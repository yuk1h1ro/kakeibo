// ============================================================
// 彼女の預かり残高 — 計算と言い回しの一元管理
//   機能011 マイナス残高(=彼女への貸し)の扱い
//   機能012 返金・手動調整
//   機能018 1件を複数人で分けて立替
//   機能010 残高の低下アラート
//
// このアプリの存在理由は「預かり残高が常に正しいこと」なので、
// 残高に関わる計算は **すべてこのファイルの純粋関数** に集める。
// React にも Supabase にも依存しないので、組み合わせを単体テストで固められる。
//
// 画面(入力タブ・彼女タブ・共有ページ)や Discord 通知が
// それぞれ独自に reduce を書くと、機能を足すたびにどこか1か所が取り残されて
// 残高が食い違う。以後 balance を出すときは必ず partnerBalance() を通すこと。
// ============================================================

import type { TransactionType } from './types'
import { partnerPaid } from './types'

/** 残高計算に必要な最小の形(Transaction を構造的に受ける) */
export interface PartnerTxLike {
  type: TransactionType
  /** 円。partner_adjust のときだけ符号つき(マイナスもあり得る) */
  amount: number
  /** 支出のうち彼女が負担すべき額 */
  partner_amount: number
  /** 支出のうち彼女が実際に払った額 (機能018)。無ければ 0 = 自分が全額払った */
  partner_paid?: number | null
}

/**
 * 取引1件が預かり残高に与える影響額。(純粋関数)
 * プラス = 私が彼女のお金を余計に持っている(彼女に返すべき額が増える)。
 *
 * 支出の式が `彼女が払った額 − 彼女の負担分` なのがこの機能群の要。
 *   - 自分が全額払った (partner_paid = 0) → −彼女の負担分  … 従来どおり
 *   - 彼女が全額払った (partner_paid = amount) → +自分の負担分
 *   - 分けて払った → 彼女が払いすぎた分だけプラス、足りない分だけマイナス
 * 既存の行は partner_paid が無い(=0)ので、式を変えても過去の残高は1円も動かない。
 */
export function partnerImpact(t: PartnerTxLike): number {
  switch (t.type) {
    case 'partner_deposit':
      // 預かった / 現金で受け取った
      return t.amount
    case 'partner_refund':
      // 彼女に返した
      return -t.amount
    case 'partner_adjust':
      // 手動調整。amount が符号つきで、そのまま残高に効く
      return t.amount
    case 'expense':
      return partnerPaid(t) - t.partner_amount
  }
}

/** 取引一覧から預かり残高を計算する。(純粋関数) */
export function partnerBalance(rows: readonly PartnerTxLike[]): number {
  return rows.reduce((sum, t) => sum + partnerImpact(t), 0)
}

/** 残高に影響する行だけを取り出す。(純粋関数。彼女タブの「動きの履歴」用) */
export function partnerMovements<T extends PartnerTxLike>(rows: readonly T[]): T[] {
  return rows.filter((t) => partnerImpact(t) !== 0)
}

// ---------- 符号の意味を言葉にする (機能011) ----------

/**
 * 残高の向き。
 * - holding … プラス。彼女のお金を私が預かっている(いずれ返す/使う)
 * - lent    … マイナス。私が彼女の分を立て替えている(彼女への貸し)
 * - even    … ゼロ。貸し借り無し
 */
export type BalanceDirection = 'holding' | 'lent' | 'even'

export function balanceDirection(balance: number): BalanceDirection {
  if (balance > 0) return 'holding'
  if (balance < 0) return 'lent'
  return 'even'
}

export interface BalanceWording {
  /** 見出し。符号の意味がひと目で分かる言葉にする */
  title: string
  /** 表示する金額(常に絶対値。符号は見出しと色で伝える) */
  magnitude: number
  /** 補足の1行 */
  note: string
}

/**
 * 利用者側の画面に出す言い回し。(純粋関数)
 *
 * 「−3,000円」とだけ出しても、預かりが減ったのか貸しが増えたのか読めない。
 * 符号の意味は数字ではなく言葉で伝える。
 */
export function balanceWording(balance: number): BalanceWording {
  switch (balanceDirection(balance)) {
    case 'holding':
      return {
        title: '預かり中',
        magnitude: balance,
        note: '彼女から預かっているお金の残りです',
      }
    case 'lent':
      return {
        title: '立て替え中(彼女への貸し)',
        magnitude: -balance,
        note: '預かり分を使い切り、この額を彼女の代わりに払っています',
      }
    case 'even':
      return { title: '貸し借りなし', magnitude: 0, note: 'ちょうど精算できています' }
  }
}

/**
 * 共有ページ(彼女が見る画面)の言い回し。(純粋関数)
 * 主語が入れ替わるので、利用者側の文言をそのまま使わない。
 */
export function partnerViewWording(balance: number): BalanceWording {
  switch (balanceDirection(balance)) {
    case 'holding':
      return {
        title: 'あずけているお金ののこり',
        magnitude: balance,
        note: 'あずけたお金から、あなたの分を引いた残りです',
      }
    case 'lent':
      return {
        title: 'たてかえてもらっている分',
        magnitude: -balance,
        note: 'あずけたお金は使い切っていて、いまはこの額を立て替えてもらっています',
      }
    case 'even':
      return { title: 'かしかりなし', magnitude: 0, note: 'ちょうど精算できています' }
  }
}

// ---------- 残高の低下アラート (機能010) ----------

/** しきい値の既定値(円)。設定画面から変えられる */
export const DEFAULT_LOW_BALANCE_THRESHOLD = 1000

/** しきい値として受け付ける上限。誤入力で常時アラートになるのを防ぐ */
export const MAX_LOW_BALANCE_THRESHOLD = 1_000_000

/** 入力された値をしきい値として使える形に丸める。(純粋関数) */
export function normalizeThreshold(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_LOW_BALANCE_THRESHOLD
  const n = Math.round(value)
  if (n < 0) return 0
  return Math.min(n, MAX_LOW_BALANCE_THRESHOLD)
}

/** 残高がしきい値を下回っているか。(純粋関数。マイナス残高は当然「下回っている」) */
export function isLowBalance(balance: number, threshold: number): boolean {
  return balance < threshold
}

/**
 * 低下アラートを鳴らすべきか。(純粋関数)
 *
 * 「下回っている間ずっと鳴らす」と、残高が低いまま何日も続くときに毎日鳴って
 * 通知が無視されるようになる。そこで **またいだ瞬間だけ** 鳴らす:
 *   - しきい値以上 → 下回った … 'notify'(鳴らして、鳴らした印を立てる)
 *   - 下回ったまま           … 'none' (二度と鳴らさない)
 *   - しきい値以上に戻った   … 'rearm'(印を降ろす。次に下回ったらまた鳴る)
 *
 * 直前の残高ではなく「鳴らした印」を状態に使うのは、端末を再起動しても、
 * 別の画面から記録しても、同じ1回だけになるようにするため。
 */
export type LowBalanceAction = 'notify' | 'rearm' | 'none'

export function lowBalanceAction(
  balance: number,
  threshold: number,
  alreadyNotified: boolean
): LowBalanceAction {
  if (isLowBalance(balance, threshold)) {
    return alreadyNotified ? 'none' : 'notify'
  }
  return alreadyNotified ? 'rearm' : 'none'
}
