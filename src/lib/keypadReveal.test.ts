import { describe, expect, it } from 'vitest'
import { REVEAL_MARGIN, revealScrollDelta } from './keypadReveal'

// 390x844 でテンキーの上端が y=525。実際に起きた配置(欄が y=701〜762)を含む
const view = { viewTop: 0, viewBottom: 525 }

describe('revealScrollDelta', () => {
  it('テンキーに隠れている欄は、テンキーより上まで送る', () => {
    const delta = revealScrollDelta({ ...view, fieldTop: 701, revealBottom: 762 })
    expect(delta).toBe(762 - (525 - REVEAL_MARGIN))
  })

  it('もう見えていれば動かさない', () => {
    expect(revealScrollDelta({ ...view, fieldTop: 300, revealBottom: 400 })).toBe(0)
  })

  it('上に隠れている欄は、上へ戻す', () => {
    expect(revealScrollDelta({ ...view, fieldTop: -40, revealBottom: 20 })).toBe(-40 - REVEAL_MARGIN)
  })

  it('見せたい範囲が入りきらないときは、欄そのものが上にはみ出すほどは送らない', () => {
    // 欄は y=600、その下の注意書きまで含めると y=1200 まである(狭い画面)
    const delta = revealScrollDelta({ ...view, fieldTop: 600, revealBottom: 1200 })
    expect(delta).toBe(600 - REVEAL_MARGIN)
  })

  it('スクロールする入れ物(編集シート)の上端を基準にする', () => {
    const delta = revealScrollDelta({ viewTop: 100, viewBottom: 525, fieldTop: 105, revealBottom: 200 })
    expect(delta).toBe(105 - (100 + REVEAL_MARGIN))
  })
})
