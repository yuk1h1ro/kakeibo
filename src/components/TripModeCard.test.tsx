// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TripModeCard from './TripModeCard'
import { endTripMode, getTripMode, startTripMode } from '../lib/tripMode'
import { setSpecialTags } from '../lib/reportTagSettings'

// ============================================================
// 旅行モードの入り口(入力タブの最上段)。
//
// 見るのは3つ:
//   ・オフのときは1行のボタンだけ(押さなければ何も起きない)
//   ・2タップで始まり、オンの間は「何が付くか」「何日目か」が出続ける
//   ・長引いても **勝手に解除しない**。声をかけるだけ
// ============================================================

afterEach(() => {
  cleanup()
  endTripMode()
  vi.useRealTimers()
  // 特別タグの選択も端末に残るので、既定(旅行・デート・出張)に戻す
  try {
    localStorage.removeItem('kakeibo.specialTags')
  } catch {
    // localStorage が無い環境でも後続のテストは動く
  }
  setSpecialTags(['旅行', 'デート', '出張'])
})

const button = (name: string | RegExp) => screen.getByRole('button', { name })

describe('オフのとき', () => {
  it('入り口は1行のボタンだけで、タグは何も出さない', () => {
    render(<TripModeCard />)
    expect(screen.getByText('旅行・デート中にする')).toBeTruthy()
    expect(screen.queryByText(/日目/)).toBeNull()
    expect(screen.queryByRole('button', { name: '終わる' })).toBeNull()
  })
})

describe('始める', () => {
  it('押してタグを選ぶだけ(2タップ)で始まり、そのタグが状態に残る', async () => {
    const user = userEvent.setup()
    render(<TripModeCard />)
    await user.click(button(/旅行・デート中にする/))
    // 候補はレポートの「特別な支出」と同じ 旅行・デート・出張
    await user.click(button('#出張'))

    expect(getTripMode()?.tag).toBe('出張')
    // 選んだ時点でシートは閉じる(確定ボタンを挟まない)
    expect(screen.queryByText('旅行モードを始める')).toBeNull()
  })

  it('候補に無いタグも自由に打てる', async () => {
    const user = userEvent.setup()
    render(<TripModeCard />)
    await user.click(button(/旅行・デート中にする/))
    await user.type(screen.getByLabelText('旅行モードのタグ'), '#帰省')
    await user.click(button('#帰省 で始める'))

    expect(getTripMode()?.tag).toBe('帰省')
  })

  it('レポートで特別扱いされないタグを打ったときは、その場で断る', async () => {
    const user = userEvent.setup()
    render(<TripModeCard />)
    await user.click(button(/旅行・デート中にする/))
    await user.type(screen.getByLabelText('旅行モードのタグ'), '帰省')
    expect(screen.getByText(/「特別な支出」に選ばれていません/)).toBeTruthy()
  })

  it('空のままでは始められない', async () => {
    const user = userEvent.setup()
    render(<TripModeCard />)
    await user.click(button(/旅行・デート中にする/))
    expect((button('このタグで始める') as HTMLButtonElement).disabled).toBe(true)
  })

  it('特別タグを全部外している人にも候補を出す(でないと始められない)', async () => {
    setSpecialTags([])
    const user = userEvent.setup()
    render(<TripModeCard />)
    await user.click(button(/旅行・デート中にする/))
    expect(button('#旅行')).toBeTruthy()
  })
})

describe('オンのあいだ', () => {
  it('何が付くか・何日目かを出し続け、終わる導線を必ず添える', () => {
    startTripMode('旅行')
    render(<TripModeCard />)
    expect(screen.getByText('旅行モード中')).toBeTruthy()
    expect(screen.getByText('#旅行 ・ 1日目')).toBeTruthy()
    expect(button('終わる')).toBeTruthy()
  })

  it('「終わる」で解除できる', async () => {
    startTripMode('旅行')
    const user = userEvent.setup()
    render(<TripModeCard />)
    await user.click(button('終わる'))

    expect(getTripMode()).toBeNull()
    expect(screen.getByText('旅行・デート中にする')).toBeTruthy()
  })
})

describe('解除し忘れへの備え', () => {
  it('短いあいだは何も言わない', () => {
    // Date だけを固定する。setTimeout は本物のままなので userEvent も動く
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 7, 1, 9))
    startTripMode('旅行')
    vi.setSystemTime(new Date(2026, 7, 4, 9)) // 4日目
    render(<TripModeCard />)

    expect(screen.getByText('#旅行 ・ 4日目')).toBeTruthy()
    expect(screen.queryByText(/終わっていませんか/)).toBeNull()
  })

  it('長引いたら声をかける。ただし勝手には解除しない', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 7, 1, 9))
    startTripMode('旅行')
    vi.setSystemTime(new Date(2026, 7, 12, 9)) // 12日目
    render(<TripModeCard />)

    expect(screen.getByText(/12日目です。もう終わっていませんか/)).toBeTruthy()
    // 声をかけたあとも、モードは付いたまま(切るかどうかは利用者が決める)
    expect(getTripMode()?.tag).toBe('旅行')
    expect(button('終わる')).toBeTruthy()
  })
})

// ============================================================
// 行き先の名前(2026和歌山)
//
// 見るのは2つ:
//   ・入れなければ何も変わらない(オフのときの手数が1タップも増えない)
//   ・入れたら2つのタグが付き、帯にも2つとも出る
// ============================================================

const txWithPlace = (date: string, tags: string[]) => ({
  id: `${date}-${tags.join('')}`,
  date,
  type: 'expense' as const,
  amount: 1000,
  category: null,
  memo: '',
  store: '',
  partner_amount: 0,
  created_at: `${date}T00:00:00.000Z`,
  tags,
})

describe('行き先の名前', () => {
  it('入れなければ、これまでどおり2タップで1つだけ付く', async () => {
    const user = userEvent.setup()
    render(<TripModeCard />)
    await user.click(button(/旅行・デート中にする/))
    await user.click(button('#旅行'))

    expect(getTripMode()?.tag).toBe('旅行')
    expect(getTripMode()?.place).toBeUndefined()
    expect(screen.getByText('#旅行 ・ 1日目')).toBeTruthy()
  })

  it('行き先を入れてからタグを押すと、2つとも付く', async () => {
    const user = userEvent.setup()
    render(<TripModeCard />)
    await user.click(button(/旅行・デート中にする/))
    await user.type(screen.getByLabelText('行き先の名前'), '2026和歌山')
    await user.click(button('#旅行 #2026和歌山'))

    expect(getTripMode()).toMatchObject({ tag: '旅行', place: '2026和歌山' })
    // 帯には付くタグが2つとも出る(保存される中身と画面が食い違わない)
    expect(screen.getByText('#旅行 #2026和歌山 ・ 1日目')).toBeTruthy()
    // 保存ボタンの上の説明にも同じ2つが出る(帯と説明で食い違わない)
    expect(screen.getAllByText('#旅行 #2026和歌山').length).toBeGreaterThan(0)
  })

  it('過去に使った行き先は1タップで選べる(打ち直さずに済む)', async () => {
    const user = userEvent.setup()
    render(
      <TripModeCard
        transactions={[
          txWithPlace('2025-05-01', ['旅行', '2025北海道']),
          txWithPlace('2026-08-06', ['旅行', '2026和歌山']),
        ]}
      />
    )
    await user.click(button(/旅行・デート中にする/))
    // 最近使った順に出る
    await user.click(button('#2026和歌山'))
    await user.click(button('#旅行 #2026和歌山'))

    expect(getTripMode()).toMatchObject({ tag: '旅行', place: '2026和歌山' })
  })

  it('候補が無いときは候補の欄ごと出さない', async () => {
    const user = userEvent.setup()
    render(<TripModeCard />)
    await user.click(button(/旅行・デート中にする/))
    expect(screen.queryByText(/前に使った行き先/)).toBeNull()
  })
})
