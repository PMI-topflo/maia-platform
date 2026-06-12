// =====================================================================
// lib/recurring-services.ts
// CRUD for the recurring-vendor-services subsystem (Phase 1):
//   recurring_services — fixed weekly vendor per (association × service)
//   vendor_employees   — the vendor's crew (get weekly upload links)
// service_visits are generated later (Phase 3 cron); not created here.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'

export const SERVICE_TYPES = ['Landscaping', 'Pool', 'Janitorial', 'Pest Control', 'Other'] as const
export const CADENCES = ['daily', 'weekly', 'biweekly', 'monthly'] as const
export const BILLING_CADENCES = ['per_visit', 'weekly', 'monthly'] as const
export const CHANNELS = ['email', 'sms', 'whatsapp'] as const
export const LANGUAGES = ['en', 'es', 'pt', 'fr', 'he', 'ru', 'ht'] as const   // resident 6 (en/es/pt/fr/he/ru) + Haitian Creole for South-FL crews

export interface RecurringService {
  id:               number
  association_code: string
  cinc_vendor_id:   string | null
  vendor_name:      string
  service_type:     string
  cadence:          string
  billing_cadence:  string
  expected_day:     number | null
  schedule_anchor:  string | null   // biweekly: reference Monday (YYYY-MM-DD)
  monthly_day:      number | null   // monthly: day-of-month (1–31)
  office_email:     string | null
  office_language:  string
  active:           boolean
  notes:            string | null
  created_at:       string
  updated_at:       string
}

export interface VendorEmployee {
  id:                string
  cinc_vendor_id:    string | null
  vendor_name:       string
  name:              string
  phone:             string | null
  email:             string | null
  preferred_channel: string
  preferred_language: string
  active:            boolean
  created_at:        string
  updated_at:        string
}

// ── recurring_services ────────────────────────────────────────────────
export async function listRecurringServices(assoc?: string | null): Promise<RecurringService[]> {
  let q = supabaseAdmin.from('recurring_services').select('*').order('association_code').order('vendor_name')
  if (assoc) q = q.eq('association_code', assoc.toUpperCase())
  const { data } = await q
  return (data ?? []) as RecurringService[]
}

export async function createRecurringService(input: Partial<RecurringService>): Promise<{ ok: true; row: RecurringService } | { ok: false; error: string }> {
  const { data, error } = await supabaseAdmin.from('recurring_services').insert({
    association_code: (input.association_code ?? '').toUpperCase(),
    cinc_vendor_id:   input.cinc_vendor_id ?? null,
    vendor_name:      input.vendor_name ?? '',
    service_type:     input.service_type ?? 'Other',
    cadence:          input.cadence ?? 'weekly',
    billing_cadence:  input.billing_cadence ?? 'monthly',
    expected_day:     input.expected_day ?? null,
    schedule_anchor:  input.schedule_anchor ?? null,
    monthly_day:      input.monthly_day ?? null,
    office_email:     input.office_email ?? null,
    office_language:  input.office_language ?? 'en',
    notes:            input.notes ?? null,
  }).select('*').single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, row: data as RecurringService }
}

export async function updateRecurringService(id: number, patch: Partial<RecurringService>): Promise<{ ok: boolean; error?: string }> {
  const allowed: (keyof RecurringService)[] = ['cinc_vendor_id', 'vendor_name', 'service_type', 'cadence', 'billing_cadence', 'expected_day', 'schedule_anchor', 'monthly_day', 'office_email', 'office_language', 'active', 'notes']
  const body: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const k of allowed) if (k in patch) body[k] = patch[k]
  const { error } = await supabaseAdmin.from('recurring_services').update(body).eq('id', id)
  return error ? { ok: false, error: error.message } : { ok: true }
}

export async function deleteRecurringService(id: number): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabaseAdmin.from('recurring_services').delete().eq('id', id)
  return error ? { ok: false, error: error.message } : { ok: true }
}

// ── vendor_employees ──────────────────────────────────────────────────
export async function listVendorEmployees(cincVendorId?: string | null): Promise<VendorEmployee[]> {
  let q = supabaseAdmin.from('vendor_employees').select('*').order('vendor_name').order('name')
  if (cincVendorId) q = q.eq('cinc_vendor_id', cincVendorId)
  const { data } = await q
  return (data ?? []) as VendorEmployee[]
}

export async function createVendorEmployee(input: Partial<VendorEmployee>): Promise<{ ok: true; row: VendorEmployee } | { ok: false; error: string }> {
  const { data, error } = await supabaseAdmin.from('vendor_employees').insert({
    cinc_vendor_id:    input.cinc_vendor_id ?? null,
    vendor_name:       input.vendor_name ?? '',
    name:              input.name ?? '',
    phone:             input.phone ?? null,
    email:             input.email ?? null,
    preferred_channel: input.preferred_channel ?? 'email',
    preferred_language: input.preferred_language ?? 'en',
  }).select('*').single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, row: data as VendorEmployee }
}

export async function updateVendorEmployee(id: string, patch: Partial<VendorEmployee>): Promise<{ ok: boolean; error?: string }> {
  const allowed: (keyof VendorEmployee)[] = ['cinc_vendor_id', 'vendor_name', 'name', 'phone', 'email', 'preferred_channel', 'preferred_language', 'active']
  const body: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const k of allowed) if (k in patch) body[k] = patch[k]
  const { error } = await supabaseAdmin.from('vendor_employees').update(body).eq('id', id)
  return error ? { ok: false, error: error.message } : { ok: true }
}

export async function deleteVendorEmployee(id: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabaseAdmin.from('vendor_employees').delete().eq('id', id)
  return error ? { ok: false, error: error.message } : { ok: true }
}
