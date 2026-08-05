import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SPECIAL_TAGS,
  MAX_SPECIAL_TAGS,
  normalizeSpecialTags,
  parseSpecialTags,
  resolveSpecialTags,
} from './reportTagSettings'

describe('resolveSpecialTags', () => {
  it('まだ触っていなければ 旅行・デート・出張 が入っている', () => {
    expect(resolveSpecialTags(null)).toEqual(['旅行', 'デート', '出張'])
    expect(resolveSpecialTags('')).toEqual([...DEFAULT_SPECIAL_TAGS])
  })

  it('自分で全部外した状態(空配列)は尊重する — 既定を復活させない', () => {
    expect(resolveSpecialTags('[]')).toEqual([])
  })

  it('壊れた値は既定に倒す(例外を投げない)', () => {
    expect(resolveSpecialTags('{')).toEqual([...DEFAULT_SPECIAL_TAGS])
    expect(resolveSpecialTags('"旅行"')).toEqual([...DEFAULT_SPECIAL_TAGS]) // 配列でない
    expect(resolveSpecialTags('123')).toEqual([...DEFAULT_SPECIAL_TAGS])
  })

  it('保存された選択をそのまま読む(選んだ順を保つ)', () => {
    expect(resolveSpecialTags('["出張", "帰省"]')).toEqual(['出張', '帰省'])
  })

  it('タグの正規化(# と空白落とし)は入力欄と同じ規則を通る', () => {
    expect(resolveSpecialTags('["#旅行", " デート ", "出 張"]')).toEqual([
      '旅行',
      'デート',
      '出張',
    ])
  })
})

describe('parseSpecialTags', () => {
  it('文字列でないもの・空になるもの・重複は落とす', () => {
    expect(parseSpecialTags([1, null, { a: 1 }, '旅行', '旅行', '#', '  '])).toEqual(['旅行'])
  })

  it('多すぎる保存値は上限で打ち切る', () => {
    const many = Array.from({ length: MAX_SPECIAL_TAGS + 5 }, (_, i) => `tag${i}`)
    expect(parseSpecialTags(many)).toHaveLength(MAX_SPECIAL_TAGS)
  })

  it('空配列はそのまま(= 全部が日常)', () => {
    expect(parseSpecialTags([])).toEqual([])
  })
})

describe('normalizeSpecialTags', () => {
  it('保存する前も読み込みと同じ規則を通る', () => {
    expect(normalizeSpecialTags(['#旅行', '旅行', 'デート'])).toEqual(['旅行', 'デート'])
  })
})
