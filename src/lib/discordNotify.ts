import type { TransactionType } from './types'
import { yen } from './format'
import { categoryLabel } from './categories'

// ============================================================
// Discord Webhook 通知
// 彼女の預かり残高が増減したとき、設定済みの Discord チャンネルへ
// Webhook で通知する。通知はあくまで補助機能であり、送信に失敗しても
// 家計簿の記録・同期は一切止めない(throw しない)のが絶対条件。
// Webhook URL はこの端末の localStorage にのみ保存されるため、
// 通知されるのは「この端末で記録して同期された分」だけ。
// ============================================================

const STORAGE_KEY = 'kakeibo.discordWebhook'

export function getWebhookUrl(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function saveWebhookUrl(url: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, url)
  } catch {
    // 保存できなくてもアプリは落とさない
  }
}

export function clearWebhookUrl(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // no-op
  }
}

export function isValidWebhookUrl(url: string): boolean {
  return (
    url.startsWith('https://discord.com/api/webhooks/') ||
    url.startsWith('https://discordapp.com/api/webhooks/')
  )
}

/**
 * 設定済みの Webhook URL へメッセージを送る。
 * 未設定なら何もせず false。失敗しても throw せず false(コンソール警告のみ)。
 * Discord の Webhook エンドポイントはブラウザからの fetch に CORS 対応済み。
 */
export async function sendDiscordMessage(content: string): Promise<boolean> {
  const url = getWebhookUrl()
  if (!url) return false
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
    if (!res.ok) {
      console.warn(`Discord通知の送信に失敗しました (HTTP ${res.status})`)
      return false
    }
    return true
  } catch (e) {
    console.warn('Discord通知の送信に失敗しました', e)
    return false
  }
}

export function sendTestMessage(): Promise<boolean> {
  return sendDiscordMessage('✅ 家計簿アプリと接続できました')
}

// ---------- メッセージ整形 ----------

// 差分の符号付き円表示(負号は見やすい U+2212 を使う)
function signedDelta(n: number): string {
  return n >= 0 ? `+${yen(n)}` : `−${yen(Math.abs(n))}`
}

function balanceLine(balance: number): string {
  const text = balance < 0 ? `−${yen(Math.abs(balance))}` : yen(balance)
  return `残高: ${text}`
}

export type PartnerNotification =
  | { kind: 'deposit'; amount: number; balance: number } // 預かり追加
  | { kind: 'expense'; label: string; amount: number; balance: number } // 支出の差引
  | { kind: 'update'; delta: number; balance: number } // 修正で残高が変わった
  | { kind: 'delete'; delta: number; balance: number } // 削除で残高が変わった
  | { kind: 'generic'; balance: number } // 旧行不明などで差分を出せないとき

export function formatPartnerNotification(n: PartnerNotification): string {
  switch (n.kind) {
    case 'deposit':
      return `💰 預かりを受け取りました +${yen(n.amount)}\n${balanceLine(n.balance)}`
    case 'expense':
      return `🍽️ ${n.label} −${yen(n.amount)}\n${balanceLine(n.balance)}`
    case 'update':
      return `✏️ 記録が修正されました(差分 ${signedDelta(n.delta)})\n${balanceLine(n.balance)}`
    case 'delete':
      return `🗑 記録が削除されました(差分 ${signedDelta(n.delta)})\n${balanceLine(n.balance)}`
    case 'generic':
      return `🔔 預かり残高が更新されました\n${balanceLine(n.balance)}`
  }
}

// ---------- 残高への影響額の判定 ----------

// Transaction / TransactionInput の両方を構造的に受けられる最小の形
interface PartnerTxLike {
  type: TransactionType
  amount: number
  partner_amount: number
}

/** 取引1件が彼女残高に与える影響額(+なら残高が増える) */
export function partnerImpact(t: PartnerTxLike): number {
  return t.type === 'partner_deposit' ? t.amount : -t.partner_amount
}

/** 取引一覧から彼女の預かり残高を計算する */
export function partnerBalance(rows: PartnerTxLike[]): number {
  return rows.reduce((sum, t) => sum + partnerImpact(t), 0)
}

// PendingOp(offlineQueue.ts)を構造的に受けられる最小の形
export interface PartnerOpLike {
  kind: 'insert' | 'update' | 'delete'
  id: string
  payload?: PartnerTxLike & { category: string | null; memo: string }
}

/**
 * 同期に成功した op が彼女残高に影響する場合、その通知メッセージを組み立てる。
 * 影響しない op は null(通知しない)。
 * - oldRows: op 適用「前」のローカル状態(update/delete の旧行の検索に使う)
 * - newRows: op 適用「後」のローカル状態(通知に載せる残高の計算に使う)
 */
export function buildPartnerOpMessage(
  op: PartnerOpLike,
  oldRows: (PartnerTxLike & { id: string })[],
  newRows: PartnerTxLike[]
): string | null {
  const balance = partnerBalance(newRows)

  if (op.kind === 'insert') {
    const p = op.payload
    if (!p) return null
    if (p.type === 'partner_deposit') {
      return formatPartnerNotification({ kind: 'deposit', amount: p.amount, balance })
    }
    if (p.partner_amount > 0) {
      return formatPartnerNotification({
        kind: 'expense',
        label: p.memo || categoryLabel(p.category),
        amount: p.partner_amount,
        balance,
      })
    }
    return null
  }

  const old = oldRows.find((r) => r.id === op.id)

  if (op.kind === 'update') {
    const p = op.payload
    if (!p) return null
    if (old) {
      const delta = partnerImpact(p) - partnerImpact(old)
      if (delta === 0) return null
      return formatPartnerNotification({ kind: 'update', delta, balance })
    }
    // 旧行が見つからない(キャッシュに未反映等)— 差分は出せないので汎用文
    if (partnerImpact(p) === 0) return null
    return formatPartnerNotification({ kind: 'generic', balance })
  }

  // delete: 旧行の影響の打ち消し(符号反転)
  if (old) {
    const delta = -partnerImpact(old)
    if (delta === 0) return null
    return formatPartnerNotification({ kind: 'delete', delta, balance })
  }
  // 旧行が見つからない削除 — 影響の有無を判定できないので汎用文
  return formatPartnerNotification({ kind: 'generic', balance })
}
