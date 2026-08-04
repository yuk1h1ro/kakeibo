import type { SVGProps } from 'react'

// 資産タブ用の線画アイコン。icons.tsx と同じ作法(viewBox 24 / stroke 1.8 / currentColor)で
// 描いているが、他の作業とファイルがぶつからないよう別ファイルに置いている。

/** 資産タブ: 金庫(建物)のアイコン */
export function IconAssets(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={22}
      height={22}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M3 9.5 12 4l9 5.5" />
      <path d="M5 10.5v8M9.5 10.5v8M14.5 10.5v8M19 10.5v8" />
      <path d="M3 20.5h18" />
    </svg>
  )
}
