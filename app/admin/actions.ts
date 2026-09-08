'use server'

import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifySession, SESSION_COOKIE } from '@/lib/session'

export type Owner = {
  id: number
  association_name: string | null
  association_code: string | null
  account_number: string | null
  first_name: string | null
  last_name: string | null
  unit_number: string | null
  street_number: string | null
  address: string | null
  city: string | null
  state: string | null
  zip_code: string | null
  phone: string | null
  phone_2: string | null
  phone_3: string | null
  phone_e164: string | null
  emails: string | null
  pmi_service_type: string | null
  language: string | null
  verified_status: string | null
  created_at: string | null
}

export type Association = {
  association_code: string
  association_name: string
  association_type: string | null
}

export type OwnersResult = {
  owners: Owner[]
  total: number
  error?: string
}

const PAGE_SIZE = 50

export async function getAssociations(): Promise<Association[]> {
  const { data, error } = await supabaseAdmin
    .from('associations')
    .select('association_code, association_name, association_type')
    .eq('active', true)
    .order('association_name')

  if (error) {
    console.error('[getAssociations]', error)
    return []
  }
  return data ?? []
}

export async function getOwners(
  page: number,
  search: string,
  associationCode: string
): Promise<OwnersResult> {
  let query = supabaseAdmin
    .from('owners')
    .select('*', { count: 'exact' })

  if (associationCode) {
    query = query.eq('association_code', associationCode)
  }

  if (search.trim()) {
    const term = search.trim()
    query = query.or(
      `first_name.ilike.%${term}%,last_name.ilike.%${term}%,emails.ilike.%${term}%,phone.ilike.%${term}%,account_number.ilike.%${term}%,unit_number.ilike.%${term}%,address.ilike.%${term}%`
    )
  }

  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  query = query.order('association_name').order('last_name').range(from, to)

  const { data, error, count } = await query

  if (error) {
    console.error('[getOwners]', error)
    return { owners: [], total: 0, error: error.message }
  }

  return { owners: data ?? [], total: count ?? 0 }
}

/** Best-effort staff identity for the contact-history log below -- never
 *  blocks the actual update if the session can't be resolved. */
async function staffEmailForHistory(): Promise<string> {
  try {
    const token = (await cookies()).get(SESSION_COOKIE)?.value
    const s = token ? await verifySession(token) : null
    if (s?.persona === 'staff' && typeof s.userId === 'string' && s.userId.includes('@')) return s.userId.toLowerCase()
  } catch { /* best-effort */ }
  return 'staff'
}

export async function updateOwner(id: number, fields: Partial<Owner>): Promise<{ error?: string }> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id: _id, created_at: _ca, ...updateFields } = fields as Owner & { id: number }

  // Real incident, 2026-09-08 (MANXI 802): a wrong owners.emails value was
  // only ever discoverable by someone noticing the wrong recipient -- no
  // change history existed at all. Snapshot the current emails/phone before
  // writing so a real change can be logged (owner_contact_history,
  // 20260908_owner_contact_history.sql).
  const touchesTracked = 'emails' in updateFields || 'phone' in updateFields
  const before = touchesTracked
    ? (await supabaseAdmin.from('owners').select('emails, phone, association_code, unit_number').eq('id', id).maybeSingle()).data
    : null

  const { error } = await supabaseAdmin
    .from('owners')
    .update(updateFields)
    .eq('id', id)

  if (error) {
    console.error('[updateOwner]', error)
    return { error: error.message }
  }

  if (before) {
    const changedBy = await staffEmailForHistory()
    for (const field of ['emails', 'phone'] as const) {
      if (!(field in updateFields)) continue
      const oldValue = before[field] as string | null
      const newValue = updateFields[field] ?? null
      if (oldValue === newValue) continue
      try {
        await supabaseAdmin.from('owner_contact_history').insert({
          owner_id: id, association_code: before.association_code, unit_number: before.unit_number,
          field, old_value: oldValue, new_value: newValue, changed_by: changedBy,
        })
      } catch { /* history logging must never fail the actual update */ }
    }
  }

  return {}
}

export async function createOwner(fields: Partial<Omit<Owner, 'id' | 'created_at'>>): Promise<{ error?: string; id?: number }> {
  const { data, error } = await supabaseAdmin
    .from('owners')
    .insert(fields)
    .select('id')
    .single()

  if (error) {
    console.error('[createOwner]', error)
    return { error: error.message }
  }
  return { id: data?.id }
}

export async function deleteOwner(id: number): Promise<{ error?: string }> {
  const { error } = await supabaseAdmin
    .from('owners')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('[deleteOwner]', error)
    return { error: error.message }
  }
  return {}
}
