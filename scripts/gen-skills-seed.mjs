// One-shot generator: reads supabase/skills/*.md and emits a seed migration.
// Run: node scripts/gen-skills-seed.mjs > supabase/migrations/20260509_seed_maia_skills.sql
import fs from 'node:fs'
import path from 'node:path'

const skillsDir = path.resolve('supabase/skills')
const files = fs.readdirSync(skillsDir).filter(f => f.endsWith('.md')).sort()

function slugify(name) {
  return name.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

function parse(text) {
  const trimmed = text.replace(/^﻿/, '').trimStart()
  if (!trimmed.startsWith('---')) throw new Error('missing frontmatter')
  const end = trimmed.indexOf('\n---', 3)
  const fm = trimmed.slice(3, end).trim()
  const body = trimmed.slice(end + 4).replace(/^\r?\n/, '').trim()
  const fields = {}
  for (const line of fm.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/)
    if (m) fields[m[1].toLowerCase()] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return { name: fields.name, description: fields.description, audience: fields.audience || 'internal', body }
}

console.log(`-- Seed the built-in MAIA skills.
-- Generated from supabase/skills/*.md via scripts/gen-skills-seed.mjs.
-- Re-running is safe: upserts on slug. Manual edits in the admin UI are
-- preserved unless the seed is re-applied.

-- Drop earlier slugs renamed to "*-troubleshoot" so they don't linger.
DELETE FROM public.maia_skills
  WHERE slug IN ('handyman-basics', 'plumber-basics', 'electrician-basics');\n`)

for (const f of files) {
  const s = parse(fs.readFileSync(path.join(skillsDir, f), 'utf8'))
  if (s.body.includes('$skill$')) throw new Error(`body of ${f} contains $skill$ delimiter`)
  const slug = slugify(s.name)
  const escapeLit = (v) => v.replace(/'/g, "''")
  console.log(`INSERT INTO public.maia_skills (slug, name, description, audience, body, enabled, uploaded_by)`)
  console.log(`VALUES ('${slug}', '${escapeLit(s.name)}', '${escapeLit(s.description)}', '${s.audience}', $skill$${s.body}$skill$, true, 'seed')`)
  console.log(`ON CONFLICT (slug) DO UPDATE SET`)
  console.log(`  name = EXCLUDED.name,`)
  console.log(`  description = EXCLUDED.description,`)
  console.log(`  audience = EXCLUDED.audience,`)
  console.log(`  body = EXCLUDED.body,`)
  console.log(`  updated_at = now();\n`)
}
