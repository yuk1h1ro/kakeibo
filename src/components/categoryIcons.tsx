// カテゴリ用の線画アイコンセット(stroke 1.8px / currentColor / viewBox 24)。
// icons.tsx と同じスタイル(round linecap/linejoin)で統一し、
// 「薄いティントの丸背景 + 濃い同系色の線画」(FinTechアプリ定番)として描画する。
// ティントはライト/ダーク両テーマで成立する彩度控えめの1組を各アイコンに割り当てる
// (背景は半透明なので下地の明暗に馴染む。線色は白面・暗面の双方で約3:1以上)。

import type { ReactNode } from 'react'
import type { CategoryVisual } from '../lib/categories'

interface IconDef {
  /** ピッカーの aria-label 用の呼び名 */
  label: string
  /** 線画の色(濃い方) */
  fg: string
  /** 丸背景の色(同系色の薄いティント) */
  bg: string
  paths: ReactNode
}

const ICON_DEFS: Record<string, IconDef> = {
  rice: {
    label: 'ごはん',
    fg: '#d97706',
    bg: 'rgba(217, 119, 6, 0.14)',
    paths: (
      <>
        <path d="M4 11a8 8 0 0 0 16 0Z" />
        <path d="M7.5 11c0-2.6 2-4.7 4.5-4.7s4.5 2.1 4.5 4.7" />
        <path d="M9 21h6" />
      </>
    ),
  },
  ramen: {
    label: 'ラーメン',
    fg: '#ea580c',
    bg: 'rgba(234, 88, 12, 0.13)',
    paths: (
      <>
        <path d="M3.5 11h17a8.5 8.5 0 0 1-17 0Z" />
        <path d="m9.5 7.5 10-5.5" />
        <path d="m12 7.5 9-3.8" />
      </>
    ),
  },
  cart: {
    label: 'カート',
    fg: '#0d9488',
    bg: 'rgba(13, 148, 136, 0.14)',
    paths: (
      <>
        <circle cx="9" cy="20.5" r="1.3" />
        <circle cx="17.5" cy="20.5" r="1.3" />
        <path d="M2.5 3h2l2.3 12.1a1.8 1.8 0 0 0 1.8 1.4h8.7a1.8 1.8 0 0 0 1.7-1.4L21.5 8H5.4" />
      </>
    ),
  },
  train: {
    label: '電車',
    fg: '#2563eb',
    bg: 'rgba(37, 99, 235, 0.13)',
    paths: (
      <>
        <rect x="4" y="3" width="16" height="16" rx="2.5" />
        <path d="M4 11h16" />
        <path d="M12 3v8" />
        <path d="M8 15h.01" />
        <path d="M16 15h.01" />
        <path d="m8 19-1.5 2.5" />
        <path d="m16 19 1.5 2.5" />
      </>
    ),
  },
  gamepad: {
    label: 'ゲーム',
    fg: '#8b5cf6',
    bg: 'rgba(139, 92, 246, 0.14)',
    paths: (
      <>
        <path d="M6 11h4" />
        <path d="M8 9v4" />
        <path d="M15 12h.01" />
        <path d="M18 10h.01" />
        <path d="M17.32 5H6.68a4 4 0 0 0-3.98 3.59c-.08.68-.7 5.87-.7 7.41a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.41-1.41A2 2 0 0 1 9.83 16h4.34a2 2 0 0 1 1.42.59L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.54-.62-6.73-.7-7.41A4 4 0 0 0 17.32 5Z" />
      </>
    ),
  },
  beer: {
    label: 'ビール',
    fg: '#ca8a04',
    bg: 'rgba(202, 138, 4, 0.15)',
    paths: (
      <>
        <path d="M15 9h2.5a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H15" />
        <path d="M5 7h10v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2Z" />
        <path d="M8.5 11v6" />
        <path d="M11.5 11v6" />
        <path d="M5 7c0-1.4 1.1-2.5 2.5-2.5.9 0 1.7.5 2.1 1.2.4-.7 1.2-1.2 2.1-1.2C13.1 4.5 15 5.6 15 7" />
      </>
    ),
  },
  pill: {
    label: 'くすり',
    fg: '#e11d48',
    bg: 'rgba(225, 29, 72, 0.12)',
    paths: (
      <>
        <path d="M10.5 20.5 3.5 13.5a4.95 4.95 0 1 1 7-7l7 7a4.95 4.95 0 1 1-7 7Z" />
        <path d="m8.5 8.5 7 7" />
      </>
    ),
  },
  box: {
    label: 'はこ',
    fg: '#78716c',
    bg: 'rgba(120, 113, 108, 0.15)',
    paths: (
      <>
        <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
        <path d="m3.3 7 8.7 5 8.7-5" />
        <path d="M12 22V12" />
      </>
    ),
  },
  coffee: {
    label: 'コーヒー',
    fg: '#9a6748',
    bg: 'rgba(154, 103, 72, 0.15)',
    paths: (
      <>
        <path d="M17 9h1.5a3.5 3.5 0 1 1 0 7H17" />
        <path d="M3 9h14v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" />
        <path d="M6.5 2v3" />
        <path d="M10 2v3" />
        <path d="M13.5 2v3" />
      </>
    ),
  },
  shirt: {
    label: '衣類',
    fg: '#0284c7',
    bg: 'rgba(2, 132, 199, 0.13)',
    paths: (
      <path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23Z" />
    ),
  },
  home: {
    label: '住まい',
    fg: '#059669',
    bg: 'rgba(5, 150, 105, 0.13)',
    paths: (
      <>
        <path d="M3 10a2 2 0 0 1 .71-1.53l7-6a2 2 0 0 1 2.58 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
        <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
      </>
    ),
  },
  gift: {
    label: 'ギフト',
    fg: '#db2777',
    bg: 'rgba(219, 39, 119, 0.12)',
    paths: (
      <>
        <rect x="3" y="8" width="18" height="4" rx="1" />
        <path d="M12 8v13" />
        <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
        <path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5" />
      </>
    ),
  },
  phone: {
    label: 'スマホ',
    fg: '#0891b2',
    bg: 'rgba(8, 145, 178, 0.13)',
    paths: (
      <>
        <rect x="6.5" y="2" width="11" height="20" rx="2.5" />
        <path d="M12 18h.01" />
      </>
    ),
  },
  book: {
    label: '本',
    fg: '#6366f1',
    bg: 'rgba(99, 102, 241, 0.13)',
    paths: (
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
    ),
  },
  scissors: {
    label: '美容',
    fg: '#a855f7',
    bg: 'rgba(168, 85, 247, 0.13)',
    paths: (
      <>
        <circle cx="6" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <path d="M20 4 8.12 15.88" />
        <path d="M14.47 14.48 20 20" />
        <path d="M8.12 8.12 12 12" />
      </>
    ),
  },
  wallet: {
    label: '財布',
    fg: '#16a34a',
    bg: 'rgba(22, 163, 74, 0.14)',
    paths: (
      <>
        <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
        <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
      </>
    ),
  },
}

/** ピッカー等で使うアイコンIDの一覧(表示順) */
export const CATEGORY_ICON_IDS: string[] = [
  'rice',
  'ramen',
  'cart',
  'train',
  'gamepad',
  'beer',
  'pill',
  'coffee',
  'shirt',
  'home',
  'gift',
  'phone',
  'book',
  'scissors',
  'wallet',
  'box',
]

export function categoryIconLabel(icon: string): string {
  return (ICON_DEFS[icon] ?? ICON_DEFS.box).label
}

/** 薄いティントの丸背景 + 線画アイコン。未知のIDは box にフォールバック */
export function CategoryIcon({ icon, size = 32 }: { icon: string; size?: number }) {
  const def = ICON_DEFS[icon] ?? ICON_DEFS.box
  const inner = Math.round(size * 0.6)
  return (
    <span
      className="cat-icon"
      style={{ width: size, height: size, background: def.bg, color: def.fg }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 24 24"
        width={inner}
        height={inner}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {def.paths}
      </svg>
    </span>
  )
}

/**
 * カテゴリの見た目(resolveCategoryVisual / visualFromEmojiValue の結果)を描画する。
 * 'icon:xxx' はティント丸背景の線画、旧絵文字はニュートラルな丸背景に絵文字のまま表示
 * (後方互換。既定8カテゴリの旧絵文字は categories.ts 側でアイコンに読み替え済み)。
 */
export function CategoryVisualBadge({
  visual,
  size = 32,
}: {
  visual: CategoryVisual
  size?: number
}) {
  if (visual.kind === 'icon') {
    return <CategoryIcon icon={visual.icon} size={size} />
  }
  return (
    <span
      className="cat-icon cat-icon-emoji"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.55) }}
      aria-hidden="true"
    >
      {visual.emoji}
    </span>
  )
}
