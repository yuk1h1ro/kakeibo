import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LOW_BALANCE_THRESHOLD,
  balanceDirection,
  balanceWording,
  isLowBalance,
  lowBalanceAction,
  normalizeThreshold,
  partnerBalance,
  partnerImpact,
  partnerMovements,
  partnerViewWording,
  type PartnerTxLike,
} from './partnerBalance'

// 残高はこのアプリの存在理由なので、行の組み立てはテスト側でも素朴に書く
// (ヘルパーで賢くすると、テストが実装と同じ間違いをしてしまう)
function expense(amount: number, partnerAmount: number, partnerPaid?: number): PartnerTxLike {
  return {
    type: 'expense',
    amount,
    partner_amount: partnerAmount,
    ...(partnerPaid === undefined ? {} : { partner_paid: partnerPaid }),
  }
}

const deposit = (amount: number): PartnerTxLike => ({
  type: 'partner_deposit',
  amount,
  partner_amount: 0,
})

const refund = (amount: number): PartnerTxLike => ({
  type: 'partner_refund',
  amount,
  partner_amount: 0,
})

const adjust = (amount: number): PartnerTxLike => ({
  type: 'partner_adjust',
  amount,
  partner_amount: 0,
})

describe('partnerImpact', () => {
  it('預かりは残高を増やす', () => {
    expect(partnerImpact(deposit(30000))).toBe(30000)
  })

  it('自分が全額払った支出は、彼女の負担分だけ残高を減らす(従来どおり)', () => {
    expect(partnerImpact(expense(3000, 1500))).toBe(-1500)
  })

  it('partner_paid が無い行(既存データ)は自分が全額払った扱いになる', () => {
    // 機能018 の列を足しても過去の残高が1円も動かないことの確認
    expect(partnerImpact({ type: 'expense', amount: 3000, partner_amount: 1500 })).toBe(-1500)
    expect(partnerImpact({ type: 'expense', amount: 3000, partner_amount: 1500, partner_paid: null })).toBe(-1500)
  })

  it('彼女が全額払った支出は、自分の負担分だけ残高が増える (機能018)', () => {
    // 3000円の会計を彼女が払い、そのうち彼女の負担は1000円 → 私は2000円借りた
    expect(partnerImpact(expense(3000, 1000, 3000))).toBe(2000)
  })

  it('分けて払った支出は「彼女が払った額 − 彼女の負担分」になる (機能018)', () => {
    // 5000円の会計を私3000・彼女2000で払い、彼女の負担は1500 → 彼女は500払いすぎ
    expect(partnerImpact(expense(5000, 1500, 2000))).toBe(500)
    // 彼女が500しか払っていないのに負担が1500 → 1000ぶん立て替えた
    expect(partnerImpact(expense(5000, 1500, 500))).toBe(-1000)
  })

  it('彼女がちょうど自分の負担分だけ払った回は残高が動かない', () => {
    expect(partnerImpact(expense(4000, 2000, 2000))).toBe(0)
  })

  it('返金は残高を減らし、調整は符号のとおりに効く (機能012)', () => {
    expect(partnerImpact(refund(5000))).toBe(-5000)
    expect(partnerImpact(adjust(300))).toBe(300)
    expect(partnerImpact(adjust(-300))).toBe(-300)
  })
})

describe('partnerBalance', () => {
  it('記録が無ければ0', () => {
    expect(partnerBalance([])).toBe(0)
  })

  it('預かってから使うとプラスのまま減る', () => {
    expect(partnerBalance([deposit(30000), expense(3000, 1500), expense(2000, 2000)])).toBe(26500)
  })

  it('使い切るとちょうど0になる', () => {
    expect(partnerBalance([deposit(3000), expense(3000, 3000)])).toBe(0)
  })

  it('預かりを超えて使うとマイナス(= 彼女への貸し)になる (機能011)', () => {
    expect(partnerBalance([deposit(1000), expense(3000, 3000)])).toBe(-2000)
  })

  it('返金と調整が混ざっても順番に依らず同じ残高になる (機能012)', () => {
    const rows = [deposit(30000), expense(4000, 2000), refund(10000), adjust(-500), adjust(200)]
    expect(partnerBalance(rows)).toBe(30000 - 2000 - 10000 - 500 + 200)
    // 足し算なので並べ替えても結果は変わらない(履歴の並び順に依存しないこと)
    expect(partnerBalance([...rows].reverse())).toBe(partnerBalance(rows))
  })

  it('返金しすぎればマイナスに振れる (機能011 + 012)', () => {
    expect(partnerBalance([deposit(5000), refund(8000)])).toBe(-3000)
  })

  it('彼女が払った回が混ざると符号が両方向に動く (機能011 + 018)', () => {
    // 預かり0の状態で、彼女が全額払った食事(私の負担2000)→ 私が2000借りている
    expect(partnerBalance([expense(3000, 1000, 3000)])).toBe(2000)
    // そのあと私が彼女の分を2000立て替えると、ちょうど貸し借りなしに戻る
    expect(partnerBalance([expense(3000, 1000, 3000), expense(2000, 2000, 0)])).toBe(0)
    // さらに私が立て替えるとマイナス(= 彼女への貸し)へ抜ける
    expect(partnerBalance([expense(3000, 1000, 3000), expense(5000, 5000, 0)])).toBe(-3000)
  })

  it('分割した明細は、分割前の1件とまったく同じ残高になる (機能096)', () => {
    // スーパーの1会計 5,000円(彼女の負担 1,200円)を、
    // 食費 3,000円(彼女 800円)と日用品 2,000円(彼女 400円)に分けた場合
    const before = [deposit(10000), expense(5000, 1200)]
    const after = [deposit(10000), expense(3000, 800), expense(2000, 400)]
    expect(partnerBalance(after)).toBe(partnerBalance(before))
    expect(partnerBalance(after)).toBe(8800)
  })

  it('返金・調整・彼女払い・分割をすべて混ぜても足し算で一致する', () => {
    const rows = [
      deposit(20000), // +20000
      expense(3000, 1500), // -1500  自分が全額払った
      expense(4000, 1000, 4000), // +3000 彼女が全額払った
      expense(2500, 1000, 500), // -500  分けて払った
      expense(3000, 800), // -800  分割した明細1
      expense(2000, 400), // -400  分割した明細2
      refund(5000), // -5000
      adjust(-120), // -120
      adjust(70), // +70
    ]
    expect(partnerBalance(rows)).toBe(20000 - 1500 + 3000 - 500 - 800 - 400 - 5000 - 120 + 70)
    expect(partnerBalance(rows)).toBe(14750)
  })
})

describe('partnerMovements', () => {
  it('残高が動かない行(自分だけの支出)は履歴に出さない', () => {
    const own = expense(1000, 0)
    const rows = [own, deposit(5000), expense(2000, 1000), adjust(100)]
    expect(partnerMovements(rows)).toHaveLength(3)
    expect(partnerMovements(rows)).not.toContain(own)
  })

  it('彼女がちょうど負担分だけ払った回は残高が動かないので出さない', () => {
    expect(partnerMovements([expense(4000, 2000, 2000)])).toHaveLength(0)
  })
})

describe('balanceDirection / balanceWording (機能011)', () => {
  it('符号ごとに向きが決まる', () => {
    expect(balanceDirection(1)).toBe('holding')
    expect(balanceDirection(-1)).toBe('lent')
    expect(balanceDirection(0)).toBe('even')
  })

  it('プラスは「預かり中」、マイナスは「立て替え中」と言い換える', () => {
    expect(balanceWording(3000).title).toBe('預かり中')
    expect(balanceWording(-3000).title).toBe('立て替え中(彼女への貸し)')
    expect(balanceWording(0).title).toBe('貸し借りなし')
  })

  it('表示する金額は常に絶対値(符号は言葉が伝える)', () => {
    expect(balanceWording(-3000).magnitude).toBe(3000)
    expect(balanceWording(3000).magnitude).toBe(3000)
  })

  it('共有ページ側は主語が彼女になる', () => {
    // 利用者側とは逆の言い方になっていること(そのまま流用すると意味が反転する)
    expect(partnerViewWording(3000).title).toBe('あずけているお金ののこり')
    expect(partnerViewWording(-3000).title).toBe('たてかえてもらっている分')
    expect(partnerViewWording(-3000).magnitude).toBe(3000)
  })
})

describe('低下アラート (機能010)', () => {
  it('既定のしきい値は1,000円', () => {
    expect(DEFAULT_LOW_BALANCE_THRESHOLD).toBe(1000)
  })

  it('しきい値ちょうどは「下回っていない」', () => {
    expect(isLowBalance(1000, 1000)).toBe(false)
    expect(isLowBalance(999, 1000)).toBe(true)
  })

  it('マイナス残高は当然「下回っている」', () => {
    expect(isLowBalance(-1, 0)).toBe(true)
    expect(isLowBalance(-5000, 1000)).toBe(true)
  })

  it('またいだ瞬間だけ鳴らし、下回ったままでは二度と鳴らさない', () => {
    // まだ鳴らしていない状態で下回った → 鳴らす
    expect(lowBalanceAction(800, 1000, false)).toBe('notify')
    // 下回ったまま(すでに鳴らした)→ 何日続いても鳴らさない
    expect(lowBalanceAction(800, 1000, true)).toBe('none')
    expect(lowBalanceAction(-200, 1000, true)).toBe('none')
  })

  it('しきい値以上に戻ると、また鳴らせる状態に戻す', () => {
    expect(lowBalanceAction(5000, 1000, true)).toBe('rearm')
    // 戻したあとに再び下回れば、もう一度だけ鳴る
    expect(lowBalanceAction(500, 1000, false)).toBe('notify')
  })

  it('十分な残高で、鳴らした印も無いときは何もしない', () => {
    expect(lowBalanceAction(5000, 1000, false)).toBe('none')
  })

  it('しきい値は現実的な範囲に丸める', () => {
    expect(normalizeThreshold(-100)).toBe(0)
    expect(normalizeThreshold(1500.4)).toBe(1500)
    expect(normalizeThreshold(Number.NaN)).toBe(DEFAULT_LOW_BALANCE_THRESHOLD)
    expect(normalizeThreshold(99_999_999)).toBe(1_000_000)
  })
})
