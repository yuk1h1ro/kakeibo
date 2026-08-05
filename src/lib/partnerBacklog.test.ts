import { describe, expect, it } from 'vitest'
import {
  BACKLOG_RETRY_DELAY_MS,
  DISCORD_MESSAGE_LIMIT,
  backlogDoneText,
  backlogEntryLine,
  backlogHeadline,
  backlogMonths,
  backlogPartialText,
  backlogProgressText,
  backlogRetryDelay,
  backlogTitle,
  backlogYears,
  buildBacklogEntries,
  buildBacklogMessages,
  cursorOf,
  describeBacklogRange,
  filterBacklogEntries,
  isAfterCursor,
  isPartnerVisible,
  newerCursor,
  packBlocks,
  runningBalanceText,
  signedImpactText,
  splitLongBlock,
  truncateTitle,
  type BacklogEntry,
  type BacklogTxLike,
} from './partnerBacklog'
import { partnerBalance } from './partnerBalance'

// ============================================================
// 彼女の預かり金の履歴を、まとめて Discord に送る
//
// この機能でいちばん怖い壊れ方は3つ:
//   1. 彼女に関係のない支出(利用者個人の買い物)が1件でも混ざること
//   2. 2,000文字を超えた1通が Discord に丸ごと拒否され、
//      「送ったのに届いていない」状態になること
//   3. すでに送った分をもう一度送って、彼女の通知欄が同じ履歴で埋まること
// このファイルはその3つを固定するために厚く書いてある。
// ============================================================

const label = (c: string | null) => (c === 'food' ? '食費' : c === 'eating_out' ? '外食' : 'その他')

function tx(over: Partial<BacklogTxLike> = {}): BacklogTxLike {
  return {
    id: 't1',
    date: '2026-05-01',
    created_at: '2026-05-01T01:00:00.000Z',
    type: 'expense',
    amount: 1000,
    category: 'food',
    memo: '',
    store: '',
    partner_amount: 0,
    ...over,
  }
}

const deposit = (date: string, amount: number, id = `d${date}`): BacklogTxLike =>
  tx({ id, date, created_at: `${date}T01:00:00.000Z`, type: 'partner_deposit', amount, category: null })

const shared = (date: string, total: number, partner: number, store: string, id = `e${date}`): BacklogTxLike =>
  tx({ id, date, created_at: `${date}T02:00:00.000Z`, amount: total, partner_amount: partner, store })

// ============================================================
// 彼女に見せる範囲 — 共有ページと同じ原則
// ============================================================

describe('彼女に見せてよい記録の選別', () => {
  it('利用者個人の支出は1件も出さない', () => {
    expect(isPartnerVisible(tx({ amount: 500, partner_amount: 0 }))).toBe(false)
  })

  it('彼女の負担分がある支出は出す', () => {
    expect(isPartnerVisible(tx({ amount: 3000, partner_amount: 1500 }))).toBe(true)
  })

  it('彼女が払った回は、彼女の負担が0でも出す(残高が動くため)', () => {
    expect(isPartnerVisible(tx({ amount: 2000, partner_amount: 0, partner_paid: 2000 }))).toBe(true)
  })

  it('彼女がちょうど自分の負担分を払った回(影響額0)も出す', () => {
    // 共有ページの条件 (partner_amount > 0 or partner_paid > 0) と同じ。
    // 残高は動かないが、彼女にとっては「あった出来事」
    expect(isPartnerVisible(tx({ amount: 800, partner_amount: 800, partner_paid: 800 }))).toBe(true)
  })

  it('預かり・返金・調整は出す', () => {
    expect(isPartnerVisible(deposit('2026-05-01', 30000))).toBe(true)
    expect(isPartnerVisible(tx({ type: 'partner_refund', amount: 5000 }))).toBe(true)
    expect(isPartnerVisible(tx({ type: 'partner_adjust', amount: -300 }))).toBe(true)
  })
})

// ============================================================
// 明細の組み立てと残高
// ============================================================

describe('明細の組み立て', () => {
  const rows = [
    shared('2026-05-20', 3000, 1500, '一緒の夕飯'),
    deposit('2026-05-01', 30000),
    tx({ id: 'own', date: '2026-05-10', store: '自分だけのコーヒー', amount: 500, partner_amount: 0 }),
  ]

  it('古い順に並べ、彼女に関係のない行は落とす', () => {
    const entries = buildBacklogEntries(rows, label)
    expect(entries.map((e) => e.id)).toEqual(['d2026-05-01', 'e2026-05-20'])
  })

  it('その時点の残高を1件ずつ積む(最後は画面の残高と一致する)', () => {
    const entries = buildBacklogEntries(rows, label)
    expect(entries.map((e) => e.balance)).toEqual([30000, 28500])
    expect(entries[entries.length - 1].balance).toBe(partnerBalance(rows))
  })

  it('出さない支出があっても残高はずれない(影響額が必ず0のため)', () => {
    const withOwn = buildBacklogEntries(rows, label)
    const withoutOwn = buildBacklogEntries(rows.filter((r) => r.id !== 'own'), label)
    expect(withOwn.map((e) => e.balance)).toEqual(withoutOwn.map((e) => e.balance))
  })

  it('同じ日付は記録日時、それも同じなら ID の順に並ぶ(順番が揺れるとカーソルが壊れる)', () => {
    const a = shared('2026-05-05', 1000, 500, 'あ', 'a')
    const b = { ...shared('2026-05-05', 1000, 500, 'い', 'b'), created_at: a.created_at }
    expect(buildBacklogEntries([b, a], label).map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('影響額は partnerBalance.ts の式そのもの(彼女が払った回はプラス)', () => {
    const entries = buildBacklogEntries(
      [tx({ id: 'p', amount: 2000, partner_amount: 800, partner_paid: 2000 })],
      label
    )
    expect(entries[0].impact).toBe(1200)
    expect(entries[0].balance).toBe(1200)
  })
})

describe('見出しの付け方', () => {
  it('支出は お店 → メモ → カテゴリ名 の順(そのつど飛ぶ通知と同じ)', () => {
    expect(backlogTitle(tx({ store: 'スーパー', memo: 'メモ' }), label)).toBe('スーパー')
    expect(backlogTitle(tx({ store: '', memo: '駅前のカフェ' }), label)).toBe('駅前のカフェ')
    expect(backlogTitle(tx({ store: '', memo: '' }), label)).toBe('食費')
  })

  it('預かり・返金・調整は言い回しを、理由があれば添える', () => {
    expect(backlogTitle(deposit('2026-05-01', 30000), label)).toBe('彼女から預かり')
    expect(backlogTitle(tx({ type: 'partner_refund', amount: 5000 }), label)).toBe('彼女に返金')
    expect(backlogTitle(tx({ type: 'partner_adjust', amount: -300, memo: '数え間違い' }), label)).toBe(
      '調整(残高を減らした)(数え間違い)'
    )
  })

  it('長すぎる見出しは詰める(1行が暴れて読めなくなるため)', () => {
    const long = 'あ'.repeat(100)
    expect([...truncateTitle(long)]).toHaveLength(40)
    expect(truncateTitle(long).endsWith('…')).toBe(true)
    expect(truncateTitle('みじかい')).toBe('みじかい')
  })
})

// ============================================================
// カーソル(前回どこまで送ったか)
// ============================================================

describe('カーソル', () => {
  const c = { date: '2026-05-10', createdAt: '2026-05-10T02:00:00.000Z', id: 'm' }

  it('カーソルより後ろの記録だけが未送信', () => {
    expect(isAfterCursor(tx({ date: '2026-05-11' }), c)).toBe(true)
    expect(isAfterCursor(tx({ date: '2026-05-09' }), c)).toBe(false)
  })

  it('同じ日付でも記録日時で切り分ける', () => {
    expect(isAfterCursor(tx({ date: '2026-05-10', created_at: '2026-05-10T03:00:00.000Z' }), c)).toBe(true)
    expect(isAfterCursor(tx({ date: '2026-05-10', created_at: '2026-05-10T01:00:00.000Z' }), c)).toBe(false)
  })

  it('カーソルそのものは「送信済み」(もう一度送らない)', () => {
    expect(isAfterCursor(tx({ date: c.date, created_at: c.createdAt, id: c.id }), c)).toBe(false)
  })

  it('まだ一度も送っていなければ全部が未送信', () => {
    expect(isAfterCursor(tx(), null)).toBe(true)
  })

  it('食い違ったときは進んでいる方を採る(戻すと送信済みが再送される)', () => {
    const older = { date: '2026-05-01', createdAt: '2026-05-01T01:00:00.000Z', id: 'a' }
    expect(newerCursor(older, c)).toBe(c)
    expect(newerCursor(c, older)).toBe(c)
    expect(newerCursor(null, c)).toBe(c)
    expect(newerCursor(c, null)).toBe(c)
    expect(newerCursor(null, null)).toBeNull()
  })

  it('取引からカーソルを作れる', () => {
    expect(cursorOf(tx({ id: 'x', date: '2026-05-02', created_at: 'ts' }))).toEqual({
      date: '2026-05-02',
      createdAt: 'ts',
      id: 'x',
    })
  })
})

// ============================================================
// 期間
// ============================================================

describe('期間の選択', () => {
  const rows = [
    deposit('2025-12-01', 10000),
    shared('2026-01-15', 2000, 1000, '初詣'),
    shared('2026-05-20', 3000, 1500, '夕飯'),
  ]
  const entries = buildBacklogEntries(rows, label)
  const cursor = { date: '2026-01-15', createdAt: '2026-01-15T02:00:00.000Z', id: 'e2026-01-15' }

  it('全期間はすべて', () => {
    expect(filterBacklogEntries(entries, { kind: 'all' }, cursor)).toHaveLength(3)
  })

  it('前回の続きは、カーソルより後ろだけ', () => {
    expect(filterBacklogEntries(entries, { kind: 'since' }, cursor).map((e) => e.id)).toEqual([
      'e2026-05-20',
    ])
  })

  it('一度も送っていなければ、前回の続き = 全期間', () => {
    expect(filterBacklogEntries(entries, { kind: 'since' }, null)).toHaveLength(3)
  })

  it('年・月で切れる', () => {
    expect(filterBacklogEntries(entries, { kind: 'year', value: '2026' }, cursor)).toHaveLength(2)
    expect(filterBacklogEntries(entries, { kind: 'month', value: '2026-05' }, cursor)).toHaveLength(1)
  })

  it('年・月を選んだときは送信済みでも構わず組み立てる(送り直しの逃げ道)', () => {
    // カーソルより前の月を明示的に選んだ = 「もう一度送りたい」という意思表示
    expect(filterBacklogEntries(entries, { kind: 'month', value: '2025-12' }, cursor)).toHaveLength(1)
  })

  it('期間の名前を言葉で出す', () => {
    expect(describeBacklogRange({ kind: 'all' }, cursor)).toBe('全期間')
    expect(describeBacklogRange({ kind: 'since' }, cursor)).toBe('前回の続き')
    // まだ一度も送っていなければ、続きの中身は全期間そのもの
    expect(describeBacklogRange({ kind: 'since' }, null)).toBe('全期間')
    expect(describeBacklogRange({ kind: 'year', value: '2026' }, null)).toBe('2026年')
    expect(describeBacklogRange({ kind: 'month', value: '2026-05' }, null)).toBe('2026年5月')
  })

  it('選べる年・月は記録のあるものだけを新しい順に', () => {
    expect(backlogYears(entries)).toEqual(['2026', '2025'])
    expect(backlogMonths(entries)).toEqual(['2026-05', '2026-01', '2025-12'])
  })
})

// ============================================================
// 本文の整形 — 彼女が読む文章
// ============================================================

describe('明細1行の書き方', () => {
  it('日付・内容・影響額・その時点の残高がこの順に並ぶ', () => {
    const [e] = buildBacklogEntries([shared('2026-05-20', 3000, 1500, '一緒の夕飯')], label)
    expect(backlogEntryLine(e)).toBe('5月20日(水) 一緒の夕飯 −¥1,500 → 立て替え ¥1,500')
  })

  it('残高がプラスなら「残り」、マイナスなら「立て替え」', () => {
    expect(runningBalanceText(28500)).toBe('残り ¥28,500')
    expect(runningBalanceText(0)).toBe('残り ¥0')
    expect(runningBalanceText(-1200)).toBe('立て替え ¥1,200')
  })

  it('影響額の符号は言葉より先に目に入るので、0 も ±¥0 と書く', () => {
    expect(signedImpactText(1200)).toBe('+¥1,200')
    expect(signedImpactText(-1500)).toBe('−¥1,500')
    expect(signedImpactText(0)).toBe('±¥0')
  })

  it('彼女が払った回は内訳を添える(符号の意味が読めないため)', () => {
    const [e] = buildBacklogEntries(
      [tx({ id: 'p', date: '2026-05-20', amount: 2000, partner_amount: 800, partner_paid: 2000, store: '居酒屋' })],
      label
    )
    expect(backlogEntryLine(e)).toContain('彼女が ¥2,000 払い、負担 ¥800')
    expect(backlogEntryLine(e)).toContain('+¥1,200')
  })

  it('金額は伏字にしない(彼女が読む文章なので目隠しの対象外)', () => {
    const [e] = buildBacklogEntries([deposit('2026-05-01', 30000)], label)
    expect(backlogEntryLine(e)).toContain('¥30,000')
    expect(backlogEntryLine(e)).not.toContain('•')
  })
})

// ============================================================
// 1通の組み立てと 2,000文字での分割
// ============================================================

/** n 件の明細をでっちあげる(1行の長さをそろえたいときに使う) */
function fakeEntries(n: number, titleLength = 10): BacklogEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `x${i}`,
    date: '2026-05-20',
    createdAt: `2026-05-20T${String(i % 24).padStart(2, '0')}:00:00.000Z`,
    title: 'あ'.repeat(titleLength),
    impact: -100,
    balance: 1000 - 100 * i,
    paid: 0,
    share: 100,
  }))
}

const plan = (entries: readonly BacklogEntry[], limit = DISCORD_MESSAGE_LIMIT) =>
  buildBacklogMessages({ entries, currentBalance: 0, limit })

describe('1通の組み立て', () => {
  const entries = buildBacklogEntries(
    [deposit('2026-05-01', 30000), shared('2026-05-20', 3000, 1500, '一緒の夕飯')],
    label
  )

  it('期間・件数・はじめの残高・明細・いまの残高がこの順に入る', () => {
    const [m] = buildBacklogMessages({ entries, currentBalance: 28500 })
    expect(m.text).toContain('📖 これまでの預かり金の記録')
    expect(m.text).toContain('期間: 2026年5月1日(金) 〜 2026年5月20日(水)・2件')
    expect(m.text).toContain('はじめの残高: ¥0(貸し借りなし)')
    expect(m.text).toContain('5月1日(金) 彼女から預かり +¥30,000 → 残り ¥30,000')
    expect(m.text).toContain('いまの残高: ¥28,500(預かり中)')
  })

  it('期間を区切って送ったときは、その期間の終わりと いまの残高 を両方書く', () => {
    const may = filterBacklogEntries(entries, { kind: 'month', value: '2026-05' }, null)
    const [m] = buildBacklogMessages({ entries: may, currentBalance: 9999 })
    expect(m.text).toContain('この期間のあとの残高: ¥28,500(預かり中)')
    expect(m.text).toContain('いまの残高: ¥9,999(預かり中)')
  })

  it('期間の終わりといまの残高が同じなら1行だけにする', () => {
    const [m] = buildBacklogMessages({ entries, currentBalance: 28500 })
    expect(m.text).not.toContain('この期間のあとの残高')
  })

  it('1通に収まるときは番号を出さない', () => {
    expect(backlogHeadline(1, 1)).toBe('📖 これまでの預かり金の記録')
    expect(backlogHeadline(2, 3)).toBe('📖 これまでの預かり金の記録(2/3)')
  })

  it('0件のときは1通も作らない(「記録がありません」だけの通知は届ける意味が無い)', () => {
    expect(buildBacklogMessages({ entries: [], currentBalance: 0 })).toEqual([])
  })
})

describe('2,000文字での分割', () => {
  it('どんな件数でも1通が上限を超えない', () => {
    for (const n of [1, 5, 30, 100, 400]) {
      for (const m of plan(fakeEntries(n))) {
        expect(m.text.length).toBeLessThanOrEqual(DISCORD_MESSAGE_LIMIT)
      }
    }
  })

  it('100件はおよそ数通に収まる(1件1通にはしない)', () => {
    const messages = plan(fakeEntries(100))
    expect(messages.length).toBeGreaterThan(1)
    expect(messages.length).toBeLessThan(10)
  })

  it('明細の順番は分割しても入れ替わらない', () => {
    const entries = fakeEntries(100)
    const joined = plan(entries).map((m) => m.text).join('\n')
    let at = -1
    for (const e of entries) {
      const next = joined.indexOf(backlogEntryLine(e), at + 1)
      expect(next).toBeGreaterThan(at)
      at = next
    }
  })

  it('境界ちょうど: 2,000文字ちょうどまでは1通、あと1文字で2通', () => {
    // 1通に収まる最大の件数を実際に探す(見出しと締めの長さも込みで決まる)
    let fit = 1
    while (plan(fakeEntries(fit + 1)).length === 1) fit += 1
    const justFits = plan(fakeEntries(fit))
    expect(justFits).toHaveLength(1)
    expect(plan(fakeEntries(fit + 1))).toHaveLength(2)

    // 残りの余白ぴったりまで文字を足す → **2,000文字ちょうど**で、まだ1通
    const room = DISCORD_MESSAGE_LIMIT - justFits[0].text.length
    const padded = fakeEntries(fit)
    padded[fit - 1] = { ...padded[fit - 1], title: padded[fit - 1].title + 'あ'.repeat(room) }
    const exact = plan(padded)
    expect(exact).toHaveLength(1)
    expect(exact[0].text.length).toBe(DISCORD_MESSAGE_LIMIT)

    // そこへ1文字だけ足すと、必ず2通に分かれる
    padded[fit - 1] = { ...padded[fit - 1], title: `${padded[fit - 1].title}あ` }
    const overflow = plan(padded)
    expect(overflow).toHaveLength(2)
    for (const m of overflow) expect(m.text.length).toBeLessThanOrEqual(DISCORD_MESSAGE_LIMIT)
  })

  it('境界ちょうど: 詰めるブロック自体も、上限ぴったりまでは1通に入れる', () => {
    // packBlocks を直接見る。改行1文字を数え忘れると、ここで 1文字あふれる
    const a = 'あ'.repeat(10)
    const b = 'い'.repeat(9)
    expect(packBlocks([a, b], 20)).toHaveLength(1) // 10 + 1 + 9 = ちょうど 20
    expect(packBlocks([a, b + 'う'], 20)).toHaveLength(2) // 21 であふれる
  })

  it('1件が長すぎるとき: 切り捨てずに分けて全部送る', () => {
    const long = 'ん'.repeat(5000)
    const pieces = splitLongBlock(long, DISCORD_MESSAGE_LIMIT)
    expect(pieces).toHaveLength(3)
    for (const p of pieces) expect(p.length).toBeLessThanOrEqual(DISCORD_MESSAGE_LIMIT)
    expect(pieces.join('')).toBe(long)
  })

  it('1件が長すぎるとき: 絵文字を途中で割らない', () => {
    // サロゲートペア(2文字ぶんの長さ)を、奇数の上限で切っても壊れないこと
    const pieces = splitLongBlock('🍚'.repeat(10), 5)
    expect(pieces.join('')).toBe('🍚'.repeat(10))
    for (const p of pieces) expect(p.length).toBeLessThanOrEqual(5)
    expect(pieces.every((p) => !/[\uD800-\uDBFF]$/.test(p))).toBe(true)
  })

  it('1件が長すぎるとき: 全体の組み立てでも上限を超えない', () => {
    const entries = fakeEntries(3)
    entries[1] = { ...entries[1], title: 'な'.repeat(4000) }
    const messages = plan(entries)
    for (const m of messages) expect(m.text.length).toBeLessThanOrEqual(DISCORD_MESSAGE_LIMIT)
    expect(messages.length).toBeGreaterThan(2)
  })

  it('0件のブロックは1通も作らない', () => {
    expect(packBlocks([], DISCORD_MESSAGE_LIMIT)).toEqual([])
    expect(packBlocks(['', ''], DISCORD_MESSAGE_LIMIT)).toEqual([])
  })

  it('分割したときは、通し番号が全部の通に入る', () => {
    const messages = plan(fakeEntries(200))
    messages.forEach((m, i) => {
      expect(m.text.startsWith(`📖 これまでの預かり金の記録(${i + 1}/${messages.length})`)).toBe(true)
    })
  })
})

describe('どこまで送れたかの目印', () => {
  it('通ごとに「ここまで送った」件数を持つ(途中で失敗しても続きから送れる)', () => {
    const entries = fakeEntries(100)
    const messages = plan(entries)
    // 累計なので単調増加し、最後は全件
    let prev = 0
    for (const m of messages) {
      expect(m.entriesThrough).toBeGreaterThanOrEqual(prev)
      prev = m.entriesThrough
    }
    expect(prev).toBe(entries.length)
    expect(messages[messages.length - 1].lastEntry?.id).toBe(entries[entries.length - 1].id)
  })

  it('1通目に入り切った件数は、その通の明細の数と一致する', () => {
    const entries = fakeEntries(100)
    const messages = plan(entries)
    const lines = messages[0].text.split('\n')
    const shown = entries.filter((e) => lines.includes(backlogEntryLine(e)))
    expect(messages[0].entriesThrough).toBe(shown.length)
  })
})

// ============================================================
// レート制限と画面の言葉
// ============================================================

describe('レート制限への備え', () => {
  it('429 や 5xx は1回だけ待ち直す(混雑は待てば直る)', () => {
    expect(backlogRetryDelay({ kind: 'http' }, 1)).toBe(BACKLOG_RETRY_DELAY_MS)
    expect(backlogRetryDelay({ kind: 'http' }, 2)).toBeNull()
  })

  it('Webhook が無効なときは待たずに止める(待っても直らない)', () => {
    expect(backlogRetryDelay({ kind: 'webhook' }, 1)).toBeNull()
  })

  it('通信できていないときも止める(連打しても同じ)', () => {
    expect(backlogRetryDelay({ kind: 'network' }, 1)).toBeNull()
  })
})

describe('画面に出す言葉', () => {
  it('送信中は何通目まで進んだかを出す(無言で数十秒待たせない)', () => {
    expect(backlogProgressText(3, 10)).toBe('送信中… 3/10通')
  })

  it('送り終えたら件数と通数を言い切る', () => {
    expect(backlogDoneText(42, 3)).toBe('42件を3通に分けて送りました')
  })

  it('途中で失敗したら、どこまで届いたかを先に書く', () => {
    const text = backlogPartialText(2, 10, 60)
    expect(text).toContain('10通のうち2通目まで(60件)が届きました')
    expect(text).toContain('前回の続き')
  })

  it('1通も送れなかったときは、何も届いていないと言い切る', () => {
    expect(backlogPartialText(0, 10, 0)).toContain('まだ何も届いていません')
  })
})
