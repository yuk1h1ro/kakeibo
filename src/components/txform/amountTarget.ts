// 自前テンキー・電卓が打ち込む先の金額欄。
// パッドは画面の下に1枚だけなので、どの欄に向いているかをこの値で持つ。
// 分割の内訳は何行もあるので、行の番号と欄で指す(`split:0:partnerAmount`)

/** 分割の内訳で、電卓が打ち込める欄 (SplitPart の数値の列) */
export type SplitField = 'amount' | 'partnerAmount'

export type AmountTarget = 'amount' | 'partner' | `split:${number}:${SplitField}`

export const splitTarget = (index: number, field: SplitField): AmountTarget => `split:${index}:${field}`

export function parseSplitTarget(target: AmountTarget): { index: number; field: SplitField } | null {
  const m = /^split:(\d+):(amount|partnerAmount)$/.exec(target)
  return m ? { index: Number(m[1]), field: m[2] as SplitField } : null
}

/** パッドの上に出す「どの欄に入力中か」。支払い金額のときは出さない */
export function keypadTargetLabel(target: AmountTarget): string | undefined {
  if (target === 'partner') return '彼女の負担分'
  const split = parseSplitTarget(target)
  if (split) return `内訳 ${split.index + 1} の${split.field === 'amount' ? '金額' : '彼女の負担分'}`
  return undefined
}
