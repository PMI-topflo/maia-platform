import { supabaseAdmin } from '@/lib/supabase-admin'
import type { DialpadCallEvent, DialpadSmsEvent } from '@/lib/dialpad'

// Module-level flag so the "SMS arrived without text content"
// warning only fires once per process — Dialpad sends a LOT of these
// when the API key lacks message_content_export:all.
let warnedMissingSmsText = false

function normalizePhone(p?: string | null): string | null {
  if (!p) return null
  const trimmed = p.trim()
  if (!trimmed) return null
  return trimmed
}

async function lookupAssociationByPhone(phone: string | null): Promise<string | null> {
  if (!phone) return null
  try {
    const { data: ownerRow } = await supabaseAdmin
      .from('owners')
      .select('association_code')
      .eq('phone', phone)
      .limit(1)
      .maybeSingle()
    if (ownerRow?.association_code) return ownerRow.association_code as string
  } catch { /* table or column may be absent; fall through */ }

  try {
    const { data: tenantRow } = await supabaseAdmin
      .from('association_tenants')
      .select('association_code')
      .eq('phone', phone)
      .limit(1)
      .maybeSingle()
    if (tenantRow?.association_code) return tenantRow.association_code as string
  } catch { /* same */ }

  return null
}

async function lookupStaffByDialpadUserId(userId?: string | number | null): Promise<{ staffId: string | null; email: string | null }> {
  if (userId == null) return { staffId: null, email: null }
  const id = String(userId)
  try {
    const { data } = await supabaseAdmin
      .from('staff_dialpad_lines')
      .select('staff_id, dialpad_email')
      .eq('dialpad_user_id', id)
      .maybeSingle()
    if (data?.staff_id) {
      // dialpad_email may be present; we still want the canonical
      // pmi_staff.email when available for sender_email.
      const { data: staffRow } = await supabaseAdmin
        .from('pmi_staff')
        .select('email')
        .eq('id', data.staff_id)
        .maybeSingle()
      return { staffId: data.staff_id as string, email: (staffRow?.email as string | null) ?? (data.dialpad_email as string | null) ?? null }
    }
  } catch { /* table may not exist yet */ }
  return { staffId: null, email: null }
}

async function lookupStaffByEmail(email?: string | null): Promise<string | null> {
  if (!email) return null
  try {
    const { data } = await supabaseAdmin
      .from('pmi_staff')
      .select('id')
      .ilike('email', email)
      .limit(1)
      .maybeSingle()
    return (data?.id as string | undefined) ?? null
  } catch {
    return null
  }
}

export async function ingestSmsEvent(event: DialpadSmsEvent): Promise<void> {
  if (!event?.id) return

  const externalId = `dialpad_sms_${event.id}`
  const direction  = event.direction ?? null

  const contactPhone =
    normalizePhone(event.contact?.phone_number) ??
    (direction === 'inbound'
      ? normalizePhone(event.from_number)
      : normalizePhone(event.to_number?.[0]))

  const contactName = event.contact?.name ?? null

  // Sender lookup applies only to outbound: figure out which staff actually
  // sent the message. sender_id wins (group senders), then target.id.
  let handledBy:   string | null = null
  let senderEmail: string | null = null
  if (direction === 'outbound') {
    const looked = await lookupStaffByDialpadUserId(event.sender_id ?? event.target?.id ?? null)
    handledBy   = looked.staffId
    senderEmail = looked.email
  }

  const isMms = !!event.mms
  const body  = event.text ?? ''
  if (!body && !isMms && !warnedMissingSmsText) {
    console.warn('[dialpad-ingest] SMS event arrived with empty text — confirm the API key has scope message_content_export:all')
    warnedMissingSmsText = true
  }

  const createdAtMs = event.created_date ? parseInt(event.created_date, 10) : NaN
  const createdAt   = Number.isFinite(createdAtMs) ? new Date(createdAtMs).toISOString() : new Date().toISOString()

  const associationCode = await lookupAssociationByPhone(contactPhone)

  const notes: Record<string, unknown> = {}
  if (isMms) {
    notes.mms       = true
    notes.media_url = body  // for MMS, `text` is a media URL, not a body
  }

  // SMS is single-event-per-message — no need to merge on conflict.
  const row: Record<string, unknown> = {
    external_id:      externalId,
    channel:          'sms_dialpad',
    direction,
    contact_phone:    contactPhone,
    phone_number:     contactPhone,
    contact_name:     contactName,
    sender_email:     senderEmail,
    handled_by:       handledBy,
    topic:            'dialpad_sms',
    message:          body,
    association_code: associationCode,
    status:           'open',
    created_at:       createdAt,
    updated_at:       new Date().toISOString(),
  }
  if (Object.keys(notes).length > 0) row.notes = notes

  const { error } = await supabaseAdmin
    .from('general_conversations')
    .upsert(row, { onConflict: 'external_id', ignoreDuplicates: true })
  if (error && error.code !== '23505') {
    console.error('[dialpad-ingest] SMS insert error:', error.message)
  }
}

export async function ingestCallEvent(event: DialpadCallEvent): Promise<void> {
  if (!event?.call_id) return

  // Multi-leg calls fan out; only archive the entry-point leg so we
  // don't write N rows for one logical phone call. The entry point's
  // own event has entry_point_call_id == null.
  if (event.entry_point_call_id != null) return

  const externalId = `dialpad_call_${event.call_id}`
  const direction  = event.direction ?? null

  const contactPhone =
    normalizePhone(event.contact?.phone) ??
    normalizePhone(event.external_number)
  const contactName  = event.contact?.name ?? null

  let handledBy: string | null = null
  const byDialpadId = await lookupStaffByDialpadUserId(event.target?.id ?? null)
  handledBy = byDialpadId.staffId
  if (!handledBy) handledBy = await lookupStaffByEmail(event.target?.email ?? null)

  const startedMs = event.date_started ?? event.event_timestamp ?? Date.now()
  const createdAt = new Date(startedMs).toISOString()

  const message =
    event.transcription_text?.trim() ||
    event.recap_summary?.trim() ||
    ''

  const recordingUrls = Array.isArray(event.recording_details)
    ? event.recording_details.map(r => r?.url).filter((u): u is string => typeof u === 'string' && !!u)
    : []

  const notes = {
    state:             event.state                ?? null,
    duration_ms:       event.duration             ?? null,
    total_duration_ms: event.total_duration       ?? null,
    was_recorded:      event.was_recorded         ?? false,
    is_transferred:    event.is_transferred       ?? false,
    voicemail_link:    event.voicemail_link       ?? null,
    recording_urls:    recordingUrls,
    event_timestamp:   event.event_timestamp      ?? null,
  }

  const associationCode = await lookupAssociationByPhone(contactPhone)

  // The first event for a call (usually `hangup`) sets the canonical
  // row. Later events (`recording`, `transcription`, `recap_summary`)
  // only update mutable fields. We rely on Postgres' ON CONFLICT logic
  // via supabase-js's `upsert` with `onConflict: 'external_id'` and the
  // default `ignoreDuplicates: false` — but supabase-js does a full
  // EXCLUDED-style replacement, which would clobber the earliest
  // created_at. To preserve the first-seen timestamp we do a manual
  // two-step: try insert, and on 23505 update only the mutable fields.
  const insertRow: Record<string, unknown> = {
    external_id:      externalId,
    channel:          'voice_dialpad',
    direction,
    contact_phone:    contactPhone,
    phone_number:     contactPhone,
    contact_name:     contactName,
    handled_by:       handledBy,
    topic:            'dialpad_call',
    message,
    notes,
    association_code: associationCode,
    status:           'open',
    created_at:       createdAt,
    updated_at:       new Date().toISOString(),
  }

  const { error: insertErr } = await supabaseAdmin
    .from('general_conversations')
    .insert(insertRow)

  if (!insertErr) return
  if (insertErr.code !== '23505') {
    console.error('[dialpad-ingest] call insert error:', insertErr.message)
    return
  }

  // Conflict path: merge mutable fields without touching created_at.
  // Only overwrite `message` if the new event actually has one — later
  // events (e.g. raw `hangup`) often arrive with empty text.
  const update: Record<string, unknown> = {
    notes,
    updated_at: new Date().toISOString(),
  }
  if (message) update.message = message
  if (handledBy) update.handled_by = handledBy

  const { error: updateErr } = await supabaseAdmin
    .from('general_conversations')
    .update(update)
    .eq('external_id', externalId)
  if (updateErr) {
    console.error('[dialpad-ingest] call update error:', updateErr.message)
  }
}
