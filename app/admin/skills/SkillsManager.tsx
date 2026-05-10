'use client'

import { useState, useTransition } from 'react'

type Audience = 'internal' | 'customer' | 'both'

interface SkillRow {
  id:          string
  slug:        string
  name:        string
  description: string
  audience:    Audience
  enabled:     boolean
  uploaded_by: string | null
}

export default function SkillsManager({ initial }: { initial: SkillRow[] }) {
  const [skills, setSkills]   = useState<SkillRow[]>(initial)
  const [uploading, setUploading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  async function refresh() {
    const res = await fetch('/api/admin/skills')
    if (res.ok) {
      const json = await res.json()
      setSkills(json.skills as SkillRow[])
    }
  }

  async function onUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const form = e.currentTarget
    const data = new FormData(form)
    if (!(data.get('file') instanceof File)) return
    setUploading(true)
    try {
      const res  = await fetch('/api/admin/skills', { method: 'POST', body: data })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Upload failed')
      form.reset()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
    }
  }

  function patch(id: string, body: Partial<{ enabled: boolean; audience: Audience }>) {
    startTransition(async () => {
      setSkills(prev => prev.map(s => s.id === id ? { ...s, ...body } : s))
      const res = await fetch(`/api/admin/skills/${id}`, {
        method:  'PATCH',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify(body),
      })
      if (!res.ok) await refresh()
    })
  }

  function remove(id: string) {
    if (!confirm('Delete this skill? It will no longer be injected into MAIA prompts.')) return
    startTransition(async () => {
      const res = await fetch(`/api/admin/skills/${id}`, { method: 'DELETE' })
      if (res.ok) setSkills(prev => prev.filter(s => s.id !== id))
      else await refresh()
    })
  }

  return (
    <div className="space-y-6">
      <section className="bg-white border border-gray-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Upload SKILL.md</h2>
        <form onSubmit={onUpload} className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            name="file"
            accept=".md,text/markdown,text/plain"
            required
            className="text-sm"
          />
          <button
            type="submit"
            disabled={uploading}
            className="bg-[#f26a1b] text-white text-xs uppercase tracking-wide font-mono px-4 py-2 rounded disabled:opacity-50"
          >
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
          {error && <span className="text-xs text-red-600">{error}</span>}
        </form>
        <p className="text-xs text-gray-500 mt-3">
          File must begin with YAML frontmatter: <code>name</code>, <code>description</code>, <code>audience</code> (internal | customer | both).
        </p>
      </section>

      <section className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="bg-gray-50 border-b border-gray-100 px-4 py-2.5">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide [font-family:var(--font-mono)]">
            Installed skills ({skills.length})
          </span>
        </div>
        {skills.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-400">No skills uploaded yet.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {skills.map(s => (
              <li key={s.id} className="px-4 py-3 flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">{s.name}</span>
                    <span className="text-[10px] font-mono text-gray-400">{s.slug}</span>
                  </div>
                  <p className="text-xs text-gray-600 mt-0.5">{s.description}</p>
                  {s.uploaded_by && (
                    <p className="text-[10px] text-gray-400 mt-1">by {s.uploaded_by}</p>
                  )}
                </div>
                <select
                  value={s.audience}
                  onChange={e => patch(s.id, { audience: e.target.value as Audience })}
                  disabled={pending}
                  className="text-xs border border-gray-200 rounded px-2 py-1"
                >
                  <option value="internal">internal</option>
                  <option value="customer">customer</option>
                  <option value="both">both</option>
                </select>
                <label className="flex items-center gap-1 text-xs text-gray-700">
                  <input
                    type="checkbox"
                    checked={s.enabled}
                    onChange={e => patch(s.id, { enabled: e.target.checked })}
                    disabled={pending}
                  />
                  enabled
                </label>
                <button
                  onClick={() => remove(s.id)}
                  disabled={pending}
                  className="text-xs text-red-600 hover:underline disabled:opacity-50"
                >
                  delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
