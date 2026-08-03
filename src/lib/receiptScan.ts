// ============================================================
// レシート読み取り(Google Gemini API)
// カメラで撮影したレシート画像を Gemini に送り、
// 店名・合計金額・購入日を JSON で抽出してフォームに反映する。
// APIキーは Discord Webhook と同様、この端末の localStorage にのみ保存。
// ============================================================

const STORAGE_KEY = 'kakeibo.geminiApiKey'

/** このアプリが使う Gemini のモデル。接続テストでの存在確認にも使う */
export const MODEL_ID = 'gemini-2.5-flash'

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

const ENDPOINT = `${API_BASE}/models/${MODEL_ID}:generateContent`

/** モデル一覧(軽量・課金なし)。接続テストで使う */
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

/** Gemini の APIキーらしい形式か(AIza で始まる39文字前後)。違っても保存自体は許可する */
export function looksLikeGeminiKey(key: string): boolean {
  return /^AIza[0-9A-Za-z_-]{30,50}$/.test(key)
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

/** models 一覧レスポンスからモデルID(models/ を除いた形)を取り出す。(純粋関数) */
export function extractModelIds(payload: unknown): string[] {
  if (payload === null || typeof payload !== 'object') return []
  const models = (payload as { models?: unknown }).models
  if (!Array.isArray(models)) return []
  const ids: string[] = []
  for (const m of models) {
    const name = (m as { name?: unknown } | null)?.name
    if (typeof name === 'string' && name.trim() !== '') {
      ids.push(name.trim().replace(/^models\//, ''))
    }
  }
  return ids
}

/**
 * 取得できたモデル一覧から結果を組み立てる。(純粋関数)
 * このアプリが使うモデルが無ければ「キーは有効だがモデル不一致」として失敗にする。
 */
export function buildTestSuccessResult(modelIds: string[]): GeminiTestResult {
  if (!modelIds.includes(MODEL_ID)) {
    const head = modelIds.slice(0, 5).join(', ')
    return {
      ok: false,
      message:
        `キーは有効ですが、このアプリが使うモデル(${MODEL_ID})が利用できません。` +
        `利用可能: ${head === '' ? '(取得できませんでした)' : head}`,
      availableModels: modelIds,
    }
  }
  return {
    ok: true,
    message: '接続できました。レシート読み取りを利用できます',
    availableModels: modelIds,
  }
}

/** テストで差し替えられるよう、fetch の必要最小限だけを型にする */
export interface TestResponseLike {
  ok: boolean
  status: number
  text: () => Promise<string>
}
export type FetchLike = (url: string) => Promise<TestResponseLike>

/**
 * 保存済みAPIキーで疎通確認する。モデル一覧の取得(GET)だけなので課金されない。
 * 「キーが違う」「APIが未有効」「モデル名が違う」を切り分けられるメッセージを返す。
 * fetchImpl は単体テスト用の差し替え口(通常は省略)。
 */
export async function testGeminiKey(fetchImpl?: FetchLike): Promise<GeminiTestResult> {
  const key = getGeminiKey()
  if (!key) return { ok: false, message: 'APIキーが設定されていません' }

  const doFetch: FetchLike = fetchImpl ?? ((url) => fetch(url))

  let res: TestResponseLike
  try {
    res = await doFetch(`${MODELS_ENDPOINT}?key=${encodeURIComponent(key)}`)
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
  return buildTestSuccessResult(extractModelIds(json))
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
export async function scanReceipt(file: File): Promise<ReceiptScanResult> {
  const key = getGeminiKey()
  if (!key) throw new Error('先にGeminiのAPIキーを設定してください')

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

  let res: Response
  try {
    res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error('通信エラー。電波の良い場所でお試しください')
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
