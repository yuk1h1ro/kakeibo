// 金額の目隠し (機能169) 用のアイコン。
// icons.tsx と同じ作法(線画・stroke 1.8px・currentColor・22px)で描いている。
// 別ファイルにしてあるのは、他のアイコンと用途が違い、
// この機能だけを追うときに探しやすくするため。

import type { SVGProps } from 'react'

function Base({ children, ...rest }: SVGProps<SVGSVGElement>) {
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
      {...rest}
    >
      {children}
    </svg>
  )
}

/** 目(いまは金額が見えている = 押すと隠す) */
export function IconEye(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </Base>
  )
}

/** 目に斜線(いまは金額を隠している = 押すと表示に戻す) */
export function IconEyeOff(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M10.6 6.2A8.6 8.6 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-2.7 3.5" />
      <path d="M6.4 7.6A16.6 16.6 0 0 0 2.5 12S6 18 12 18a9.4 9.4 0 0 0 3.7-.75" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="M3.5 3.5l17 17" />
    </Base>
  )
}
