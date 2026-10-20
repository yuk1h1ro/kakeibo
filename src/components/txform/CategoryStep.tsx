import { categoryLabel, visualFromEmojiValue, type Category } from '../../lib/categories'
import { CategoryVisualBadge } from '../categoryIcons'
import StepLabel from './StepLabel'

interface Props {
  categories: readonly Category[]
  category: string | null
  onChoose: (id: string) => void
  /** お店から自動で入れたカテゴリ(手で選び直したら null) */
  autoCategory: string | null
  /** 同じ店で使った他のカテゴリ。決めきれないときに名前で見せる */
  autoRivals: readonly string[]
}

/** 1. カテゴリ。主線の最初の段 (機能051) */
export default function CategoryStep({ categories, category, onChoose, autoCategory, autoRivals }: Props) {
  return (
    <div className="form-step">
      <label className="field">
        <StepLabel no={1}>カテゴリ</StepLabel>
      </label>
      <div className="category-grid">
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`category-chip ${category === c.id ? 'selected' : ''}`}
            onClick={() => onChoose(c.id)}
          >
            <CategoryVisualBadge visual={visualFromEmojiValue(c.emoji)} size={34} />
            {c.label}
          </button>
        ))}
      </div>
      {/* 自動で入ったカテゴリを黙って使わせないための1行 */}
      {autoCategory !== null && category === autoCategory && (
        <p className="muted auto-category-note">
          {autoRivals.length > 0
            ? `このお店は「${[autoCategory, ...autoRivals]
                .map(categoryLabel)
                .join('」「')}」で使っています。とりあえず「${categoryLabel(
                autoCategory
              )}」にしました(違うときは上から選び直してください)`
            : `このお店でいちばん多い「${categoryLabel(
                autoCategory
              )}」にしました(違うときは選び直してください)`}
        </p>
      )}
    </div>
  )
}
