export type TransactionType = 'expense' | 'partner_deposit'

export interface Transaction {
  id: string
  date: string // YYYY-MM-DD
  type: TransactionType
  amount: number // 支払い総額(円)。partner_deposit の場合は預かり額
  category: string | null
  memo: string
  partner_amount: number // 支出のうち彼女の負担分(円)。彼女残高から差し引かれる
  created_at: string
}

// 自分の実質支出(彼女の負担分を除く)
export function ownAmount(t: Transaction): number {
  return t.type === 'expense' ? t.amount - t.partner_amount : 0
}
