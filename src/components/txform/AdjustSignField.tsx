/**
 * 機能012: 調整の向き。編集シートから開いたときもここで直せる。
 * 金額欄は絶対値で打たせ、向きはこの2択で選ばせる
 * (符号を数字に打たせると、マイナスの打ち間違いが残高に直結する)。
 */
export default function AdjustSignField({ sign, onChange }: { sign: 1 | -1; onChange: (sign: 1 | -1) => void }) {
  return (
    <div className="field">
      <span>どちらに直しますか</span>
      {/* 残高の向きを決める2択。すぐ上の種類チップ(settle-mode)と同じ見た目・
          同じ 16px にそろえる — 押し間違いがそのまま残高の符号になる操作なので、
          他のチップより小さくしない */}
      <div className="settle-modes" role="group" aria-label="調整の向き">
        <button
          type="button"
          className={`settle-mode${sign === 1 ? ' selected' : ''}`}
          aria-pressed={sign === 1}
          onClick={() => onChange(1)}
        >
          残高を増やす
        </button>
        <button
          type="button"
          className={`settle-mode${sign === -1 ? ' selected' : ''}`}
          aria-pressed={sign === -1}
          onClick={() => onChange(-1)}
        >
          残高を減らす
        </button>
      </div>
    </div>
  )
}
