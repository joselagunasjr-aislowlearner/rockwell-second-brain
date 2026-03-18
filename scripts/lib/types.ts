export const VALID_CATEGORIES = [
  'decision',
  'contact',
  'lesson',
  'open_thread',
  'vendor',
  'client',
  'strategy',
  'daily_note',
] as const

export type KnowledgeCategory = (typeof VALID_CATEGORIES)[number]

export interface KnowledgeEntry {
  title: string
  content: string
  category: KnowledgeCategory
  tags?: string[]
  importance: 1 | 2 | 3 | 4 | 5
  source: string
}

export interface SummarizeInput {
  contentType: 'drive' | 'gmail'
  rawText: string
  metadata: {
    filename?: string  // Drive
    senders?: string[] // Gmail
    dateRange?: string // Gmail
  }
}

export interface SummarizeOutput {
  title: string
  summary: string
  category: KnowledgeCategory
  importance: 1 | 2 | 3 | 4 | 5
}

export const MAX_TITLE_LENGTH = 255
export const MAX_CONTENT_LENGTH = 2000
export const MAX_RAW_TEXT_LENGTH = 10_000
