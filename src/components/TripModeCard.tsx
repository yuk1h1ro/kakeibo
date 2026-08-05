import { useState } from 'react'
import useBodyScrollLock from '../hooks/useBodyScrollLock'
import { todayISO } from '../lib/format'
import { useSpecialTags } from '../lib/reportTagSettings'
import { normalizeTag } from '../lib/tags'
import {
  endTripMode,
  startTripMode,
  tripBadgeText,
  tripReminderText,
  tripTagOptions,
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
// ============================================================

/** 開始時にタグを選ぶシート。チップを押した時点で始まる(確定ボタンを挟まない) */
function TripStartSheet({ onClose }: { onClose: () => void }) {
  const specialTags = useSpecialTags()
  const options = tripTagOptions(specialTags)
  const [draft, setDraft] = useState('')

  useBodyScrollLock()

  const start = (tag: string) => {
    // 空になる文字列では始まらない(startTripMode が false を返す)。
    // その場合はシートを開いたままにして、打ち直せるようにする
    if (startTripMode(tag)) onClose()
  }

  const drafted = normalizeTag(draft)
  // 選んだタグがレポートの「特別な支出」に入っていないと、せっかく付けても
  // 普段の支出と一緒に数えられてしまう。始める前に一言だけ断っておく
  const draftIsSpecial = drafted !== null && specialTags.includes(drafted)

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
          {drafted === null ? 'このタグで始める' : `#${drafted} で始める`}
        </button>
      </div>
    </div>
  )
}

export default function TripModeCard() {
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
            これから記録する支出に、自動で <strong>#{mode.tag}</strong> が付きます
            (1件ずつ外すこともできます)
          </p>
          {/* 長引いたときだけ声をかける。勝手に解除はしない —
              途中で切れると、1回の旅行の中でタグの有無が混ざってしまう */}
          {reminder !== null && <p className="trip-reminder">{reminder}</p>}
        </div>
      )}

      {picking && <TripStartSheet onClose={() => setPicking(false)} />}
    </>
  )
}
