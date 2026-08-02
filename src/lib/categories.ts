export interface Category {
  id: string
  label: string
  emoji: string
}

export const CATEGORIES: Category[] = [
  { id: 'food', label: '食費', emoji: '🍚' },
  { id: 'eating_out', label: '外食', emoji: '🍜' },
  { id: 'daily', label: '日用品', emoji: '🧻' },
  { id: 'transport', label: '交通費', emoji: '🚃' },
  { id: 'hobby', label: '趣味・娯楽', emoji: '🎮' },
  { id: 'social', label: '交際費', emoji: '🍻' },
  { id: 'health', label: '医療・健康', emoji: '💊' },
  { id: 'other', label: 'その他', emoji: '📦' },
]

export function categoryLabel(id: string | null): string {
  if (!id) return '未分類'
  const c = CATEGORIES.find((c) => c.id === id)
  return c ? c.label : id
}

export function categoryEmoji(id: string | null): string {
  const c = CATEGORIES.find((c) => c.id === id)
  return c ? c.emoji : '📦'
}
