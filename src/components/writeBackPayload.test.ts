import { describe, expect, it } from 'vitest'
import mainScreenSource from './MainScreen.tsx?raw'
import inputTabSource from './InputTab.tsx?raw'
import historyTabSource from './HistoryTab.tsx?raw'
import useTransactionsSource from '../hooks/useTransactions.ts?raw'

// ============================================================
// 「既存の記録を書き戻す」画面が、送る内容を手書きしていないこと
//
// ---- なぜソースを読むテストなのか ----
// 調査で見つかった不具合のうち3件が、この一点から出ている:
//
//   ・気分スタンプ (MainScreen)  — 手書きした payload に partner_paid が無く、
//     通知の差分計算が実在しない「差分 −¥5,000」を彼女に送っていた
//   ・店カテゴリの一括変更 (InputTab) — 同じ理由で同じ嘘の通知が出ていた
//   ・複数選択からの一括変更 (HistoryTab) — 同上
//
// いずれも **lib の純粋関数は正しく、呼び出し方だけが違って** いたため、
// 既存のテストは1件も落ちなかった。
//
// このうち HistoryTab の2経路(一括変更・複製)は画面を操作して確かめている
// (HistoryTab.interaction.test.tsx)。残る MainScreen と InputTab は
// Supabase と起動処理を丸ごと抱えていて画面から動かせないので、
// せめて「組み立て関数を通しているか」だけをソースから見張る。
//
// このテストが落ちたときにやること: 手書きに戻っていないかを確かめる。
// 組み立て関数の名前を変えた・置き場所を変えたなら、下の表を直せばよい。
// ============================================================

/** 既存の記録を書き戻す経路と、その内容を作るべき関数 */
const WRITE_BACK_CALL_SITES: {
  name: string
  source: string
  what: string
  /** 送る内容がこの呼び出しから作られていること */
  builder: string
}[] = [
  {
    name: 'MainScreen.tsx',
    source: mainScreenSource,
    what: '気分スタンプの付け直し (機能143)',
    builder: 'withSatisfaction(t, value)',
  },
  {
    name: 'InputTab.tsx',
    source: inputTabSource,
    what: '店のカテゴリが変わったときの過去分の直し (機能078)',
    builder: 'withCategory(t, recategorize.category)',
  },
  {
    name: 'HistoryTab.tsx',
    source: historyTabSource,
    what: '複数選択からの一括カテゴリ変更 (機能151)',
    builder: 'withCategory(t, catKey)',
  },
  {
    name: 'HistoryTab.tsx',
    source: historyTabSource,
    what: '長押しからの複製 (機能149)',
    builder: 'duplicateInput(t, today)',
  },
  {
    name: 'useTransactions.ts',
    source: useTransactionsSource,
    what: '削除の取り消し (機能159)',
    builder: 'restoreInput(',
  },
]

describe('既存の記録を書き戻す経路は、送る内容を組み立て関数から作る', () => {
  it.each(WRITE_BACK_CALL_SITES)('$what は $builder から作る', ({ source, builder }) => {
    expect(source).toContain(builder)
  })

  it.each([
    { name: 'MainScreen.tsx', source: mainScreenSource },
    { name: 'InputTab.tsx', source: inputTabSource },
    { name: 'HistoryTab.tsx', source: historyTabSource },
  ])('$name は、書き戻す内容の項目を手書きしない', ({ name, source }) => {
    // 「その行が持っている事実」を表す列。手書きの payload に現れたら、
    // どれか1つを書き忘れて残高・通知・内訳が静かに壊れる形になっている。
    // (新しい1件を作るフォーム — TransactionForm — は別の話なので、
    //  この一覧には入れていない)
    for (const key of ['partner_paid:', 'split_group:', 'satisfaction:']) {
      expect(source, `${name} に手書きの ${key} がある`).not.toContain(key)
    }
  })
})

// ============================================================
// 組み立て関数そのものが「持っている事実」を落としていないこと。
//
// 上のソース検査は「関数を通しているか」しか見ない。通していても、
// 関数側が1列でも写し忘れれば同じ不具合が戻る。列を増やしたときに
// transactionToInput への追加を忘れる、というのが現実的な壊れ方なので、
// **Transaction の列と、写される列の対応** をここで固定する。
// ============================================================
describe('書き戻しの土台が写す項目', () => {
  it('その記録が持っている事実(誰が払ったか・タグ・分割・自動生成・気分)を1つも落とさない', async () => {
    const { transactionToInput } = await import('../lib/txActions')
    const input = transactionToInput({
      id: 't1',
      date: '2026-08-03',
      type: 'expense',
      amount: 2000,
      category: 'food',
      memo: 'めも',
      store: 'スーパー',
      partner_amount: 800,
      partner_paid: 2000,
      tags: ['旅行2026'],
      split_group: 'g1',
      source: 'recurring',
      satisfaction: 'good',
      created_at: '2026-08-03T01:00:00.000Z',
    })
    expect(input).toMatchObject({
      date: '2026-08-03',
      type: 'expense',
      amount: 2000,
      category: 'food',
      memo: 'めも',
      store: 'スーパー',
      partner_amount: 800,
      partner_paid: 2000,
      tags: ['旅行2026'],
      split_group: 'g1',
      source: 'recurring',
      satisfaction: 'good',
    })
    // created_at だけは写さない — 書き換えで送ると、楽観表示の仮の時刻で
    // サーバーの本物を上書きしてしまう(入れ直す restoreInput だけが写す)
    expect('created_at' in input).toBe(false)
  })
})
