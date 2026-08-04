// ============================================================
// レシート読み取り(Google Gemini API)
// カメラで撮影したレシート画像を Gemini に送り、
// 店名・合計金額・購入日を JSON で抽出してフォームに反映する。
// APIキーは Discord Webhook と同様、この端末の localStorage にのみ保存。
// ============================================================

const STORAGE_KEY = 'kakeibo.geminiApiKey'

/** 自動選択したモデル名の保存先(端末ごとのキャッシュ) */
const MODEL_STORAGE_KEY = 'kakeibo.geminiModel'

/**
 * モデル一覧が取れなかったときの最終フォールバック。
 * 通常は使わない — モデルは一覧APIから自動選択する(pickModel / resolveModel)。
 * Google はモデルを随時廃止するため、決め打ちに依存しないこと。
 */
export const MODEL_ID = 'gemini-3-flash'

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

/** 指定モデルの generateContent エンドポイント */
function generateContentEndpoint(model: string): string {
  return `${API_BASE}/models/${model}:generateContent`
}

/** モデル一覧(軽量・課金なし)。接続テストとモデル自動選択で使う */
const MODELS_ENDPOINT = `${API_BASE}/models`

export function getGeminiKey(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return null
    // 既に空白付きで保存されている場合の救済として、読み出し時にも trim する
    const key = raw.trim()
    return key === '' ? null : key
  } catch {
    return null
  }
}

export function saveGeminiKey(key: string): void {
  try {
    // 呼び出し側でも trim しているが、前後の空白は保存時にも落としておく
    localStorage.setItem(STORAGE_KEY, key.trim())
  } catch {
    // 保存できなくてもアプリは落とさない
  }
}

export function clearGeminiKey(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // no-op
  }
}

export function hasGeminiKey(): boolean {
  const key = getGeminiKey()
  return key !== null && key.trim() !== ''
}

// ---------- 使用モデルのキャッシュ ----------

/** 自動選択済みのモデル名。未解決なら null */
export function getCachedModel(): string | null {
  try {
    const raw = localStorage.getItem(MODEL_STORAGE_KEY)
    if (raw === null) return null
    const model = raw.trim()
    return model === '' ? null : model
  } catch {
    return null
  }
}

export function saveCachedModel(model: string): void {
  try {
    localStorage.setItem(MODEL_STORAGE_KEY, model.trim())
  } catch {
    // 保存できなくてもアプリは落とさない(毎回解決し直すだけ)
  }
}

/** 廃止されたモデルを掴んだときに捨てる */
export function clearCachedModel(): void {
  try {
    localStorage.removeItem(MODEL_STORAGE_KEY)
  } catch {
    // no-op
  }
}

/**
 * Gemini の APIキーらしい形式か。違っても保存自体は許可する(警告を出すだけ)。
 * - 新形式(Auth key, 2026年〜): `AQ.` で始まる。文字種・長さは今後変わりうるので緩く見る
 * - 旧形式(Standard key): `AIza` で始まる39文字前後
 */
export function looksLikeGeminiKey(key: string): boolean {
  return /^AQ\.[A-Za-z0-9_.-]{20,}$/.test(key) || /^AIza[0-9A-Za-z_-]{30,50}$/.test(key)
}

/**
 * APIキーの送り方。新形式(`AQ.…`)は `?key=` クエリでは通らず、
 * `x-goog-api-key` ヘッダーでのみ受け付けられる。旧形式(`AIza…`)も
 * このヘッダーで動くため、形式で分岐せずヘッダー方式に一本化する。
 * URL にキーを載せないので、履歴やアクセスログへの漏洩も防げる。
 */
function apiKeyHeader(key: string): Record<string, string> {
  return { 'x-goog-api-key': key }
}

export interface ReceiptScanResult {
  store: string | null
  total: number | null
  date: string | null
}

// ---------- 画像の縮小 ----------

const MAX_LONG_SIDE = 1280
const JPEG_QUALITY = 0.8

/** 撮影画像を読み込む。EXIF の回転情報は createImageBitmap で適用する */
async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  try {
    // iOS の縦撮影などで画像が横倒しにならないよう EXIF の向きを反映
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    // 古いブラウザ向けフォールバック(<img> 経由の描画は既定で EXIF の向きが反映される)
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const url = URL.createObjectURL(file)
      const img = new Image()
      img.onload = () => {
        URL.revokeObjectURL(url)
        resolve(img)
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error('画像を読み込めませんでした'))
      }
      img.src = url
    })
  }
}

/**
 * 撮影画像を長辺 1280px 程度・JPEG 品質 0.8 に縮小して base64 化する。
 * 通信量を抑え、読み取りを速く安定させるため。
 */
export async function resizeImage(file: File): Promise<{ base64: string; mimeType: string }> {
  const source = await loadBitmap(file)
  const width = 'naturalWidth' in source ? source.naturalWidth : source.width
  const height = 'naturalHeight' in source ? source.naturalHeight : source.height
  if (!width || !height) throw new Error('画像を読み込めませんでした')

  const scale = Math.min(1, MAX_LONG_SIDE / Math.max(width, height))
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('画像の変換に失敗しました')
  ctx.drawImage(source, 0, 0, w, h)
  if ('close' in source) source.close()

  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
  const comma = dataUrl.indexOf(',')
  if (comma < 0) throw new Error('画像の変換に失敗しました')
  return { base64: dataUrl.slice(comma + 1), mimeType: 'image/jpeg' }
}

// ---------- レスポンスの解析・検証 ----------

const PARSE_ERROR_MESSAGE =
  'レシートを読み取れませんでした。明るい場所でもう一度撮影してください'

/** YYYY-MM-DD 形式かつ実在しうる日付か */
function isValidDateString(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return false
  const month = Number(m[2])
  const day = Number(m[3])
  return month >= 1 && month <= 12 && day >= 1 && day <= 31
}

/**
 * Gemini generateContent のレスポンス JSON から店名・合計・日付を取り出して検証する。
 * 解析不能なら日本語メッセージで throw。個別の値が不正なときはその項目だけ null。
 * (純粋関数として切り出し、単体テストできるようにしている)
 */
export function extractReceiptFields(apiResponse: unknown): ReceiptScanResult {
  let text: unknown
  try {
    const r = apiResponse as {
      candidates?: { content?: { parts?: { text?: unknown }[] } }[]
    }
    text = r.candidates?.[0]?.content?.parts?.[0]?.text
  } catch {
    text = undefined
  }
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error(PARSE_ERROR_MESSAGE)
  }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error(PARSE_ERROR_MESSAGE)
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(PARSE_ERROR_MESSAGE)
  }
  const obj = raw as { store?: unknown; total?: unknown; date?: unknown }

  const store =
    typeof obj.store === 'string' && obj.store.trim() !== '' ? obj.store.trim() : null

  const total =
    typeof obj.total === 'number' && Number.isInteger(obj.total) && obj.total > 0
      ? obj.total
      : null

  const date =
    typeof obj.date === 'string' && isValidDateString(obj.date.trim())
      ? obj.date.trim()
      : null

  return { store, total, date }
}

/**
 * HTTP ステータスをユーザー向けの日本語メッセージに変換する。
 * apiMessage(Googleが返した原因)があれば必ず併記する — これが無いと
 * 「キーが悪いのか、モデル名が悪いのか」の切り分けができない。
 */
export function httpErrorMessage(status: number, apiMessage?: string | null): string {
  let base: string
  if (status === 401 || status === 403) {
    base = 'APIキーが無効か、権限がありません。設定を確認してください'
  } else if (status === 400) {
    // 400 はリクエスト不正・モデル名不正・スキーマ不正でも返る。キー決め打ちにしない
    base = 'リクエストが拒否されました'
  } else if (status === 404) {
    base = '指定のモデルが見つかりません'
  } else if (status === 429) {
    base = '無料枠の上限に達しました。しばらく待ってから再度お試しください'
  } else if (status >= 500) {
    base = 'Googleのサーバーが混み合っています。しばらく待ってから再度お試しください'
  } else {
    base = `読み取りに失敗しました(HTTP ${status})`
  }
  const detail = typeof apiMessage === 'string' ? apiMessage.trim() : ''
  return detail ? `${base}(詳細: ${detail})` : base
}

// ---------- 接続テスト ----------

export interface GeminiTestResult {
  ok: boolean
  /** 画面にそのまま出す日本語メッセージ */
  message: string
  /** 利用可能なモデル名(models/ を除いた形) */
  availableModels?: string[]
  /** 自動選択されたモデル名(成功時のみ) */
  model?: string
}

/**
 * Google API のエラーレスポンス本文から原因の手がかりを取り出す。(純粋関数)
 * 形式: {"error": {"code": 400, "message": "...", "status": "...", "details": [...]}}
 * message だけでなく status と details[].reason も混ぜて返し、呼び出し側が
 * SERVICE_DISABLED などで分岐できるようにする。
 * JSON でない・形が違う場合は null(呼び出し側を落とさない)。
 */
export function extractApiErrorMessage(bodyText: string): string | null {
  let payload: unknown
  try {
    payload = JSON.parse(bodyText)
  } catch {
    return null
  }
  if (payload === null || typeof payload !== 'object') return null
  const err = (payload as { error?: unknown }).error
  if (err === null || typeof err !== 'object') return null
  const e = err as { message?: unknown; status?: unknown; details?: unknown }

  const parts: string[] = []
  if (typeof e.message === 'string' && e.message.trim() !== '') parts.push(e.message.trim())
  if (typeof e.status === 'string' && e.status.trim() !== '') parts.push(e.status.trim())
  if (Array.isArray(e.details)) {
    for (const d of e.details) {
      const reason = (d as { reason?: unknown } | null)?.reason
      if (typeof reason === 'string' && reason.trim() !== '' && !parts.includes(reason.trim())) {
        parts.push(reason.trim())
      }
    }
  }
  return parts.length > 0 ? parts.join(' / ') : null
}

/**
 * 失敗レスポンスを、原因別の対処法付き日本語メッセージにする。(純粋関数)
 * detail は extractApiErrorMessage で取り出した Google 自身のメッセージ。
 * ステータス+詳細で「キーが違う/APIが未有効/キーの制限」を切り分ける。
 */
export function buildTestFailureMessage(status: number, detail: string | null): string {
  const d = detail ?? ''
  let base: string
  if (status === 400 && d.includes('API key not valid')) {
    base =
      'APIキーが正しくありません。AI Studio (aistudio.google.com/apikey) で発行したキーをコピーし直してください'
  } else if (status === 403 && (d.includes('SERVICE_DISABLED') || d.includes('has not been used'))) {
    base =
      'このプロジェクトで Generative Language API が有効化されていません。詳細に表示されるURLから有効化してください'
  } else if (status === 403) {
    base =
      'APIキーの制限により拒否されました。Google Cloud Console でキーの制限設定を確認してください'
  } else {
    // それ以外は既存の変換に任せる(詳細の併記もそちらが行う)
    return httpErrorMessage(status, detail)
  }
  return detail ? `${base}(詳細: ${detail})` : base
}

/** モデル一覧の1要素(必要な項目だけ) */
export interface GeminiModelInfo {
  name: string
  supportedGenerationMethods?: string[]
}

/** models 一覧レスポンスから必要な項目だけ取り出す。(純粋関数) */
export function extractModelEntries(payload: unknown): GeminiModelInfo[] {
  if (payload === null || typeof payload !== 'object') return []
  const models = (payload as { models?: unknown }).models
  if (!Array.isArray(models)) return []
  const entries: GeminiModelInfo[] = []
  for (const m of models) {
    const name = (m as { name?: unknown } | null)?.name
    if (typeof name !== 'string' || name.trim() === '') continue
    const methods = (m as { supportedGenerationMethods?: unknown }).supportedGenerationMethods
    entries.push({
      name: name.trim(),
      supportedGenerationMethods: Array.isArray(methods)
        ? methods.filter((x): x is string => typeof x === 'string')
        : undefined,
    })
  }
  return entries
}

/** models 一覧レスポンスからモデルID(models/ を除いた形)を取り出す。(純粋関数) */
export function extractModelIds(payload: unknown): string[] {
  return extractModelEntries(payload).map(toModelId)
}

/** "models/gemini-3-flash" → "gemini-3-flash" */
function toModelId(m: { name: string }): string {
  return m.name.trim().replace(/^models\//, '')
}

/**
 * 優先して使いたいモデル(前方一致で判定するので、
 * `-preview` や `-001` などのサフィックス付きにも当たる)。
 * 無料枠の対象は Flash / Flash-Lite 系のみなので Pro 系は入れない。
 */
const PREFERRED_MODELS = ['gemini-3.5-flash', 'gemini-3-flash', 'gemini-2.5-flash']

/** OCR用途に使えないモデル(画像生成・埋め込み・質問応答専用)を弾く */
const EXCLUDED_PATTERN = /(image|embedding|aqa)/i

/** モデル名からバージョン番号を取り出す。"gemini-3.5-flash" → 3.5。取れなければ null */
function modelVersion(id: string): number | null {
  const m = /(\d+(?:\.\d+)?)/.exec(id)
  if (!m) return null
  const v = Number(m[1])
  return Number.isFinite(v) ? v : null
}

/**
 * 利用可能なモデル一覧から、このアプリで使うモデルを1つ選ぶ。(純粋関数)
 *
 * - `generateContent` 非対応のものは除外(配列自体が無い場合は候補に残す)
 * - 画像生成(`image`)・埋め込み(`embedding`)・`aqa` は除外
 * - 無料枠の対象である Flash 系を優先し、PREFERRED_MODELS の順に前方一致で採用
 * - どれにも当たらなければ Flash 系のうちバージョン番号が新しいものを採用
 * - Flash 系が無ければ generateContent 対応の先頭、候補ゼロなら null
 */
export function pickModel(models: GeminiModelInfo[]): string | null {
  if (!Array.isArray(models)) return null

  const candidates = models
    .filter((m): m is GeminiModelInfo => typeof m?.name === 'string' && m.name.trim() !== '')
    .filter(
      (m) =>
        !Array.isArray(m.supportedGenerationMethods) ||
        m.supportedGenerationMethods.includes('generateContent'),
    )
    .map(toModelId)
    .filter((id) => !EXCLUDED_PATTERN.test(id))

  if (candidates.length === 0) return null

  const flash = candidates.filter((id) => /flash/i.test(id))

  for (const prefix of PREFERRED_MODELS) {
    const matched = flash.filter((id) => id.startsWith(prefix))
    if (matched.length === 0) continue
    // 完全一致 > 通常版 > lite版 の順。同じ前置きでも安定して同じものを選ぶため
    return (
      matched.find((id) => id === prefix) ??
      matched.find((id) => !/lite/i.test(id)) ??
      matched[0]
    )
  }

  if (flash.length > 0) {
    // 名前からバージョン番号を拾って新しい順に。取れないものは末尾へ(同点は元の順)
    const sorted = flash
      .map((id, index) => ({ id, index, version: modelVersion(id) }))
      .sort((a, b) => {
        if (a.version === b.version) return a.index - b.index
        if (a.version === null) return 1
        if (b.version === null) return -1
        return b.version - a.version
      })
    return sorted[0].id
  }

  return candidates[0]
}

/**
 * 取得できたモデル一覧から接続テスト結果を組み立てる。(純粋関数)
 * 使えるモデルが1つも選べなければ「キーは有効だがモデル不一致」として失敗にする。
 */
export function buildTestSuccessResult(models: GeminiModelInfo[]): GeminiTestResult {
  const modelIds = models.map(toModelId)
  const picked = pickModel(models)
  if (picked === null) {
    const head = modelIds.slice(0, 5).join(', ')
    return {
      ok: false,
      message:
        'キーは有効ですが、レシート読み取りに使えるモデルが見つかりませんでした。' +
        `利用可能: ${head === '' ? '(取得できませんでした)' : head}`,
      availableModels: modelIds,
    }
  }
  return {
    ok: true,
    message: `接続できました(使用モデル: ${picked})。レシート読み取りを利用できます`,
    availableModels: modelIds,
    model: picked,
  }
}

/** テストで差し替えられるよう、fetch の必要最小限だけを型にする */
export interface TestResponseLike {
  ok: boolean
  status: number
  text: () => Promise<string>
}
export interface RequestInitLike {
  method?: string
  headers?: Record<string, string>
  body?: string
}
export type FetchLike = (url: string, init?: RequestInitLike) => Promise<TestResponseLike>
/** 読み取り本体は JSON も読むので json() が要る(本物の Response もこの形を満たす) */
export interface ScanResponseLike extends TestResponseLike {
  json: () => Promise<unknown>
}
export type ScanFetchLike = (url: string, init?: RequestInitLike) => Promise<ScanResponseLike>

/**
 * 保存済みAPIキーで疎通確認する。モデル一覧の取得(GET)だけなので課金されない。
 * 「キーが違う」「APIが未有効」「モデル名が違う」を切り分けられるメッセージを返す。
 * fetchImpl は単体テスト用の差し替え口(通常は省略)。
 */
export async function testGeminiKey(fetchImpl?: FetchLike): Promise<GeminiTestResult> {
  const key = getGeminiKey()
  if (!key) return { ok: false, message: 'APIキーが設定されていません' }

  const doFetch: FetchLike = fetchImpl ?? ((url, init) => fetch(url, init))

  let res: TestResponseLike
  try {
    // キーは URL ではなく x-goog-api-key ヘッダーで送る(新形式キー対応)
    res = await doFetch(MODELS_ENDPOINT, { method: 'GET', headers: apiKeyHeader(key) })
  } catch {
    return { ok: false, message: '通信エラー。電波の良い場所でお試しください' }
  }

  let body = ''
  try {
    body = await res.text()
  } catch {
    body = ''
  }

  if (!res.ok) {
    return {
      ok: false,
      message: buildTestFailureMessage(res.status, extractApiErrorMessage(body)),
    }
  }

  let json: unknown = null
  try {
    json = JSON.parse(body)
  } catch {
    json = null
  }
  const result = buildTestSuccessResult(extractModelEntries(json))
  // テストは実質「モデルの再解決」でもある。ここで結果をキャッシュしておくと、
  // モデルが廃止されたときにユーザーが接続テストを押すだけで復旧できる。
  if (result.ok && result.model) saveCachedModel(result.model)
  return result
}

// ---------- 使用モデルの解決 ----------

/**
 * モデル一覧を取得して、このアプリで使うモデルを決める。結果は localStorage にキャッシュする。
 * 一覧が取れない・選べない場合は MODEL_ID(最終フォールバック)を返し、キャッシュはしない。
 * fetchImpl は単体テスト用の差し替え口(通常は省略)。
 */
export async function resolveModel(fetchImpl?: FetchLike): Promise<string> {
  const key = getGeminiKey()
  if (!key) throw new Error('先にGeminiのAPIキーを設定してください')

  const doFetch: FetchLike = fetchImpl ?? ((url, init) => fetch(url, init as RequestInit))

  try {
    // キーは URL ではなく x-goog-api-key ヘッダーで送る(新形式キー対応)
    const res = await doFetch(MODELS_ENDPOINT, { method: 'GET', headers: apiKeyHeader(key) })
    if (res.ok) {
      const picked = pickModel(extractModelEntries(JSON.parse(await res.text())))
      if (picked !== null) {
        saveCachedModel(picked)
        return picked
      }
    }
  } catch {
    // 通信エラー・JSON崩れは握りつぶしてフォールバックへ(読み取り自体は試みる)
  }
  return MODEL_ID
}

// ---------- 読み取り本体 ----------

const PROMPT =
  'このレシート画像から次を抽出してJSONで返してください。' +
  'store: 店名(チェーン名を優先、支店名は省略可)。' +
  'total: 支払い合計金額(円、整数。税込の最終支払額)。' +
  'date: 購入日(YYYY-MM-DD)。' +
  '読み取れない項目は null にしてください。'

/**
 * レシート画像を Gemini に送り、店名・合計金額・購入日を抽出する。
 * 失敗時は日本語メッセージの Error を throw する。
 */
export async function scanReceipt(
  file: File,
  fetchImpl?: ScanFetchLike,
): Promise<ReceiptScanResult> {
  const key = getGeminiKey()
  if (!key) throw new Error('先にGeminiのAPIキーを設定してください')

  const doFetch: ScanFetchLike = fetchImpl ?? ((url, init) => fetch(url, init as RequestInit))

  const { base64, mimeType } = await resizeImage(file)

  const body = {
    contents: [
      {
        parts: [
          { inline_data: { mime_type: mimeType, data: base64 } },
          { text: PROMPT },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          store: { type: 'STRING', nullable: true },
          total: { type: 'INTEGER', nullable: true },
          date: { type: 'STRING', nullable: true },
        },
      },
    },
  }

  const payload = JSON.stringify(body)

  const post = async (model: string): Promise<ScanResponseLike> => {
    try {
      // キーは URL ではなく x-goog-api-key ヘッダーで送る(新形式キー対応)
      return await doFetch(generateContentEndpoint(model), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...apiKeyHeader(key) },
        body: payload,
      })
    } catch {
      throw new Error('通信エラー。電波の良い場所でお試しください')
    }
  }

  // キャッシュがあればそれを使い、無ければ一覧から解決する
  let model = getCachedModel() ?? (await resolveModel(fetchImpl))
  let res = await post(model)

  // 404(モデル廃止)なら、キャッシュを捨てて1度だけ再解決してやり直す。
  // リトライは1回だけ(無限ループ防止)。
  if (!res.ok && res.status === 404) {
    clearCachedModel()
    const resolved = await resolveModel(fetchImpl)
    // 同じモデルに解決されたなら投げ直しても同じ404なので、そのままエラーにする
    if (resolved !== model) {
      model = resolved
      res = await post(model)
    }
  }

  if (!res.ok) {
    // エラー本文から Google のメッセージを拾って併記する(読めなくても落とさない)
    let apiMessage: string | null = null
    try {
      apiMessage = extractApiErrorMessage(await res.text())
    } catch {
      apiMessage = null
    }
    throw new Error(httpErrorMessage(res.status, apiMessage))
  }

  let json: unknown
  try {
    json = await res.json()
  } catch {
    throw new Error(PARSE_ERROR_MESSAGE)
  }
  return extractReceiptFields(json)
}
