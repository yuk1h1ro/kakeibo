import { useEffect, useRef, useState } from 'react'
import { useKeypadEnabled } from '../../lib/keypadSettings'
import { revealAboveKeypad } from '../../lib/keypadReveal'
import type { AmountTarget } from './amountTarget'

/**
 * 画面の下に1枚だけ出す自前テンキー(機能052)の開け閉めと、
 * それに付いて回る画面の調整。
 *
 * タッチ端末では既定で有効、PC では OS のキーボードのまま(enabled = false)。
 * どの欄に打ち込むか(target)は、開くたびにタップされた欄へ向け直す。
 * 打ち込む中身(電卓の状態)はフォームが持ち、ここは関知しない。
 */
export function useKeypadDock() {
  const enabled = useKeypadEnabled()
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<AmountTarget>('amount')
  const amountRef = useRef<HTMLInputElement | null>(null)
  const partnerRef = useRef<HTMLInputElement | null>(null)
  // 支払い金額のすぐ下の「この記録は 昨日 で保存されます」
  const dateLeadRef = useRef<HTMLParagraphElement | null>(null)

  // テンキーの高さぶんの余白を本文に持たせる(保存ボタンがパッドの下に隠れないように)
  useEffect(() => {
    if (!open) return
    document.body.classList.add('keypad-open')
    return () => document.body.classList.remove('keypad-open')
  }, [open])

  // タップが **どこで始まったか**。
  // 画面の下半分にある金額欄をタップすると、指を置いた瞬間にテンキーが開いて
  // 欄を覆い、指を離す位置がテンキーのキーになる。ブラウザはこの click を
  // 「押した所と離した所の共通の祖先」に届けるので、下の「外側を押したら
  // 閉じる」に引っかかり、テンキーが一瞬開いてすぐ閉じていた。
  // 始まりが金額欄なら、それは外側のタップではない。
  // テンキーが開く前の押し下げも拾う必要があるので、こちらは常に聞いておく
  const pointerOriginRef = useRef<EventTarget | null>(null)
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      pointerOriginRef.current = e.target
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [])

  // 金額欄・テンキー以外を触ったら閉じる。
  // blur ではなく click で閉じるのは、押した相手の onClick が先に走るようにするため
  // (先に閉じると余白が消えてボタンが指の下からずれることがある)
  useEffect(() => {
    if (!open) return
    // 「保存して続ける」は次の1件をそのまま打つためのボタンなので、閉じない。
    // お店のチップも同じ — 押すとその場で金額へ進む(=パッドを開く)ので、
    // 開けたのと同じタップで閉じてしまわないように除外する。
    // ％・税込のボタンは金額欄そのものへの操作なので、押しても閉じない
    // (閉じると押した直後に画面が跳ねて、出したばかりの結果が読めない)
    // SVG のアイコン(カテゴリの絵など)も外側として数えるので、HTMLElement ではなく Element で見る
    const keepsOpen = (el: EventTarget | null): boolean =>
      el instanceof Element &&
      (el === amountRef.current ||
        el === partnerRef.current ||
        el.closest('.keypad-field') !== null ||
        el.closest('.keypad-dock') !== null ||
        el.closest('.save-continue') !== null ||
        el.closest('.store-chip') !== null ||
        el.closest('.percent-block') !== null)
    const onDocumentClick = (e: MouseEvent) => {
      if (keepsOpen(e.target) || keepsOpen(pointerOriginRef.current)) return
      setOpen(false)
    }
    // 聞き始めるのは、テンキーを開いたタップが終わってから。
    // React はタップで起きた変更をそのタップの最中に反映するので、ここで
    // すぐ聞き始めると、**開いたタップそのもの** が document まで上ってきて
    // 「外側を押した」と数えられ、開いた瞬間に閉じる(カテゴリの文字の
    // 部分を押したときがそうだった。絵の部分は SVG なので、たまたま
    // 見逃されていただけ)
    const timer = window.setTimeout(() => document.addEventListener('click', onDocumentClick), 0)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('click', onDocumentClick)
    }
  }, [open])

  // テンキーを開いた・別の欄へ向け直したら、その欄をテンキーより上に見せる
  // (keypadReveal.ts)。支払い金額のときは、すぐ下の「この記録は 昨日 で
  // 保存されます」まで見せる — 日付の取り違えに気付ける最後の場所なので
  useEffect(() => {
    if (!open) return
    const active = document.activeElement
    const field = active instanceof HTMLInputElement ? active : amountRef.current
    if (!field) return
    const frame = requestAnimationFrame(() =>
      revealAboveKeypad(field, target === 'amount' ? dateLeadRef.current : null)
    )
    return () => cancelAnimationFrame(frame)
  }, [open, target])

  return {
    enabled,
    open,
    setOpen,
    target,
    setTarget,
    amountRef,
    partnerRef,
    dateLeadRef,
    /** タップされた金額欄に向けて開く。無効な端末では何もしない */
    openFor(next: AmountTarget) {
      if (!enabled) return
      setTarget(next)
      setOpen(true)
    },
    /** 向いている欄が画面から消えるとき。閉じて、行き先を支払い金額へ戻す */
    release() {
      setOpen(false)
      setTarget('amount')
    },
  }
}
