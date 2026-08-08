import { describe, expect, it } from 'vitest'
import type { Transaction } from './types'
import {
  bulkTagConfirmText,
  bulkTagDoneText,
  bulkTagUpdates,
  planAddTag,
  planRemoveTag,
  tagAddInput,
  tagRemoveInput,
  tagsOnTransactions,
} from './bulkTags'

// ============================================================
// 過去の旅行に、あとから行き先タグをまとめて付ける。
//
// ここで守っているのは4つ:
//   ・すでに付いている記録は書き換えない(中身の無い変更履歴を残さない)
//   ・タグの上限(5個)で付けられない記録は **数えて伝える**(黙って飛ばさない)
//   ・付け間違えたら、同じ入り口からまとめて外せる
//   ・書き込む内容は transactionToInput 経由(彼女の負担分などを落とさない)
// ============================================================

let seq = 0
function tx(p: Partial<Transaction> = {}): Transaction {
  seq += 1
  return {
    id: `id${seq}`,
    date: '2026-08-06',
    type: 'expense',
    amount: 1000,
    category: 'food',
    memo: '',
    store: '',
    partner_amount: 0,
    created_at: '2026-08-06T03:00:00.000Z',
    ...p,
  }
}

describe('planAddTag', () => {
  it('タグの付いていない記録だけを対象にする', () => {
    const txs = [tx({ tags: ['旅行'] }), tx({ tags: ['旅行'] })]
    const plan = planAddTag(txs, '2026和歌山')
    expect(plan?.targets).toHaveLength(2)
    expect(plan?.alreadyCount).toBe(0)
    expect(plan?.fullCount).toBe(0)
    expect(plan?.totalCount).toBe(2)
  })

  it('すでに付いている記録は書き換えない(空の変更履歴を残さない)', () => {
    const txs = [tx({ tags: ['旅行', '2026和歌山'] }), tx({ tags: ['旅行'] })]
    const plan = planAddTag(txs, '2026和歌山')
    expect(plan?.targets).toHaveLength(1)
    expect(plan?.alreadyCount).toBe(1)
  })

  it('「#」付きで打っても、入力欄と同じ規則でならす', () => {
    expect(planAddTag([tx()], ' #2026和歌山 ')?.tag).toBe('2026和歌山')
  })

  it('空になる文字列では実行できない', () => {
    expect(planAddTag([tx()], '   ')).toBeNull()
    expect(planAddTag([tx()], '#')).toBeNull()
  })

  it('タグが5個ある記録は対象から外し、件数を数える', () => {
    const txs = [
      tx({ tags: ['a', 'b', 'c', 'd', 'e'] }),
      tx({ tags: ['旅行'] }),
    ]
    const plan = planAddTag(txs, '2026和歌山')
    expect(plan?.targets).toHaveLength(1)
    expect(plan?.fullCount).toBe(1)
    // 黙って飛ばさない = 文言に必ず出る
    expect(bulkTagConfirmText(plan!, 'add')).toContain('1件は付けられません')
    expect(bulkTagDoneText(plan!, 'add')).toContain('1件は付けられませんでした')
  })

  it('5個あってもそのタグが入っていれば「すでに付いている」に数える', () => {
    const txs = [tx({ tags: ['2026和歌山', 'b', 'c', 'd', 'e'] })]
    const plan = planAddTag(txs, '2026和歌山')
    expect(plan?.targets).toHaveLength(0)
    expect(plan?.alreadyCount).toBe(1)
    expect(plan?.fullCount).toBe(0)
  })

  it('対象が0件でも壊れない', () => {
    const plan = planAddTag([], '2026和歌山')
    expect(plan?.targets).toEqual([])
    expect(bulkTagConfirmText(plan!, 'add')).toBe('0件に #2026和歌山 を付けます')
  })

  it('確認の文には件数が必ず入る', () => {
    const txs = Array.from({ length: 35 }, () => tx({ tags: ['旅行'] }))
    const plan = planAddTag(txs, '2026和歌山')
    expect(bulkTagConfirmText(plan!, 'add')).toBe('35件に #2026和歌山 を付けます')
  })
})

describe('planRemoveTag', () => {
  it('付いている記録だけを外す', () => {
    const txs = [tx({ tags: ['旅行', '2026和歌山'] }), tx({ tags: ['旅行'] })]
    const plan = planRemoveTag(txs, '2026和歌山')
    expect(plan?.targets).toHaveLength(1)
    expect(plan?.alreadyCount).toBe(1)
    expect(bulkTagConfirmText(plan!, 'remove')).toContain('外します')
  })

  it('1件も付いていなければ対象は空', () => {
    expect(planRemoveTag([tx({ tags: ['旅行'] })], '2026和歌山')?.targets).toEqual([])
  })
})

describe('書き込む内容', () => {
  it('足したタグは末尾に付き、ほかの項目は写される', () => {
    const t = tx({ tags: ['旅行'], partner_amount: 400, partner_paid: 1000, store: '旅館' })
    const input = tagAddInput(t, '2026和歌山')
    expect(input.tags).toEqual(['旅行', '2026和歌山'])
    // 「その記録が持っている事実」が落ちない(落ちると預かり残高が静かに動く)
    expect(input.partner_amount).toBe(400)
    expect(input.partner_paid).toBe(1000)
    expect(input.store).toBe('旅館')
    expect(input.amount).toBe(1000)
  })

  it('外したタグだけが消え、並び順は変わらない', () => {
    const t = tx({ tags: ['旅行', '2026和歌山', '記念日'] })
    expect(tagRemoveInput(t, '2026和歌山').tags).toEqual(['旅行', '記念日'])
  })

  it('updateMany に渡せる形になる(1件ずつ op が積まれる)', () => {
    const txs = [tx({ id: 'a', tags: ['旅行'] }), tx({ id: 'b', tags: ['旅行'] })]
    const updates = bulkTagUpdates(planAddTag(txs, '2026和歌山')!, 'add')
    expect(updates.map((u) => u.id)).toEqual(['a', 'b'])
    expect(updates[0].input.tags).toEqual(['旅行', '2026和歌山'])
  })
})

describe('tagsOnTransactions', () => {
  it('付いているタグを多い順に数える(親は除ける)', () => {
    const txs = [
      tx({ tags: ['旅行', '2026和歌山'] }),
      tx({ tags: ['旅行', '2026和歌山'] }),
      tx({ tags: ['旅行', '記念日'] }),
    ]
    expect(tagsOnTransactions(txs, ['旅行'])).toEqual([
      { tag: '2026和歌山', count: 2 },
      { tag: '記念日', count: 1 },
    ])
  })

  it('同じ記録に同じタグが重複していても二重に数えない', () => {
    expect(tagsOnTransactions([tx({ tags: ['x', 'x'] })])).toEqual([{ tag: 'x', count: 1 }])
  })

  it('タグが1つも無ければ空', () => {
    expect(tagsOnTransactions([tx()])).toEqual([])
  })
})
