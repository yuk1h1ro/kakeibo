// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import {
  HISTORY_VIEW_KEY,
  clearHistoryView,
  getHistoryView,
  parseHistoryView,
  setHistoryView,
} from './historyView'

describe('parseHistoryView', () => {
  it('保存できる値は一覧とカレンダーの2つだけ', () => {
    expect(parseHistoryView('list')).toBe('list')
    expect(parseHistoryView('calendar')).toBe('calendar')
  })

  it('未保存・知らない値は null(= 既定の一覧に倒す)', () => {
    expect(parseHistoryView(null)).toBeNull()
    expect(parseHistoryView('')).toBeNull()
    expect(parseHistoryView('grid')).toBeNull()
  })
})

describe('履歴の見え方の保存', () => {
  afterEach(() => clearHistoryView())

  it('既定は一覧(開いた瞬間に明細が見える側)', () => {
    clearHistoryView()
    expect(getHistoryView()).toBe('list')
  })

  it('選んだ見え方は端末に残る', () => {
    setHistoryView('calendar')
    expect(getHistoryView()).toBe('calendar')
    expect(localStorage.getItem(HISTORY_VIEW_KEY)).toBe('calendar')
  })
})
