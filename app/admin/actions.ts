'use server'

import { supabaseAdmin } from '@/lib/supabase-admin'

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

export async function updateOwner(id: number, fields: Partial<Owner>): Promise<{ error?: string }> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id: _id, created_at: _ca, ...updateFields } = fields as Owner & { id: number }

  const { error } = await supabaseAdmin
    .from('owners')
    .update(updateFields)
    .eq('id', id)

  if (error) {
    console.error('[updateOwner]', error)
    return { error: error.message }
  }
  return {}
}

export async function createOwner(fields: Omit<Owner, 'id' | 'created_at'>): Promise<{ error?: string; id?: number }> {
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
