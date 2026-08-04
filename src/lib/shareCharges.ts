// ============================================================
// 共有ページ(彼女が見る画面)の明細の並べ方と符号
//
// 共有ページは長らく、明細を必ず「あなたの分として引かれたもの」として
// マイナス表記で出していた。しかし機能018 で「彼女が払った回」を
// 見せるようになってから、その回は **残高が増える** のに画面ではマイナスに見え、
// 彼女の負担が0で全額彼女が払った回は金額が「—」になって、
// 残高が増えた事実がどこにも出なかった(上の残高と明細の足し算が合わない)。
//
// 利用者側 (PartnerTab の MovementRow) は partnerImpact をそのまま符号付きで
// 出しているので、同じ取引が2人の画面で逆符号になっていたことになる。
//
// ここでは残高への影響額 (paid − 彼女の負担分) を partnerBalance.ts 経由で出し、
// 「あなたが払った回」は節を分ける。式を自前で書かないこと —
// 残高の計算は partnerBalance.ts が唯一の正。
// ============================================================

import { partnerImpact } from './partnerBalance'
import type { ShareCharge } from './shareView'

/** 共有ページの明細1件が、預かり残高に与える影響額。(純粋関数) */
export function chargeImpact(c: Pick<ShareCharge, 'amount' | 'paid'>): number {
  // amount(支払い総額)は共有ページには届かないが、partnerImpact は
  // 支出のとき「彼女が払った額 − 彼女の負担分」しか見ないので影響しない。
  // 実際にあり得る値(彼女が払った額)を渡して、辻褄の合う形で問い合わせる。
  return partnerImpact({
    type: 'expense',
    amount: c.paid,
    partner_amount: c.amount,
    partner_paid: c.paid,
  })
}

/**
 * 明細を2つの節に分ける。(純粋関数)
 * - deducted    … 利用者が払い、彼女の分として引いた回 (paid = 0)
 * - paidByPartner … 彼女が財布から出した回 (paid > 0)。残高は増えることが多い
 *
 * 節を分けるのは、同じ「−」でも意味がまるで違うため。
 * 混ぜて並べると、彼女が払った回まで「引かれた」に見えてしまう。
 */
export function splitCharges<T extends Pick<ShareCharge, 'paid'>>(
  charges: readonly T[]
): { deducted: T[]; paidByPartner: T[] } {
  return {
    deducted: charges.filter((c) => c.paid <= 0),
    paidByPartner: charges.filter((c) => c.paid > 0),
  }
}

/** 符号付きの金額表示。(純粋関数。yen の整形は呼び出し側から渡す) */
export function signedAmountText(impact: number, yen: (n: number) => string): string {
  if (impact > 0) return `+${yen(impact)}`
  if (impact < 0) return `-${yen(-impact)}`
  // ちょうど相殺した回(彼女が自分の負担分だけ払った)。0 と書くほうが誠実で、
  // 「—」だと動いたのか動かなかったのか読めない
  return yen(0)
}

/**
 * 彼女が払った回の説明文。(純粋関数)
 * 専門用語を使わず、「いくら払って、いくらが自分の分で、残りがどうなったか」を
 * そのままの順で書く。
 */
export function paidRowNote(
  c: Pick<ShareCharge, 'amount' | 'paid'>,
  yen: (n: number) => string
): string {
  const impact = chargeImpact(c)
  // 彼女の負担が0の回に「あなたの分は ¥0 でした」と書くと、かえって読みにくい
  if (c.amount === 0) {
    return `このお会計は、ぜんぶあなたが払ってくれました。${yen(c.paid)} をのこりに足しました`
  }
  const head = `あなたが ${yen(c.paid)} 払い、そのうちあなたの分は ${yen(c.amount)} でした`
  if (impact > 0) return `${head}。多く出してくれた ${yen(impact)} は、のこりに足しました`
  if (impact < 0) return `${head}。足りない ${yen(-impact)} は、のこりから引きました`
  return `${head}。ちょうどなので、のこりは動きません`
}
