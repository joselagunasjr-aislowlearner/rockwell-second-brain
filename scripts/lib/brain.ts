import { SupabaseClient } from '@supabase/supabase-js'
import { KnowledgeEntry, MAX_TITLE_LENGTH, MAX_CONTENT_LENGTH } from './types'

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength - 1) + '…'
}

export async function fetchExistingSources(supabase: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('knowledge_entries')
    .select('source')

  if (error) {
    throw new Error(`Failed to fetch existing sources: ${error.message}`)
  }

  const sources = new Set<string>()
  for (const row of data ?? []) {
    if (typeof row.source === 'string') {
      sources.add(row.source)
    }
  }
  return sources
}

export async function insertEntry(
  supabase: SupabaseClient,
  entry: KnowledgeEntry
): Promise<string> {
  const { data, error } = await supabase
    .from('knowledge_entries')
    .insert({
      title: truncate(entry.title, MAX_TITLE_LENGTH),
      content: truncate(entry.content, MAX_CONTENT_LENGTH),
      category: entry.category,
      tags: entry.tags ?? [],
      importance: entry.importance,
      source: entry.source,
    })
    .select('id')
    .single()

  if (error) {
    throw new Error(`Failed to insert entry: ${error.message}`)
  }

  return data.id as string
}
