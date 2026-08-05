// ============================================================
// CSV 書き出し (機能198) の画面。
//
// 目的はバックアップ。Supabase の無料プランには自動バックアップが無いので、
// 「消えたら戻せない」を利用者の手元で埋めるための導線。
// 設定シートから開く(毎日触るものではないため、タブには置かない)。
//
// ここは「期間を選んで、押したら保存する」だけ。CSV の中身の組み立ては
// lib/csvExport.ts、保存の方法の選択は lib/csvFile.ts が持つ(どちらもテスト済み)。
// ============================================================

import { useMemo, useState } from 'react'
import useBodyScrollLock from '../hooks/useBodyScrollLock'
import { categoryLabel } from '../lib/categories'
import {
  csvFileName,
  describeRange,
  exportMonths,
  exportYears,
  filterByRange,
  isSameRange,
  transactionsCsv,
  type ExportRange,
} from '../lib/csvExport'
import { saveCsv, type SaveOutcome } from '../lib/csvFile'
import { todayISO } from '../lib/format'
import type { Transaction } from '../lib/types'
// 設定シートから開くので実際は読み込み済みだが、この画面だけを単体で描いたときにも
// 崩れないよう、自分の見た目は自分で持ってくる
import '../settings.css'

interface Props {
  transactions: readonly Transaction[]
  onClose: () => void
}

/** 保存できたあとに出す言葉。何が起きたのかを言い切る(「たぶん保存されました」を避ける) */
function outcomeMessage(outcome: SaveOutcome, fileName: string): string {
  switch (outcome.kind) {
    case 'downloaded':
      return `${fileName} を保存しました(「ファイル」アプリのダウンロードに入っています)`
    case 'shared':
      return `${fileName} を共有しました`
    case 'cancelled':
      return '保存をやめました'
    case 'opened':
      return '新しいタブに表示しました。全部を選んでコピーし、テキストとして保存してください'
    case 'failed':
      return `保存できませんでした: ${outcome.message}`
  }
}

export default function CsvExportSheet({ transactions, onClose }: Props) {
  useBodyScrollLock()
  const today = todayISO()
  const [range, setRange] = useState<ExportRange>({ kind: 'all' })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  const dates = useMemo(() => transactions.map((t) => t.date), [transactions])
  const years = useMemo(() => exportYears(dates, today), [dates, today])
  const months = useMemo(() => exportMonths(dates), [dates])
  const target = useMemo(() => filterByRange(transactions, range), [transactions, range])

  const fileName = csvFileName(range, today)
  const selectedMonth = range.kind === 'month' ? range.value : ''

  const run = () => {
    setBusy(true)
    setMessage(null)
    setFailed(false)
    // 中身の組み立てはここで初めて行う(件数が多いと重いので、押されるまで作らない)。
    // 金額の目隠し (機能169) はここに効かない — バックアップを伏字にしても意味が無いため
    const text = transactionsCsv(target, categoryLabel)
    void saveCsv(text, fileName)
      .then((outcome) => {
        setMessage(outcomeMessage(outcome, fileName))
        setFailed(outcome.kind === 'failed')
      })
      .finally(() => setBusy(false))
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>CSV で書き出す</h2>
          <button className="btn-ghost" onClick={onClose}>
            閉じる
          </button>
        </div>

        <p className="muted">
          記録をこの端末に書き出して控えを取ります。Supabase
          には自動バックアップがないので、月に一度など、ときどき全期間で取っておくと安心です。
        </p>

        <div className="settings-section">
          <h3>期間</h3>
          <div className="csv-range">
            <button
              type="button"
              className={`date-chip ${range.kind === 'all' ? 'selected' : ''}`}
              aria-pressed={range.kind === 'all'}
              onClick={() => setRange({ kind: 'all' })}
            >
              全期間
            </button>
            {years.map((y) => {
              const r: ExportRange = { kind: 'year', value: y }
              const selected = isSameRange(range, r)
              return (
                <button
                  key={y}
                  type="button"
                  className={`date-chip ${selected ? 'selected' : ''}`}
                  aria-pressed={selected}
                  onClick={() => setRange(r)}
                >
                  {describeRange(r)}
                </button>
              )
            })}
          </div>

          {/* 月は数が多いのでチップにせず選択欄にする。
              記録のある月だけを新しい順に並べる(空の月を選ばせても仕方がない) */}
          {months.length > 0 && (
            <label className="csv-month">
              <span className="muted">月を選ぶ</span>
              <select
                className="csv-month-select"
                value={selectedMonth}
                onChange={(e) => {
                  const v = e.target.value
                  if (v) setRange({ kind: 'month', value: v })
                }}
              >
                <option value="">(選んでいません)</option>
                {months.map((m) => (
                  <option key={m} value={m}>
                    {describeRange({ kind: 'month', value: m })}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="settings-section">
          <h3>書き出す内容</h3>
          <p className="muted">
            {describeRange(range)}の記録 <strong>{target.length}件</strong>
            <br />
            ファイル名: <code className="settings-url">{fileName}</code>
          </p>
          <button
            type="button"
            className="btn-primary csv-run"
            disabled={busy || target.length === 0}
            onClick={run}
          >
            {busy ? '書き出しています…' : 'CSV を書き出す'}
          </button>
          {/* 0件のときに空のファイルを作らせない。押しても得るものが無く、
              「書き出せた」という記憶だけが残るほうが危ない */}
          {target.length === 0 && (
            <p className="muted">この期間には記録がありません。ほかの期間を選んでください</p>
          )}
          {message && <p className={failed ? 'error-text' : 'muted'}>{message}</p>}
        </div>

        <div className="settings-section">
          <h3>書き出したファイルについて</h3>
          <p className="muted">
            Excel や Google スプレッドシートでそのまま開けます(文字化けしないよう BOM 付きの
            UTF-8 で書き出します)。金額は記号や桁区切りを付けない数値なので、そのまま計算できます。
          </p>
          <p className="muted">
            <strong>画面の金額を伏字にしていても、書き出す中身は伏せません。</strong>
            控えとしての意味が無くなるためです。中身が見られて困る場所には置かないでください。
          </p>
          <p className="muted">
            このファイルからアプリに戻す機能はありません。書き戻すときは、内容を見ながら
            手で入力し直すことになります。
          </p>
        </div>
      </div>
    </div>
  )
}
