import VerticalBars from './VerticalBars'

interface Datum {
  label: string
  value: number
  isCurrent: boolean
}

// 縦棒の描画は VerticalBars と共通(曜日別・時間帯別と見た目を揃えるため)。
// ここは「選択中の月を強調する」という月次推移固有の意味づけだけを持つ。
export default function MonthlyTrend({ data }: { data: Datum[] }) {
  return (
    <VerticalBars
      ariaLabel="月次支出の推移"
      data={data.map((d) => ({ label: d.label, value: d.value, emphasis: d.isCurrent }))}
    />
  )
}
