// 履歴タブで使う線画アイコン (icons.tsx と同じ作法: stroke 1.8px / currentColor)。

import type { SVGProps } from 'react'
import { IconBase } from './icons'

// 履歴は行の中に並ぶボタンなので、タブバーの 22px より一回り小さい 20px にしている。
// 呼び出し側が width/height を渡せば、そちらが勝つ(IconBase と同じ)。
function Base(props: SVGProps<SVGSVGElement>) {
  return <IconBase width={20} height={20} {...props} />
}

/** ゴミ箱(削除) */
export function IconTrash(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M4 6.5h16" />
      <path d="M9.5 6.5V4.5h5v2" />
      <path d="M6.5 6.5 7.4 20h9.2l.9-13.5" />
      <path d="M10.5 10v6M13.5 10v6" />
    </Base>
  )
}

/** 鉛筆(編集) */
export function IconEdit(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </Base>
  )
}

/** 2枚重ね(複製) */
export function IconCopy(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" />
    </Base>
  )
}

/** お店(日よけのある店先) */
export function IconStore(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M4.5 10.5V19a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-8.5" />
      <path d="M3 10.5 4.8 4.5h14.4L21 10.5a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0Z" />
      <path d="M9.5 20v-5h5v5" />
    </Base>
  )
}

/** 元に戻す矢印 */
export function IconUndo(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M4 8h9a5.5 5.5 0 0 1 0 11H7" />
      <path d="M7.5 4.5 4 8l3.5 3.5" />
    </Base>
  )
}

/** 履歴(時計に矢印) */
export function IconHistory(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M3.5 4.5V9H8" />
      <path d="M12 7.5V12l3 1.8" />
    </Base>
  )
}

/** 更新(回転矢印) */
export function IconRefresh(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M20 12a8 8 0 1 1-2.4-5.7" />
      <path d="M20 4v4.5h-4.5" />
    </Base>
  )
}
