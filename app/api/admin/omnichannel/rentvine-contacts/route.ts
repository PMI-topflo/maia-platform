import { NextResponse } from 'next/server'

export type RentvineContact = {
  id:    string
  name:  string
  email: string | null
  phone: string | null
  type:  'owner' | 'tenant'
  unit:  string | null
}

export async function GET() {
  const base   = process.env.RENTVINE_BASE_URL
  const key    = process.env.RENTVINE_ACCESS_KEY
  const secret = process.env.RENTVINE_SECRET

  if (!base || !key || !secret) {
    return NextResponse.json({ contacts: [] })
  }

  const creds   = Buffer.from(`${key}:${secret}`).toString('base64')
  const headers = { Authorization: `Basic ${creds}`, 'Content-Type': 'application/json' }

  const contacts: RentvineContact[] = []

  for (const [ep, type] of [['contacts/owners', 'owner'], ['contacts/tenants', 'tenant']] as [string, 'owner' | 'tenant'][]) {
    try {
      const res  = await fetch(`${base}/${ep}`, { headers })
      const json = await res.json()
      const rows: Record<string, unknown>[] = Array.isArray(json?.data) ? json.data
        : Array.isArray(json)             ? json
        : []

      for (const r of rows) {
        const id = r.contactID ?? r.id ?? r.contact_id
        if (!id) continue
        contacts.push({
          id:    String(id),
          name:  String(r.name ?? r.fullName ?? r.full_name ?? ''),
          email: r.email ? String(r.email) : null,
          phone: r.phone ? String(r.phone) : null,
          type,
          unit:  r.unit ?? r.unitNumber ?? r.unit_number ? String(r.unit ?? r.unitNumber ?? r.unit_number) : null,
        })
      }
    } catch (err) {
      console.error(`[rentvine-contacts] ${ep} error:`, err)
    }
  }

  contacts.sort((a, b) => a.name.localeCompare(b.name))
  return NextResponse.json({ contacts })
}
