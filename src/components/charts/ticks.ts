// 目盛りの計算。縦棒グラフ(VerticalBars)と累積の折れ線(CumulativeLine)で
// 目盛りの刻み方が違うと、同じ画面の中で数字の読み方が変わってしまうので共有する。

/** きりのいい目盛り(2〜4本)を計算する。(純粋関数) */
export function computeTicks(maxValue: number): { top: number; ticks: number[] } {
  const max = Math.max(maxValue, 1000)
  const pow = Math.pow(10, Math.floor(Math.log10(max)))
  for (const m of [0.25, 0.5, 1, 2, 2.5, 5]) {
    const step = m * pow
    const count = Math.ceil(max / step)
    if (count >= 2 && count <= 4) {
      const ticks: number[] = []
      for (let i = 1; i <= count; i++) ticks.push(step * i)
      return { top: step * count, ticks }
    }
  }
  return { top: max, ticks: [max / 2, max] }
}
