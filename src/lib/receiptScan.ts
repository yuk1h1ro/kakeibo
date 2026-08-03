// ============================================================
// レシート読み取り(Google Gemini API)
// カメラで撮影したレシート画像を Gemini に送り、
// 店名・合計金額・購入日を JSON で抽出してフォームに反映する。
// APIキーは Discord Webhook と同様、この端末の localStorage にのみ保存。
// ============================================================

const STORAGE_KEY = 'kakeibo.geminiApiKey'

const ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'

export function getGeminiKey(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function saveGeminiKey(key: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, key)
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
 * Gemini のエラーレスポンス本文から Google 自身のメッセージを取り出す。
 * 形式: {"error": {"code": 400, "message": "...", "status": "INVALID_ARGUMENT"}}
 * JSON でない・形が違う場合は null(呼び出し側を落とさない)。
 */
export function extractApiErrorMessage(bodyText: string): string | null {
  let raw: unknown
  try {
    raw = JSON.parse(bodyText)
  } catch {
    return null
  }
  if (raw === null || typeof raw !== 'object') return null
  const err = (raw as { error?: unknown }).error
  if (err === null || typeof err !== 'object') return null
  const { message, status } = err as { message?: unknown; status?: unknown }
  if (typeof message === 'string' && message.trim() !== '') return message.trim()
  if (typeof status === 'string' && status.trim() !== '') return status.trim()
  return null
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
