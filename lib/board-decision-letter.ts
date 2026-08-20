// =====================================================================
// lib/board-decision-letter.ts
//
// under_review -> approval_sent, fully automatic: the instant every required
// document is approved (syncBoardWindow flips the application to
// under_review — see lib/board-review.ts), MAIA generates the board
// decision / approval letter itself, using the association's default
// signers (its top `required_signatures` board officers), opens a
// signature-reminder round, and emails whoever isn't already signed their
// link — the exact same steps the manual "Create & send" flow already took,
// just no longer waiting for someone to press the button. User direction,
// 2026-08-20 (Rule 4).
//
// The context-loading + letter-creation + invitation-sending logic here is
// shared with the manual staff flow (app/api/admin/pre-apply/[id]/
// decision-page/route.ts and its /send route both call into this file) —
// a staff-created letter and an auto-created one can never diverge.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { signEsignToken } from '@/lib/esign-token'
import { extractLeaseDetails } from '@/lib/lease-extract'
import { sendEmail } from '@/lib/gmail'
import { BOARD_EMAIL_CC } from '@/lib/board-review-email'

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))

const rolePriority = (role: string | null): number => {
  const r = (role ?? '').toLowerCase()
  if (r.includes('president') && !r.includes('vice')) return 0
  if (r.includes('vice')) return 1
  if (r.includes('secretary')) return 2
  if (r.includes('treasurer')) return 3
  return 4
}

export interface DecisionContext {
  applicationId: string
  unitLabel: string | null
  applicationType: string
  code: string
  legal: string
  propertyAddress: string | null
  applicant: string | null
  required: number
  board: { name: string | null; email: string | null; role: string | null; signature_image: string | null }[]
  occupants: string[]
  leaseStart: string | null
  leaseEnd: string | null
}

export async function loadDecisionContext(applicationId: string): Promise<DecisionContext | null> {
  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('association_code, application_type, unit_label').eq('id', applicationId).maybeSingle()
  if (!app) return null
  const code = String(app.association_code)
  const [{ data: assoc }, { data: sh }, { data: members }, { data: cfg }, { data: tenant }] = await Promise.all([
    supabaseAdmin.from('associations').select('legal_name, association_name, principal_address, city, state, zip').eq('association_code', code).maybeSingle(),
    supabaseAdmin.from('application_stakeholders').select('name, is_primary').eq('application_id', applicationId).eq('role', 'applicant').order('is_primary', { ascending: false }).order('created_at', { ascending: true }),
    supabaseAdmin.from('association_board_members').select('name, email, role, signature_image').eq('association_code', code).eq('active', true),
    supabaseAdmin.from('association_config').select('required_signatures').eq('association_code', code).maybeSingle(),
    supabaseAdmin.from('unit_tenant_contacts').select('occupants, lease_start, lease_end').eq('association_code', code).eq('unit_ref', app.unit_label ?? '').maybeSingle(),
  ])
  const legal = (assoc?.legal_name as string | null) || (assoc?.association_name as string | null) || code
  const addr = [assoc?.principal_address, app.unit_label ? `Unit ${app.unit_label}` : null, [assoc?.city, [assoc?.state, assoc?.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ')
  const applicantNames = ((sh ?? []) as { name: string | null }[]).map(s => String(s.name ?? '').trim()).filter(Boolean)
  const applicant = applicantNames[0] ?? null
  const tenantOcc = Array.isArray(tenant?.occupants) ? (tenant!.occupants as Array<{ name?: string } | string>).map(o => typeof o === 'string' ? o : o?.name).filter(Boolean) as string[] : []
  const occ = tenantOcc.length ? tenantOcc : applicantNames
  const required = Math.max(1, (cfg?.required_signatures as number | null) ?? 1)
  const ordered = (members ?? []).slice().sort((a, b) => rolePriority(a.role as string) - rolePriority(b.role as string))

  let leaseStart = (tenant?.lease_start as string | null) ?? null
  let leaseEnd = (tenant?.lease_end as string | null) ?? null
  if (!leaseStart || !leaseEnd) {
    const { data: lease } = await supabaseAdmin.from('application_documents').select('storage_path, mime_type').eq('application_id', applicationId).eq('doc_key', 'signed_lease').maybeSingle()
    if (lease?.storage_path) {
      const { data: blob } = await supabaseAdmin.storage.from('application-docs').download(String(lease.storage_path))
      if (blob) {
        const d = await extractLeaseDetails(Buffer.from(await blob.arrayBuffer()), (lease.mime_type as string | null) ?? null).catch(() => null)
        if (d) { leaseStart = leaseStart || d.leaseStart; leaseEnd = leaseEnd || d.leaseEnd }
      }
    }
  }
  return {
    applicationId, unitLabel: (app.unit_label as string | null) ?? null, applicationType: String(app.application_type),
    code, legal, propertyAddress: addr || null, applicant, required, board: ordered,
    occupants: occ, leaseStart, leaseEnd,
  }
}

export interface LetterSigner { role: string; name: string | null; email: string | null }
export interface CreatedLetter { docId: string; allSigned: boolean; signers: LetterSigner[] }

export async function createBoardDecisionLetter(c: DecisionContext, opts: {
  decision?: string; conditions?: string; leaseStart?: string; leaseEnd?: string; occupants?: string[]
  signers: { name?: string | null; email?: string | null }[]
  createdBy: string
}): Promise<CreatedLetter | { error: string }> {
  const chosen = opts.signers.map(x => ({ name: x.name?.trim() || null, email: (x.email ?? '').trim() })).filter(x => x.email.includes('@'))
  if (chosen.length === 0) return { error: 'No signer emails — set board officers (with a President) in Board setup or enter emails.' }

  const occupants = (opts.occupants ?? []).map(o => String(o).trim()).filter(Boolean)
  const payload = {
    associationLegalName: c.legal, propertyAddress: c.propertyAddress, applicant: c.applicant,
    occupants: occupants.length ? occupants : (c.applicant ? [c.applicant] : []),
    unit: c.unitLabel, applicationType: c.applicationType,
    decision: opts.decision?.trim() || 'Approved', conditions: opts.conditions?.trim() || null,
    leaseStart: opts.leaseStart || c.leaseStart || null, leaseEnd: opts.leaseEnd || c.leaseEnd || null,
  }

  const now = new Date().toISOString()
  const sigByEmail = new Map(c.board.map(m => [String(m.email).toLowerCase(), m.signature_image]))
  const signers = chosen.map((x, i) => {
    const onFile = sigByEmail.get(x.email.toLowerCase()) ?? null
    const base = { role: `approver_${i + 1}`, name: x.name, email: x.email, phone: null as string | null }
    return onFile
      ? { ...base, signed_at: now, sig_name: x.name, sig_image: onFile, sig_ip: null, verification: { email: x.email, emailVerifiedAt: now } }
      : base
  })
  const allSigned = signers.every(sg => 'signed_at' in sg)

  const { data: created, error } = await supabaseAdmin.from('esign_documents').insert({
    kind: 'board_decision', association_code: c.code, unit_ref: c.unitLabel, application_id: c.applicationId,
    title: `Board Decision — ${c.propertyAddress ?? `Unit ${c.unitLabel ?? ''}`}`.trim(),
    payload, signers, status: allSigned ? 'completed' : (signers.some(sg => 'signed_at' in sg) ? 'partially_signed' : 'sent'),
    created_by: opts.createdBy,
  }).select('id').single()
  if (error || !created) return { error: `Could not create: ${error?.message ?? 'unknown'}` }

  await supabaseAdmin.from('listing_applications').update({ review_note: `Board Decision Page — ${signers.filter(sg => 'signed_at' in sg).length}/${signers.length} signed`, updated_at: now }).eq('id', c.applicationId)

  return { docId: String(created.id), allSigned, signers: signers.map(sg => ({ role: sg.role, name: sg.name, email: sg.email })) }
}

/** Email each unsigned signer their signing link — CC'd to the office so
 *  staff see exactly what's going out to the board, now that this can fire
 *  with no one pressing "send". User direction, 2026-08-20. */
export async function sendSignerInvitations(docId: string): Promise<{ sent: number; to: string[]; note?: string }> {
  const { data: doc } = await supabaseAdmin.from('esign_documents').select('id, title, signers, payload').eq('id', docId).maybeSingle()
  if (!doc) return { sent: 0, to: [] }
  const signers = Array.isArray(doc.signers) ? (doc.signers as Array<{ role: string; name: string | null; email: string | null; signed_at?: string }>) : []
  const pending = signers.filter(s => !s.signed_at && (s.email ?? '').includes('@'))
  if (pending.length === 0) return { sent: 0, to: [], note: 'All signers have already signed.' }

  const address = (doc.payload as { propertyAddress?: string } | null)?.propertyAddress ?? ''
  const to: string[] = []
  for (const s of pending) {
    const link = `${APP}/esign/${await signEsignToken(docId, s.role)}`
    try {
      await sendEmail({
        to: [String(s.email)], cc: BOARD_EMAIL_CC,
        subject: `Please sign — ${doc.title}`,
        html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.6;max-width:520px">
          <p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#f26a1b;font-weight:700;margin:0 0 4px">PMI Top Florida Properties</p>
          <h2 style="margin:0 0 8px;color:#1f2a44">Board approval letter — signature requested</h2>
          <p>Hello ${esc(s.name ?? 'Board Member')}, the approval letter${address ? ` for <strong>${esc(address)}</strong>` : ''} is ready for your signature.</p>
          <p><a href="${link}" style="display:inline-block;background:#059669;color:#fff;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:8px">Review &amp; sign the letter →</a></p>
          <p style="color:#9aa0ab;font-size:12px">You'll see the full letter before you sign. This link is unique to you.</p>
        </div>`,
      })
      to.push(String(s.email))
    } catch { /* keep going; report count */ }
  }
  return { sent: to.length, to }
}

/** Track who still needs to sign, separately from the old per-document
 *  review round — recipients come from the LETTER's own signers, not the
 *  board_members/building_managers roster the old manual round used, so the
 *  reminder chases the actual people who need to sign THIS letter. */
export async function startSignatureReminderRound(c: DecisionContext, signers: LetterSigner[]): Promise<string | null> {
  const recipients = signers.filter(s => (s.email ?? '').includes('@')).map(s => ({ name: s.name, email: s.email, role: 'board' }))
  if (!recipients.length) return null
  const { data, error } = await supabaseAdmin.from('document_review_rounds').insert({
    application_id: c.applicationId, association_code: c.code, unit_label: c.unitLabel,
    token: crypto.randomUUID(), recipients, purpose: 'signature_reminder', started_by: 'auto',
  }).select('id').single()
  return error || !data ? null : String(data.id)
}

/** The orchestrator — call once, right after syncBoardWindow reports the
 *  application just became complete. Best-effort and self-contained: any
 *  failure here is swallowed rather than thrown, since this runs inline in
 *  the staff/board document-decision routes and must never break the
 *  decision the caller just recorded. */
export async function advanceToApprovalSent(applicationId: string): Promise<void> {
  try {
    const c = await loadDecisionContext(applicationId)
    if (!c) return
    const defaultSigners = c.board.slice(0, c.required).map(m => ({ name: m.name, email: m.email }))
    const created = await createBoardDecisionLetter(c, { signers: defaultSigners, createdBy: 'auto' })
    if ('error' in created) return

    await startSignatureReminderRound(c, created.signers)

    const { data: flipped } = await supabaseAdmin.from('listing_applications')
      .update({ status: 'approval_sent', updated_at: new Date().toISOString() })
      .eq('id', applicationId).eq('status', 'under_review').select('id')
    if (!flipped?.length) return

    if (!created.allSigned) await sendSignerInvitations(created.docId)
  } catch { /* best-effort */ }
}
