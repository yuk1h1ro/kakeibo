import { useMemo, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  assetCategoryEmoji,
  assetCategoryLabel,
  useAssetsStore,
  type AssetDef,
  type AssetKind,
} from '../lib/assets'
import {
  assetRows,
  monthlyNetWorthSeries,
  netWorthChange,
  type AssetRow,
} from '../lib/netWorth'
import { formatDate, todayISO, yen } from '../lib/format'
import NetWorthChart from './NetWorthChart'
import BalanceEntrySheet from './BalanceEntrySheet'
import AssetEditSheet from './AssetEditSheet'
import '../assets.css'

/** 円をマイナスも含めて表示する(yen は符号を扱わないため、ここで前置きする) */
function signed(value: number): string {
  return value < 0 ? `-${yen(Math.abs(value))}` : yen(value)
}

/** 増減の表示。0 は「増減なし」として符号を付けない */
function delta(value: number): string {
  if (value === 0) return '±0'
  return value > 0 ? `+${yen(value)}` : `-${yen(Math.abs(value))}`
}

/** 増減の色。資産は増えたら緑、負債は減ったら緑(意味が逆になる) */
function deltaTone(kind: AssetKind, value: number): string {
  if (value === 0) return ''
  const good = kind === 'liability' ? value < 0 : value > 0
  return good ? 'positive' : 'negative'
}

/**
 * 資産・純資産の記録 (機能101)。
 *
 * 家計簿の支出とは別のテーブル(assets / asset_balances)だけを読み書きするので、
 * このタブで何をしても履歴・レポート・彼女タブの数字は変わらない。
 */
export default function AssetsTab({ supabase }: { supabase: SupabaseClient }) {
  const { assets, balances } = useAssetsStore()
  const today = todayISO()

  const [entryOpen, setEntryOpen] = useState(false)
  // editing: undefined = シートを閉じている / null = 新規追加 / AssetDef = 編集
  const [editing, setEditing] = useState<AssetDef | null | undefined>(undefined)

  const rows = useMemo(() => assetRows(assets, balances, today), [assets, balances, today])
  const change = useMemo(() => netWorthChange(assets, balances, today), [assets, balances, today])
  const series = useMemo(
    () => monthlyNetWorthSeries(assets, balances, today),
    [assets, balances, today]
  )

  const assetItems = rows.filter((r) => r.asset.kind === 'asset')
  const liabilityItems = rows.filter((r) => r.asset.kind === 'liability')
  const { current } = change

  // 月1回程度の記録を想定しているので、35日以上あいたときだけそっと促す。
  // (毎日入力させる作りにはしない)
  const staleDays = change.daysSinceLastRecord
  const isStale = staleDays !== null && staleDays >= 35

  return (
    <>
      <div className="card hero-card">
        <div className="label">純資産(資産 − 負債)</div>
        <div className={`hero-value nw-hero ${current.netWorth < 0 ? 'negative' : ''}`}>
          {signed(current.netWorth)}
        </div>
        {change.delta !== null && change.previous ? (
          <p className="muted nw-delta">
            前回({formatDate(change.previous.asOf)})から{' '}
            <span
              className={change.delta > 0 ? 'positive' : change.delta < 0 ? 'negative' : ''}
            >
              {delta(change.delta)}
            </span>
          </p>
        ) : (
          <p className="muted nw-delta">
            {change.lastRecordedOn
              ? '2回目を記録すると増減が出ます'
              : 'まだ残高の記録がありません'}
          </p>
        )}
        <div className="nw-breakdown">
          <span>
            資産 <strong>{yen(current.totalAssets)}</strong>
          </span>
          <span>
            負債 <strong>{yen(current.totalLiabilities)}</strong>
          </span>
        </div>
      </div>

      {series.length > 0 && (
        <div className="card">
          <h2>純資産の推移(月末時点)</h2>
          <NetWorthChart data={series} />
          <p className="asset-note">
            記録が無い月は、直前に記録した残高をそのまま持ち越して表示しています。
          </p>
        </div>
      )}

      <div className="card">
        <h2>残高の記録</h2>
        <p className="muted nw-last-record">
          {change.lastRecordedOn
            ? `最後の記録: ${formatDate(change.lastRecordedOn)}(${staleDays === 0 ? '今日' : `${staleDays}日前`})`
            : 'まだ一度も記録していません'}
        </p>
        {isStale && (
          <p className="nw-stale">前回の記録から{staleDays}日たちました。そろそろ更新しませんか?</p>
        )}
        <button
          className="btn-primary"
          disabled={rows.length === 0}
          onClick={() => setEntryOpen(true)}
        >
          残高をまとめて記録する
        </button>
        <p className="asset-note">
          自動連携はしていません。月に1回くらい、手で残高を書き写す使い方を想定しています。
        </p>
      </div>

      <div className="card">
        <h2>資産</h2>
        {assetItems.length === 0 ? (
          <p className="muted">まだ登録がありません(銀行口座・証券口座・現金など)</p>
        ) : (
          <ul className="asset-list">
            {assetItems.map((r) => (
              <AssetListRow key={r.asset.id} row={r} onEdit={() => setEditing(r.asset)} />
            ))}
          </ul>
        )}

        <h2 className="asset-section-heading">負債</h2>
        {liabilityItems.length === 0 ? (
          <p className="muted">まだ登録がありません(カードの残債・奨学金など)</p>
        ) : (
          <ul className="asset-list">
            {liabilityItems.map((r) => (
              <AssetListRow key={r.asset.id} row={r} onEdit={() => setEditing(r.asset)} />
            ))}
          </ul>
        )}

        <button className="btn-ghost asset-add-btn" onClick={() => setEditing(null)}>
          ＋ 資産・負債を追加
        </button>
      </div>

      {entryOpen && (
        <BalanceEntrySheet
          supabase={supabase}
          rows={rows}
          onClose={() => setEntryOpen(false)}
          onSaved={() => setEntryOpen(false)}
        />
      )}
      {editing !== undefined && (
        <AssetEditSheet
          supabase={supabase}
          editing={editing}
          onClose={() => setEditing(undefined)}
          onSaved={() => setEditing(undefined)}
        />
      )}
    </>
  )
}

function AssetListRow({ row, onEdit }: { row: AssetRow; onEdit: () => void }) {
  const { asset, balance } = row
  return (
    <li>
      <button className="asset-row" onClick={onEdit}>
        <span className="asset-emoji" aria-hidden="true">
          {assetCategoryEmoji(asset.kind, asset.category)}
        </span>
        <span className="asset-row-text">
          <span className="asset-name">{asset.name}</span>
          <span className="asset-sub">
            {assetCategoryLabel(asset.kind, asset.category)}
            {row.recordedOn ? ` ・ ${formatDate(row.recordedOn)}時点` : ' ・ 未記録'}
          </span>
        </span>
        <span className="asset-amounts">
          <span className="asset-balance">{balance === null ? '—' : signed(balance)}</span>
          {row.delta !== null && (
            // 負債は「増えた」ほうが悪いので、色の意味を資産と逆にする
            <span className={`asset-delta ${deltaTone(asset.kind, row.delta)}`}>
              {delta(row.delta)}
            </span>
          )}
        </span>
      </button>
    </li>
  )
}
