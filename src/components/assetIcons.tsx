import type { SVGProps } from 'react'
import { IconBase } from './icons'

// 資産タブ用の線画アイコン。作法(viewBox 24 / stroke 1.8 / currentColor)は IconBase に従う。

/** 資産タブ: 金庫(建物)のアイコン */
export function IconAssets(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M3 9.5 12 4l9 5.5" />
      <path d="M5 10.5v8M9.5 10.5v8M14.5 10.5v8M19 10.5v8" />
      <path d="M3 20.5h18" />
    </IconBase>
  )
}
