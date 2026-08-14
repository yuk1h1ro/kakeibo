// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TransactionForm from './TransactionForm'
import { setKeypadPreference } from '../lib/keypadSettings'
import { endTripMode, startTripMode } from '../lib/tripMode'
import type { TransactionInput } from '../hooks/useTransactions'
import type { Transaction } from '../lib/types'

// ============================================================
// 入力フォームを実際に操作して、**保存されるまでに何が送られるか** を確かめる。
//
// ここには実際に起きた不具合が2件ぶら下がっている:
//   ・分割を開くと、上段で選んだ「支払った人」が黙って捨てられていた。
//     分割は「自分が全額払った会計」を分けるものなので使わないこと自体は
//     仕様どおりだが、何も言わずに消えると「彼女が払った」と入力したつもりの
//     会計が、預かり残高に逆向きで効いてしまう。
//   ・お店のチップを押すと、テンキーを開けたのと同じタップでそれが閉じた。
//     チップは押すとその場で金額へ進む(=パッドを開く)のに、
//     「金額欄とパッド以外を触ったら閉じる」規則に自分が引っかかっていた。
//
// 描画テスト(renderToStaticMarkup)では、押す・打つを伴うここまでは届かない。
// このファイルだけ jsdom で動かしている(先頭の @vitest-environment)。
// 他のテストの実行環境は node のまま変わらない。
// ============================================================

afterEach(() => {
  cleanup()
  // 旅行モードは端末に残る状態なので、テストをまたいで持ち越さない
  endTripMode()
})

type User = ReturnType<typeof userEvent.setup>

const button = (name: string | RegExp): HTMLButtonElement =>
  screen.getByRole('button', { name }) as HTMLButtonElement
const field = (label: string): HTMLInputElement => screen.getByLabelText(label) as HTMLInputElement
const saveButton = () => button('記録する')

/** 金額欄などは打ち直しがあるので、いったん空にしてから打つ */
async function typeAmount(user: User, label: string, value: string) {
  const el = field(label)
  await user.clear(el)
  await user.type(el, value)
}

/** 気分・タグ・分割の折りたたみを開く(主線には畳みが無いので、開くのはここだけ) */
async function openOptions(user: User) {
  await user.click(button(/気分/))
}

function setup(props: Partial<Parameters<typeof TransactionForm>[0]> = {}) {
  const user = userEvent.setup()
  const submitted: TransactionInput[] = []
  const splitSubmitted: TransactionInput[][] = []
  render(
    <TransactionForm
      fixedType="expense"
      submitLabel="記録する"
      onSubmit={async (input) => {
        submitted.push(input)
      }}
      onSubmitSplit={async (inputs) => {
        splitSubmitted.push(inputs)
      }}
      {...props}
    />
  )
  return { user, submitted, splitSubmitted }
}

describe('入力フォームが保存する内容', () => {
  it('カテゴリと金額だけで、そのまま記録できる', async () => {
    const { user, submitted } = setup()
    await user.click(button(/食費/))
    await typeAmount(user, '支払い金額(円)', '1000')
    await user.click(saveButton())

    expect(submitted).toHaveLength(1)
    expect(submitted[0]).toMatchObject({
      type: 'expense',
      amount: 1000,
      category: 'food',
      partner_amount: 0,
      // 何も触らなければ「自分が全額払った」= 機能018 より前の前提のまま
      partner_paid: 0,
    })
  })

  it('選んだ「支払った人」が保存内容に載る(載らないと預かり残高が逆に動く)', async () => {
    // 機能018。彼女が ¥1,000 全額払い、そのうち彼女の負担は ¥400 →
    // 残高は +¥600 動く。partner_paid が落ちると −¥400 になり、符号ごと逆になる
    const { user, submitted } = setup()
    await user.click(button(/食費/))
    await typeAmount(user, '支払い金額(円)', '1000')
    await user.click(button('二人で使った'))
    await typeAmount(user, '彼女の負担分', '400')
    await user.click(button('彼女が全額'))
    await user.click(saveButton())

    expect(submitted[0]).toMatchObject({ amount: 1000, partner_amount: 400, partner_paid: 1000 })
  })

  it('「分けて払った」は、打った額がそのまま彼女が払った額になる', async () => {
    const { user, submitted } = setup()
    await user.click(button(/食費/))
    await typeAmount(user, '支払い金額(円)', '3000')
    await user.click(button('分けて払った'))
    await typeAmount(user, '彼女が払った額', '1200')
    await user.click(saveButton())

    expect(submitted[0]).toMatchObject({ amount: 3000, partner_paid: 1200 })
  })

  it('彼女が払った額が支払い金額を超えていると保存できない', async () => {
    const { user, submitted } = setup()
    await user.click(button(/食費/))
    await typeAmount(user, '支払い金額(円)', '1000')
    await user.click(button('分けて払った'))
    await typeAmount(user, '彼女が払った額', '5000')

    expect(saveButton().disabled).toBe(true)
    expect(screen.getByText('彼女が払った額は、支払い金額までにしてください')).toBeTruthy()
    expect(submitted).toHaveLength(0)
  })

  it('彼女の負担分が支払い金額を超えていると保存できない', async () => {
    const { user } = setup()
    await user.click(button(/食費/))
    await typeAmount(user, '支払い金額(円)', '1000')
    await user.click(button('二人で使った'))
    await typeAmount(user, '彼女の負担分', '3000')

    expect(saveButton().disabled).toBe(true)
  })

  it('打ちかけのタグも取りこぼさずに保存する', async () => {
    // 機能088。Enter を押さずに保存ボタンへ行っても消えない
    const { user, submitted } = setup()
    await user.click(button(/食費/))
    await typeAmount(user, '支払い金額(円)', '800')
    await openOptions(user)
    await user.type(field('タグ'), '旅行2026 デート')
    await user.click(saveButton())

    expect(submitted[0].tags).toEqual(['旅行2026', 'デート'])
  })

  it('気分スタンプは押した値が保存内容に載る', async () => {
    // 機能219
    const { user, submitted } = setup()
    await user.click(button(/食費/))
    await typeAmount(user, '支払い金額(円)', '800')
    await openOptions(user)
    const stamps = within(screen.getByRole('group', { name: 'この支出の気分' }))
    await user.click(stamps.getByRole('button', { name: /後悔/ }))
    await user.click(saveButton())

    expect(submitted[0].satisfaction).toBe('regret')
  })

  it('保存したあと、次の1件に前の「支払った人」やタグが残らない', async () => {
    // 1件ごとの事実なので持ち越さない。残ると、次の記録が知らないうちに
    // 「彼女が払った」扱いになり、預かり残高が動く
    const { user, submitted } = setup()
    await user.click(button(/食費/))
    await typeAmount(user, '支払い金額(円)', '1000')
    await user.click(button('彼女が全額'))
    await user.click(saveButton())

    await typeAmount(user, '支払い金額(円)', '500')
    await user.click(saveButton())

    expect(submitted).toHaveLength(2)
    expect(submitted[1]).toMatchObject({ amount: 500, partner_paid: 0, partner_amount: 0 })
    expect(submitted[1].tags).toEqual([])
  })
})

// ============================================================
// おごり・値引き (favors.ts)。
//
// 守りたいのは3つ:
//   ・**全額おごってもらった回(支払い 0円)を保存できること**。
//     ここが通らないと、ご馳走になった事実そのものが記録に残せない
//     (この機能を入れるまでは、金額 > 0 が絶対条件だった)
//   ・浮いた額を amount に混ぜないこと(支出の合計に嘘が乗る)
//   ・理由の無い 0円 はこれまでどおり弾くこと
// ============================================================
describe('おごり・値引き', () => {
  /** 開いている「詳細」の中で、おごり(または割引)を押す */
  async function pickFavor(user: User, name: RegExp) {
    const kinds = within(screen.getByRole('group', { name: 'おごり・値引き' }))
    await user.click(kinds.getByRole('button', { name }))
  }

  /** 「詳細」を開いて、おごり(または割引)を選ぶ */
  async function chooseFavor(user: User, name: RegExp) {
    await openOptions(user)
    await pickFavor(user, name)
  }

  it('全額おごってもらった回は、支払い 0円 のまま保存できる', async () => {
    const { user, submitted } = setup()
    await user.click(button(/食費/))
    // 金額欄には何も打たない(自分は1円も払っていない)
    await chooseFavor(user, /おごってもらった/)
    await typeAmount(user, 'おごってもらった額(円)', '3200')
    await user.type(field('おごってくれた人'), '田中')
    expect(saveButton().disabled).toBe(false)
    await user.click(saveButton())

    expect(submitted[0]).toMatchObject({
      amount: 0,
      favor_amount: 3200,
      favor_kind: 'treat',
      favor_from: '田中',
    })
  })

  it('浮いた額は支払い金額に足されない(支出の合計に嘘を乗せない)', async () => {
    const { user, submitted } = setup()
    await user.click(button(/食費/))
    await typeAmount(user, '支払い金額(円)', '1000')
    await chooseFavor(user, /おごってもらった/)
    await typeAmount(user, 'おごってもらった額(円)', '2200')
    await user.click(saveButton())

    expect(submitted[0].amount).toBe(1000)
    expect(submitted[0].favor_amount).toBe(2200)
  })

  it('割引には相手の名前を聞かない(相手のいない好意なので)', async () => {
    const { user, submitted } = setup()
    await user.click(button(/食費/))
    await typeAmount(user, '支払い金額(円)', '2500')
    await chooseFavor(user, /割引・ポイント/)
    await typeAmount(user, '安くなった額(円)', '500')
    expect(screen.queryByLabelText('おごってくれた人')).toBeNull()
    await user.click(saveButton())

    expect(submitted[0]).toMatchObject({
      amount: 2500,
      favor_amount: 500,
      favor_kind: 'discount',
      favor_from: '',
    })
  })

  it('理由の無い 0円 は、これまでどおり保存できない', async () => {
    const { user } = setup()
    await user.click(button(/食費/))
    // 種類だけ選んで額を入れない = おごりとして成立していない
    await chooseFavor(user, /おごってもらった/)
    expect(saveButton().disabled).toBe(true)
  })

  it('もう一度押すと外れ、外したら 0円 では保存できなくなる', async () => {
    const { user } = setup()
    await user.click(button(/食費/))
    await chooseFavor(user, /おごってもらった/)
    await typeAmount(user, 'おごってもらった額(円)', '3200')
    expect(saveButton().disabled).toBe(false)

    // 「詳細」は開いたまま、同じチップをもう一度押す
    await pickFavor(user, /おごってもらった/)
    expect(saveButton().disabled).toBe(true)
  })

  it('保存したあと、次の1件に前のおごりが残らない', async () => {
    // 残ると、覚えのない「田中さんのおごり」が静かに増えていく
    const { user, submitted } = setup()
    await user.click(button(/食費/))
    await chooseFavor(user, /おごってもらった/)
    await typeAmount(user, 'おごってもらった額(円)', '3200')
    await user.type(field('おごってくれた人'), '田中')
    await user.click(saveButton())

    await typeAmount(user, '支払い金額(円)', '800')
    await user.click(saveButton())

    expect(submitted).toHaveLength(2)
    expect(submitted[1]).toMatchObject({
      amount: 800,
      favor_amount: 0,
      favor_kind: null,
      favor_from: '',
    })
  })

  it('付けていない記録は「無し」を明示して送る(編集で外したときに前の値を残さない)', async () => {
    const { user, submitted } = setup()
    await user.click(button(/食費/))
    await typeAmount(user, '支払い金額(円)', '1000')
    await user.click(saveButton())

    expect(submitted[0]).toMatchObject({ favor_amount: 0, favor_kind: null, favor_from: '' })
  })
})

// ============================================================
// 旅行モード。
//
// 守りたいのは「保存される内容」— 画面の見た目より、**tags に何が入るか**。
//   ・オンなら入る / オフなら入らない(オフの挙動が1文字も変わらないこと)
//   ・自動と手動の両方が付く
//   ・その1件だけ外せて、外した判断は次に持ち越さない
//   ・編集シートでは効かない(開いただけで記録の中身が変わらない)
// ============================================================
describe('旅行モードの自動タグ', () => {
  /** カテゴリと金額だけ打って保存する(いちばん短い経路) */
  async function saveSimple(user: User, amount = '1000') {
    await user.click(button(/食費/))
    await typeAmount(user, '支払い金額(円)', amount)
    await user.click(saveButton())
  }

  it('オンのとき、保存した記録にそのタグが入る', async () => {
    startTripMode('旅行')
    const { user, submitted } = setup()
    await saveSimple(user)
    expect(submitted[0].tags).toEqual(['旅行'])
  })

  it('オフのときは何も入らない(モードを使わない人の保存内容は変わらない)', async () => {
    const { user, submitted } = setup()
    await saveSimple(user)
    expect(submitted[0].tags).toEqual([])
    // オフのときは画面にも何も出さない = 入力の手数が増えない
    expect(screen.queryByRole('button', { name: 'この1件だけ外す' })).toBeNull()
  })

  it('手で付けたタグと共存する(自動+手動の両方が付く)', async () => {
    startTripMode('旅行')
    const { user, submitted } = setup()
    await user.click(button(/食費/))
    await typeAmount(user, '支払い金額(円)', '1000')
    await openOptions(user)
    await user.type(field('タグ'), 'おみやげ')
    await user.click(saveButton())
    expect(submitted[0].tags).toEqual(['旅行', 'おみやげ'])
  })

  it('その1件だけ外せる(旅行中のコンビニで買う自分用のもの)', async () => {
    startTripMode('旅行')
    const { user, submitted } = setup()
    await user.click(button(/食費/))
    await typeAmount(user, '支払い金額(円)', '300')
    await user.click(button('この1件だけ外す'))
    expect(screen.getByText(/を付けません/)).toBeTruthy()
    await user.click(saveButton())
    expect(submitted[0].tags).toEqual([])
  })

  it('外したあと、押し直せばまた付く', async () => {
    startTripMode('旅行')
    const { user, submitted } = setup()
    await user.click(button(/食費/))
    await typeAmount(user, '支払い金額(円)', '300')
    await user.click(button('この1件だけ外す'))
    await user.click(button('やっぱり付ける'))
    await user.click(saveButton())
    expect(submitted[0].tags).toEqual(['旅行'])
  })

  it('「この1件だけ外す」は次の記録に持ち越さない(外したまま旅行の記録が抜けないように)', async () => {
    startTripMode('旅行')
    const { user, submitted } = setup()
    await user.click(button(/食費/))
    await typeAmount(user, '支払い金額(円)', '300')
    await user.click(button('この1件だけ外す'))
    await user.click(saveButton())

    await typeAmount(user, '支払い金額(円)', '2000')
    await user.click(saveButton())

    expect(submitted[0].tags).toEqual([])
    expect(submitted[1].tags).toEqual(['旅行'])
  })

  it('編集シートでは自動で付かない(開いて更新しただけで記録が変質しないこと)', async () => {
    startTripMode('旅行')
    const submitted: TransactionInput[] = []
    const user = userEvent.setup()
    render(
      <TransactionForm
        initial={{
          id: 't1',
          date: '2026-08-03',
          type: 'expense',
          amount: 2000,
          category: 'food',
          memo: '',
          store: '',
          partner_amount: 0,
          created_at: '2026-08-03T01:00:00.000Z',
        }}
        submitLabel="更新する"
        onSubmit={async (input) => {
          submitted.push(input)
        }}
      />
    )
    await user.click(button('更新する'))
    expect(submitted[0].tags).toEqual([])
  })

  it('分割して保存しても、内訳のすべてにタグが乗る', async () => {
    // 旅行中の1会計を分けたときだけタグが落ちると、その回の合計が合わなくなる
    startTripMode('旅行')
    const { user, splitSubmitted } = setup()
    await user.click(button(/食費/))
    await typeAmount(user, '支払い金額(円)', '3000')
    await openOptions(user)
    await user.click(button('カテゴリを分けて記録する'))
    await user.selectOptions(screen.getByLabelText('内訳 2 のカテゴリ'), 'daily')
    await user.click(saveButton())

    expect(splitSubmitted[0].every((i) => i.tags?.includes('旅行'))).toBe(true)
  })

  it('預かり・返金には効かない(旅行かどうかは支出の性質のため)', async () => {
    startTripMode('旅行')
    const submitted: TransactionInput[] = []
    const user = userEvent.setup()
    render(
      <TransactionForm
        fixedType="partner_deposit"
        submitLabel="記録する"
        onSubmit={async (input) => {
          submitted.push(input)
        }}
      />
    )
    await typeAmount(user, '預かり金額(円)', '30000')
    await user.click(saveButton())
    expect(submitted[0].tags).toEqual([])
  })
})

describe('分割を開いたときの引き継ぎ (機能096)', () => {
  /** 分割を開くところまで進める。金額 ¥3,000・彼女の負担分 ¥1,000・彼女が全額払い */
  async function openSplit() {
    const ctx = setup()
    const { user } = ctx
    await user.click(button(/食費/))
    await typeAmount(user, '支払い金額(円)', '3000')
    await user.click(button('二人で使った'))
    await typeAmount(user, '彼女の負担分', '1000')
    await user.click(button('彼女が全額'))
    await openOptions(user)
    await user.click(button('カテゴリを分けて記録する'))
    return ctx
  }

  it('上段の「彼女の負担分」は黙って消えず、内訳に振り分けられる', async () => {
    await openSplit()
    expect(screen.getByText(/上段の「彼女の負担分」¥1,000 は内訳に振り分けました/)).toBeTruthy()
    // 先頭の内訳から、その内訳の金額を上限に詰める(按分にすると1円がどこかに寄る)
    expect(field('内訳 1 の彼女の負担分').value).toBe('1,000')
    expect(field('内訳 2 の彼女の負担分').value).toBe('')
  })

  it('使われなくなる「支払った人」は、その場で理由つきで知らせる', async () => {
    // これが無かった頃は、彼女が全額払ったつもりの会計が
    // 自分が全額払った扱いで黙って保存され、預かり残高が逆向きに動いていた
    await openSplit()
    expect(screen.getByText(/「支払った人」は分割では使えない/)).toBeTruthy()
    expect(screen.getByText(/自分が全額払った扱いで保存されます/)).toBeTruthy()
  })

  it('「自分が全額」のままなら、支払った人の注意は出さない(要らない注意を増やさない)', async () => {
    const { user } = setup()
    await user.click(button(/食費/))
    await typeAmount(user, '支払い金額(円)', '3000')
    await openOptions(user)
    await user.click(button('カテゴリを分けて記録する'))
    expect(screen.queryByText(/「支払った人」は分割では使えない/)).toBeNull()
  })

  it('分割をやめると、入れた「彼女の負担分」がそのまま元の欄に戻る', async () => {
    const { user } = await openSplit()
    await user.click(button('分割をやめる'))
    expect(field('彼女の負担分').value).toBe('1,000')
  })

  it('内訳の合計が支払い金額と一致するまで保存できない', async () => {
    const { user, splitSubmitted } = await openSplit()
    await user.selectOptions(screen.getByLabelText('内訳 2 のカテゴリ'), 'daily')
    await typeAmount(user, '内訳 2 の金額', '1000')

    expect(screen.getByText(/あと ¥500 振り分けてください/)).toBeTruthy()
    expect(saveButton().disabled).toBe(true)
    expect(splitSubmitted).toHaveLength(0)
  })

  it('保存すると、内訳ごとの記録がまとめて1つの束として積まれる', async () => {
    const { user, splitSubmitted } = await openSplit()
    await user.selectOptions(screen.getByLabelText('内訳 2 のカテゴリ'), 'daily')
    await user.click(saveButton())

    expect(splitSubmitted).toHaveLength(1)
    const inputs = splitSubmitted[0]
    expect(inputs).toHaveLength(2)
    // 合計は必ず元の支払い金額と一致する
    expect(inputs.reduce((s, i) => s + i.amount, 0)).toBe(3000)
    expect(inputs.map((i) => i.category)).toEqual(['food', 'daily'])
    // 彼女の負担分は内訳ごとに持つ(1行にまとめると按分の丸めで残高がずれる)
    expect(inputs.map((i) => i.partner_amount)).toEqual([1000, 0])
    // 支払った人は分割では使わない。必ず 0 にして残高の向きを固定する
    expect(inputs.every((i) => i.partner_paid === 0)).toBe(true)
    // 同じ会計であることは split_group だけが表す
    expect(inputs[0].split_group).toBeTruthy()
    expect(inputs[1].split_group).toBe(inputs[0].split_group)
    // 1件ぶんの onSubmit は呼ばれない(二重計上しない)
  })

  it('分割中は上段の「彼女の負担分」の欄を出さない(入れても効かない欄を残さない)', async () => {
    await openSplit()
    expect(screen.queryByLabelText('彼女の負担分')).toBeNull()
    expect(screen.queryByRole('group', { name: '支払った人' })).toBeNull()
  })
})

describe('編集フォームが開いたときの初期値', () => {
  function tx(over: Partial<Transaction> = {}): Transaction {
    return {
      id: 't1',
      date: '2026-08-03',
      type: 'expense',
      amount: 2000,
      category: 'food',
      memo: '',
      store: 'スーパー',
      partner_amount: 800,
      created_at: '2026-08-03T01:00:00.000Z',
      ...over,
    }
  }

  function renderEdit(t: Transaction) {
    const submitted: TransactionInput[] = []
    render(
      <TransactionForm
        initial={t}
        submitLabel="更新する"
        onSubmit={async (input) => {
          submitted.push(input)
        }}
      />
    )
    return { user: userEvent.setup(), submitted }
  }

  it('彼女が全額払った記録を開くと「彼女が全額」が選ばれている', () => {
    renderEdit(tx({ partner_paid: 2000 }))
    expect(button('彼女が全額').getAttribute('aria-pressed')).toBe('true')
  })

  it('分けて払った記録を開くと「分けて払った」と、その額が入っている', () => {
    renderEdit(tx({ partner_paid: 1200 }))
    expect(button('分けて払った').getAttribute('aria-pressed')).toBe('true')
    expect(field('彼女が払った額').value).toBe('1,200')
  })

  it('何も直さずに更新しても、彼女が払った額が消えない(残高が動かないこと)', async () => {
    const { user, submitted } = renderEdit(tx({ partner_paid: 2000 }))
    await user.click(button('更新する'))
    expect(submitted[0]).toMatchObject({ amount: 2000, partner_amount: 800, partner_paid: 2000 })
  })

  it('何も直さずに更新しても、タグと気分が消えない', async () => {
    // 編集しただけで「その記録が持っている事実」が落ちると、記録が静かに変質する
    const { user, submitted } = renderEdit(tx({ tags: ['旅行2026'], satisfaction: 'good' }))
    await user.click(button('更新する'))
    expect(submitted[0].tags).toEqual(['旅行2026'])
    expect(submitted[0].satisfaction).toBe('good')
  })

  it('編集シートでは分割の導線を出さない(分けた1行ずつを個別に直す画面のため)', () => {
    renderEdit(tx())
    expect(screen.queryByRole('button', { name: 'カテゴリを分けて記録する' })).toBeNull()
  })

  it('分割された記録には、この1行だけが変わることを明示する', () => {
    renderEdit(tx({ split_group: 'g1' }))
    expect(screen.getByText(/この行だけが変わります/)).toBeTruthy()
  })
})

describe('預かり・返金・調整のフォーム (機能012)', () => {
  function setupSettlement(fixedType: 'partner_deposit' | 'partner_refund' | 'partner_adjust') {
    const user = userEvent.setup()
    const submitted: TransactionInput[] = []
    const impacts: number[] = []
    render(
      <TransactionForm
        fixedType={fixedType}
        submitLabel="記録する"
        onPartnerImpactChange={(n) => impacts.push(n)}
        onSubmit={async (input) => {
          submitted.push(input)
        }}
      />
    )
    return { user, submitted, impacts }
  }

  it('返金は金額欄の見出しが変わり、カテゴリもお店も持たない', async () => {
    const { user, submitted } = setupSettlement('partner_refund')
    expect(screen.queryByRole('button', { name: /食費/ })).toBeNull()
    await typeAmount(user, '返した金額(円)', '5000')
    await user.click(saveButton())
    expect(submitted[0]).toMatchObject({
      type: 'partner_refund',
      amount: 5000,
      category: null,
      store: '',
      partner_amount: 0,
    })
  })

  it('調整は向きをボタンで選び、符号つきの金額として保存する(数字に符号を打たせない)', async () => {
    // 符号を打ち込ませると、マイナスの打ち間違いがそのまま残高に直結する
    const { user, submitted } = setupSettlement('partner_adjust')
    await typeAmount(user, '調整する金額(円)', '700')
    await user.click(button('残高を減らす'))
    await user.click(saveButton())
    expect(submitted[0]).toMatchObject({ type: 'partner_adjust', amount: -700 })
  })

  it('調整の既定は「残高を増やす」で、そのままならプラスで保存する', async () => {
    const { user, submitted } = setupSettlement('partner_adjust')
    expect(button('残高を増やす').getAttribute('aria-pressed')).toBe('true')
    await typeAmount(user, '調整する金額(円)', '700')
    await user.click(saveButton())
    expect(submitted[0]).toMatchObject({ type: 'partner_adjust', amount: 700 })
  })

  it('残高への影響額を、押す前に親へ知らせる(見込みと保存後の残高がずれないように)', async () => {
    const { user, impacts } = setupSettlement('partner_refund')
    await typeAmount(user, '返した金額(円)', '5000')
    // 返金は残高を減らす向き
    expect(impacts[impacts.length - 1]).toBe(-5000)
  })

  it('調整の向きを変えると、知らせる影響額の符号も変わる', async () => {
    const { user, impacts } = setupSettlement('partner_adjust')
    await typeAmount(user, '調整する金額(円)', '700')
    expect(impacts[impacts.length - 1]).toBe(700)
    await user.click(button('残高を減らす'))
    expect(impacts[impacts.length - 1]).toBe(-700)
  })
})

describe('支出の残高への影響額の通知 (機能018)', () => {
  it('彼女の負担分だけならマイナス、彼女が払いすぎた回はプラスで知らせる', async () => {
    const user = userEvent.setup()
    const impacts: number[] = []
    render(
      <TransactionForm
        fixedType="expense"
        submitLabel="記録する"
        onPartnerImpactChange={(n) => impacts.push(n)}
        onSubmit={async () => {}}
      />
    )
    await user.click(button(/食費/))
    await typeAmount(user, '支払い金額(円)', '1000')
    await user.click(button('二人で使った'))
    await typeAmount(user, '彼女の負担分', '400')
    expect(impacts[impacts.length - 1]).toBe(-400)

    // 彼女が全額(¥1,000)払い、負担は ¥400 → 残高は +¥600 動く
    await user.click(button('彼女が全額'))
    expect(impacts[impacts.length - 1]).toBe(600)
  })
})

describe('保存できない入力', () => {
  it('金額が0のままでは保存ボタンを押せない', async () => {
    const { user } = setup()
    await user.click(button(/食費/))
    expect(saveButton().disabled).toBe(true)
  })

  it('支出はカテゴリを選ばないと保存できない', async () => {
    const { user } = setup()
    await typeAmount(user, '支払い金額(円)', '1000')
    expect(saveButton().disabled).toBe(true)
  })

  it('保存に失敗したときは、原文ではなく原因と次にやることを先に出す (機能161)', async () => {
    const user = userEvent.setup()
    render(
      <TransactionForm
        fixedType="expense"
        submitLabel="記録する"
        onSubmit={async () => {
          throw new Error('duplicate key value violates unique constraint "transactions_pkey"')
        }}
      />
    )
    await user.click(button(/食費/))
    await typeAmount(user, '支払い金額(円)', '1000')
    await user.click(saveButton())

    const text = screen.getByText(/確かめてください/).textContent ?? ''
    // 原文は消さない(原因を追える唯一の手がかりなので)が、先頭には置かない。
    // 原文が先頭にあると、読む気を失って「やること」まで届かない
    expect(text.startsWith('duplicate key')).toBe(false)
    expect(text).toContain('同じ内容の記録がすでにあるため')
    expect(text.indexOf('確かめてください')).toBeLessThan(text.indexOf('transactions_pkey'))
  })
})

describe('金額欄の簡易電卓', () => {
  it('＝を押し忘れても、保留中の計算を確定してから保存する', async () => {
    const { user, submitted } = setup()
    await user.click(button(/食費/))
    await typeAmount(user, '支払い金額(円)', '1200')
    await user.click(button('足す'))
    await typeAmount(user, '支払い金額(円)', '800')
    await user.click(saveButton())
    expect(submitted[0].amount).toBe(2000)
  })

  it('マイナスになる計算は保存させない', async () => {
    const { user } = setup()
    await user.click(button(/食費/))
    await typeAmount(user, '支払い金額(円)', '500')
    await user.click(button('引く'))
    await typeAmount(user, '支払い金額(円)', '800')
    await user.click(button('計算する'))
    expect(screen.getByText('マイナスの金額は保存できません')).toBeTruthy()
    expect(saveButton().disabled).toBe(true)
  })
})

// ============================================================
// ％と「税込にする」(機能043 の続き)
//
// 要望は「小数点は要らない、%(とくに消費税)が計算できればいい」。
// ここでは **打った金額が税込になって、そのまま整数で保存されるか** を見る。
// 端数の切り捨てや境界そのものは calc.test.ts(純粋関数)側で押さえてある。
// ============================================================
describe('税込にする', () => {
  const amountLabel = '支払い金額(円)'

  it('打った直後に1タップで税込になり、その額が保存される', async () => {
    const { user, submitted } = setup()
    await user.click(button(/食費/))
    await typeAmount(user, amountLabel, '1000')
    await user.click(button('税込にする(10%)'))

    // 桁区切り(機能050)と喧嘩しないこと
    expect(field(amountLabel).value).toBe('1,100')
    await user.click(saveButton())
    expect(submitted[0].amount).toBe(1100)
    expect(Number.isInteger(submitted[0].amount)).toBe(true)
  })

  it('軽減税率(8%)も同じ1タップ', async () => {
    const { user, submitted } = setup()
    await user.click(button(/食費/))
    await typeAmount(user, amountLabel, '1000')
    await user.click(button('税込にする(8%)'))
    expect(field(amountLabel).value).toBe('1,080')
    await user.click(saveButton())
    expect(submitted[0].amount).toBe(1080)
  })

  it('押した結果が文字でも出る(黙って数字が変わらない)', async () => {
    const { user } = setup()
    await user.click(button(/食費/))
    await typeAmount(user, amountLabel, '333')
    await user.click(button('税込にする(10%)'))
    // 端数を切り捨てたときは、そう書く
    expect(screen.getByText('333 → 税込 366(10%・円未満切り捨て)')).toBeTruthy()
  })

  it('金額を打ち直すと、前に押した結果の説明は消える', async () => {
    const { user } = setup()
    await user.click(button(/食費/))
    await typeAmount(user, amountLabel, '1000')
    await user.click(button('税込にする(10%)'))
    expect(screen.queryByText(/税込 1,100/)).not.toBeNull()

    await typeAmount(user, amountLabel, '500')
    expect(screen.queryByText(/税込 1,100/)).toBeNull()
  })

  it('金額が無いうちは押せない', async () => {
    const { user } = setup()
    await user.click(button(/食費/))
    expect((button('税込にする(10%)') as HTMLButtonElement).disabled).toBe(true)
    await typeAmount(user, amountLabel, '100')
    expect((button('税込にする(10%)') as HTMLButtonElement).disabled).toBe(false)
  })

  it('計算の途中で押すと、先に計算を確定してから税込にする', async () => {
    const { user, submitted } = setup()
    await user.click(button(/食費/))
    await typeAmount(user, amountLabel, '980')
    await user.click(button('足す'))
    await typeAmount(user, amountLabel, '200')
    await user.click(button('税込にする(10%)'))
    expect(field(amountLabel).value).toBe('1,298')
    await user.click(saveButton())
    expect(submitted[0].amount).toBe(1298)
  })

  it('彼女の負担分でも同じように税込にできる', async () => {
    const { user, submitted } = setup()
    await user.click(button(/食費/))
    await typeAmount(user, amountLabel, '2200')
    await user.click(button('二人で使った'))
    await typeAmount(user, '彼女の負担分', '1000')
    await user.click(button('彼女の負担分を税込にする(10%)'))
    expect(field('彼女の負担分').value).toBe('1,100')
    await user.click(saveButton())
    expect(submitted[0].partner_amount).toBe(1100)
  })

  it('テンキーを開いたまま押しても、パッドは閉じない', async () => {
    setKeypadPreference('on')
    const { user } = setup()
    await user.click(button(/食費/))
    await user.click(field(amountLabel))
    expect(screen.queryByRole('group', { name: '金額入力のテンキー' })).not.toBeNull()

    // 自前テンキーで打ってから税込にする(OSキーボードと同じ場所を押す)
    await user.click(within(screen.getByRole('group', { name: '金額入力のテンキー' })).getByRole('button', { name: '1' }))
    await user.click(within(screen.getByRole('group', { name: '金額入力のテンキー' })).getByRole('button', { name: '00' }))
    await user.click(within(screen.getByRole('group', { name: '金額入力のテンキー' })).getByRole('button', { name: '0' }))
    expect(field(amountLabel).value).toBe('1,000')

    await user.click(button('税込にする(10%)'))
    expect(field(amountLabel).value).toBe('1,100')
    expect(screen.queryByRole('group', { name: '金額入力のテンキー' })).not.toBeNull()
  })
})

describe('％キー', () => {
  const amountLabel = '支払い金額(円)'

  it('1000 ＋ 10 ％ で 1100 になる', async () => {
    const { user, submitted } = setup()
    await user.click(button(/食費/))
    await typeAmount(user, amountLabel, '1000')
    await user.click(button('足す'))
    await typeAmount(user, amountLabel, '10')
    await user.click(button('パーセント'))
    expect(field(amountLabel).value).toBe('1,100')
    await user.click(saveButton())
    expect(submitted[0].amount).toBe(1100)
  })

  it('1000 × 10 ％ で 100(割合そのもの)', async () => {
    const { user } = setup()
    await user.click(button(/食費/))
    await typeAmount(user, amountLabel, '1000')
    await user.click(button('掛ける'))
    await typeAmount(user, amountLabel, '10')
    await user.click(button('パーセント'))
    expect(field(amountLabel).value).toBe('100')
  })

  it('演算子を押していないうちは ％ を押せない', async () => {
    const { user } = setup()
    await user.click(button(/食費/))
    await typeAmount(user, amountLabel, '1000')
    expect((button('パーセント') as HTMLButtonElement).disabled).toBe(true)
    await user.click(button('足す'))
    expect((button('パーセント') as HTMLButtonElement).disabled).toBe(false)
  })

  it('C を押すと ％ の途中経過ごと消える', async () => {
    // テンキーを開くと C が2つ(バーとパッド)になるので、ここでは OS キーボード側で見る
    setKeypadPreference('off')
    const { user } = setup()
    await user.click(button(/食費/))
    await typeAmount(user, amountLabel, '1000')
    await user.click(button('足す'))
    await user.click(button('金額をクリア'))
    expect(field(amountLabel).value).toBe('')
    expect((button('パーセント') as HTMLButtonElement).disabled).toBe(true)
  })
})

// ============================================================
// お店のチップとテンキー (機能052 + 新しい入力の並び)
//
// 実際に起きた不具合:
//   **店のチップを押すと、テンキーを開けたのと同じタップでそれが閉じた。**
// チップは押すとその場で金額へ進む(= パッドを開く)のに、
// 「金額欄・パッド以外を触ったら閉じる」規則に自分が引っかかっていた。
// 閉じる規則そのものは必要なので、規則を消すのではなく除外で守っている。
// この2件はその除外が外れたときにだけ落ちる。
// ============================================================
describe('お店のチップを押してもテンキーが閉じない', () => {
  /** カテゴリ「食費」で過去に使った店が候補として並ぶ状態 */
  function known(): Transaction[] {
    return [
      {
        id: 'k1',
        date: '2026-08-01',
        type: 'expense',
        amount: 1200,
        category: 'food',
        memo: '',
        store: 'スーパー',
        partner_amount: 0,
        created_at: '2026-08-01T01:00:00.000Z',
      },
    ]
  }

  const keypad = () => screen.queryByRole('group', { name: '金額入力のテンキー' })

  it('金額を打ったあとに店を選び直しても、テンキーは開いたまま', async () => {
    setKeypadPreference('on')
    const { user } = setup({ knownTransactions: known() })
    await user.click(button(/食費/))
    await typeAmount(user, '支払い金額(円)', '1200')
    expect(keypad()).not.toBeNull()

    await user.click(within(screen.getByRole('group', { name: 'お店の候補' })).getByRole('button', { name: 'スーパー' }))
    expect(keypad()).not.toBeNull()
    expect(field('お店').value).toBe('スーパー')
  })

  it('金額欄を先に触ってパッドを開いていても、店を選んだ時点で閉じない', async () => {
    // チップは選ぶと金額欄へ送る(= パッドを開く)。開けたのと同じタップで
    // 閉じてしまうと、押したのにテンキーが出ないように見える
    setKeypadPreference('on')
    const { user } = setup({ knownTransactions: known() })
    await user.click(button(/食費/))
    await user.click(field('支払い金額(円)'))
    expect(keypad()).not.toBeNull()

    await user.click(within(screen.getByRole('group', { name: 'お店の候補' })).getByRole('button', { name: 'スーパー' }))
    expect(keypad()).not.toBeNull()
  })

  it('金額欄・パッド・店のチップ以外を触ったら、これまでどおり閉じる', async () => {
    // 上2件が「何でも閉じない」に倒れていないことの裏取り
    setKeypadPreference('on')
    const { user } = setup({ knownTransactions: known() })
    await user.click(button(/食費/))
    await typeAmount(user, '支払い金額(円)', '1200')
    expect(keypad()).not.toBeNull()

    await user.click(button('昨日'))
    expect(keypad()).toBeNull()
  })
})
