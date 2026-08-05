import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTLEMENT_MODE,
  SETTLEMENT_MODES,
  draftImpact,
  settlementImpact,
  settlementInput,
  settlementMode,
  settlementRecord,
  type SettlementMode,
} from './partnerSettlement'
import { partnerBalance } from './partnerBalance'

// ============================================================
// 預かり・返金・調整の「保存される中身」を固定するテスト。
//
// この3つは画面上は同じカードの切り替えでしかないが、保存される
// type と amount の符号を1つ間違えると預かり残高が静かにずれる。
// UI の形(シート / カード / 将来の別の形)が変わっても、ここが
// 通っている限り記録の意味は変わらない。
// ============================================================

describe('種類ごとの type と amount の符号', () => {
  it('預かる → partner_deposit。amount は正で、残高は増える', () => {
    const draft = { mode: 'deposit' as const, amount: 3000, direction: 1 as const }
    expect(settlementRecord(draft)).toEqual({ type: 'partner_deposit', amount: 3000 })
    expect(draftImpact(draft)).toBe(3000)
  })

  it('返す → partner_refund。amount は正のまま(符号は種別が持つ)で、残高は減る', () => {
    const draft = { mode: 'refund' as const, amount: 3000, direction: 1 as const }
    expect(settlementRecord(draft)).toEqual({ type: 'partner_refund', amount: 3000 })
    expect(draftImpact(draft)).toBe(-3000)
  })

  it('調整(増やす) → partner_adjust。amount が符号つきの正で、残高は増える', () => {
    const draft = { mode: 'adjust' as const, amount: 500, direction: 1 as const }
    expect(settlementRecord(draft)).toEqual({ type: 'partner_adjust', amount: 500 })
    expect(draftImpact(draft)).toBe(500)
  })

  it('調整(減らす) → partner_adjust。amount が符号つきの負で、残高は減る', () => {
    const draft = { mode: 'adjust' as const, amount: 500, direction: -1 as const }
    expect(settlementRecord(draft)).toEqual({ type: 'partner_adjust', amount: -500 })
    expect(draftImpact(draft)).toBe(-500)
  })

  it('調整以外は向きを選んでも符号が付かない(二重に効かせない)', () => {
    // 向きのボタンは調整のときしか出ないが、状態が残っていても影響しないこと
    expect(settlementRecord({ mode: 'deposit', amount: 1000, direction: -1 }).amount).toBe(1000)
    expect(settlementRecord({ mode: 'refund', amount: 1000, direction: -1 }).amount).toBe(1000)
    expect(draftImpact({ mode: 'refund', amount: 1000, direction: -1 })).toBe(-1000)
  })

  it('保存される形からも同じ影響額が出る(見込み表示が使う入口)', () => {
    // 画面は入力中の1件を「保存される形」にしてから見込みを出す。
    // 種類からの経路と結果が一致していないと、押す前と後で数が変わる
    expect(settlementImpact({ type: 'partner_deposit', amount: 3000 })).toBe(3000)
    expect(settlementImpact({ type: 'partner_refund', amount: 3000 })).toBe(-3000)
    expect(settlementImpact({ type: 'partner_adjust', amount: 500 })).toBe(500)
    expect(settlementImpact({ type: 'partner_adjust', amount: -500 })).toBe(-500)
  })

  it('金額に符号が混ざって渡っても絶対値として扱う', () => {
    // 金額欄は絶対値しか受け付けないが、向きは必ず direction 側で決める
    expect(settlementRecord({ mode: 'refund', amount: -2000, direction: 1 }).amount).toBe(2000)
    expect(settlementRecord({ mode: 'adjust', amount: -2000, direction: -1 }).amount).toBe(-2000)
  })
})

describe('保存される1件の中身', () => {
  const cases: { mode: SettlementMode; direction: 1 | -1; type: string; amount: number }[] = [
    { mode: 'deposit', direction: 1, type: 'partner_deposit', amount: 1200 },
    { mode: 'refund', direction: 1, type: 'partner_refund', amount: 1200 },
    { mode: 'adjust', direction: 1, type: 'partner_adjust', amount: 1200 },
    { mode: 'adjust', direction: -1, type: 'partner_adjust', amount: -1200 },
  ]

  for (const c of cases) {
    it(`${c.mode}(${c.direction > 0 ? '増' : '減'}) は分類も店名も彼女の負担分も持たない`, () => {
      const input = settlementInput({
        mode: c.mode,
        amount: 1200,
        direction: c.direction,
        date: '2026-08-05',
        memo: '  現金でやり取りした  ',
      })
      expect(input).toEqual({
        date: '2026-08-05',
        type: c.type,
        amount: c.amount,
        category: null,
        // 理由・メモは必ず保存する(共有ページにも出るので、あとから理由を追える)
        memo: '現金でやり取りした',
        store: '',
        partner_amount: 0,
      })
    })
  }

  it('3種類を続けて記録すると、残高は影響額の合計どおりに動く', () => {
    // 「表示した見込み」と「保存後の残高」がずれないことの担保。
    // partnerBalance を通しても同じ数になる = 履歴の足し算と一致する
    const drafts = [
      { mode: 'deposit' as const, amount: 30000, direction: 1 as const },
      { mode: 'refund' as const, amount: 5000, direction: 1 as const },
      { mode: 'adjust' as const, amount: 300, direction: -1 as const },
    ]
    const rows = drafts.map((d) =>
      settlementInput({ ...d, date: '2026-08-05', memo: '' })
    )
    expect(partnerBalance(rows)).toBe(30000 - 5000 - 300)
    expect(drafts.reduce((s, d) => s + draftImpact(d), 0)).toBe(partnerBalance(rows))
  })
})

describe('種類の定義', () => {
  it('選べるのは 預かる / 返す / 調整 の3つで、既定は預かる', () => {
    expect(SETTLEMENT_MODES.map((m) => m.id)).toEqual(['deposit', 'refund', 'adjust'])
    expect(DEFAULT_SETTLEMENT_MODE).toBe('deposit')
    expect(SETTLEMENT_MODES[0].id).toBe(DEFAULT_SETTLEMENT_MODE)
  })

  it('見出し・補足・保存ボタンの文言が種類ごとに違う', () => {
    const headings = SETTLEMENT_MODES.map((m) => m.heading)
    const submits = SETTLEMENT_MODES.map((m) => m.submitLabel)
    const hints = SETTLEMENT_MODES.map((m) => m.hint)
    expect(new Set(headings).size).toBe(3)
    expect(new Set(submits).size).toBe(3)
    expect(new Set(hints).size).toBe(3)
  })

  it('種類ごとに保存される取引種別が違う', () => {
    expect(settlementMode('deposit').txType).toBe('partner_deposit')
    expect(settlementMode('refund').txType).toBe('partner_refund')
    expect(settlementMode('adjust').txType).toBe('partner_adjust')
  })
})
