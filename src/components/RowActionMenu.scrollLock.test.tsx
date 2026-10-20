// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import RowActionMenu from './RowActionMenu'
import type { Transaction } from '../lib/types'

// 長押しメニューだけ、背景のスクロール固定を呼び忘れていた(ほかのシート18個は呼んでいる)。
// 開いている間は背景が動かず、閉じたら元に戻ることを確かめる
const TX: Transaction = {
  id: 't1',
  date: '2026-08-03',
  type: 'expense',
  amount: 1000,
  category: 'food',
  memo: '',
  store: 'お店',
  partner_amount: 0,
  created_at: '2026-08-03T00:00:00.000Z',
}

// 固定を外すときに元の位置へ戻す(window.scrollTo)。jsdom には無いので空にしておく
beforeEach(() => {
  window.scrollTo = () => {}
})
afterEach(() => cleanup())

describe('長押しメニューの背景', () => {
  it('開いている間は背景をスクロールさせず、閉じたら戻す', () => {
    const noop = () => {}
    const { unmount } = render(
      <RowActionMenu
        tx={TX}
        onDuplicate={noop}
        onEdit={noop}
        onDelete={noop}
        onFilterStore={noop}
        onClose={noop}
      />
    )
    expect(document.body.style.position).toBe('fixed')
    unmount()
    expect(document.body.style.position).toBe('')
  })
})
