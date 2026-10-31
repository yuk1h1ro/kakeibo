// ============================================================
// 履歴タブの見え方「一覧｜カレンダー」(端末ごとの設定)
//
// 既定は **一覧**。カレンダーだけだった頃は、開いた瞬間に明細が1行も
// 画面に入らず(390x844 で最初の行が y=816、タブバーの裏)、
// 「最近なにを入れたか」を見るだけで毎回スクロールが要った。
// 一覧ならその月の記録が開いた時点で並ぶ。カレンダーで眺めたい人は
// 切り替えれば、その選択はこの端末に残る(次に開いてもカレンダーのまま)。
//
// サーバーには置かない。スマホでは一覧、PC ではカレンダー、のように
// 端末ごとに見たいものが違ってよい設定なので(keypadSettings.ts などと同じ置き場)。
// ============================================================

import { useSyncExternalStore } from 'react'
import { createLocalSetting } from './localSetting'

export type HistoryView = 'list' | 'calendar'

/** localStorage のキー。**既存端末の選択を読めなくするので変えないこと** */
export const HISTORY_VIEW_KEY = 'kakeibo.historyView'

/** 保存値を読む。知らない値・未保存は null(= 既定の一覧)。(純粋関数) */
export function parseHistoryView(raw: string | null): HistoryView | null {
  return raw === 'list' || raw === 'calendar' ? raw : null
}

const setting = createLocalSetting<HistoryView>({
  key: HISTORY_VIEW_KEY,
  fallback: 'list',
  parse: parseHistoryView,
  serialize: (value) => value,
})

export function getHistoryView(): HistoryView {
  return setting.get()
}

export function setHistoryView(next: HistoryView): void {
  if (setting.get() === next) return
  setting.set(next)
}

/** 既定(一覧)に戻し、保存値も消す。テストで端末の状態を初期化するときに使う */
export function clearHistoryView(): void {
  setting.clear()
}

export function useHistoryView(): HistoryView {
  return useSyncExternalStore(setting.subscribe, setting.get, setting.get)
}
