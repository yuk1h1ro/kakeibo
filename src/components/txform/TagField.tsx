import { collectTags, parseTagInput, sanitizeTags, MAX_TAGS_PER_TX } from '../../lib/tags'
import type { Transaction } from '../../lib/types'

/** タグの候補に出す件数。多すぎると詳細欄が縦に伸びて入力の邪魔になる */
const TAG_SUGGESTION_LIMIT = 8

interface Props {
  tags: readonly string[]
  onTags: (tags: string[]) => void
  /** 打ちかけの文字列(まだタグとして確定していない) */
  draft: string
  onDraft: (draft: string) => void
  /** 候補を出すための既存の記録 */
  knownTransactions: readonly Transaction[]
}

/**
 * 機能088: タグ。付けたい人だけが開く「詳細」の中に置く。
 * 打ちかけの文字列は Enter と、欄から離れたときに確定する
 * (保存のときにも拾うので、確定し忘れても取りこぼさない)。
 */
export default function TagField({ tags, onTags, draft, onDraft, knownTransactions }: Props) {
  const commitDraft = () => {
    const parsed = parseTagInput(draft)
    if (parsed.length > 0) onTags(sanitizeTags([...tags, ...parsed]))
    onDraft('')
  }

  // 過去に使ったタグの候補。すでに付いているものは出さない
  const suggestions = collectTags(knownTransactions, 30)
    .filter((t) => !tags.includes(t.tag))
    .slice(0, TAG_SUGGESTION_LIMIT)

  return (
    <div className="field tag-field">
      <span>タグ(任意・{MAX_TAGS_PER_TX}個まで)</span>
      {tags.length > 0 && (
        <div className="tag-chips">
          {tags.map((tag) => (
            <span key={tag} className="tag-chip is-on">
              #{tag}
              <button
                type="button"
                className="tag-chip-remove"
                aria-label={`タグ ${tag} を外す`}
                onClick={() => onTags(tags.filter((x) => x !== tag))}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        type="text"
        aria-label="タグ"
        placeholder="例: 旅行2026 デート(空白で区切る)"
        value={draft}
        autoComplete="off"
        onChange={(e) => onDraft(e.target.value)}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          // Enter で確定。フォーム送信は起きない(button type=button のため)
          if (e.key === 'Enter') {
            e.preventDefault()
            commitDraft()
          }
        }}
      />
      {suggestions.length > 0 && (
        <div className="tag-chips">
          {suggestions.map((s) => (
            <button
              key={s.tag}
              type="button"
              className="tag-chip"
              onClick={() => onTags(sanitizeTags([...tags, s.tag]))}
            >
              #{s.tag}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
