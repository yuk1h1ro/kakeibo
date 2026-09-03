// ============================================================
// 検索・並べ替え・絞り込み条件の保存 (機能145 / 150 / 152)
//
// 日本語入力への配慮(機能145):
//   IME で変換している最中(compositionstart 〜 compositionend)は
//   検索語を確定させない。「かんじ」と打っている途中の仮の文字で
//   検索が走ると、結果が目まぐるしく入れ替わって読めなくなるため。
//   確定後も 220ms だけ待ってから走らせる(1文字ごとの再計算を避ける)。
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { categoryLabel, useCategories } from '../lib/categories'
import {
  DEFAULT_FILTER,
  NO_CATEGORY_KEY,
  PERIOD_OPTIONS,
  SORT_OPTIONS,
  describeFilter,
  filterStores,
  filterTags,
  isFilterActive,
  suggestFilterName,
  type HistoryFilter,
} from '../lib/historyFilter'
import { collectTags } from '../lib/tags'
import type { Transaction } from '../lib/types'
import '../ledger.css'
import {
  addSavedFilter,
  canSaveFilter,
  findMatchingFilter,
  loadSavedFilters,
  removeSavedFilter,
  storeSavedFilters,
  type SavedFilter,
} from '../lib/savedFilters'

interface Props {
  filter: HistoryFilter
  onChange: (next: HistoryFilter) => void
  /** タグの選択肢を出すための記録一覧 (機能088)。使われているタグだけを出す */
  transactions?: readonly Transaction[]
}

export default function HistoryFilterBar({ filter, onChange, transactions }: Props) {
  const categories = useCategories()
  // 実際に使われているタグだけを候補にする(空の選択肢を並べない)
  const tagOptions = collectTags(transactions ?? [], 40)
  const activeTags = filterTags(filter)
  // お店はこの画面から選ぶものではなく(候補が数百件になる)、
  // レポートのお店別か行の長押しから渡ってくる。ここでは外せるようにだけしておく
  const activeStores = filterStores(filter)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(filter.query)
  const [saved, setSaved] = useState<SavedFilter[]>(() => loadSavedFilters())
  const [naming, setNaming] = useState<string | null>(null)

  const composingRef = useRef(false)
  const commitRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (commitRef.current !== null) window.clearTimeout(commitRef.current)
    }
  }, [])

  // 保存した条件を呼び出したときなど、外から検索語が変わったら入力欄も合わせる
  useEffect(() => {
    setDraft(filter.query)
  }, [filter.query])

  const filterRef = useRef(filter)
  filterRef.current = filter

  const commitQuery = (value: string) => {
    if (commitRef.current !== null) window.clearTimeout(commitRef.current)
    commitRef.current = window.setTimeout(() => {
      onChange({ ...filterRef.current, query: value })
    }, 220)
  }

  const patch = (p: Partial<HistoryFilter>) => onChange({ ...filter, ...p })

  const toggleCategory = (key: string) => {
    const next = filter.categories.includes(key)
      ? filter.categories.filter((c) => c !== key)
      : [...filter.categories, key]
    patch({ categories: next })
  }

  const toggleTag = (tag: string) => {
    const next = activeTags.includes(tag)
      ? activeTags.filter((t) => t !== tag)
      : [...activeTags, tag]
    patch({ tags: next })
  }

  const active = isFilterActive(filter)
  const matching = findMatchingFilter(saved, filter)

  const applySaved = (s: SavedFilter) => {
    onChange(s.filter)
    setOpen(false)
  }

  const deleteSaved = (id: string) => {
    const next = removeSavedFilter(saved, id)
    setSaved(next)
    storeSavedFilters(next)
  }

  const confirmSave = () => {
    const name = (naming ?? '').trim()
    if (name === '') return
    const next = addSavedFilter(saved, {
      id: crypto.randomUUID(),
      name,
      filter,
      createdAt: new Date().toISOString(),
    })
    setSaved(next)
    storeSavedFilters(next)
    setNaming(null)
  }

  return (
    <div className="card">
      <div className="hist-search-row">
        <input
          type="search"
          inputMode="search"
          enterKeyHint="search"
          value={draft}
          placeholder="店名・メモ・カテゴリで検索"
          aria-label="記録を検索"
          onChange={(e) => {
            const value = e.target.value
            setDraft(value)
            // 変換中は確定させない(暴発防止)。確定は compositionend で行う
            if (composingRef.current) return
            commitQuery(value)
          }}
          onCompositionStart={() => {
            composingRef.current = true
          }}
          onCompositionEnd={(e) => {
            composingRef.current = false
            const value = e.currentTarget.value
            setDraft(value)
            commitQuery(value)
          }}
        />
        {draft !== '' && (
          <button
            className="hist-search-clear"
            aria-label="検索語を消す"
            onClick={() => {
              setDraft('')
              commitQuery('')
            }}
          >
            ✕
          </button>
        )}
      </div>

      <button
        className="hist-filter-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span>絞り込み・並べ替え {open ? '▲' : '▼'}</span>
        <span className="hist-filter-state">
          {matching ? matching.name : active ? describeFilter(filter, categoryLabel) : ''}
        </span>
      </button>

      {open && (
        <div className="hist-filter-body">
          <div>
            {/* 並べ替えの基準を明示する(支払い総額ではなく自分の実質支出) */}
            <span className="hist-field-label">並べ替え(金額は自分の実質支出で比べます)</span>
            <div className="hist-chips">
              {SORT_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  className={`hist-chip${filter.sort === o.value ? ' is-on' : ''}`}
                  aria-pressed={filter.sort === o.value}
                  onClick={() => patch({ sort: o.value })}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="hist-field-label">期間(表示中の月が基準)</span>
            <div className="hist-chips">
              {PERIOD_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  className={`hist-chip${filter.period === o.value ? ' is-on' : ''}`}
                  aria-pressed={filter.period === o.value}
                  onClick={() => patch({ period: o.value })}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="hist-field-label">カテゴリ(選ばなければすべて)</span>
            <div className="hist-chips">
              {categories.map((c) => (
                <button
                  key={c.catKey}
                  className={`hist-chip${filter.categories.includes(c.catKey) ? ' is-on' : ''}`}
                  aria-pressed={filter.categories.includes(c.catKey)}
                  onClick={() => toggleCategory(c.catKey)}
                >
                  {c.label}
                </button>
              ))}
              <button
                className={`hist-chip${filter.categories.includes(NO_CATEGORY_KEY) ? ' is-on' : ''}`}
                aria-pressed={filter.categories.includes(NO_CATEGORY_KEY)}
                onClick={() => toggleCategory(NO_CATEGORY_KEY)}
              >
                未分類・預かり
              </button>
            </div>
          </div>

          {/* お店。絞り込んでいるときだけ出す(選ぶ場所ではなく、外す場所) */}
          {activeStores.length > 0 && (
            <div>
              <span className="hist-field-label">お店(押すと外せます)</span>
              <div className="hist-chips">
                {activeStores.map((s) => (
                  <button
                    key={s}
                    className="hist-chip is-on"
                    aria-pressed={true}
                    onClick={() => patch({ stores: activeStores.filter((x) => x !== s) })}
                  >
                    {s} ✕
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 機能088: タグ。使われているタグが1つも無ければ節ごと出さない */}
          {tagOptions.length > 0 && (
            <div>
              <span className="hist-field-label">タグ(選ばなければすべて)</span>
              <div className="tag-chips">
                {tagOptions.map((t) => (
                  <button
                    key={t.tag}
                    className={`tag-chip${activeTags.includes(t.tag) ? ' is-on' : ''}`}
                    aria-pressed={activeTags.includes(t.tag)}
                    onClick={() => toggleTag(t.tag)}
                  >
                    #{t.tag}
                  </button>
                ))}
              </div>
            </div>
          )}

          {saved.length > 0 && (
            <div>
              <span className="hist-field-label">保存した条件(この端末に保存)</span>
              <div className="hist-chips">
                {saved.map((s) => (
                  <span
                    key={s.id}
                    className={`hist-saved-row${matching?.id === s.id ? ' is-on' : ''}`}
                  >
                    <button className="hist-chip" onClick={() => applySaved(s)}>
                      {s.name}
                    </button>
                    <button
                      className="hist-chip hist-chip-del"
                      aria-label={`${s.name} を削除`}
                      onClick={() => deleteSaved(s.id)}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {naming !== null ? (
            <div>
              <span className="hist-field-label">この条件に名前を付ける</span>
              <div className="hist-search-row">
                <input
                  value={naming}
                  maxLength={20}
                  aria-label="条件の名前"
                  onChange={(e) => setNaming(e.target.value)}
                />
              </div>
              <div className="hist-filter-actions" style={{ marginTop: 8 }}>
                <button onClick={() => setNaming(null)}>やめる</button>
                <button className="hist-primary" onClick={confirmSave}>
                  保存する
                </button>
              </div>
            </div>
          ) : (
            <div className="hist-filter-actions">
              <button onClick={() => onChange(DEFAULT_FILTER)} disabled={!active}>
                絞り込みを解除
              </button>
              <button
                className="hist-primary"
                disabled={!canSaveFilter(filter)}
                /* 名前の初期値は説明文そのままではなく、20文字に収まりやすい形にする
                   (既定のままの期間「すべて」を落とす。理由は suggestFilterName) */
                onClick={() => setNaming(suggestFilterName(filter, categoryLabel))}
              >
                この条件を保存
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
