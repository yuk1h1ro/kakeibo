import { useState } from 'react'
import useBodyScrollLock from '../hooks/useBodyScrollLock'
import { todayISO } from '../lib/format'
import { useSpecialTags } from '../lib/reportTagSettings'
import { normalizeTag } from '../lib/tags'
import type { Transaction } from '../lib/types'
import {
  endTripMode,
  placeTagOptions,
  startTripMode,
  tripBadgeText,
  tripReminderText,
  tripTagOptions,
  tripTagsText,
  useTripMode,
} from '../lib/tripMode'
import { useTxFeature } from '../lib/txExtensions'
import '../styles.css'

// ============================================================
// 旅行モードの入り口と、オンの間の表示。
//
// ---- なぜ入力タブの最上段なのか ----
// このモードの最大の失敗は **解除し忘れ** で、そうなると普段の支出が
// 旅行として残り続ける。気づく機会は多いほどよいので、アプリを開いて
// 最初に見る場所(入力タブの一番上)に置いた。オンの間はここが色付きの
// 帯になり、何日目かも常に出る。
//
// ---- オフのときに入力の手数を増やさないこと ----
// オフのときの見た目は、主線(カテゴリ → お店 → 金額 → …)の **外側** に
// ある1行のボタンだけ。押さなければ入力の操作は1タップも変わらない。
// 開始も「押す → タグを選ぶ」の2タップで終わる。
//
// ---- 行き先の名前(2026和歌山)---- ★
// 開始のシートに「行き先」の欄を足したが、**任意** で、空のままなら
// これまでとまったく同じ1タグだけが付く。ここに1度打つだけで、以降の記録には
// 「旅行」と「2026和歌山」の**2つが自動で付く**(入力のたびに選ばせない)。
// 階層タグにしなかった理由は reportTags.ts の共起タグの節を参照。
// ============================================================

/** 開始時にタグを選ぶシート。チップを押した時点で始まる(確定ボタンを挟まない) */
function TripStartSheet({
  transactions,
  onClose,
}: {
  transactions: readonly Transaction[]
  onClose: () => void
}) {
  const specialTags = useSpecialTags()
  const options = tripTagOptions(specialTags)
  const [draft, setDraft] = useState('')
  // 行き先(任意)。ここに入れた分だけタグが1つ増える
  const [place, setPlace] = useState('')

  useBodyScrollLock()

  const start = (tag: string) => {
    // 空になる文字列では始まらない(startTripMode が false を返す)。
    // その場合はシートを開いたままにして、打ち直せるようにする
    if (startTripMode(tag, place)) onClose()
  }

  const drafted = normalizeTag(draft)
  // 選んだタグがレポートの「特別な支出」に入っていないと、せっかく付けても
  // 普段の支出と一緒に数えられてしまう。始める前に一言だけ断っておく
  const draftIsSpecial = drafted !== null && specialTags.includes(drafted)
  const placeTag = normalizeTag(place)

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>旅行モードを始める</h2>
          <button type="button" className="btn-ghost" onClick={onClose}>
            閉じる
          </button>
        </div>

        <p className="muted">
          始めてから終わるまで、記録した支出に自動でこのタグが付きます。
          <strong>自動では終わりません</strong> — 帰ったら「終わる」を押してください
        </p>

        {/* 行き先はタグの選択より先に置く。あとに置くと、チップを押した時点で
            始まってしまい「行き先を入れる場所があった」ことに気づけない。
            空のままチップを押せば、これまでどおり2タップで始まる */}
        <label className="field">
          <span>行き先の名前(任意)</span>
          <input
            type="text"
            aria-label="行き先の名前"
            placeholder="例: 2026和歌山"
            value={place}
            autoComplete="off"
            onChange={(e) => setPlace(e.target.value)}
          />
        </label>
        <p className="muted trip-place-note">
          入れると、記録に <strong>#{options[0] ?? '旅行'}</strong> と一緒に
          <strong>#{placeTag ?? '2026和歌山'}</strong>{' '}
          も自動で付きます。レポートで旅行を選ぶと、この行き先ごとに分けて見られます
          (空のままなら、これまでどおり1つだけ付きます)
        </p>

        {/* 過去に使った行き先を1タップで。打ち直さずに済むほうが、
            同じ旅行に別々の綴りのタグが付く事故を防げる */}
        {options.map((tag) => {
          const past = placeTagOptions(transactions, tag)
          if (past.length === 0) return null
          return (
            <div className="field" key={`past-${tag}`}>
              <span>前に使った行き先(#{tag})</span>
              <div className="trip-tag-options" role="group" aria-label={`${tag}の行き先の候補`}>
                {past.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`trip-tag-option${placeTag === p ? ' is-on' : ''}`}
                    aria-pressed={placeTag === p}
                    onClick={() => setPlace(p)}
                  >
                    #{p}
                  </button>
                ))}
              </div>
            </div>
          )
        })}

        <div className="field">
          <span>どのタグを付けますか</span>
          <div className="trip-tag-options" role="group" aria-label="旅行モードのタグの候補">
            {options.map((tag) => (
              <button
                key={tag}
                type="button"
                className="trip-tag-option"
                onClick={() => start(tag)}
              >
                #{tag}
                {placeTag !== null && <span className="trip-tag-option-place"> #{placeTag}</span>}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span>ほかのタグにする</span>
          <input
            type="text"
            aria-label="旅行モードのタグ"
            placeholder="例: 帰省"
            value={draft}
            autoComplete="off"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                start(draft)
              }
            }}
          />
        </label>

        {drafted !== null && !draftIsSpecial && (
          <p className="muted">
            「{drafted}」はレポートの「特別な支出」に選ばれていません。普段の支出と分けて
            見たいときは、レポートの設定でこのタグも選んでください
          </p>
        )}

        <button
          type="button"
          className="btn-primary"
          disabled={drafted === null}
          onClick={() => start(draft)}
        >
          {drafted === null
            ? 'このタグで始める'
            : `#${drafted}${placeTag !== null ? ` #${placeTag}` : ''} で始める`}
        </button>
      </div>
    </div>
  )
}

export default function TripModeCard({
  transactions = [],
}: {
  /** 行き先の候補を出すための全記録。渡さなくても動く(候補が出ないだけ) */
  transactions?: readonly Transaction[]
}) {
  const mode = useTripMode()
  const [picking, setPicking] = useState(false)
  // tags 列が無い環境ではタグ自体が保存されないので、導線ごと出さない
  const taggingAvailable = useTxFeature('tagging')

  if (!taggingAvailable) return null

  const today = todayISO()
  const reminder = mode ? tripReminderText(mode, today) : null

  return (
    <>
      {mode === null ? (
        // オフのときは1行のボタンだけ。押さなければ入力の操作は何も変わらない
        <button type="button" className="trip-start" onClick={() => setPicking(true)}>
          <span className="trip-emoji" aria-hidden="true">
            🧳
          </span>
          <span className="trip-start-text">
            <span className="trip-start-title">旅行・デート中にする</span>
            <span className="trip-start-sub">これからの記録に自動でタグが付きます</span>
          </span>
        </button>
      ) : (
        // オンの間は色付きの帯。何が付くか・何日目か・どこで終わるかを1か所に出す。
        // role="status" にして、切り替えた瞬間も読み上げられるようにする
        <div className={`trip-banner${reminder !== null ? ' is-overdue' : ''}`} role="status">
          <div className="trip-banner-row">
            <span className="trip-emoji" aria-hidden="true">
              🧳
            </span>
            <span className="trip-banner-text">
              <span className="trip-banner-title">旅行モード中</span>
              <span className="trip-banner-badge">{tripBadgeText(mode, today)}</span>
            </span>
            <button type="button" className="trip-end" onClick={() => endTripMode()}>
              終わる
            </button>
          </div>
          <p className="trip-banner-note">
            これから記録する支出に、自動で <strong>{tripTagsText(mode)}</strong> が付きます
            (1件ずつ外すこともできます)
          </p>
          {/* 長引いたときだけ声をかける。勝手に解除はしない —
              途中で切れると、1回の旅行の中でタグの有無が混ざってしまう */}
          {reminder !== null && <p className="trip-reminder">{reminder}</p>}
        </div>
      )}

      {picking && (
        <TripStartSheet transactions={transactions} onClose={() => setPicking(false)} />
      )}
    </>
  )
}
