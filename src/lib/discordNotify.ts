// 通知文は目隠し(機能169)の対象外。彼女の端末に届く文章なので、
// こちらの画面が伏字になっているかどうかで中身が変わってはいけない
import { yenPlain as yen } from './format'
import { categoryLabel } from './categories'
import {
  balanceWording,
  lowBalanceAction,
  partnerBalance,
  partnerImpact,
  type PartnerTxLike,
} from './partnerBalance'
import { loadLowBalanceThreshold } from './lowBalanceSettings'
import { getWebhookUrl } from './discordWebhook'

// 残高計算の本体は partnerBalance.ts(純粋関数)に置いてある。
// 従来ここから import していた箇所のために再エクスポートする。
export { partnerBalance, partnerImpact }
export type { PartnerTxLike }

// ============================================================
// Discord Webhook 通知
// 彼女の預かり残高が増減したとき、設定済みの Discord チャンネルへ
// Webhook で通知する。通知はあくまで補助機能であり、送信に失敗しても
// 家計簿の記録・同期は一切止めない(throw しない)のが絶対条件。
//
// Webhook URL の置き場所は discordWebhook.ts に移した(Supabase +
// localStorage キャッシュ)。以前はこの端末の localStorage にしか無く、
// 「PCでは設定したがスマホではしていない」ために、いちばん入力に使っている
// スマホからの記録だけが通知されていなかった。いまはどの端末で設定しても
// 全部の端末から通知が飛ぶ。
// ============================================================

// 保存場所が変わっても呼び出し側(monthlySummary など)は変えずに済むよう、
// 従来どおりこのモジュールからも読めるようにしておく
export {
  getWebhookUrl,
  saveWebhookUrl,
  clearWebhookUrl,
  isValidWebhookUrl,
  maskWebhookUrl,
} from './discordWebhook'

/**
 * テスト送信の結果。
 *
 * 成否だけを返していた頃は「送信に失敗しました。URLと通信状態を確認してください」と
 * 両方を並べるしかなく、いちばん多い原因(チャンネルを作り直して Webhook URL が
 * 無効になった)にたどり着けなかった。理由まで持ち帰って文言を出し分ける。
 */
export type DiscordFailure =
  /** fetch そのものが失敗した = 届いていない(オフライン・遮断など) */
  | { kind: 'network' }
  /** Discord が URL を受け付けなかった (401/403/404) = Webhook が無効 */
  | { kind: 'webhook'; status: number }
  /** それ以外の HTTP エラー(混雑・一時的な不調など) */
  | { kind: 'http'; status: number }

export type DiscordSendResult = { ok: true } | { ok: false; failure: DiscordFailure }

/**
 * HTTP のステータスから失敗の種類を決める。(純粋関数)
 *
 * Discord は、消えた Webhook に 404、トークンが違えば 401、
 * 権限が無ければ 403 を返す。いずれも待っても直らない = URL を入れ直す話。
 * 429(混雑)や 5xx は待てば直るので、混ぜない。
 */
export function classifyDiscordStatus(status: number): DiscordFailure {
  if (status === 401 || status === 403 || status === 404) return { kind: 'webhook', status }
  return { kind: 'http', status }
}

/**
 * テスト送信が失敗したときに画面へ出す文言。(純粋関数)
 * どの場合も「次に何をするか」を必ず1つ書く。分からないことは断定しない。
 */
export function discordFailureMessage(failure: DiscordFailure): string {
  if (failure.kind === 'webhook') {
    return (
      'Discord に送れませんでした。Webhook URL が古い可能性があります' +
      '(チャンネルを削除・作り直すと、それまでの URL は無効になります)。' +
      'Discord のチャンネル設定 → 連携サービス → ウェブフックで URL をコピーし直し、' +
      'いったん「解除」してから貼り直して保存してください。'
    )
  }
  if (failure.kind === 'network') {
    return (
      'Discord に届きませんでした。この端末が通信できていないか、通信が不安定な可能性があります。' +
      '電波か Wi-Fi を確かめて、もう一度テスト送信してください。'
    )
  }
  return (
    `Discord に断られました(HTTP ${failure.status})。しばらく待ってから、もう一度テスト送信してください。` +
    'それでも直らないときは、Discord のチャンネル設定 → 連携サービス → ウェブフックで ' +
    'URL をコピーし直し、いったん「解除」してから貼り直して保存してください。'
  )
}

/**
 * 設定済みの Webhook URL へメッセージを送り、失敗の理由まで返す。
 * 失敗しても throw しない(通知は補助機能で、記録・同期を止めてはいけない)。
 * Discord の Webhook エンドポイントはブラウザからの fetch に CORS 対応済み。
 */
export async function sendDiscordMessageWithResult(content: string): Promise<DiscordSendResult> {
  const url = getWebhookUrl()
  // URL 未設定は「失敗」ではない(通知を使っていないだけ)。
  // それでも呼ばれたときのために、届いていないことは network として返す
  if (!url) return { ok: false, failure: { kind: 'network' } }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
    if (!res.ok) {
      console.warn(`Discord通知の送信に失敗しました (HTTP ${res.status})`)
      return { ok: false, failure: classifyDiscordStatus(res.status) }
    }
    return { ok: true }
  } catch (e) {
    console.warn('Discord通知の送信に失敗しました', e)
    return { ok: false, failure: { kind: 'network' } }
  }
}

/** 成否だけでよい呼び出し側(残高通知など)向けの薄い包み */
export async function sendDiscordMessage(content: string): Promise<boolean> {
  return (await sendDiscordMessageWithResult(content)).ok
}

export function sendTestMessage(): Promise<DiscordSendResult> {
  return sendDiscordMessageWithResult('✅ 家計簿アプリと接続できました')
}

// ---------- メッセージ整形 ----------

// 差分の符号付き円表示(負号は見やすい U+2212 を使う)
function signedDelta(n: number): string {
  return n >= 0 ? `+${yen(n)}` : `−${yen(Math.abs(n))}`
}

/**
 * 残高の1行。符号だけでは「預かり」なのか「貸し」なのか読めないので、
 * 機能011 の言い回し(partnerBalance.ts)をそのまま載せる。
 */
export function balanceLine(balance: number): string {
  const w = balanceWording(balance)
  return balance === 0 ? `残高: ${yen(0)}(${w.title})` : `残高: ${yen(w.magnitude)}(${w.title})`
}

export type PartnerNotification =
  | { kind: 'deposit'; amount: number; balance: number } // 預かり追加(現金で受け取った場合も同じ)
  | { kind: 'expense'; label: string; amount: number; balance: number } // 支出の差引
  | { kind: 'partnerPaid'; label: string; amount: number; balance: number } // 彼女が払った回 (機能018)
  | { kind: 'refund'; amount: number; balance: number } // 彼女に返した (機能012)
  | { kind: 'adjust'; delta: number; reason: string; balance: number } // 手動調整 (機能012)
  | { kind: 'update'; delta: number; balance: number } // 修正で残高が変わった
  | { kind: 'delete'; delta: number; balance: number } // 削除で残高が変わった
  | { kind: 'generic'; balance: number } // 旧行不明などで差分を出せないとき

export function formatPartnerNotification(n: PartnerNotification): string {
  switch (n.kind) {
    case 'deposit':
      return `💰 預かりを受け取りました +${yen(n.amount)}\n${balanceLine(n.balance)}`
    case 'expense':
      return `🍽️ ${n.label} −${yen(n.amount)}\n${balanceLine(n.balance)}`
    case 'partnerPaid':
      return `🙏 ${n.label} は彼女が払いました +${yen(n.amount)}\n${balanceLine(n.balance)}`
    case 'refund':
      return `↩️ 預かりを返しました −${yen(n.amount)}\n${balanceLine(n.balance)}`
    case 'adjust':
      return `🛠 残高を調整しました(${signedDelta(n.delta)}${n.reason ? ` / ${n.reason}` : ''})\n${balanceLine(n.balance)}`
    case 'update':
      return `✏️ 記録が修正されました(差分 ${signedDelta(n.delta)})\n${balanceLine(n.balance)}`
    case 'delete':
      return `🗑 記録が削除されました(差分 ${signedDelta(n.delta)})\n${balanceLine(n.balance)}`
    case 'generic':
      return `🔔 預かり残高が更新されました\n${balanceLine(n.balance)}`
  }
}

// ---------- 残高の低下アラート (機能010) ----------
//
// Discord にも載せる判断をした理由:
//   このアラートの目的は「次の預かりをお願いする」ことで、相手は彼女。
//   アプリ内表示だけだと、彼女が知るのは次に共有ページを開いたときになり、
//   気付くのが遅れる。Discord は既に2人で見ている場所なので、ここが最短。
// 過剰にならないための歯止め:
//   しきい値を **またいだ瞬間だけ** 送る(lowBalanceAction)。下回ったままの日は
//   何日続いても送らない。しきい値以上に戻ると、また鳴らせる状態に戻る。
//   「鳴らした印」は端末の localStorage に持つ。Webhook URL は端末間で同期する
//   ようになったが、この印は同期しない ——「1回だけ」の意味を端末ごとにしておけば、
//   同期の失敗で印が消えても最悪もう1通鳴るだけで済む(逆に、印だけが同期されて
//   URL が届いていない端末があると、鳴るべき1通が消える)。

const LOW_ALERT_KEY = 'kakeibo.lowBalanceNotified'

export function isLowBalanceNotified(): boolean {
  try {
    return localStorage.getItem(LOW_ALERT_KEY) === '1'
  } catch {
    return false
  }
}

function setLowBalanceNotified(on: boolean): void {
  try {
    if (on) localStorage.setItem(LOW_ALERT_KEY, '1')
    else localStorage.removeItem(LOW_ALERT_KEY)
  } catch {
    // 保存できないときは、最悪もう一度鳴るだけ(記録には影響しない)
  }
}

export function formatLowBalanceAlert(balance: number, threshold: number): string {
  const w = balanceWording(balance)
  const head =
    balance < 0
      ? `⚠️ 預かりを使い切り、いま ${yen(w.magnitude)} を立て替えています`
      : `⚠️ 預かり残高が少なくなりました(残り ${yen(w.magnitude)})`
  return `${head}\nお知らせの基準: ${yen(threshold)}を下回ったとき`
}

/**
 * 残高が確定したあとに呼ぶ。しきい値をまたいだときだけ Discord に送る。
 * 送ったら true。例外は投げない(通知は記録を止めない)。
 */
export function notifyLowBalanceIfNeeded(balance: number): boolean {
  const threshold = loadLowBalanceThreshold()
  const action = lowBalanceAction(balance, threshold, isLowBalanceNotified())
  if (action === 'rearm') {
    setLowBalanceNotified(false)
    return false
  }
  if (action !== 'notify') return false
  setLowBalanceNotified(true)
  // Webhook 未設定なら sendDiscordMessage が何もしない。
  // 印は立てたままにする(設定した瞬間に過去のアラートが飛ぶのを防ぐ)
  void sendDiscordMessage(formatLowBalanceAlert(balance, threshold))
  return true
}

// ---------- 残高への影響額の判定 ----------

// PendingOp(offlineQueue.ts)を構造的に受けられる最小の形。
// store は旧バージョンで積まれたキュー(store 追加以前)に無いことがあるため optional
export interface PartnerOpLike {
  kind: 'insert' | 'update' | 'delete'
  id: string
  payload?: PartnerTxLike & { category: string | null; memo: string; store?: string }
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
    // 機能012: 返金・手動調整。残高が動いた理由をそのまま伝える
    if (p.type === 'partner_refund') {
      return formatPartnerNotification({ kind: 'refund', amount: p.amount, balance })
    }
    if (p.type === 'partner_adjust') {
      return formatPartnerNotification({
        kind: 'adjust',
        delta: p.amount,
        reason: p.memo,
        balance,
      })
    }
    // 表題の優先順位: お店 → メモ → カテゴリ名
    const label = p.store || p.memo || categoryLabel(p.category)
    const impact = partnerImpact(p)
    // 機能018: 彼女が払いすぎた回は残高が増えるので、差引とは別の文言にする
    if (impact > 0) {
      return formatPartnerNotification({ kind: 'partnerPaid', label, amount: impact, balance })
    }
    if (impact < 0) {
      return formatPartnerNotification({ kind: 'expense', label, amount: -impact, balance })
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
