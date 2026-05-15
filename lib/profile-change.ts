// =====================================================================
// lib/profile-change.ts
// Shared helpers for the non-staff persona profile-edit flow:
//   - lookupPersonaRecord — fetch the row for a session
//   - submitProposedEmailChange — queue a pending_profile_changes row +
//     email the staff approver
//   - applyApproval / applyRejection — magic-link handlers' core logic
//
// Personas covered: owner, tenant, board, unit_manager, building_manager.
// Staff have their own self-edit path (no approval needed) in
// /admin/profile + /api/admin/me.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail }     from '@/lib/gmail'

export type Persona = 'owner' | 'tenant' | 'board' | 'unit_manager' | 'building_manager'

const APPROVER_EMAIL = process.env.PROFILE_CHANGE_APPROVER ?? 'ar@topfloridaproperties.com'
const APP_URL        = process.env.NEXT_PUBLIC_APP_URL    ?? 'https://www.pmitop.com'

export interface PersonaRecord {
  id:               string
  name:             string
  current_email:    string | null
  phone:            string | null
  association_code: string | null
  association_name: string | null
  unit_number:      string | null
  /** Editable fields a personal record carries beyond email. Returned
   *  as a plain map so the shared form / PATCH endpoint can iterate
   *  without persona-specific switch statements. */
  extra:            Record<string, string | null>
}

// ─────────────────────────────────────────────────────────────────────
// Lookup
// ─────────────────────────────────────────────────────────────────────

/** Fetch the persona record tied to the current session. The shape
 *  varies per table — we normalize down to a common PersonaRecord. */
export async function lookupPersonaRecord(
  persona:     Persona,
  session:     { userId?: string | number; associationCode?: string },
): Promise<PersonaRecord | null> {
  const loginEmail = typeof session.userId === 'string' && session.userId.includes('@')
    ? session.userId.toLowerCase()
    : ''
  const assocCode  = (session.associationCode || '').toUpperCase()

  switch (persona) {
    case 'owner': {
      // Owners can be matched by email substring (their `emails` field is
      // comma-separated). Pick the active row that contains the login.
      if (!loginEmail) return null
      const { data } = await supabaseAdmin
        .from('owners')
        .select('id, first_name, last_name, entity_name, emails, phone, phone_2, address, association_code, association_name, unit_number, account_number')
        .ilike('emails', `%${loginEmail}%`)
        .or('status.neq.previous,status.is.null')
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!data) return null
      const fullName = data.entity_name || [data.first_name, data.last_name].filter(Boolean).join(' ') || ''
      return {
        id:               String(data.id),
        name:             fullName,
        current_email:    data.emails ?? null,
        phone:            data.phone ?? data.phone_2 ?? null,
        association_code: data.association_code ?? null,
        association_name: data.association_name ?? null,
        unit_number:      data.unit_number ?? null,
        extra: {
          first_name:     data.first_name ?? '',
          last_name:      data.last_name  ?? '',
          phone_2:        data.phone_2 ?? '',
          address:        data.address ?? '',
          account_number: data.account_number ?? '',
        },
      }
    }
    case 'tenant': {
      if (!loginEmail || !assocCode) return null
      const { data } = await supabaseAdmin
        .from('association_tenants')
        .select('id, first_name, last_name, email, phone, association_code, association_name, unit_number')
        .eq('association_code', assocCode)
        .ilike('email', loginEmail)
        .order('lease_start_date', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!data) return null
      return {
        id:               String(data.id),
        name:             [data.first_name, data.last_name].filter(Boolean).join(' '),
        current_email:    data.email ?? null,
        phone:            data.phone ?? null,
        association_code: data.association_code,
        association_name: data.association_name ?? null,
        unit_number:      data.unit_number ?? null,
        extra: {
          first_name: data.first_name ?? '',
          last_name:  data.last_name  ?? '',
        },
      }
    }
    case 'board': {
      if (!loginEmail) return null
      const { data } = await supabaseAdmin
        .from('association_board_members')
        .select('id, association_code, name, email, role')
        .ilike('email', loginEmail)
        .eq('active', true)
        .limit(1)
        .maybeSingle()
      if (!data) return null
      const { data: assoc } = await supabaseAdmin
        .from('associations')
        .select('association_name')
        .eq('association_code', data.association_code)
        .maybeSingle()
      return {
        id:               String(data.id),
        name:             data.name ?? '',
        current_email:    data.email ?? null,
        phone:            null,
        association_code: data.association_code,
        association_name: assoc?.association_name ?? null,
        unit_number:      null,
        extra: {
          role: data.role ?? '',
        },
      }
    }
    case 'unit_manager': {
      if (!loginEmail) return null
      const { data } = await supabaseAdmin
        .from('unit_managers')
        .select('id, first_name, last_name, email, phone, association_code, company_name')
        .ilike('email', loginEmail)
        .eq('active', true)
        .limit(1)
        .maybeSingle()
      if (!data) return null
      const { data: assoc } = await supabaseAdmin
        .from('associations')
        .select('association_name')
        .eq('association_code', data.association_code)
        .maybeSingle()
      return {
        id:               String(data.id),
        name:             [data.first_name, data.last_name].filter(Boolean).join(' '),
        current_email:    data.email ?? null,
        phone:            data.phone ?? null,
        association_code: data.association_code,
        association_name: assoc?.association_name ?? null,
        unit_number:      null,
        extra: {
          first_name:   data.first_name ?? '',
          last_name:    data.last_name  ?? '',
          company_name: data.company_name ?? '',
        },
      }
    }
    case 'building_manager': {
      if (!loginEmail) return null
      const { data } = await supabaseAdmin
        .from('building_managers')
        .select('id, first_name, last_name, email, phone, association_code, company_name')
        .ilike('email', loginEmail)
        .eq('active', true)
        .limit(1)
        .maybeSingle()
      if (!data) return null
      const { data: assoc } = await supabaseAdmin
        .from('associations')
        .select('association_name')
        .eq('association_code', data.association_code)
        .maybeSingle()
      return {
        id:               String(data.id),
        name:             [data.first_name, data.last_name].filter(Boolean).join(' '),
        current_email:    data.email ?? null,
        phone:            data.phone ?? null,
        association_code: data.association_code,
        association_name: assoc?.association_name ?? null,
        unit_number:      null,
        extra: {
          first_name:   data.first_name ?? '',
          last_name:    data.last_name  ?? '',
          company_name: data.company_name ?? '',
        },
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Direct (non-email) field updates
// ─────────────────────────────────────────────────────────────────────

const TABLE: Record<Persona, string> = {
  owner:            'owners',
  tenant:           'association_tenants',
  board:            'association_board_members',
  unit_manager:     'unit_managers',
  building_manager: 'building_managers',
}

/** Whitelist of fields each persona can self-update without approval.
 *  Email is deliberately excluded here — it requires approval. */
const SAFE_FIELDS: Record<Persona, string[]> = {
  owner:            ['phone', 'phone_2', 'address', 'first_name', 'last_name'],
  tenant:           ['phone', 'first_name', 'last_name'],
  board:            ['name'],
  unit_manager:     ['phone', 'first_name', 'last_name', 'company_name'],
  building_manager: ['phone', 'first_name', 'last_name', 'company_name'],
}

export async function applySafeFieldUpdates(
  persona:    Persona,
  recordId:   string,
  patch:      Record<string, string | null>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const allowed = SAFE_FIELDS[persona]
  const clean: Record<string, unknown> = {}
  for (const k of allowed) {
    if (Object.prototype.hasOwnProperty.call(patch, k)) {
      const v = patch[k]
      clean[k] = typeof v === 'string' ? (v.trim() || null) : null
    }
  }
  if (Object.keys(clean).length === 0) return { ok: true }

  // Owners.id is bigint; others are uuid. Postgres compares either as a
  // string in the filter, so casting recordId works for both.
  const { error } = await supabaseAdmin.from(TABLE[persona]).update(clean).eq('id', recordId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────
// Email-change approval
// ─────────────────────────────────────────────────────────────────────

export async function submitProposedEmailChange(
  persona:        Persona,
  record:         PersonaRecord,
  proposedEmail:  string,
  requesterEmail: string,
): Promise<{ pending_id: string; sent: boolean }> {
  const { data: pending, error } = await supabaseAdmin
    .from('pending_profile_changes')
    .insert({
      persona,
      persona_record_id: record.id,
      field:             'email',
      current_value:     record.current_email,
      proposed_value:    proposedEmail,
      requester_email:   requesterEmail,
      requester_name:    record.name,
      association_code:  record.association_code,
      association_name:  record.association_name,
    })
    .select('id, confirm_token, reject_token, expires_at')
    .single()
  if (error || !pending) {
    throw new Error(`pending_profile_changes insert failed: ${error?.message}`)
  }

  const confirmUrl = `${APP_URL}/api/profile-change/approve/${pending.confirm_token}`
  const rejectUrl  = `${APP_URL}/api/profile-change/reject/${pending.reject_token}`
  const expires    = new Date(pending.expires_at).toLocaleString('en-US', {
    timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  })

  const html = approvalEmailHtml({
    persona, record, proposedEmail, confirmUrl, rejectUrl, expires,
  })
  let sent = false
  try {
    await sendEmail({
      to:      APPROVER_EMAIL,
      subject: `Approve email change — ${persona} ${record.name || record.id}`,
      html,
    })
    sent = true
  } catch (err) {
    console.error('[profile-change] approver email send failed:', err)
  }

  return { pending_id: pending.id, sent }
}

function approvalEmailHtml(opts: {
  persona:        Persona
  record:         PersonaRecord
  proposedEmail:  string
  confirmUrl:     string
  rejectUrl:      string
  expires:        string
}): string {
  const personaLabel = ({
    owner:            'Unit Owner',
    tenant:           'Tenant',
    board:            'Board Member',
    unit_manager:     'Unit Manager',
    building_manager: 'Building Manager',
  } as const)[opts.persona]
  const where = [
    opts.record.association_name ?? opts.record.association_code,
    opts.record.unit_number ? `Unit ${opts.record.unit_number}` : null,
  ].filter(Boolean).join(' · ')
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#222;max-width:600px;margin:0 auto;padding:20px">
<p style="font-size:14px;color:#555;margin-top:0">A ${personaLabel.toLowerCase()} requested a login-email change:</p>
<div style="font-size:18px;font-weight:600">${opts.record.name || '(no name on file)'}</div>
${where ? `<div style="font-size:13px;color:#6b7280;margin-top:2px">${where}</div>` : ''}

<table style="margin:18px 0;font-size:14px">
  <tr><td style="color:#6b7280;padding-right:14px">Current email:</td><td>${opts.record.current_email ?? '—'}</td></tr>
  <tr><td style="color:#6b7280;padding-right:14px">Requested new:</td><td><strong>${opts.proposedEmail}</strong></td></tr>
</table>

<div style="margin:24px 0 16px 0">
  <a href="${opts.confirmUrl}" style="background:#15803d;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;font-weight:500;margin-right:8px">Approve change</a>
  <a href="${opts.rejectUrl}"  style="background:#fff;color:#b91c1c;border:1px solid #b91c1c;padding:9px 19px;border-radius:4px;text-decoration:none;font-weight:500">Reject</a>
</div>
<p style="color:#6b7280;font-size:12px;margin-top:18px">Link expires ${opts.expires}. After approval the user is asked whether to keep the old address on file as a backup.</p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0 12px">
<p style="color:#9ca3af;font-size:11px;margin:0">MAIA · PMI Top Florida Properties</p>
</body></html>`
}

// ─────────────────────────────────────────────────────────────────────
// Approve / Reject token handlers (used by the magic-link routes)
// ─────────────────────────────────────────────────────────────────────

export interface PendingChange {
  id:                 string
  persona:            Persona
  persona_record_id:  string
  current_value:      string | null
  proposed_value:     string
  requester_email:    string
  requester_name:     string | null
  association_name:   string | null
  status:             'pending' | 'approved' | 'rejected' | 'expired'
  decided_at:         string | null
  expires_at:         string
}

export async function findPending(byField: 'confirm_token' | 'reject_token', token: string): Promise<PendingChange | null> {
  const { data } = await supabaseAdmin
    .from('pending_profile_changes')
    .select('id, persona, persona_record_id, current_value, proposed_value, requester_email, requester_name, association_name, status, decided_at, expires_at')
    .eq(byField, token)
    .maybeSingle()
  return (data as PendingChange | null) ?? null
}

export async function applyApproval(row: PendingChange, approverEmail?: string): Promise<{ ok: boolean; error?: string }> {
  // Write the new email onto the persona table. Each table uses a
  // different column name for the canonical email.
  const tableEmailCol: Record<Persona, string> = {
    owner:            'emails',           // comma-separated; new email REPLACES (V1 simplification)
    tenant:           'email',
    board:            'email',
    unit_manager:     'email',
    building_manager: 'email',
  }
  const updatePatch = { [tableEmailCol[row.persona]]: row.proposed_value }
  const { error: uErr } = await supabaseAdmin
    .from(TABLE[row.persona])
    .update(updatePatch)
    .eq('id', row.persona_record_id)
  if (uErr) return { ok: false, error: uErr.message }

  await supabaseAdmin
    .from('pending_profile_changes')
    .update({ status: 'approved', decided_at: new Date().toISOString(), approver_email: approverEmail ?? null })
    .eq('id', row.id)

  // Notify the user
  void sendEmail({
    to:      row.proposed_value,
    subject: `Your email update is approved`,
    html: `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#222">
<p>Hi ${row.requester_name || 'there'},</p>
<p>Your request to update your login email has been approved. From now on, log in with <strong>${row.proposed_value}</strong>.</p>
<p style="font-size:13px;color:#6b7280;margin-top:14px">If you'd like to keep <strong>${row.current_value ?? 'your previous address'}</strong> on file as well (for notifications or backup login), reply to this email and let us know — staff can add it back as an alias.</p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0 12px">
<p style="color:#9ca3af;font-size:11px;margin:0">MAIA · PMI Top Florida Properties</p>
</body></html>`,
  }).catch(err => console.error('[profile-change] user notify (approve) failed:', err))

  return { ok: true }
}

export async function applyRejection(row: PendingChange, approverEmail?: string): Promise<{ ok: boolean; error?: string }> {
  await supabaseAdmin
    .from('pending_profile_changes')
    .update({ status: 'rejected', decided_at: new Date().toISOString(), approver_email: approverEmail ?? null })
    .eq('id', row.id)

  void sendEmail({
    to:      row.requester_email,
    subject: 'Your email update request was declined',
    html: `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#222">
<p>Hi ${row.requester_name || 'there'},</p>
<p>Your request to change your login email to <strong>${row.proposed_value}</strong> was reviewed and declined. Your current email <strong>${row.current_value ?? '(on file)'}</strong> stays in effect.</p>
<p style="font-size:13px;color:#6b7280;margin-top:14px">If you believe this was a mistake or want help completing the change, reply to this email and a staff member will follow up.</p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0 12px">
<p style="color:#9ca3af;font-size:11px;margin:0">MAIA · PMI Top Florida Properties</p>
</body></html>`,
  }).catch(err => console.error('[profile-change] user notify (reject) failed:', err))

  return { ok: true }
}
