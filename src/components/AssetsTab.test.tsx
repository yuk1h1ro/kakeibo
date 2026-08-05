import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AssetDef, AssetsSnapshot, BalanceSnapshot } from '../lib/assets'

// ============================================================
// 資産タブ (機能101)。
//
// この画面だけが「符号の意味」を2つ扱っている:
//   1. 純資産はマイナスになりうる。金額に符号を前置きする唯一の画面
//   2. **負債は増減の良し悪しが資産と逆**。資産が増えたら緑、
//      負債は減ったら緑。ここを揃えてしまうと、借金が増えた月に
//      緑が出て「順調です」と読めてしまう
//
// どちらも lib(netWorth.ts)ではなくこの画面にしか無い判断なので、
// 純関数のテストは1件も落ちない。描いた文字列と class から確かめる。
// ============================================================

// ストアは Supabase とキャッシュを抱えていて外から差し替えられないので、
// 「今この瞬間のスナップショット」だけを差し替えて何通りも描く
const store = vi.hoisted(() => ({
  snapshot: { assets: [], balances: [], status: 'ready' } as AssetsSnapshot,
}))

vi.mock('../lib/assets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/assets')>()),
  useAssetsStore: () => store.snapshot,
}))

const { default: AssetsTab } = await import('./AssetsTab')

function asset(over: Partial<AssetDef> & Pick<AssetDef, 'id' | 'name'>): AssetDef {
  return {
    kind: 'asset',
    category: 'bank',
    sortOrder: 0,
    archived: false,
    ...over,
  }
}

function bal(assetId: string, asOf: string, balance: number): BalanceSnapshot {
  return { id: `${assetId}-${asOf}`, assetId, asOf, balance, createdAt: `${asOf}T00:00:00.000Z` }
}

function render(assets: AssetDef[], balances: BalanceSnapshot[]): string {
  store.snapshot = { assets, balances, status: 'ready' }
  return renderToStaticMarkup(<AssetsTab supabase={{} as SupabaseClient} />)
}

/** その資産の行だけを切り出す(他の行の金額と混ざらないように) */
function rowOf(html: string, name: string): string {
  const start = html.indexOf(name)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = html.indexOf('</li>', start)
  return html.slice(start, end === -1 ? undefined : end)
}

describe('純資産の符号', () => {
  it('負債が資産を上回ると、純資産にマイナスを付けて出す', () => {
    // 「−」を落とすと、借金超過の月が黒字に見える
    const html = render(
      [
        asset({ id: 'a1', name: '銀行' }),
        asset({ id: 'l1', name: 'カード', kind: 'liability', category: 'credit_card' }),
      ],
      [bal('a1', '2026-07-01', 300000), bal('l1', '2026-07-01', 800000)]
    )
    expect(html).toContain('-¥500,000')
    expect(html).toContain('nw-hero negative')
    // 内訳のほうは「資産」「負債」と言葉で分かれているので、符号は付けない
    expect(html).toContain('資産 <strong>¥300,000</strong>')
    expect(html).toContain('負債 <strong>¥800,000</strong>')
  })

  it('資産が上回っているときはマイナスを付けない', () => {
    const html = render(
      [
        asset({ id: 'a1', name: '銀行' }),
        asset({ id: 'l1', name: 'カード', kind: 'liability', category: 'credit_card' }),
      ],
      [bal('a1', '2026-07-01', 800000), bal('l1', '2026-07-01', 300000)]
    )
    expect(html).toContain('>¥500,000<')
    expect(html).not.toContain('-¥500,000')
    expect(html).not.toContain('nw-hero negative')
  })
})

describe('増減の良し悪しは、資産と負債で逆になる', () => {
  it('資産が増えたら良い(positive)', () => {
    const html = render(
      [asset({ id: 'a1', name: '銀行' })],
      [bal('a1', '2026-06-01', 1000000), bal('a1', '2026-07-01', 1200000)]
    )
    const row = rowOf(html, '銀行')
    expect(row).toContain('+¥200,000')
    expect(row).toContain('asset-delta positive')
  })

  it('資産が減ったら悪い(negative)', () => {
    const html = render(
      [asset({ id: 'a1', name: '銀行' })],
      [bal('a1', '2026-06-01', 1200000), bal('a1', '2026-07-01', 1000000)]
    )
    const row = rowOf(html, '銀行')
    expect(row).toContain('-¥200,000')
    expect(row).toContain('asset-delta negative')
  })

  it('負債が減ったら良い(positive)—— 資産と同じ色にすると意味が逆になる', () => {
    const html = render(
      [asset({ id: 'l1', name: 'カード', kind: 'liability', category: 'credit_card' })],
      [bal('l1', '2026-06-01', 500000), bal('l1', '2026-07-01', 300000)]
    )
    const row = rowOf(html, 'カード')
    expect(row).toContain('-¥200,000')
    expect(row).toContain('asset-delta positive')
  })

  it('負債が増えたら悪い(negative)', () => {
    const html = render(
      [asset({ id: 'l1', name: 'カード', kind: 'liability', category: 'credit_card' })],
      [bal('l1', '2026-06-01', 300000), bal('l1', '2026-07-01', 500000)]
    )
    const row = rowOf(html, 'カード')
    expect(row).toContain('+¥200,000')
    expect(row).toContain('asset-delta negative')
  })

  it('変わらなかったときは ±0 と書き、色を付けない', () => {
    const html = render(
      [asset({ id: 'a1', name: '銀行' })],
      [bal('a1', '2026-06-01', 1000000), bal('a1', '2026-07-01', 1000000)]
    )
    const row = rowOf(html, '銀行')
    expect(row).toContain('±0')
    expect(row).not.toContain('positive')
    expect(row).not.toContain('negative')
  })
})

describe('まだ記録していない資産', () => {
  it('残高は ¥0 ではなく「—」と出す(0円と未記録は違う)', () => {
    // ¥0 と書くと「使い切った口座」に見え、純資産に入っていないことが読めない
    const html = render([asset({ id: 'a1', name: '証券', category: 'securities' })], [])
    const row = rowOf(html, '証券')
    expect(row).toContain('—')
    expect(row).not.toContain('¥0')
    expect(row).toContain('未記録')
  })

  it('比較できる記録が1件しか無いときは、増減を出さない(嘘の増減を作らない)', () => {
    const html = render([asset({ id: 'a1', name: '銀行' })], [bal('a1', '2026-07-01', 1000000)])
    expect(rowOf(html, '銀行')).not.toContain('asset-delta')
    expect(html).toContain('2回目を記録すると増減が出ます')
  })
})

describe('資産と負債は節を分けて出す', () => {
  it('資産の節に負債が混ざらない', () => {
    const html = render(
      [
        asset({ id: 'a1', name: '銀行' }),
        asset({ id: 'l1', name: '奨学金', kind: 'liability', category: 'scholarship' }),
      ],
      [bal('a1', '2026-07-01', 1000000), bal('l1', '2026-07-01', 400000)]
    )
    const assetsSection = html.slice(html.indexOf('<h2>資産</h2>'), html.indexOf('負債</h2>'))
    expect(assetsSection).toContain('銀行')
    expect(assetsSection).not.toContain('奨学金')
  })

  it('どちらも空のときは、節ごとに何を入れるものかを書く', () => {
    const html = render([], [])
    expect(html).toContain('銀行口座・証券口座・現金など')
    expect(html).toContain('カードの残債・奨学金など')
    expect(html).toContain('まだ残高の記録がありません')
  })
})
