import { categoryLabel } from '../../lib/categories'
import type { StoreCategory } from '../../lib/storeCategories'
import { guessStoreCategory, isSameStore, type StoreIndex, type StoreOption } from '../../lib/storePicker'
import StepLabel from './StepLabel'

interface Props {
  store: string
  onStoreChange: (name: string) => void
  category: string | null
  /** 選んだカテゴリで過去に使ったお店(storeOptionsFor) */
  storeOptions: readonly StoreOption[]
  /** 店名を打っている途中の候補(カテゴリをまたいで探す) */
  suggestions: readonly StoreCategory[]
  storeIndex: StoreIndex
  /** チップを押した。同じ店をもう一度押したら外す判断は呼ぶ側 */
  onChooseStore: (name: string) => void
  onFocus: () => void
  onBlur: () => void
  /** 打っている途中の候補を選んだ。guessed はその店でいちばん多く使ったカテゴリ */
  onPickSuggestion: (storeName: string, guessed: string, rivals: string[]) => void
}

/**
 * 2. お店。ここが入力の主役 —
 * 選んだカテゴリで過去に使ったお店を並べ、1タップで選ぶだけで済ませる。
 * 候補の出どころ(取引履歴 + 学習内容)と並び順は storePicker.ts を参照。
 * 候補に無い店は下の欄に打てばよく、保存時に学習されるので次から候補に出る
 * (学習は InputTab の learnFromInput → rememberStoreCategory が担う)。
 * 打った店名から カテゴリ を当てる既存の動き(機能067/075)は、
 * この欄の onBlur と候補リストにそのまま残してある
 */
export default function StoreStep({
  store,
  onStoreChange,
  category,
  storeOptions,
  suggestions,
  storeIndex,
  onChooseStore,
  onFocus,
  onBlur,
  onPickSuggestion,
}: Props) {
  // 一覧に無い店(新しく打った店・カテゴリを選び直したあとの店)も、
  // 選ばれていることが見えるように先頭のチップとして出す
  const storeInOptions = storeOptions.some((o) => isSameStore(o.storeName, store))

  return (
    <div className="field store-field form-step">
      <StepLabel no={2}>お店(任意)</StepLabel>
      {storeOptions.length > 0 && (
        <div className="store-chips" role="group" aria-label="お店の候補">
          {/* 一覧に無い店(打ったばかり・カテゴリを選び直した後)も選択中だと分かるように出す */}
          {store.trim() !== '' && !storeInOptions && (
            <button
              type="button"
              className="store-chip selected"
              aria-pressed={true}
              onClick={() => onChooseStore(store)}
            >
              {store.trim()}
            </button>
          )}
          {storeOptions.map((o) => (
            <button
              key={o.storeKey}
              type="button"
              className={`store-chip${isSameStore(o.storeName, store) ? ' selected' : ''}`}
              aria-pressed={isSameStore(o.storeName, store)}
              onClick={() => onChooseStore(o.storeName)}
            >
              {o.storeName}
            </button>
          ))}
        </div>
      )}
      <input
        type="text"
        aria-label="お店"
        placeholder={storeOptions.length > 0 ? '一覧に無いお店はここに入力' : '例: セブンイレブン'}
        value={store}
        autoComplete="off"
        onChange={(e) => onStoreChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
      />
      {category === null && (
        <p className="muted store-hint">カテゴリを選ぶと、そのカテゴリで使ったお店が並びます</p>
      )}
      {category !== null && storeOptions.length === 0 && (
        <p className="muted store-hint">
          このカテゴリのお店はまだありません。入れておくと次から1タップで選べます
        </p>
      )}
      {/* 機能067/075: 店名を打っている途中の候補(カテゴリをまたいで探す)。
          こちらは「店 → カテゴリ」の経路で、カテゴリがまだ空のときだけカテゴリも入る */}
      {suggestions.length > 0 && (
        <ul className="store-suggestions">
          {suggestions.map((s) => {
            // 表示するカテゴリと、選んだときに入るカテゴリを必ず一致させる。
            // どちらも「その店でいちばん多く使ったカテゴリ」(履歴が無い店だけ学習内容)
            const guess = guessStoreCategory(storeIndex, s.storeName)
            const guessed = guess?.category ?? s.category
            return (
              <li key={s.storeKey}>
                <button
                  type="button"
                  className="store-suggestion"
                  // blur より先に確定させたいので mousedown/pointerdown で拾う
                  onPointerDown={(e) => {
                    e.preventDefault()
                    onPickSuggestion(s.storeName, guessed, guess?.rivals ?? [])
                  }}
                >
                  <span className="store-suggestion-name">{s.storeName}</span>
                  <span className="store-suggestion-cat">{categoryLabel(guessed)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
