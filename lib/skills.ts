import { supabaseAdmin } from '@/lib/supabase-admin'

export type SkillAudience = 'internal' | 'customer' | 'both'

export interface Skill {
  id:           string
  slug:         string
  name:         string
  description:  string
  audience:     SkillAudience
  body:         string
  enabled:      boolean
  uploaded_by:  string | null
  storage_path: string | null
  created_at:   string
  updated_at:   string
}

export interface ParsedSkill {
  name:        string
  description: string
  audience:    SkillAudience
  body:        string
}

// Total characters of skill content we will inline into a single system prompt.
// At ~4 chars/token this is roughly 6k tokens — comfortably under model limits
// while leaving room for FAQ context and conversation history.
const MAX_SKILL_CHARS_PER_PROMPT = 24_000

// Parse a SKILL.md file with YAML-style frontmatter:
//   ---
//   name: Florida Property Manager
//   description: ...
//   audience: internal
//   ---
//   <body>
export function parseSkillFile(text: string): ParsedSkill {
  const trimmed = text.replace(/^﻿/, '').trimStart()
  if (!trimmed.startsWith('---')) {
    throw new Error('SKILL.md must start with a YAML frontmatter block (--- ... ---)')
  }
  const end = trimmed.indexOf('\n---', 3)
  if (end < 0) throw new Error('SKILL.md frontmatter is missing its closing --- delimiter')

  const fm   = trimmed.slice(3, end).trim()
  const body = trimmed.slice(end + 4).replace(/^\r?\n/, '').trim()
  if (!body) throw new Error('SKILL.md body is empty')

  const fields: Record<string, string> = {}
  for (const line of fm.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/)
    if (!m) continue
    fields[m[1].toLowerCase()] = m[2].trim().replace(/^["']|["']$/g, '')
  }

  const name        = fields.name
  const description = fields.description
  const audienceRaw = (fields.audience || 'internal').toLowerCase()
  if (!name)        throw new Error('SKILL.md frontmatter missing required field: name')
  if (!description) throw new Error('SKILL.md frontmatter missing required field: description')
  if (audienceRaw !== 'internal' && audienceRaw !== 'customer' && audienceRaw !== 'both') {
    throw new Error('audience must be one of: internal, customer, both')
  }

  return { name, description, audience: audienceRaw as SkillAudience, body }
}

export function slugify(name: string): string {
  return name.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

export async function listSkills(opts?: { audience?: 'internal' | 'customer'; enabledOnly?: boolean }): Promise<Skill[]> {
  let q = supabaseAdmin.from('maia_skills').select('*').order('name', { ascending: true })
  if (opts?.enabledOnly) q = q.eq('enabled', true)
  if (opts?.audience) q = q.in('audience', [opts.audience, 'both'])
  const { data, error } = await q
  if (error) {
    console.error('[skills] list error:', error.message)
    return []
  }
  return (data ?? []) as Skill[]
}

// Builds a markdown block to append to a system prompt. Returns empty string
// when no skills apply, so callers can concatenate unconditionally.
export async function buildSkillsPromptBlock(audience: 'internal' | 'customer'): Promise<string> {
  const skills = await listSkills({ audience, enabledOnly: true })
  if (!skills.length) return ''

  const sections: string[] = []
  let used = 0
  for (const s of skills) {
    const block = `## ${s.name}\n${s.description}\n\n${s.body}`
    if (used + block.length > MAX_SKILL_CHARS_PER_PROMPT) break
    sections.push(block)
    used += block.length
  }
  if (!sections.length) return ''

  return `\n\nADDITIONAL SKILLS (apply when relevant — do not mention them by name to the user):\n\n${sections.join('\n\n---\n\n')}`
}
