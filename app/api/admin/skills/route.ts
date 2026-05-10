import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { parseSkillFile, slugify } from '@/lib/skills'

async function requireStaff(req: NextRequest) {
  const token   = req.cookies.get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return null
  return session
}

export async function GET(req: NextRequest) {
  if (!(await requireStaff(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data, error } = await supabaseAdmin
    .from('maia_skills')
    .select('id, slug, name, description, audience, enabled, uploaded_by, created_at, updated_at')
    .order('name', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ skills: data ?? [] })
}

const MAX_BYTES = 256 * 1024  // 256 KB cap on a SKILL.md upload

export async function POST(req: NextRequest) {
  const session = await requireStaff(req)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'file is required' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: `file exceeds ${MAX_BYTES} bytes` }, { status: 400 })

  const text = await file.text()
  let parsed
  try {
    parsed = parseSkillFile(text)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'parse failed' }, { status: 400 })
  }

  const slug         = slugify(parsed.name)
  const storagePath  = `${slug}/${Date.now()}-SKILL.md`

  const upload = await supabaseAdmin.storage.from('maia-skills').upload(storagePath, text, {
    contentType: 'text/markdown',
    upsert: false,
  })
  if (upload.error) {
    return NextResponse.json({ error: `storage: ${upload.error.message}` }, { status: 500 })
  }

  const { data, error } = await supabaseAdmin
    .from('maia_skills')
    .upsert({
      slug,
      name:         parsed.name,
      description:  parsed.description,
      audience:     parsed.audience,
      body:         parsed.body,
      enabled:      true,
      uploaded_by:  session.displayName || String(session.userId),
      storage_path: storagePath,
      updated_at:   new Date().toISOString(),
    }, { onConflict: 'slug' })
    .select('id, slug, name, audience, enabled')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ skill: data })
}
