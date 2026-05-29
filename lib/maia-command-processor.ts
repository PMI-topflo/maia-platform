import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'
import { logEmail } from '@/lib/email-logger'
import { fetchStaffList } from '@/lib/staff-list'
import { signAssignToken } from '@/lib/ticket-assign-tokens'
import {
  createTicket,
  findOpenTicketByGmailThread,
  findOpenTicketBySubject,
  appendMessage,
  type TicketPriority,
  type TicketType,
} from '@/lib/tickets'
import {
  fetchGmailMessage,
  fetchGmailThread,
  fetchGmailAttachmentData,
  type GmailFullMessage,
  type GmailMessagePart,
} from '@/lib/gmail'
import { buildSkillsPromptBlock } from '@/lib/skills'
import { buildOfficeHoursBlock } from '@/lib/office-hours'
import { saveWorkOrderAttachmentBytes, isImageFilename } from '@/lib/work-order-attachments'
import { isValidTicketCategory } from '@/lib/ticket-categories'

// ── Constants ─────────────────────────────────────────────────────────────────

const ALLOWED_DOMAINS = ['@topfloridaproperties.com', '@pmitop.com', '@mypmitop.com']

const TRIGGER_PHRASES = [
  '@maia please add to the database',
  '@maia add new owner',
  '@maia add to db',
  '@maia add owner',
  '@maia new tenant',
  '@maia add tenant',
  '@maia add agent',
  '@maia add vendor',
  '@maia add board member',
  '@maia update owner',
  '@maia update unit',
  '@maia update db',
  '@maia new owner',
  '@maia update board members',
  '@maia update board',
]

const MAIA_EMAIL = 'maia@pmitop.com'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExtractedRecord {
  record_type:       'owner' | 'tenant' | 'board_member' | 'agent' | 'vendor' | null
  association_code:  string | null
  unit_number:       string | null
  entity_name:       string | null
  first_name:        string | null
  last_name:         string | null
  email:             string | null
  phone:             string | null
  address:           string | null
  notes:             string | null
  missing_fields:    string[]
  additional_people?: Array<{
    first_name: string | null
    last_name:  string | null
    email:      string | null
    phone:      string | null
  }>
}

interface UpsertResult {
  table:            string
  recordId:         string
  assocName?:       string | null
  isTransfer?:      boolean
  previousOwner?:   { id: number; name: string; email: string | null; endDate: string; leaseStart?: string | null }
  hasActiveTenants?: boolean
}

export interface ParsedEmail {
  messageId:    string
  threadId:     string
  rfcMessageId: string
  /** Gmail internalDate — epoch milliseconds as a string. When the
   *  message was received by the mailbox, regardless of when MAIA
   *  processed it. Used to spot a backlog replay of genuinely-old mail. */
  internalDate: string
  sender:       string
  senderEmail:  string
  senderName:   string
  subject:      string
  body:         string
  to:           string[]
  cc:           string[]
  attachments:  Array<{ filename: string; mimeType: string; attachmentId: string; size: number }>
}

// ── Header / address helpers ──────────────────────────────────────────────────

function hdr(headers: Array<{ name: string; value: string }>, name: string): string {
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''
}

function parseAddress(raw: string): { name: string; email: string } {
  const m = raw.match(/^(.+?)\s*<([^>]+)>$/)
  if (m) return { name: m[1].trim().replace(/^"|"$/g, ''), email: m[2].trim().toLowerCase() }
  return { name: '', email: raw.trim().toLowerCase() }
}

function parseAddressList(raw: string): string[] {
  if (!raw) return []
  const parts: string[] = []
  let depth = 0, cur = ''
  for (const ch of raw) {
    if (ch === '<') depth++
    if (ch === '>') depth--
    if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = '' }
    else cur += ch
  }
  if (cur.trim()) parts.push(cur.trim())
  return parts.filter(Boolean)
}

// ── Body decoder ──────────────────────────────────────────────────────────────

function b64url(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
}

function extractParts(parts: GmailMessagePart[] | undefined): { plain: string; html: string } {
  let plain = '', html = ''
  if (!parts) return { plain, html }
  for (const p of parts) {
    if (p.mimeType === 'text/plain' && p.body.data) plain += b64url(p.body.data)
    else if (p.mimeType === 'text/html' && p.body.data) html += b64url(p.body.data)
    else if (p.parts) {
      const sub = extractParts(p.parts)
      plain += sub.plain; html += sub.html
    }
  }
  return { plain, html }
}

function collectAttachments(parts: GmailMessagePart[] | undefined): ParsedEmail['attachments'] {
  const out: ParsedEmail['attachments'] = []
  if (!parts) return out
  for (const p of parts) {
    if (p.filename && p.body.attachmentId) {
      out.push({ filename: p.filename, mimeType: p.mimeType, attachmentId: p.body.attachmentId, size: p.body.size })
    }
    if (p.parts) out.push(...collectAttachments(p.parts))
  }
  return out
}

// ── Gmail message → ParsedEmail ───────────────────────────────────────────────

export function parseGmailMessage(msg: GmailFullMessage): ParsedEmail {
  const headers = msg.payload.headers
  const sender  = hdr(headers, 'From')
  const parsed  = parseAddress(sender)

  let body = ''
  if (msg.payload.body?.data) {
    body = b64url(msg.payload.body.data)
  } else {
    const { plain, html } = extractParts(msg.payload.parts)
    body = plain || html
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&#64;/g, '@')
      .replace(/&commat;/gi, '@')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/ /g, ' ')   // non-breaking space
      .replace(/\s+/g, ' ')
      .trim()
  }
  // Normalize non-breaking spaces from plain text sources too
  body = body.replace(/ /g, ' ')

  return {
    messageId:    msg.id,
    threadId:     msg.threadId,
    rfcMessageId: hdr(headers, 'Message-ID'),
    internalDate: msg.internalDate ?? '',
    sender,
    senderEmail:  parsed.email,
    senderName:   parsed.name,
    subject:      hdr(headers, 'Subject'),
    body,
    to:           parseAddressList(hdr(headers, 'To')).map(a => parseAddress(a).email).filter(Boolean),
    cc:           parseAddressList(hdr(headers, 'Cc')).map(a => parseAddress(a).email).filter(Boolean),
    attachments:  collectAttachments(msg.payload.parts),
  }
}

// ── Sender / trigger checks ───────────────────────────────────────────────────

export function isAllowedSender(email: string): boolean {
  return ALLOWED_DOMAINS.some(d => email.toLowerCase().endsWith(d))
}

function detectTrigger(body: string): string | null {
  // Normalize whitespace so "@maia\nupdate db" matches "@maia update db"
  const lower = body.toLowerCase().replace(/\s+/g, ' ')
  return TRIGGER_PHRASES.find(p => lower.includes(p)) ?? null
}

// Infer a DB command from subject/body keywords.
// For authorized senders: subject keywords alone are sufficient (no @maia required).
// For all others: @maia must also be present.
function inferTrigger(subject: string, body: string, senderAllowed = false): string | null {
  const combined = (subject + ' ' + body).toLowerCase().replace(/\s+/g, ' ')
  const hasMaia  = combined.includes('@maia') || combined.includes('maia@pmitop.com')

  // Authorized senders with ownership keywords in subject trigger without @maia
  const subjectLow = subject.toLowerCase()
  if (senderAllowed) {
    if (/new owner|owner transfer|transfer of ownership|new buyer|new purchaser/.test(subjectLow)) return '@maia add owner'
    if (/new tenant|new renter|new lease|tenant transfer/.test(subjectLow))                        return '@maia add tenant'
    if (/new board member/.test(subjectLow))                                                        return '@maia add board member'
    if (/new agent|real estate agent/.test(subjectLow))                                             return '@maia add agent'
    if (/new vendor/.test(subjectLow))                                                              return '@maia add vendor'
  }

  // Without @maia require explicit mention
  if (!hasMaia) return null

  if (/new owner|owner transfer|transfer of ownership|new buyer|new purchaser/.test(combined)) return '@maia add owner'
  if (/new tenant|new renter|new lease|tenant transfer/.test(combined))                        return '@maia add tenant'
  if (/new board member/.test(combined))                                                        return '@maia add board member'
  if (/new agent|real estate agent/.test(combined))                                             return '@maia add agent'
  if (/new vendor/.test(combined))                                                              return '@maia add vendor'
  return null
}

// ── Reference code ────────────────────────────────────────────────────────────

function genRef(): string {
  const d    = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `PMI-${d}-${rand}`
}

// ── Claude extraction ─────────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `You are MAIA, the PMI Top Florida Properties database assistant.
Extract structured data from this email to add a new record to the database.

From the email subject, body, and any forwarded/quoted content, extract:
- record_type: "owner" | "tenant" | "board_member" | "agent" | "vendor"
- association_code: look for codes like ABBOTT, VENETIAN1, MACO, GLADES, PALM, etc. or association names. Return uppercase code only.
- unit_number: the unit/apt number (e.g. "101", "2B", "Unit 5")
- entity_name: company name if LLC/Corp (null if individual)
- first_name, last_name: primary contact name
- email: contact email address
- phone: contact phone number (digits only, no formatting)
- address: full property address
- notes: any additional relevant info

Rules:
- For record_type, infer from context:
  - @maia add owner / @maia update db / @maia new owner / subject has "NEW OWNER" / "TRANSFER OF OWNERSHIP" → "owner"
  - @maia add tenant / @maia new tenant / subject has "NEW TENANT" → "tenant"
  - @maia add board member → "board_member"
  - @maia add agent / @maia add vendor → infer accordingly
  - If the subject or body clearly indicates a new owner or property transfer, always use "owner" even if no explicit command phrase was given
- If you see multiple people (couple, co-owners), list the primary in main fields and extras in additional_people
- For association_code: account numbers like "ESSI16" combine association code + unit number. Extract the alphabetic prefix only: ESSI16 → "ESSI", ABBO5 → "ABBO", MACO12 → "MACO". If the code is clearly just letters (ABBOTT, MACO, PALM), return as-is
- missing_fields: list required fields you could NOT extract
  - owner requires: association_code, unit_number, first_name or entity_name, and email or phone
  - tenant requires: association_code, unit_number, first_name
  - board_member requires: association_code, first_name, last_name
  - agent/vendor require: first_name or entity_name, and email or phone

Return ONLY valid JSON, no markdown, no explanation:
{
  "record_type": "owner"|"tenant"|"board_member"|"agent"|"vendor"|null,
  "association_code": string|null,
  "unit_number": string|null,
  "entity_name": string|null,
  "first_name": string|null,
  "last_name": string|null,
  "email": string|null,
  "phone": string|null,
  "address": string|null,
  "notes": string|null,
  "missing_fields": string[],
  "additional_people": [{"first_name":string|null,"last_name":string|null,"email":string|null,"phone":string|null}]|null
}`

async function extractWithClaude(emailContent: string): Promise<ExtractedRecord> {
  const message = await anthropic.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system:     SYSTEM_PROMPT,
    messages:   [{ role: 'user', content: emailContent }],
  })

  const text = message.content.find(b => b.type === 'text')?.text ?? '{}'

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    return JSON.parse(jsonMatch ? jsonMatch[0] : text) as ExtractedRecord
  } catch {
    return {
      record_type:    null,
      association_code: null,
      unit_number:    null,
      entity_name:    null,
      first_name:     null,
      last_name:      null,
      email:          null,
      phone:          null,
      address:        null,
      notes:          null,
      missing_fields: ['parse_error'],
    }
  }
}

// ── Supabase upsert ───────────────────────────────────────────────────────────

interface UpsertContext {
  commandId?:      string | null
  actorEmail?:     string | null
  gmailMessageId?: string | null
}

async function upsertRecord(ext: ExtractedRecord, ctx?: UpsertContext): Promise<UpsertResult> {
  if (!ext.record_type) throw new Error('record_type is null')

  const code = ext.association_code?.toUpperCase() ?? null

  let assocName: string | null = code
  if (code) {
    const { data } = await supabaseAdmin
      .from('associations')
      .select('association_name')
      .eq('association_code', code)
      .maybeSingle()
    assocName = data?.association_name ?? code
  }

  switch (ext.record_type) {
    case 'owner': {
      const today   = new Date().toISOString().slice(0, 10)
      const newName = ext.entity_name || [ext.first_name, ext.last_name].filter(Boolean).join(' ') || 'New Owner'

      // Find existing active owner at this unit
      type PrevRow = { id: number; first_name: string | null; last_name: string | null; entity_name: string | null; emails: string | null }
      let prevOwner: PrevRow | null = null
      if (code && ext.unit_number) {
        // Use "IS DISTINCT FROM" logic: status != 'previous' OR status IS NULL
        const { data } = await supabaseAdmin
          .from('owners')
          .select('id, first_name, last_name, entity_name, emails')
          .eq('association_code', code)
          .eq('unit_number', ext.unit_number)
          .or('status.neq.previous,status.is.null')
          .order('id', { ascending: false })
          .limit(1)
          .maybeSingle()
        prevOwner = (data as PrevRow | null) ?? null
      }

      const prevName = prevOwner
        ? ([prevOwner.first_name, prevOwner.last_name].filter(Boolean).join(' ') || prevOwner.entity_name || 'Previous Owner')
        : null

      // Archive previous owner
      if (prevOwner) {
        await supabaseAdmin
          .from('owners')
          .update({
            status:             'previous',
            ownership_end_date: today,
            transferred_to:     newName,
          })
          .eq('id', prevOwner.id)
      }

      // Check for active tenants at this unit
      let hasActiveTenants = false
      if (code && ext.unit_number) {
        const { data: tenants } = await supabaseAdmin
          .from('association_tenants')
          .select('id')
          .eq('association_code', code)
          .eq('unit_number', ext.unit_number)
          .limit(1)
        hasActiveTenants = (tenants?.length ?? 0) > 0
      }

      // Insert new owner
      // When entity_name is set (LLC/Corp), use it as first_name so it's stored
      const insertFirstName = ext.entity_name ?? ext.first_name
      const insertLastName  = ext.entity_name ? (ext.first_name ? `${ext.first_name} ${ext.last_name ?? ''}`.trim() : ext.last_name) : ext.last_name

      const { data, error } = await supabaseAdmin
        .from('owners')
        .insert({
          association_code:     code,
          association_name:     assocName,
          unit_number:          ext.unit_number,
          entity_name:          ext.entity_name ?? null,
          first_name:           insertFirstName,
          last_name:            insertLastName,
          emails:               ext.email,
          phone:                ext.phone,
          address:              ext.address,
          status:               'active',
          ownership_start_date: today,
          transferred_from:     prevName,
        })
        .select('id')
        .single()
      if (error) throw new Error(`owners: ${error.message}`)

      // Record the transfer event in the explicit audit log. Fire-and-
      // log on error: a failed history insert shouldn't roll back the
      // owner mutation we just successfully landed.
      const { error: ohErr } = await supabaseAdmin
        .from('ownership_history')
        .insert({
          association_code:        code,
          unit_number:             ext.unit_number,
          previous_owner_id:       prevOwner?.id        ?? null,
          previous_owner_name:     prevName             ?? null,
          previous_owner_emails:   prevOwner?.emails    ?? null,
          new_owner_id:            data.id,
          new_owner_name:          newName,
          new_owner_emails:        ext.email            ?? null,
          transfer_date:           today,
          source:                  'maia_email',
          actor_email:             ctx?.actorEmail      ?? null,
          maia_email_command_id:   ctx?.commandId       ?? null,
          gmail_message_id:        ctx?.gmailMessageId  ?? null,
        })
      if (ohErr) console.error('[MAIA owner-transfer] ownership_history insert failed:', ohErr.message)

      return {
        table:    'owners',
        recordId: String(data.id),
        assocName,
        isTransfer:      !!prevOwner,
        hasActiveTenants,
        previousOwner: prevOwner ? { id: prevOwner.id, name: prevName!, email: prevOwner.emails ?? null, endDate: today } : undefined,
      }
    }

    case 'tenant': {
      const today   = new Date().toISOString().slice(0, 10)
      const newName = [ext.first_name, ext.last_name].filter(Boolean).join(' ') || 'New Tenant'

      // Find existing active tenant at this unit
      type PrevTenantRow = { id: number; first_name: string | null; last_name: string | null; email: string | null; lease_start_date: string | null }
      let prevTenant: PrevTenantRow | null = null
      if (code && ext.unit_number) {
        const { data } = await supabaseAdmin
          .from('association_tenants')
          .select('id, first_name, last_name, email, lease_start_date')
          .eq('association_code', code)
          .eq('unit_number', ext.unit_number)
          .not('status', 'in', '("previous","expired")')
          .maybeSingle()
        prevTenant = (data as PrevTenantRow | null) ?? null
      }

      const prevTenantName = prevTenant
        ? ([prevTenant.first_name, prevTenant.last_name].filter(Boolean).join(' ') || 'Previous Tenant')
        : null

      if (prevTenant) {
        await supabaseAdmin
          .from('association_tenants')
          .update({ status: 'previous', lease_end_date: today, transferred_to: newName })
          .eq('id', prevTenant.id)

        void supabaseAdmin.from('tenant_history').insert({
          tenant_id: prevTenant.id, association_code: code, unit_number: ext.unit_number,
          tenant_name: prevTenantName, action: 'archived', reason: 'new_tenant_added', performed_by: 'maia',
        })
      }

      const { data, error } = await supabaseAdmin
        .from('association_tenants')
        .insert({
          association_code:   code,
          association_name:   assocName,
          unit_number:        ext.unit_number,
          first_name:         ext.first_name,
          last_name:          ext.last_name,
          email:              ext.email,
          phone:              ext.phone,
          notes:              ext.notes,
          status:             'active',
          lease_start_date:   today,
          transferred_from:   prevTenantName,
          previous_tenant_id: prevTenant?.id ?? null,
          added_by:           'maia',
        })
        .select('id')
        .single()
      if (error) throw new Error(`association_tenants: ${error.message}`)

      void supabaseAdmin.from('tenant_history').insert({
        tenant_id: data.id, association_code: code, unit_number: ext.unit_number,
        tenant_name: newName, action: 'added', performed_by: 'maia',
        metadata: { transferred_from: prevTenantName },
      })

      return {
        table:    'association_tenants',
        recordId: String(data.id),
        assocName,
        isTransfer:    !!prevTenant,
        previousOwner: prevTenant ? { id: prevTenant.id, name: prevTenantName!, email: prevTenant.email ?? null, endDate: today, leaseStart: prevTenant.lease_start_date ?? null } : undefined,
      }
    }

    case 'board_member': {
      // The real table is `association_board_members` and it stores a
      // single `name` column + `role` (not first_name/last_name/position).
      // The original code wrote to a non-existent `board_members` table
      // — every "@maia add board member" silently errored on insert.
      const fullName = ext.entity_name
        || [ext.first_name, ext.last_name].filter(Boolean).join(' ').trim()
        || 'Board Member'
      const { data, error } = await supabaseAdmin
        .from('association_board_members')
        .insert({
          association_code: code,
          name:             fullName,
          email:            ext.email ?? null,
          active:           true,
        })
        .select('id')
        .single()
      if (error) throw new Error(`association_board_members: ${error.message}`)
      // Phone + notes captured by Claude don't have columns on this
      // table; surface them through the reply email so staff can route
      // manually if needed. (No data is lost — they remain in the
      // maia_email_commands.body_text and extracted_data JSON.)
      return { table: 'association_board_members', recordId: String(data.id) }
    }

    case 'agent': {
      const { data, error } = await supabaseAdmin
        .from('real_estate_agents')
        .insert({
          first_name:   ext.first_name,
          last_name:    ext.last_name,
          company_name: ext.entity_name,
          email:        ext.email,
          phone:        ext.phone,
          notes:        ext.notes,
        })
        .select('id')
        .single()
      if (error) throw new Error(`real_estate_agents: ${error.message}`)
      return { table: 'real_estate_agents', recordId: String(data.id) }
    }

    case 'vendor': {
      const { data, error } = await supabaseAdmin
        .from('vendors')
        .insert({
          company_name: ext.entity_name ?? [ext.first_name, ext.last_name].filter(Boolean).join(' '),
          first_name:   ext.first_name,
          last_name:    ext.last_name,
          email:        ext.email,
          phone:        ext.phone,
          notes:        ext.notes,
        })
        .select('id')
        .single()
      if (error) throw new Error(`vendors: ${error.message}`)
      return { table: 'vendors', recordId: String(data.id) }
    }
  }
}

// ── Attachment upload ─────────────────────────────────────────────────────────

async function uploadAttachment(
  messageId:  string,
  att:        ParsedEmail['attachments'][0],
  recordType: string | null,
): Promise<string | null> {
  try {
    const buf    = await fetchGmailAttachmentData(messageId, att.attachmentId)
    const bucket = recordType === 'vendor' ? 'vendor-docs'
      : recordType === 'owner' ? 'application-docs'
      : 'buyer-docs'
    const path = `maia-email/${Date.now()}-${att.filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`

    const { error } = await supabaseAdmin.storage
      .from(bucket)
      .upload(path, buf, { contentType: att.mimeType, upsert: false })

    if (error) { console.error('[MAIA] Attachment upload:', error.message); return null }

    return supabaseAdmin.storage.from(bucket).getPublicUrl(path).data.publicUrl
  } catch (err) {
    console.error('[MAIA] Attachment error:', err)
    return null
  }
}

// ── Reply HTML ────────────────────────────────────────────────────────────────

async function notifyBoardOfNewTenant(associationCode: string, assocName: string | null, unitNumber: string | null, tenantName: string): Promise<void> {
  // Was querying the wrong table — `board_members` doesn't exist; the
  // real table is `association_board_members`. Email column also gained
  // a NULL-able state in the recent migration, hence the filter.
  const { data: board } = await supabaseAdmin
    .from('association_board_members')
    .select('email')
    .eq('association_code', associationCode)
    .eq('active', true)
    .not('email', 'is', null)
  const emails = (board ?? []).map(b => b.email).filter(Boolean) as string[]
  if (!emails.length) return

  const unit    = unitNumber ? `Unit ${unitNumber}` : 'a unit'
  const subject = `New Tenant Application — ${unit} at ${assocName ?? associationCode}`
  const html    = `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#222;max-width:600px;margin:0 auto;padding:20px">
<p>Dear Board Members,</p>
<p>A new tenant application has been submitted for <strong>${unit}</strong> at <strong>${assocName ?? associationCode}</strong>.</p>
<p><strong>Tenant:</strong> ${tenantName}</p>
<p>This tenant requires board approval before move-in. Please review and approve:</p>
<p><a href="https://www.pmitop.com/board" style="background:#f26a1b;color:white;padding:10px 20px;text-decoration:none;border-radius:4px;font-weight:600">Review Application →</a></p>
<p style="color:#6b7280;font-size:12px">— MAIA, PMI Top Florida Properties</p>
</body></html>`

  void sendEmail({ to: emails, subject, html })
}

function tenantTransitionHtml(opts: {
  ext:         ExtractedRecord
  assocName:   string | null
  prevTenant:  { name: string; email: string | null; leaseStart: string | null; endDate: string }
  today:       string
  ref:         string
  files:       Array<{ filename: string; url: string | null }>
}): string {
  const { ext, assocName, prevTenant, today, ref, files } = opts
  const newName   = [ext.first_name, ext.last_name].filter(Boolean).join(' ') || '—'
  const unit      = ext.unit_number ? `Unit ${ext.unit_number}` : ''
  const filesHtml = files.length
    ? files.map(f => `<li>${f.filename}${f.url ? ` — <a href="${f.url}" style="color:#f26a1b">view</a>` : ' (upload failed)'}</li>`).join('')
    : '<li>None</li>'

  return `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#222;max-width:600px;margin:0 auto;padding:20px">
<div style="border-left:4px solid #22c55e;padding-left:16px;margin-bottom:24px">
  <p style="font-size:18px;font-weight:600;margin:0">✅ Tenant Transition Complete!</p>
  <p style="color:#6b7280;margin:4px 0 0">${assocName ?? ext.association_code ?? '—'}${unit ? ` — ${unit}` : ''}</p>
</div>
<p style="font-weight:600;color:#6b7280;text-transform:uppercase;font-size:11px;letter-spacing:.08em;margin-bottom:4px">Previous Tenant (access removed)</p>
<table style="width:100%;border-collapse:collapse;margin-bottom:20px">
  <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600;width:140px">Name</td><td style="padding:8px 12px;border:1px solid #e5e7eb">${prevTenant.name}</td></tr>
  <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600">Email</td><td style="padding:8px 12px;border:1px solid #e5e7eb">${prevTenant.email ?? '—'}</td></tr>
  <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600">Lease period</td><td style="padding:8px 12px;border:1px solid #e5e7eb">${prevTenant.leaseStart ?? '—'} → ${prevTenant.endDate}</td></tr>
</table>
<p style="font-weight:600;color:#6b7280;text-transform:uppercase;font-size:11px;letter-spacing:.08em;margin-bottom:4px">New Tenant (pending board approval)</p>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px">
  <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600;width:140px">Name</td><td style="padding:8px 12px;border:1px solid #e5e7eb">${newName}</td></tr>
  <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600">Email</td><td style="padding:8px 12px;border:1px solid #e5e7eb">${ext.email ?? '—'}</td></tr>
  <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600">Phone</td><td style="padding:8px 12px;border:1px solid #e5e7eb">${ext.phone ?? '—'}</td></tr>
  <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600">Lease start</td><td style="padding:8px 12px;border:1px solid #e5e7eb">${today}</td></tr>
  <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600">Documents</td><td style="padding:8px 12px;border:1px solid #e5e7eb"><ul style="margin:0;padding-left:16px">${filesHtml}</ul></td></tr>
</table>
<div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:4px;padding:12px 16px;margin-bottom:20px">
  <strong>⚠️ Action Needed:</strong> New tenant requires board approval before move-in.
  <p style="margin:8px 0 0"><a href="https://www.pmitop.com/admin?search=${encodeURIComponent(newName)}" style="color:#f26a1b;font-weight:600">Approve here →</a></p>
</div>
<p style="color:#6b7280;font-size:12px">Reference: ${ref}</p>
<p style="color:#6b7280;font-size:12px">— MAIA, PMI Top Florida Properties</p>
</body></html>`
}

function tenantCourtesyHtml(tenantName: string, assocName: string | null, unit: string | null, endDate: string): string {
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#222;max-width:600px;margin:0 auto;padding:20px">
<p>Dear ${tenantName},</p>
<p>This is a courtesy notice to let you know that your tenancy record for <strong>${unit ? `Unit ${unit}` : 'your unit'}</strong> at <strong>${assocName ?? 'your association'}</strong> has been updated in our system. Your lease ended on ${endDate}.</p>
<p>If you have any questions, please contact PMI Top Florida Properties:</p>
<ul>
  <li>Email: <a href="mailto:PMI@topfloridaproperties.com">PMI@topfloridaproperties.com</a></li>
  <li>Phone: 305.900.5077</li>
</ul>
<p style="color:#6b7280;font-size:12px">— PMI Top Florida Properties</p>
</body></html>`
}

function transferHtml(opts: {
  ext:              ExtractedRecord
  assocName:        string | null
  prevOwner:        { name: string; email: string | null; endDate: string }
  today:            string
  ref:              string
  files:            Array<{ filename: string; url: string | null }>
  hasActiveTenants: boolean
}): string {
  const { ext, assocName, prevOwner, today, ref, files, hasActiveTenants } = opts
  const newName   = [ext.first_name, ext.last_name].filter(Boolean).join(' ') || ext.entity_name || '—'
  const unit      = ext.unit_number ? `Unit ${ext.unit_number}` : ''
  const filesHtml = files.length
    ? files.map(f => `<li>${f.filename}${f.url ? ` — <a href="${f.url}" style="color:#f26a1b">view</a>` : ' (upload failed)'}</li>`).join('')
    : '<li>None</li>'
  const tenantsWarning = hasActiveTenants
    ? `<div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:4px;padding:12px 16px;margin:16px 0">
        <strong>⚠️ Action Needed:</strong> This unit has active tenants. Please confirm their status with the new owner.
       </div>`
    : ''

  return `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#222;max-width:600px;margin:0 auto;padding:20px">
<div style="border-left:4px solid #22c55e;padding-left:16px;margin-bottom:24px">
  <p style="font-size:18px;font-weight:600;margin:0">✅ Ownership Transfer Complete!</p>
  <p style="color:#6b7280;margin:4px 0 0">Unit: ${assocName ?? ext.association_code ?? '—'}${unit ? ` — ${unit}` : ''}</p>
</div>
<p style="font-weight:600;color:#6b7280;text-transform:uppercase;font-size:11px;letter-spacing:.08em;margin-bottom:4px">Previous Owner (access removed)</p>
<table style="width:100%;border-collapse:collapse;margin-bottom:20px">
  <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600;width:120px">Name</td><td style="padding:8px 12px;border:1px solid #e5e7eb">${prevOwner.name}</td></tr>
  <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600">Email</td><td style="padding:8px 12px;border:1px solid #e5e7eb">${prevOwner.email ?? '—'}</td></tr>
  <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600">Period ended</td><td style="padding:8px 12px;border:1px solid #e5e7eb">${prevOwner.endDate}</td></tr>
</table>
<p style="font-weight:600;color:#6b7280;text-transform:uppercase;font-size:11px;letter-spacing:.08em;margin-bottom:4px">New Owner (access granted)</p>
<table style="width:100%;border-collapse:collapse;margin-bottom:20px">
  <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600;width:120px">Name</td><td style="padding:8px 12px;border:1px solid #e5e7eb">${newName}</td></tr>
  <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600">Email</td><td style="padding:8px 12px;border:1px solid #e5e7eb">${ext.email ?? '—'}</td></tr>
  <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600">Phone</td><td style="padding:8px 12px;border:1px solid #e5e7eb">${ext.phone ?? '—'}</td></tr>
  <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600">Ownership start</td><td style="padding:8px 12px;border:1px solid #e5e7eb">${today}</td></tr>
  <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600">Documents</td><td style="padding:8px 12px;border:1px solid #e5e7eb"><ul style="margin:0;padding-left:16px">${filesHtml}</ul></td></tr>
</table>
${tenantsWarning}
<p><a href="https://www.pmitop.com/admin?search=${encodeURIComponent(newName)}" style="background:#f26a1b;color:white;padding:10px 20px;text-decoration:none;border-radius:4px;font-weight:600">View New Owner Record →</a></p>
<p style="color:#6b7280;font-size:12px;margin-top:24px">Reference: ${ref}</p>
<p style="color:#6b7280;font-size:12px">— MAIA, PMI Top Florida Properties</p>
</body></html>`
}

function courtesyHtml(prevOwnerName: string, assocName: string | null, unit: string | null, endDate: string): string {
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#222;max-width:600px;margin:0 auto;padding:20px">
<p>Dear ${prevOwnerName},</p>
<p>This is a courtesy notice to let you know that your ownership record for <strong>${unit ? `Unit ${unit}` : 'your unit'}</strong> at <strong>${assocName ?? 'your association'}</strong> has been updated in our system as of ${endDate}.</p>
<p>If you have any questions about this update, please contact PMI Top Florida Properties:</p>
<ul>
  <li>Email: <a href="mailto:PMI@topfloridaproperties.com">PMI@topfloridaproperties.com</a></li>
  <li>Phone: 305.900.5077</li>
</ul>
<p>Thank you.</p>
<p style="color:#6b7280;font-size:12px">— PMI Top Florida Properties</p>
</body></html>`
}

function successHtml(ext: ExtractedRecord, ref: string, files: Array<{ filename: string; url: string | null }>): string {
  const contactName = [ext.first_name, ext.last_name].filter(Boolean).join(' ') || '—'
  const displayName = ext.entity_name
    ? `${ext.entity_name}${contactName !== '—' ? ` (${contactName})` : ''}`
    : contactName
  const labelMap: Record<string, string> = { owner: 'Unit Owner', tenant: 'Tenant', board_member: 'Board Member', agent: 'Real Estate Agent', vendor: 'Vendor' }
  const label     = labelMap[ext.record_type ?? ''] ?? ext.record_type ?? 'Record'
  const filesHtml = files.length
    ? files.map(f => `<li>${f.filename}${f.url ? ` — <a href="${f.url}" style="color:#f26a1b">view</a>` : ' (upload failed)'}</li>`).join('')
    : '<li>None</li>'

  return `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#222;max-width:600px;margin:0 auto;padding:20px">
<div style="border-left:4px solid #22c55e;padding-left:16px;margin-bottom:24px">
  <p style="font-size:18px;font-weight:600;margin:0">✅ Done! I've added the following to the database.</p>
</div>
<table style="width:100%;border-collapse:collapse;margin-bottom:20px">
  <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600;width:140px">Record type</td><td style="padding:8px 12px;border:1px solid #e5e7eb">${label}</td></tr>
  <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600">Name</td><td style="padding:8px 12px;border:1px solid #e5e7eb">${displayName}</td></tr>
  <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600">Association</td><td style="padding:8px 12px;border:1px solid #e5e7eb">${ext.association_code ?? '—'}${ext.unit_number ? ` — Unit ${ext.unit_number}` : ''}</td></tr>
  <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600">Email</td><td style="padding:8px 12px;border:1px solid #e5e7eb">${ext.email ?? '—'}</td></tr>
  <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600">Phone</td><td style="padding:8px 12px;border:1px solid #e5e7eb">${ext.phone ?? '—'}</td></tr>
  <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600">Documents</td><td style="padding:8px 12px;border:1px solid #e5e7eb"><ul style="margin:0;padding-left:16px">${filesHtml}</ul></td></tr>
</table>
<p><a href="https://www.pmitop.com/admin?search=${encodeURIComponent(displayName)}" style="background:#f26a1b;color:white;padding:10px 20px;text-decoration:none;border-radius:4px;font-weight:600">View &amp; Edit Record →</a></p>
<p style="color:#6b7280;font-size:12px;margin-top:24px">Reference: ${ref}</p>
<p style="color:#6b7280;font-size:12px">— MAIA, PMI Top Florida Properties</p>
</body></html>`
}

function incompleteHtml(ext: ExtractedRecord, ref: string): string {
  const missingHtml = (ext.missing_fields ?? []).map(f => `<li>${f.replace(/_/g, ' ')}</li>`).join('')

  return `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#222;max-width:600px;margin:0 auto;padding:20px">
<div style="border-left:4px solid #f59e0b;padding-left:16px;margin-bottom:24px">
  <p style="font-size:18px;font-weight:600;margin:0">⚠️ Received your request, but couldn't extract all required information.</p>
</div>
<p style="font-weight:600">What I found:</p>
<ul>
  <li>Association: ${ext.association_code ?? 'not found'}</li>
  <li>Name: ${[ext.first_name, ext.last_name].filter(Boolean).join(' ') || ext.entity_name || 'not found'}</li>
  <li>Unit: ${ext.unit_number ?? 'not found'}</li>
</ul>
<p style="font-weight:600">What I still need:</p>
<ul>${missingHtml || '<li>Unable to determine record type</li>'}</ul>
<p>Please reply with the missing information and I'll complete the record.</p>
<p style="color:#6b7280;font-size:12px;margin-top:24px">Reference: ${ref}</p>
<p style="color:#6b7280;font-size:12px">— MAIA, PMI Top Florida Properties</p>
</body></html>`
}

// ── General AI responder ──────────────────────────────────────────────────────

// ---------------------------------------------------------------------
// Escalation routing — when MAIA can't fully resolve a request itself
// and instead forwards it to a human, this maps the department it picks
// to the assignee that owns the queue + whether to open a work order
// rather than a plain ticket. Overridable per env so PMI can re-route
// without redeploying.
// ---------------------------------------------------------------------
type EscalationDepartment = 'maintenance' | 'ap' | 'ar' | 'financial'

interface EscalationRoute {
  assignee:    string
  isWorkOrder: boolean
  teamLabel:   string   // shown back to the sender ("our maintenance team")
}

const ESCALATION_ROUTING: Record<EscalationDepartment, EscalationRoute> = {
  maintenance: {
    assignee:    process.env.MAIA_ROUTE_MAINTENANCE ?? 'service@topfloridaproperties.com',
    isWorkOrder: true,
    teamLabel:   'maintenance team',
  },
  ap: {
    assignee:    process.env.MAIA_ROUTE_AP ?? 'ap@topfloridaproperties.com',
    isWorkOrder: false,
    teamLabel:   'accounts-payable team',
  },
  ar: {
    assignee:    process.env.MAIA_ROUTE_AR ?? 'ar@topfloridaproperties.com',
    isWorkOrder: false,
    teamLabel:   'accounts-receivable team',
  },
  financial: {
    assignee:    process.env.MAIA_ROUTE_FINANCIAL ?? 'ar@topfloridaproperties.com',
    isWorkOrder: false,
    teamLabel:   'finance team',
  },
}

/** What MAIA returns from a freeform conversation — the structured
 *  decision plus the reply body to email back. */
interface MaiaDecision {
  action:     'resolved' | 'escalate'
  department: EscalationDepartment | null
  /** One of the labels in TICKET_CATEGORIES (lib/ticket-categories.ts).
   *  Only meaningful when action='escalate' AND department !== 'maintenance'
   *  (maintenance escalations become work orders, which carry a CINC
   *  work_order_type_name rather than a ticket_category). */
  category:   string | null
  reply:      string
}

/** Parse MAIA's structured JSON. Falls back to {action:'resolved'} on
 *  any malformed output so a brittle JSON pass never breaks the email
 *  reply path — we just lose the routing signal for that one message. */
function parseMaiaResponse(raw: string): MaiaDecision {
  const text = (raw ?? '').trim()
  // Strip ```json … ``` fences if the model wrapped them.
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  try {
    const obj = JSON.parse(cleaned) as Partial<MaiaDecision>
    const action: 'resolved' | 'escalate' = obj.action === 'escalate' ? 'escalate' : 'resolved'
    const dept = obj.department && obj.department in ESCALATION_ROUTING
      ? (obj.department as EscalationDepartment)
      : null
    const category = typeof obj.category === 'string' && isValidTicketCategory(obj.category)
      ? obj.category
      : null
    const reply = typeof obj.reply === 'string' && obj.reply.trim().length > 0
      ? obj.reply.trim()
      : text
    return {
      action,
      department: action === 'escalate' ? dept : null,
      category:   action === 'escalate' ? category : null,
      reply,
    }
  } catch {
    return { action: 'resolved', department: null, category: null, reply: text }
  }
}

const ESCALATION_INSTRUCTION = `

RESPONSE FORMAT — IMPORTANT:
You MUST respond with a single JSON object and nothing else. No prose around it, no markdown fences. The schema:
{
  "action": "resolved" | "escalate",
  "department": "maintenance" | "ap" | "ar" | "financial" | null,
  "category": "<one of the staff categories below>" | null,
  "reply": "the full email body to send back to the sender (plain text or simple HTML, ready to be wrapped in <p> tags)"
}

Use "resolved" when you can fully answer from the FAQ / company info. The reply is the answer. (department + category null)
Use "escalate" when the request needs a human:
  - Maintenance / repair / work order (leak, broken AC, common-area issue) → "maintenance" (a work order will be opened; leave category null)
  - Vendor invoice, payment to a vendor, W-9, ACH form, vendor onboarding → "ap"
  - Owner balance, missed payment, payment plan, ledger, late fees, owner refund → "ar"
  - Budget question, reserve study, assessment / special-assessment, audited financials → "financial"
  - Anything else needing a human decision → department: null

When escalating to a TICKET (any department except "maintenance"), also pick the staff category that best routes the ticket. Use exactly one of these label strings, copied verbatim:
  - "Resident Support"                 (Resident assistance)
  - "Violations & Compliance"          (Rule enforcement)
  - "Architectural Review (ARC/ACC)"   (Modification approvals)
  - "Financial & Billing"              (Accounting matters)
  - "Security & Safety"                (Security incidents)
  - "Vendor Management"                (Vendor coordination)
  - "Insurance & Claims"               (Claims/issues)
  - "Legal & Collections"              (Attorney/legal matters)
  - "Communications"                   (Notices & announcements)
  - "Amenity Reservations"             (Clubhouse/pool/etc)
  - "Move-In / Move-Out"               (Tenant/owner logistics)
  - "Parking & Towing"                 (Vehicle issues)
  - "Access Control"                   (Gate/cards/fobs)
  - "Utilities"                        (Utility-related concerns)
  - "Emergency Incidents"              (Critical escalations)
  - "Technology / Systems"             (Software, internet, cameras)
  - "Concierge / Front Desk"           (Hospitality-type requests)
If no category clearly fits, set category to null.

When escalating, the "reply" field is a WARM HUMAN ACKNOWLEDGEMENT ONLY — thank the sender, confirm you have the details, that's it. ONE short paragraph.
Do NOT use action verbs like "forwarded", "routed", "sent", "opened", "logged", "filed", "assigned", "escalated", or "passed along" — they imply you took an action you cannot actually take.
Do NOT mention which team will handle it, do NOT promise a response time, do NOT invent a ticket number.
The SYSTEM appends a verifiable footer to your reply with the real ticket number, the routed team, and the response-time SLA — duplicating that information in your text is wrong.
Example of a GOOD escalation reply: "Hi Ron — thanks for sending the Atlas invoice across. I have all the details I need from here."
Example of a BAD escalation reply: "Hi Ron — I've forwarded this to our AP team and they'll respond within one business day." (uses forbidden verbs AND duplicates the system footer).
Never invent figures, dates, or balances. Default to escalation when in doubt.`

const GENERAL_SYSTEM_PROMPT = `You are Maia, the AI assistant for PMI Top Florida Properties, a professional HOA and residential property management company serving South Florida.

COMPANY INFO:
- Phone: 305.900.5077
- Email: pmi@topfloridaproperties.com
- Service: service@topfloridaproperties.com
- Payments: ar@topfloridaproperties.com
- Portal: https://pmitfp.cincwebaxis.com/
- Apply: https://pmitopfloridaproperties.rentvine.com/public/apply?unitID=38
- Estoppel: https://secure.condocerts.com/resale/

FAQ KNOWLEDGE:
- Payments: ACH (no fee, 10th of month), online portal (fee), check to P.O. Box 163556 Miami FL 33116
- Maintenance: email service@topfloridaproperties.com with photos
- ARC requests: email support@topfloridaproperties.com with permits and documents
- Tenant/buyer approval: board approval required, background check required
- Estoppel: 5-7 business days via condocerts.com
- Balance: check at https://pmitfp.cincwebaxis.com/

INTERNAL STAFF COMMANDS:
You are also used internally by PMI staff to update the database. If this email appears to be from a PMI staff member (domain: @topfloridaproperties.com, @pmitop.com, @mypmitop.com) and contains owner/tenant/board/transfer information but no explicit command, instruct them to add "@maia" anywhere in the email body. You can infer the intent from the subject:
- Subject has "NEW OWNER" or "TRANSFER" → tell them to add "@maia" to trigger an owner update
- Subject has "NEW TENANT" or body has "new tenant" → tell them to add "@maia" to trigger a tenant update
Do NOT say you cannot access databases — you can, when the correct trigger is present.

RULES:
- Respond in English only
- Be professional and concise
- If unsure, direct to service@topfloridaproperties.com or 305.900.5077
- Never fabricate financial figures or legal details
- Never say you cannot access or update the PMI database — you can when triggered correctly
- Always sign as: Maia | PMI Top Florida Properties AI Assistant

TICKET & WORK ORDER RULES — STRICT, DO NOT BREAK:
- You CANNOT create, open, update, or close tickets or work orders by writing about them in a reply. They are only created by a separate code path that fires when the sender includes an exact trigger phrase at the start of the body — for example "@maia open ticket <details>" or "@maia open work order <details>".
- You CANNOT forward, route, send, escalate, hand off, or pass along email either. The system performs the actual routing (assigning a ticket to a team) on its own; your text must never claim you did so.
- NEVER write phrases that imply YOU took an action — "Work Order Created Successfully", "Ticket has been logged", "I've opened a work order", "I've forwarded this to our AP team", "I've routed your request", "I've sent this to maintenance", "I've passed it along", "I've assigned this to ...", "I've escalated this", etc. The SYSTEM appends a verifiable footer to your reply when a ticket actually gets opened (with the real number, the routed team, and the SLA). Your reply contains the human-facing acknowledgement ONLY.
- NEVER invent or echo a ticket / work-order number. Real ones look like "TKT-2026-NNNN" (created by the system, not by you). If you reference a number you saw in the conversation, only do so when quoting the sender — never as a confirmation of your own action.
- If a staff member asks you to create / open / log a ticket or work order but did NOT include the exact trigger phrase, your job is to instruct them to resend with one of these exact phrases at the top of the body:
    @maia open ticket <brief description>
    @maia open work order <brief description>
  Quote the exact phrase back to them so they can copy it. Do NOT pretend the request has been actioned.
- The same rules apply to UPDATING existing tickets. You cannot modify a ticket by writing about it. If asked, instruct the user to email "@maia append TKT-YYYY-NNNN" with their update.`

const AUTO_REPLY_SUBJECTS = ['out of office', 'auto-reply', 'automatic reply', 'delivery failed', 'undeliverable', 'autoreply']
const AUTO_REPLY_SENDERS  = ['maia@', 'noreply@', 'no-reply@', 'mailer-daemon@']

function describeAssociationType(t: string): string {
  switch (t) {
    case 'condo':            return 'residential condominium (governed by Florida Statutes Chapter 718)'
    case 'commercial_condo': return 'commercial / non-residential condominium (governed by Florida Statutes Chapter 718; voting and assessments often weighted by square footage; tenants are commercial lessees, not residential tenants)'
    case 'coop':             return 'cooperative — owners hold shares + a proprietary lease (governed by Florida Statutes Chapter 719)'
    case 'hoa':              return 'homeowners association (governed by Florida Statutes Chapter 720)'
    case 'master_hoa':       return 'master HOA — governs community-wide common areas above one or more sub-associations (still Florida Statutes Chapter 720, but at the umbrella level; unit-level rules belong to the sub-association)'
    default:                 return t
  }
}

// Cache association codes for the lifetime of the process to avoid repeated DB lookups
let _assocCodeCache: Array<{ code: string; name: string }> | null = null

// strict=true → only match explicit account-number patterns like "ESSI16"
// strict=false → also try bare code and association name (more false positives)
export async function detectAssociationCode(text: string, strict = false): Promise<string | null> {
  if (!_assocCodeCache) {
    const { data } = await supabaseAdmin
      .from('associations')
      .select('association_code, association_name')
      .eq('active', true)
    _assocCodeCache = (data ?? []).map((r: Record<string, unknown>) => ({
      code: String(r.association_code ?? ''),
      name: String(r.association_name ?? ''),
    }))
  }

  if (!_assocCodeCache) return null
  const cache = _assocCodeCache
  const upper = text.toUpperCase()

  // Most reliable: explicit account-number pattern (e.g. ESSI16 → ESSI, MANXI23 → MANXI)
  // Require prefix ≥ 3 chars to avoid "FL22" style false positives
  const acctMatch = upper.match(/\b([A-Z]{3,6})\d{1,3}\b/)
  if (acctMatch) {
    const prefix = acctMatch[1]
    const hit = cache.find(a => a.code === prefix)
    if (hit) return hit.code
  }

  // In strict mode we stop here — email logs use strict to avoid cross-contamination
  if (strict) return null

  // Bare code at word boundary, min 4 chars (loose — can still produce false positives)
  for (const a of cache) {
    if (a.code && a.code.length >= 4) {
      if (new RegExp(`\\b${a.code}\\b`).test(upper)) return a.code
    }
  }

  // Full association name at word boundary, min 6 chars
  for (const a of cache) {
    if (a.name && a.name.length >= 6) {
      const escaped = a.name.toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (new RegExp(`\\b${escaped}\\b`).test(upper)) return a.code
    }
  }

  return null
}

// Load PDF + image attachments as Claude content blocks so freeform replies
// reason from the actual document (invoices, photos, forms) instead of
// guessing from the email body alone. Caps total bytes and attachment count
// so a fwd of many huge files can't blow up tokens. Failures degrade to
// text-only on a per-attachment basis.
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const MAX_ATTACHMENT_COUNT = 5

type ClaudeImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
const SUPPORTED_IMAGE_TYPES = new Set<ClaudeImageMediaType>(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

function asImageMediaType(mt: string): ClaudeImageMediaType | null {
  return (SUPPORTED_IMAGE_TYPES as Set<string>).has(mt) ? (mt as ClaudeImageMediaType) : null
}

type ClaudeContentBlock =
  | { type: 'text';     text: string }
  | { type: 'image';    source: { type: 'base64'; media_type: ClaudeImageMediaType; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf';    data: string } }

async function loadAttachmentBlocks(parsed: ParsedEmail): Promise<ClaudeContentBlock[]> {
  if (parsed.attachments.length === 0) return []
  const blocks: ClaudeContentBlock[] = []
  let totalBytes = 0
  let count      = 0
  for (const att of parsed.attachments) {
    if (count >= MAX_ATTACHMENT_COUNT) break
    const mt    = att.mimeType.toLowerCase()
    const isPdf = mt === 'application/pdf'
    const img   = asImageMediaType(mt)
    if (!isPdf && !img) continue
    if (totalBytes + att.size > MAX_ATTACHMENT_BYTES) {
      console.warn(`[MAIA attach] skipping ${att.filename}: would exceed ${MAX_ATTACHMENT_BYTES}-byte cap`)
      continue
    }
    try {
      const buf  = await fetchGmailAttachmentData(parsed.messageId, att.attachmentId)
      const data = buf.toString('base64')
      if (isPdf) {
        blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } })
      } else if (img) {
        blocks.push({ type: 'image',    source: { type: 'base64', media_type: img,               data } })
      }
      totalBytes += att.size
      count++
    } catch (err) {
      console.warn(`[MAIA attach] fetch failed for ${att.filename}:`, err instanceof Error ? err.message : err)
    }
  }
  return blocks
}

async function handleGeneralEmailQuery(parsed: ParsedEmail): Promise<void> {
  // Loop guard: don't reply if MAIA already sent an outbound on this
  // exact gmail thread within the last 10 minutes. Stops self-perpetuating
  // signature loops where a quoted "MAIA" in a reply triggers another
  // reply, which contains "MAIA" in its signature, etc.
  if (parsed.threadId) {
    const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString()
    const { data: recentMaiaReply } = await supabaseAdmin
      .from('general_conversations')
      .select('id')
      .eq('gmail_thread_id', parsed.threadId)
      .eq('reply_sent', true)
      .gte('updated_at', tenMinAgo)
      .limit(1)
      .maybeSingle()
    if (recentMaiaReply) {
      console.warn(`[MAIA general] thread ${parsed.threadId}: skipping reply, already replied within 10m`)
      return
    }
  }

  // Global rate limit: hard cap of MAIA_FREEFORM_RATE_LIMIT freeform
  // replies in any rolling 5-minute window across ALL threads. Defaults
  // to 5. The user-configured Resend cap was the only thing that stopped
  // a 99-reply loop before this guard existed — this is the application-
  // level circuit breaker so we never depend on the upstream provider's
  // quota again. If hit, MAIA stops replying and logs a warning until
  // the window clears.
  const RATE_LIMIT  = Number(process.env.MAIA_FREEFORM_RATE_LIMIT ?? 5)
  const RATE_WINDOW = 5 * 60_000  // 5 minutes
  const windowStart = new Date(Date.now() - RATE_WINDOW).toISOString()
  const { count: recentRepliesCount } = await supabaseAdmin
    .from('general_conversations')
    .select('id', { count: 'exact', head: true })
    .eq('reply_sent', true)
    .gte('updated_at', windowStart)
  if ((recentRepliesCount ?? 0) >= RATE_LIMIT) {
    console.error(`[MAIA general] CIRCUIT BREAKER: ${recentRepliesCount} replies in last 5m exceeds limit of ${RATE_LIMIT} — skipping`)
    return
  }

  // Anti-loop: skip automated senders and auto-reply subjects
  if (AUTO_REPLY_SENDERS.some(s => parsed.senderEmail.toLowerCase().includes(s))) return
  const subjectLower = parsed.subject.toLowerCase()
  if (AUTO_REPLY_SUBJECTS.some(s => subjectLower.includes(s))) return

  // Try to detect association from subject/body without a full Claude extraction
  const detectedAssocCode = await detectAssociationCode(parsed.subject + ' ' + parsed.body)

  // Idempotency: log first to prevent double-processing on Pub/Sub retries
  const now = new Date().toISOString()
  const { data: convRow, error: convErr } = await supabaseAdmin
    .from('general_conversations')
    .insert({
      gmail_message_id: parsed.messageId,
      gmail_thread_id:  parsed.threadId,
      channel:          'email',
      sender_email:     parsed.senderEmail,
      sender_name:      parsed.senderName,
      subject:          parsed.subject,
      message:          parsed.body.slice(0, 4000),
      association_code: detectedAssocCode,
      status:           'processing',
      initiated_at:     now,
    })
    .select('id')
    .single()

  if (convErr) {
    if (convErr.code === '23505') return  // already processed
    console.error('[MAIA general] insert error:', convErr.message)
    return
  }

  try {
    // Pull the actual Gmail thread so Claude sees every prior turn —
    // staff replies, customer follow-ups, and exchanges from before MAIA
    // was wired up. The old general_conversations lookup only surfaced
    // MAIA's *own* prior replies, so human turns and pre-MAIA history
    // were invisible. Empty array on missing threadId or fetch failure →
    // single-message behaviour.
    const PRIOR_CAP    = 10
    const BODY_CAP     = 2000
    const threadMsgs   = parsed.threadId ? await fetchGmailThread(parsed.threadId) : []
    const priorParsed  = threadMsgs
      .filter(m => m.id !== parsed.messageId)
      .map(parseGmailMessage)
      .slice(-PRIOR_CAP)

    const priorBlock = priorParsed.length === 0 ? '' :
      '<conversation_history>\n' +
      priorParsed.map(p => {
        const isMaia = p.senderEmail === 'maia@pmitop.com'
        const who    = isMaia ? 'MAIA (you, previous reply)' : `${p.senderName || p.senderEmail}`
        return `--- ${who} ---\n${p.body.slice(0, BODY_CAP)}`
      }).join('\n\n') +
      '\n</conversation_history>\n\n'

    // Pull PDF/image attachments first so Claude sees the invoice/photo
    // before the email body text. The text block goes last in the user
    // turn so the model reasons "here is a doc … now here is what the
    // sender said about it."
    const attachmentBlocks = await loadAttachmentBlocks(parsed)
    const currentText = priorBlock +
      `From: ${parsed.senderName} <${parsed.senderEmail}>\n` +
      `Subject: ${parsed.subject}\n\n${parsed.body}`
    const messages = [
      {
        role:    'user' as const,
        content: [...attachmentBlocks, { type: 'text' as const, text: currentText }],
      },
    ]

    let assocBlock = ''
    if (detectedAssocCode) {
      const { data: assoc } = await supabaseAdmin
        .from('associations')
        .select('association_name, association_type')
        .eq('association_code', detectedAssocCode)
        .maybeSingle()
      if (assoc?.association_name) {
        assocBlock = `\n\nDETECTED ASSOCIATION: ${assoc.association_name} (${detectedAssocCode})`
        if (assoc.association_type) {
          assocBlock += `\nASSOCIATION TYPE: ${describeAssociationType(assoc.association_type)}`
        }
      }
    }

    const skillsBlock = await buildSkillsPromptBlock('internal')
    const officeBlock = buildOfficeHoursBlock()
    const message = await anthropic.messages.create({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system:     GENERAL_SYSTEM_PROMPT + assocBlock + officeBlock + skillsBlock + ESCALATION_INSTRUCTION,
      messages,
    })

    // Parse the structured response. action tells us whether to mark
    // the auto-ticket resolved or open it for the routed department;
    // reply is what we actually email the sender.
    const rawText  = message.content.find(b => b.type === 'text')?.text ?? ''
    const decision = parseMaiaResponse(rawText)
    const aiText   = decision.reply

    // ── Phase 1: create or update the MAIA-owned ticket FIRST ───────────
    // The reply needs to cite the real TKT-YYYY-NNNN, and the assignee
    // needs a notifyAssignee email, so we resolve the ticket BEFORE
    // composing the outbound text. Best-effort: if the ticket op throws,
    // we still send the reply (just without the ticket footer) instead
    // of stranding the sender with no acknowledgement.
    const routing = decision.action === 'escalate' && decision.department
      ? ESCALATION_ROUTING[decision.department]
      : null
    type ResolvedTicket = { id: number; ticket_number: string; type: string; subject: string | null }
    let resolvedTicket: ResolvedTicket | null = null
    let ticketIsNew = false
    try {
      const nowIso          = new Date().toISOString()
      const ticketStatus    = decision.action === 'resolved' ? 'resolved' : 'open'
      const ticketType      = routing?.isWorkOrder           ? 'work_order' : 'ticket'
      const ticketAssignee  = routing?.assignee              ?? 'maia@pmitop.com'
      const ticketPriority  = decision.action === 'resolved' ? 'low'        : 'normal'
      const ticketResolvedAt = decision.action === 'resolved' ? nowIso       : null
      // Categories only apply to plain tickets — work orders carry
      // work_order_type_name (from CINC) instead. So drop the category
      // for the maintenance branch even if MAIA picked one.
      const ticketCategory   = ticketType === 'work_order' ? null : (decision.category ?? null)

      const existing = parsed.threadId
        ? (await supabaseAdmin
            .from('tickets')
            .select('id, ticket_number, type, subject, ticket_category')
            .eq('gmail_thread_id', parsed.threadId)
            .eq('created_by_maia', true)
            .maybeSingle()).data as (ResolvedTicket & { ticket_category: string | null }) | null
        : null

      if (existing) {
        // Don't downgrade a work_order back to a ticket on update — once
        // staff (or MAIA) decided it was a WO, that classification
        // stays. Everything else reflects MAIA's latest read of the
        // thread. For ticket_category, only OVERWRITE when MAIA actually
        // picked one — never clobber a staff-set category with null.
        const preserveType = existing.type === 'work_order'
        const { data: updated } = await supabaseAdmin
          .from('tickets')
          .update({
            status:         ticketStatus,
            priority:       ticketPriority,
            assignee_email: ticketAssignee,
            resolved_at:    ticketResolvedAt,
            updated_at:     nowIso,
            ...(preserveType ? {} : { type: ticketType }),
            ...(ticketCategory && existing.type !== 'work_order' ? { ticket_category: ticketCategory } : {}),
          })
          .eq('id', existing.id)
          .select('id, ticket_number, type, subject')
          .single()
        resolvedTicket = (updated as ResolvedTicket | null) ?? existing
        ticketIsNew    = false
      } else {
        const { data: inserted } = await supabaseAdmin.from('tickets').insert({
          type:             ticketType,
          status:           ticketStatus,
          priority:         ticketPriority,
          channel_origin:   'email',
          association_code: detectedAssocCode,
          contact_name:     parsed.senderName,
          contact_email:    parsed.senderEmail?.toLowerCase() ?? null,
          subject:          parsed.subject,
          summary:          (parsed.body ?? '').slice(0, 800),
          assignee_email:   ticketAssignee,
          gmail_thread_id:  parsed.threadId,
          created_by_maia:  true,
          resolved_at:      ticketResolvedAt,
          ticket_category:  ticketCategory,
        }).select('id, ticket_number, type, subject').single()
        resolvedTicket = (inserted as ResolvedTicket | null)
        ticketIsNew    = true
      }
    } catch (tErr) {
      console.error('[MAIA general] auto-ticket insert failed:', tErr instanceof Error ? tErr.message : String(tErr))
    }

    // ── Phase 2: build the reply, with a verifiable footer on escalation ──
    // Escalations get a structured footer naming the ticket + team so the
    // sender can verify the action actually happened. Resolved replies
    // don't — the AI's reply already IS the answer.
    const isEscalation  = decision.action === 'escalate' && routing && resolvedTicket
    const ticketLabel   = resolvedTicket?.type === 'work_order' ? 'work order' : 'ticket'
    const ticketFooter  = isEscalation
      ? `<div style="margin:24px 0 0;padding:12px 16px;background:#f9fafb;border-left:3px solid #f26a1b">
<p style="margin:0 0 6px;color:#111827">I've opened ${ticketLabel} <a href="${APP_URL}/admin/tickets/${resolvedTicket!.id}" style="color:#f26a1b;text-decoration:none;font-family:ui-monospace,monospace;font-weight:600">${resolvedTicket!.ticket_number}</a> and routed it to our ${routing!.teamLabel}.</p>
<p style="margin:0;color:#6b7280;font-size:13px">They'll respond within one business day.</p>
</div>`
      : ''
    const replyHtml = `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#222;max-width:600px;margin:0 auto;padding:20px">
${aiText.split('\n').map(line => `<p style="margin:0 0 12px">${line}</p>`).join('')}
${ticketFooter}
<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
<p style="color:#6b7280;font-size:11px">This response was generated by AI. For urgent matters please call 305.900.5077.</p>
</body></html>`

    const replySubject = parsed.subject.startsWith('Re:') ? parsed.subject : `Re: ${parsed.subject}`

    const { messageId: replyMsgId } = await sendEmail({
      to:      parsed.senderEmail,
      subject: replySubject,
      html:    replyHtml,
      ...(parsed.rfcMessageId && {
        headers: { 'In-Reply-To': parsed.rfcMessageId, References: parsed.rfcMessageId },
      }),
    })

    void logEmail({
      direction: 'outbound',
      toEmail:   parsed.senderEmail,
      subject:   replySubject,
      fullBody:  replyHtml,
      persona:   'staff',
      status:    'sent',
      resendMessageId: replyMsgId,
      sentBy:    'maia-general',
      gmailThreadId: parsed.threadId,
    })

    // Append the AI's outbound reply to the same ticket so the dashboard
    // shows the full thread in one place. Awaited (not fire-and-forget) for
    // the same serverless reason described in processEmailCommand.
    await appendOutboundEmailToTicket({
      threadId:   parsed.threadId,
      toEmail:    parsed.senderEmail,
      subject:    replySubject,
      bodyHtml:   replyHtml,
      bodyText:   aiText,
      externalId: replyMsgId ?? null,
    })

    await supabaseAdmin
      .from('general_conversations')
      .update({
        response:    aiText,
        reply_sent:  true,
        status:      'sent',
        updated_at:  new Date().toISOString(),
      })
      .eq('id', convRow.id)

    // ── Phase 3: notify the assignee, but only on a NEW ticket ────────
    // Long threads that re-escalate (or flip resolved → escalate) update
    // the same MAIA-owned ticket row instead of inserting a second one;
    // we deliberately DON'T re-ping the assignee in that case — they
    // already know about the ticket and the new message is visible on
    // the dashboard's activity log.
    if (isEscalation && ticketIsNew && resolvedTicket) {
      await notifyAssignee(resolvedTicket, routing!.assignee, 'maia@pmitop.com')
    }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[MAIA general] error:', msg)
    await supabaseAdmin
      .from('general_conversations')
      .update({ status: 'failed', error_message: msg, updated_at: new Date().toISOString() })
      .eq('id', convRow.id)
    // Deliberately no ticket created on failure — only successful MAIA
    // resolutions become tickets, so "resolved by MAIA" is a clean
    // measure of value.
  }
}

// ── Ticket ingest ─────────────────────────────────────────────────────────────

// Phrases that, when present in the body of a staff-sent email, create a new
// ticket. Replies in an existing thread are always appended regardless of
// whether the trigger is present (it's already a ticket).
const TICKET_CREATE_TRIGGERS = [
  '@maia ct',
  '@maia create ticket',
  '@maia create a ticket',
  '@maia new ticket',
  '@maia ticket',
  '@maia open ticket',
  '@maia open a ticket',
  '@ticket',
  '@maia wo',
  '@maia work order',
  '@maia workorder',
  '@maia create work order',
  '@maia create a work order',
  '@maia new work order',
  '@maia open work order',
  '@maia open a work order',
  '@workorder',
  '@wo',
] as const

function detectTicketTrigger(body: string): boolean {
  const norm = ' ' + body.toLowerCase().replace(/\s+/g, ' ') + ' '
  return TICKET_CREATE_TRIGGERS.some(t => norm.includes(' ' + t + ' ') || norm.includes(t + '\n') || norm.includes(t + ',') || norm.includes(t + '.') || norm.includes(t + '!'))
}

// Invoice-intake triggers. Karen (or any staff member) forwards a
// vendor invoice PDF to maia@ with an @maia + "...invoice" instruction in
// the body to queue it for review in /admin/invoices. As of 2026-05-26
// this is the ONLY way an invoice enters intake — the old "any PDF to
// billing@ becomes an invoice" implicit routing was removed because it
// kept swallowing real @maia commands that were CC'd to billing@.
//
// Contiguous legacy forms (kept for back-compat):
const INVOICE_INTAKE_TRIGGERS = [
  '@maia process invoice',
  '@maia invoice',
  '@maia upload invoice',
] as const

// Flexible form. Real staff phrasing rarely matches the rigid contiguous
// triggers — e.g. Gmail renders the contact mention as "@Maia PMI AI
// AGENT", and people write "process THIS invoice", "pay this invoice",
// etc. This matches an @maia mention followed (allowing the mention
// wrapper + filler words like "this"/"the") by a process/pay-style verb
// and the word "invoice". Bounded to a single sentence (stops at a
// period) so it can't span an unrelated later clause, and it still
// requires an explicit AP-style verb so it doesn't swallow questions
// like "@maia what's the status of the Atlas invoice?".
const INVOICE_INTAKE_FLEX_REGEX =
  /@maia\b[^.\n]{0,40}\b(process|processing|upload|pay|submit|enter|log|record)\b[^.\n]{0,25}\binvoice/i

export function detectInvoiceTrigger(body: string): boolean {
  const norm = ' ' + body.toLowerCase().replace(/\s+/g, ' ') + ' '
  if (INVOICE_INTAKE_FLEX_REGEX.test(norm)) return true
  return INVOICE_INTAKE_TRIGGERS.some(t =>
    norm.includes(' ' + t + ' ') ||
    norm.includes(t + '\n') ||
    norm.includes(t + ',') ||
    norm.includes(t + '.') ||
    norm.includes(t + '!'),
  )
}

// Matches @maia append TKT-YYYY-NNNN (4+ digit suffix). Captures the
// ticket number so the caller can resolve it to a ticket id. Case
// insensitive on the keyword; the captured ticket_number is uppercased
// downstream before the DB lookup.
const APPEND_TRIGGER_REGEX = /@maia\s+append\s+(TKT-\d{4}-\d{4,})/i

function detectAppendTrigger(body: string): string | null {
  const m = body.match(APPEND_TRIGGER_REGEX)
  return m ? m[1].toUpperCase() : null
}

function appendNotFoundHtml(ticketNumber: string, requesterName: string): string {
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#222;max-width:600px;margin:0 auto;padding:20px">
<p style="margin-top:0">Hi ${requesterName || 'there'},</p>
<p>I couldn't find a ticket with the number <strong>${ticketNumber}</strong> to append your email to. Your message has NOT been added anywhere.</p>
<p style="font-size:14px">Double-check the ticket number — the format is <code>TKT-YYYY-NNNN</code> (look at the ticket header in <a href="https://www.pmitop.com/admin/tickets">/admin/tickets</a>). Resend with the correct number to retry.</p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0 12px">
<p style="color:#9ca3af;font-size:11px;margin:0">MAIA · PMI Top Florida Properties</p>
</body></html>`
}

interface TicketModifiers {
  assignee?: string
  priority?: TicketPriority
  type?:     TicketType
}

function parseTicketModifiers(body: string): TicketModifiers {
  const assignMatch   = body.match(/@assign\s+([\w._%+-]+@[\w.-]+\.[A-Za-z]{2,})/i)
  const priorityMatch = body.match(/@priority\s+(urgent|high|normal|low)/i)
  // Treat as a work order when either the bare `@workorder`/`@wo` modifier
  // appears, OR the trigger phrase itself referenced "work order" — e.g.
  // "@maia open a work order Electrical". The latter is how staff naturally
  // phrase it; without this, every "open work order" became a generic ticket.
  const typeMatch     = body.match(/@(?:work[\s_-]?order|wo)\b|@maia\s+(?:create\s+(?:a\s+)?|open\s+(?:a\s+)?|new\s+)?work[\s_-]?order\b/i)
  return {
    assignee: assignMatch?.[1]?.toLowerCase(),
    priority: priorityMatch ? (priorityMatch[1].toLowerCase() as TicketPriority) : undefined,
    type:     typeMatch     ? 'work_order'                                       : undefined,
  }
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'

async function notifyAssignee(
  ticket:        { id: number; ticket_number: string; subject: string | null; type: string },
  assigneeEmail: string,
  assignerEmail: string,
): Promise<void> {
  try {
    const label = ticket.type === 'work_order' ? 'work order' : 'ticket'
    await sendEmail({
      to:      assigneeEmail,
      subject: `🎫 You've been assigned ${ticket.ticket_number} — ${ticket.subject ?? '(no subject)'}`,
      html:    `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#222;max-width:600px;margin:0 auto;padding:20px">
<p style="font-size:14px;color:#555">${assignerEmail} has assigned you a ${label}:</p>
<div style="background:#f9fafb;border-left:3px solid #f26a1b;padding:12px 16px;margin:16px 0">
  <div style="font-family:ui-monospace,monospace;font-size:12px;color:#6b7280">${ticket.ticket_number}</div>
  <div style="font-size:16px;font-weight:600;margin-top:4px">${ticket.subject ?? '(no subject)'}</div>
</div>
<p style="font-size:14px;margin-top:24px">
  <a href="${APP_URL}/admin/tickets/${ticket.id}" style="background:#f26a1b;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;font-weight:500">Open ${label}</a>
</p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0 16px">
<p style="color:#9ca3af;font-size:11px">PMI Top Florida Properties · automated notification</p>
</body></html>`,
    })
  } catch (err) {
    console.error('[tickets] notifyAssignee failed:', err instanceof Error ? err.message : err)
  }
}

// ─────────────────────────────────────────────────────────────────────
// @maia update board members — two-step confirmation flow
//
// Unlike the other commands, board updates are not applied immediately.
// MAIA extracts the proposed change, looks up the affected association,
// stores a pending row, and emails the requester a preview with
// confirm/cancel magic links. Nothing touches association_board_members
// until the staff member clicks Confirm.
// ─────────────────────────────────────────────────────────────────────

interface ExtractedBoardUpdate {
  association_name: string | null
  association_code: string | null
  new_members: Array<{ name: string; role: string | null }>
  missing_fields: string[]
}

const BOARD_UPDATE_PROMPT = `You are MAIA, parsing a staff email that asks you to update the board of an association.
Extract:
- association_name: the association the email refers to (e.g. "Serenity Place IV", "Abbott Heights"). Pull from subject or body.
- association_code: optional short code like ABBOTT, VENETIAN1, MACO, PALM, ESSI if mentioned. Uppercase. Null if not present.
- new_members: an array of every person listed as a new/incoming board member.
  Each item: { name: string, role: string|null }. Role is the board position
  (President, Vice President, Treasurer, Secretary, Director, Member, etc.).
  If only a name is given without a role, set role=null. Do NOT invent roles.
- missing_fields: list any required field you could not extract.
    REQUIRED: association_name OR association_code, new_members (at least 1)

Return ONLY valid JSON, no markdown:
{
  "association_name": string|null,
  "association_code": string|null,
  "new_members": [{ "name": string, "role": string|null }],
  "missing_fields": string[]
}`

async function extractBoardUpdate(emailContent: string): Promise<ExtractedBoardUpdate> {
  const message = await anthropic.messages.create({
    model:       'claude-haiku-4-5-20251001',
    max_tokens:  1024,
    system:      BOARD_UPDATE_PROMPT,
    messages:    [{ role: 'user', content: emailContent }],
  })
  const text = (message.content[0] as { type: string; text: string }).text
  try {
    return JSON.parse(text) as ExtractedBoardUpdate
  } catch {
    return { association_name: null, association_code: null, new_members: [], missing_fields: ['parse-error'] }
  }
}

async function resolveAssociation(
  ext: ExtractedBoardUpdate,
): Promise<{ code: string; name: string } | null> {
  if (ext.association_code) {
    const code = ext.association_code.toUpperCase()
    const { data } = await supabaseAdmin
      .from('associations')
      .select('association_code, association_name')
      .eq('association_code', code)
      .maybeSingle()
    if (data) return { code: data.association_code, name: data.association_name ?? code }
  }
  if (ext.association_name) {
    // Case-insensitive substring match on association_name.
    const { data } = await supabaseAdmin
      .from('associations')
      .select('association_code, association_name')
      .ilike('association_name', `%${ext.association_name.trim()}%`)
      .limit(2)
    if (data && data.length === 1) return { code: data[0].association_code, name: data[0].association_name }
    // Multiple matches → require disambiguation (caller will reply asking for the code).
  }
  return null
}

function boardUpdatePreviewHtml(opts: {
  associationName: string
  current: Array<{ name: string; role: string | null }>
  proposed: Array<{ name: string; role: string | null }>
  confirmUrl: string
  cancelUrl: string
  expiresAtIso: string
}): string {
  const expires = new Date(opts.expiresAtIso).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  })
  const li = (m: { name: string; role: string | null }) =>
    `<li style="margin-bottom:4px">${m.name}${m.role ? ` <span style="color:#6b7280">— ${m.role}</span>` : ''}</li>`
  const currentList  = opts.current.length  > 0 ? `<ul style="margin:6px 0 12px 18px;padding:0">${opts.current.map(li).join('')}</ul>` : `<div style="color:#6b7280;font-style:italic;margin:6px 0 12px 0">(no active members on record)</div>`
  const proposedList = opts.proposed.length > 0 ? `<ul style="margin:6px 0 12px 18px;padding:0">${opts.proposed.map(li).join('')}</ul>` : `<div style="color:#6b7280;font-style:italic;margin:6px 0 12px 0">(none extracted)</div>`
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#222;max-width:600px;margin:0 auto;padding:20px">
<p style="font-size:14px;color:#555;margin-top:0">You asked to update the board for:</p>
<div style="font-size:18px;font-weight:600;margin-bottom:18px">${opts.associationName}</div>

<div style="font-size:13px;font-weight:600;color:#b91c1c;text-transform:uppercase;letter-spacing:.04em">Will be deactivated</div>
${currentList}

<div style="font-size:13px;font-weight:600;color:#15803d;text-transform:uppercase;letter-spacing:.04em">Will be added (active)</div>
${proposedList}

<div style="margin:24px 0 16px 0">
  <a href="${opts.confirmUrl}" style="background:#15803d;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;font-weight:500;margin-right:8px">Confirm and apply</a>
  <a href="${opts.cancelUrl}" style="background:#fff;color:#b91c1c;border:1px solid #b91c1c;padding:9px 19px;border-radius:4px;text-decoration:none;font-weight:500">Cancel</a>
</div>
<p style="color:#6b7280;font-size:12px;margin-top:18px">This request expires ${expires}. If you didn't ask for this, click Cancel — nothing is changed until you confirm.</p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0 12px">
<p style="color:#9ca3af;font-size:11px;margin:0">MAIA · PMI Top Florida Properties</p>
</body></html>`
}

function boardUpdateClarificationHtml(reason: string, requesterName: string): string {
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#222;max-width:600px;margin:0 auto;padding:20px">
<p style="font-size:14px;margin-top:0">Hi ${requesterName || 'there'},</p>
<p style="font-size:14px">I couldn't process your board-update request:</p>
<div style="background:#fef2f2;border-left:3px solid #b91c1c;padding:12px 16px;margin:12px 0;font-size:14px;color:#7f1d1d">${reason}</div>
<p style="font-size:14px">Reply with the missing info and I'll prepare a preview for you to confirm.</p>
<p style="font-size:14px;color:#6b7280">Example format:</p>
<pre style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:4px;padding:12px;font-size:12px;color:#374151;white-space:pre-wrap">@maia update board members
Association: Serenity Place IV
New board:
- Jane Doe — President
- John Smith — Treasurer
- Alice Adams — Secretary</pre>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0 12px">
<p style="color:#9ca3af;font-size:11px;margin:0">MAIA · PMI Top Florida Properties</p>
</body></html>`
}

async function handleBoardMembersUpdate(parsed: ParsedEmail): Promise<void> {
  const emailContent = `Subject: ${parsed.subject}\nFrom: ${parsed.sender}\n\n${parsed.body}`
  const ext          = await extractBoardUpdate(emailContent)

  const replyTo       = parsed.senderEmail
  const replySubject  = parsed.subject.startsWith('Re:') ? parsed.subject : `Re: ${parsed.subject}`
  const requesterName = parsed.senderName

  // Validation: require association + at least one new member.
  if (!ext.association_name && !ext.association_code) {
    await sendEmail({
      to: replyTo, subject: replySubject,
      html: boardUpdateClarificationHtml(`I couldn't identify which association this is for. Please include the association name or code.`, requesterName),
    })
    return
  }
  if (!ext.new_members || ext.new_members.length === 0) {
    await sendEmail({
      to: replyTo, subject: replySubject,
      html: boardUpdateClarificationHtml(`I couldn't find any new board members in your email. List each one on its own line with their position (e.g. "Jane Doe — President").`, requesterName),
    })
    return
  }

  const assoc = await resolveAssociation(ext)
  if (!assoc) {
    await sendEmail({
      to: replyTo, subject: replySubject,
      html: boardUpdateClarificationHtml(`I couldn't find an association matching "${ext.association_name ?? ext.association_code}" in the database. Please include a more specific name or the short code (e.g. ABBOTT, VENETIAN1).`, requesterName),
    })
    return
  }

  // Fetch CURRENT active board members for the preview.
  const { data: currentRows } = await supabaseAdmin
    .from('association_board_members')
    .select('name, role')
    .eq('association_code', assoc.code)
    .eq('active', true)
    .order('sort_order', { ascending: true })
  const current = (currentRows ?? []).map(r => ({ name: r.name, role: r.role }))

  // Persist the pending row. confirm_token defaults to a fresh uuid.
  const { data: pending, error: pErr } = await supabaseAdmin
    .from('maia_pending_board_updates')
    .insert({
      association_code: assoc.code,
      association_name: assoc.name,
      requester_email:  parsed.senderEmail,
      requester_name:   parsed.senderName || null,
      new_members:      ext.new_members,
      current_members:  current,
      gmail_message_id: parsed.messageId,
      gmail_thread_id:  parsed.threadId,
      reply_subject:    replySubject,
    })
    .select('confirm_token, expires_at')
    .single()
  if (pErr || !pending) {
    console.error('[MAIA board-update] insert pending failed:', pErr?.message)
    await sendEmail({
      to: replyTo, subject: replySubject,
      html: boardUpdateClarificationHtml(`Internal error saving the pending update. Please try again.`, requesterName),
    })
    return
  }

  const confirmUrl = `${APP_URL}/api/maia-email/board-update/confirm/${pending.confirm_token}`
  const cancelUrl  = `${APP_URL}/api/maia-email/board-update/cancel/${pending.confirm_token}`

  await sendEmail({
    to:      replyTo,
    subject: `${replySubject} — confirm board update for ${assoc.name}`,
    html:    boardUpdatePreviewHtml({
      associationName: assoc.name,
      current,
      proposed:        ext.new_members,
      confirmUrl,
      cancelUrl,
      expiresAtIso:    pending.expires_at,
    }),
  })
}

function makeInboundMessageInput(parsed: ParsedEmail) {
  return {
    direction:   'inbound' as const,
    channel:     'email'   as const,
    from_addr:   parsed.senderEmail,
    to_addr:     'maia@pmitop.com',
    subject:     parsed.subject,
    body:        parsed.body,
    external_id: parsed.rfcMessageId || parsed.messageId,
    attachments: parsed.attachments.map(a => ({
      filename: a.filename, mimeType: a.mimeType, size: a.size,
    })),
  }
}

// A bare ticket / work-order number (TKT-YYYY-NNNN) mentioned anywhere
// in the subject or body — no command keyword required. Used to auto-
// route an emailed photo onto a work order.
const TICKET_NUMBER_REGEX = /\bTKT-\d{4}-\d{4,}\b/i
function detectTicketNumberMention(text: string): string | null {
  const m = text.match(TICKET_NUMBER_REGEX)
  return m ? m[0].toUpperCase() : null
}

/** When an inbound email is linked to a WORK ORDER, copy its image
 *  attachments into work_order_attachments (source 'email') so they show
 *  up in the work order's Photos widget. No-op for regular tickets, for
 *  emails with no images, or when no attachment fetcher was supplied
 *  (the fetcher needs the right Gmail account's credentials). */
async function attachEmailPhotosToWorkOrder(
  ticketId:         number,
  parsed:           ParsedEmail,
  fetchAttachment?: (attachmentId: string) => Promise<Buffer>,
): Promise<void> {
  if (!fetchAttachment) return
  const images = parsed.attachments.filter(a => isImageFilename(a.filename))
  if (images.length === 0) return

  const { data: ticket } = await supabaseAdmin
    .from('tickets')
    .select('type')
    .eq('id', ticketId)
    .maybeSingle()
  if (!ticket || ticket.type !== 'work_order') return

  for (const att of images) {
    try {
      const bytes  = await fetchAttachment(att.attachmentId)
      const result = await saveWorkOrderAttachmentBytes({
        ticketId,
        source:          'email',
        bytes,
        filename:        att.filename,
        uploadedByEmail: parsed.senderEmail,
      })
      if (!result.ok) {
        console.error(`[wo-photos] email photo "${att.filename}" → WO ${ticketId} failed: ${result.error}`)
      }
    } catch (err) {
      console.error(`[wo-photos] email photo "${att.filename}" → WO ${ticketId} error:`,
        err instanceof Error ? err.message : err)
    }
  }
}

function mentionsMaiaInBody(body: string): boolean {
  const norm = body.toLowerCase()
  return norm.includes('@maia') || norm.includes('maia@pmitop.com')
}

/** Brief one-line "got it — appended to TKT-XXXX" reply. Sent after we
 *  silently fold an inbound email into an existing ticket so the sender
 *  knows where their message went instead of staring at an empty inbox.
 *  Caller decides whether to invoke — vendor reply-threads should stay
 *  silent (their original reason for silent-append). */
async function sendAppendAck(
  ticket: { id: number; ticket_number: string; type: string },
  parsed: ParsedEmail,
): Promise<void> {
  try {
    const label   = ticket.type === 'work_order' ? 'work order' : 'ticket'
    const subject = parsed.subject.startsWith('Re:') ? parsed.subject : `Re: ${parsed.subject}`
    const html    = `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#222;max-width:600px;margin:0 auto;padding:20px">
<p style="margin-top:0">Got it — appended to <a href="${APP_URL}/admin/tickets/${ticket.id}" style="color:#f26a1b;text-decoration:none;font-family:ui-monospace,monospace">${ticket.ticket_number}</a>.</p>
<p style="color:#6b7280;font-size:12px;margin:6px 0 0">This ${label} already existed for this email thread, so your message was added to it rather than opening a duplicate.</p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px">
<p style="color:#9ca3af;font-size:11px;margin:0">MAIA · PMI Top Florida Properties</p>
</body></html>`
    const { messageId } = await sendEmail({
      to:      parsed.senderEmail,
      subject,
      html,
      ...(parsed.rfcMessageId && {
        headers: { 'In-Reply-To': parsed.rfcMessageId, References: parsed.rfcMessageId },
      }),
    })
    void logEmail({
      direction:       'outbound',
      toEmail:         parsed.senderEmail,
      subject,
      fullBody:        html,
      persona:         'staff',
      status:          'sent',
      resendMessageId: messageId,
      sentBy:          'maia-append-ack',
      gmailThreadId:   parsed.threadId,
    })
  } catch (err) {
    console.warn('[tickets] sendAppendAck failed:', err instanceof Error ? err.message : err)
  }
}

/** Email-to-ticket ingest. Called by both the main MAIA webhook and the
 *  staff-Gmail webhook so logic stays in one place.
 *
 *  Rules:
 *    - Staff senders only (caller passes `allowed=true` to enable ticket
 *      creation; external senders just get logged in email_logs).
 *    - Replies in an existing ticket thread (gmail_thread_id match) are
 *      always appended — no trigger needed for replies.
 *    - New tickets require an explicit trigger phrase in the body
 *      (TICKET_CREATE_TRIGGERS).
 *    - Subject-match: a second "@maia ticket" email about the same subject
 *      from the same contact within 30 days appends to the open ticket
 *      instead of creating a duplicate.
 *    - Inline modifiers (`@assign`, `@priority`, `@workorder`) are parsed
 *      from the body and applied at create time. `@assign` triggers a
 *      courtesy notification email to the new assignee. */
export async function ingestInboundEmailToTicket(
  parsed:    ParsedEmail,
  allowed:   boolean,
  assocCode: string | null,
  // Downloads one of `parsed`'s attachments by id. Supplied by the
  // caller because it needs the right Gmail account's credentials
  // (env creds for maia@, a per-account token for staff inboxes).
  // When omitted, emailed work-order photos are simply not ingested.
  fetchAttachment?: (attachmentId: string) => Promise<Buffer>,
): Promise<void> {
  if (!allowed) return

  try {
    // 0. Explicit @maia append TKT-YYYY-NNNN → append to the named ticket.
    //    Wins over both thread-reply and subject-match because staff are
    //    explicitly targeting a specific ticket (typical use: forwarding
    //    a vendor estimate into an existing work order). On a typo we
    //    reply so the email content isn't silently lost.
    const appendTo = detectAppendTrigger(parsed.body)
    if (appendTo) {
      const { data: target } = await supabaseAdmin
        .from('tickets')
        .select('id, ticket_number, type')
        .eq('ticket_number', appendTo)
        .maybeSingle()
      if (!target) {
        await sendEmail({
          to:      parsed.senderEmail,
          subject: parsed.subject.startsWith('Re:') ? parsed.subject : `Re: ${parsed.subject}`,
          html:    appendNotFoundHtml(appendTo, parsed.senderName),
        })
        return
      }
      // appendMessage returns null when (channel, external_id) already
      // exists — a Pub/Sub retry or dual-mailbox re-processing of the
      // same Gmail message. We MUST skip the ack in that case; otherwise
      // each redelivery sends another ack. Production hit 18 acks for one
      // inbound on 2026-05-25 because the ack was unconditional.
      const appended = await appendMessage(target.id, makeInboundMessageInput(parsed))
      await attachEmailPhotosToWorkOrder(target.id, parsed, fetchAttachment)
      // Explicit @maia append → ack on first delivery only.
      if (appended) await sendAppendAck(target, parsed)
      return
    }

    // 1. Reply in existing thread → append, no trigger required.
    if (parsed.threadId) {
      const existing = await findOpenTicketByGmailThread(parsed.threadId)
      if (existing) {
        const appended = await appendMessage(existing.id, makeInboundMessageInput(parsed))
        await attachEmailPhotosToWorkOrder(existing.id, parsed, fetchAttachment)
        // Two gates: (1) only ack when staff explicitly invoked @maia
        // (vendor reply-threads stay silent — original reason for silent
        // append), (2) only on first delivery — see comment above.
        if (appended && mentionsMaiaInBody(parsed.body)) {
          await sendAppendAck(existing, parsed)
        }
        return
      }
    }

    // 1.5 Auto-route by a bare TKT-YYYY-NNNN mentioned in the subject or
    //     body — only when it resolves to a WORK ORDER. Lets a vendor's
    //     photo email land on the work order without the @maia command,
    //     as long as the WO number appears somewhere (MAIA puts it in the
    //     subject of every work-order email it sends).
    const mentioned = detectTicketNumberMention(`${parsed.subject} ${parsed.body}`)
    if (mentioned) {
      const { data: woTarget } = await supabaseAdmin
        .from('tickets')
        .select('id, type')
        .eq('ticket_number', mentioned)
        .maybeSingle()
      if (woTarget && woTarget.type === 'work_order') {
        await appendMessage(woTarget.id, makeInboundMessageInput(parsed))
        await attachEmailPhotosToWorkOrder(woTarget.id, parsed, fetchAttachment)
        return
      }
    }

    // 2. New tickets only when a trigger phrase is present.
    if (!detectTicketTrigger(parsed.body)) return

    // 3. Subject-match dedupe across separate threads.
    const existingBySubject = await findOpenTicketBySubject(parsed.subject, parsed.senderEmail)
    if (existingBySubject) {
      const appended = await appendMessage(existingBySubject.id, makeInboundMessageInput(parsed))
      await attachEmailPhotosToWorkOrder(existingBySubject.id, parsed, fetchAttachment)
      // Staff intent confirmed by detectTicketTrigger above; ack on
      // first delivery only — see comment in the explicit-append path.
      if (appended) await sendAppendAck(existingBySubject, parsed)
      return
    }

    // For ticket creation, prefer loose association detection — staff write
    // the association name on purpose ("For Serenity Place IV") so we can
    // match by name, not just account-number patterns. This overrides the
    // strict-mode result that the caller passes in (which it uses for
    // email_logs to avoid customer-mention cross-contamination).
    const looseAssoc = await detectAssociationCode(parsed.subject + ' ' + parsed.body, false).catch(() => null)
    const finalAssocCode = looseAssoc ?? assocCode

    // 4. Create new ticket with parsed modifiers.
    const mods   = parseTicketModifiers(parsed.body)
    const ticket = await createTicket({
      type:             mods.type ?? 'ticket',
      channel_origin:   'email',
      priority:         mods.priority,
      association_code: finalAssocCode,
      persona:          'staff',
      contact_name:     parsed.senderName || null,
      contact_email:    parsed.senderEmail,
      subject:          parsed.subject,
      summary:          parsed.body.slice(0, 280),
      gmail_thread_id:  parsed.threadId || null,
      assignee_email:   mods.assignee,
    })
    await appendMessage(ticket.id, makeInboundMessageInput(parsed))
    await attachEmailPhotosToWorkOrder(ticket.id, parsed, fetchAttachment)

    if (mods.assignee) {
      await notifyAssignee(ticket, mods.assignee, parsed.senderEmail)
    } else {
      // No explicit @assign — send a triage email back to the sender with
      // one-click buttons for each staff member. Forces a quick decision so
      // the ticket doesn't sit unassigned.
      await sendTriageEmail(ticket, parsed.senderEmail)
    }
  } catch (err) {
    console.error('[tickets] ingest inbound email failed:', err instanceof Error ? err.message : err)
  }
}

async function sendTriageEmail(
  ticket:      { id: number; ticket_number: string; subject: string | null; type: string },
  toEmail:     string,
): Promise<void> {
  try {
    const staff = await fetchStaffList()
    if (staff.length === 0) {
      console.warn(`[tickets] triage email skipped — no staff in pmi_staff for ${ticket.ticket_number}`)
      return
    }

    const label = ticket.type === 'work_order' ? 'Work order' : 'Ticket'

    // Build one button per staff member + a "keep it for myself" button.
    const tokens = await Promise.all(staff.map(async s => ({
      ...s,
      token: await signAssignToken(ticket.id, s.email),
    })))
    const selfToken = await signAssignToken(ticket.id, toEmail)

    const buttonStyle = 'display:inline-block;background:#f9fafb;border:1px solid #e5e7eb;color:#111827;padding:10px 14px;margin:4px 4px 4px 0;border-radius:6px;text-decoration:none;font-size:13px;font-weight:500'
    const meStyle     = 'display:inline-block;background:#f26a1b;color:#fff;padding:10px 14px;margin:4px 4px 4px 0;border-radius:6px;text-decoration:none;font-size:13px;font-weight:500'

    const buttons = tokens.map(s => {
      const link = `${APP_URL}/api/tickets/${ticket.id}/assign?to=${encodeURIComponent(s.email)}&token=${s.token}`
      const subtitle = s.role ? ` <span style="color:#9ca3af;font-weight:400">· ${s.role}</span>` : ''
      return `<a href="${link}" style="${buttonStyle}">${escapeHtml(s.name)}${subtitle}</a>`
    }).join('')

    const meLink = `${APP_URL}/api/tickets/${ticket.id}/assign?to=${encodeURIComponent(toEmail.toLowerCase())}&token=${selfToken}`

    await sendEmail({
      to:      toEmail,
      subject: `🎫 ${ticket.ticket_number} needs an assignee — ${ticket.subject ?? '(no subject)'}`,
      html:    `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#222;max-width:600px;margin:0 auto;padding:20px">
<p style="font-size:14px;color:#555">${label} created — please pick who should handle this:</p>
<div style="background:#f9fafb;border-left:3px solid #f26a1b;padding:12px 16px;margin:16px 0">
  <div style="font-family:ui-monospace,monospace;font-size:12px;color:#6b7280">${ticket.ticket_number}</div>
  <div style="font-size:16px;font-weight:600;margin-top:4px">${escapeHtml(ticket.subject ?? '(no subject)')}</div>
</div>
<div style="margin:20px 0">
  ${buttons}
</div>
<div style="margin:20px 0;padding-top:16px;border-top:1px solid #e5e7eb">
  <a href="${meLink}" style="${meStyle}">Keep it for myself</a>
</div>
<p style="color:#9ca3af;font-size:11px;margin-top:24px">Click any button to set the assignee. They'll get a notification with a link to the ticket. Links expire in 14 days.</p>
</body></html>`,
    })
  } catch (err) {
    console.error('[tickets] sendTriageEmail failed:', err instanceof Error ? err.message : err)
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

async function appendOutboundEmailToTicket(opts: {
  threadId:    string
  toEmail:     string
  subject:     string
  bodyHtml:    string
  bodyText:    string
  externalId:  string | null
}): Promise<void> {
  try {
    // The inbound message that triggered this reply already created the
    // ticket on the same gmail_thread_id, so this lookup should hit.
    const ticket = await findOpenTicketByGmailThread(opts.threadId)
    if (!ticket) return
    await appendMessage(ticket.id, {
      direction:   'outbound',
      channel:     'email',
      from_addr:   'maia@pmitop.com',
      to_addr:     opts.toEmail,
      subject:     opts.subject,
      body:        opts.bodyText,
      body_html:   opts.bodyHtml,
      external_id: opts.externalId,
    })
  } catch (err) {
    console.error('[tickets] append outbound email failed:', err instanceof Error ? err.message : err)
  }
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

export async function processEmailCommand(messageId: string): Promise<void> {
  let commandId: string | null = null

  try {
    const msg    = await fetchGmailMessage(messageId)
    const parsed = parseGmailMessage(msg)

    // Hard guard against the maia@→maia@ loop.
    //
    // Production diagnostic showed 11,152 emails in 10 days with
    // from=maia@pmitop.com and to=maia@pmitop.com. They came from a
    // mix of forward rules, auto-responder loops, and Resend bounces
    // that route MAIA's own outbound back into the inbox. Without
    // this check, processEmailCommand re-triggers a reply on each one
    // and we feedback ourselves forever.
    //
    // The staff-account webhook (processStaffAccountEmails) has had
    // an equivalent skip since day 1; this is just the same guard for
    // the main maia@ path.
    const senderLc = parsed.senderEmail.toLowerCase()
    if (senderLc === 'maia@pmitop.com' || senderLc === 'no-reply@pmitop.com' || senderLc === 'noreply@pmitop.com') {
      console.log(`[MAIA] skipping self-sent message ${messageId} (from=${senderLc}) — would loop`)
      return
    }

    const bodyNorm     = parsed.body.toLowerCase().replace(/\s+/g, ' ')
    const subjectNorm  = parsed.subject.toLowerCase()
    // Subject: match either "@maia" or "Maia" by name (most customers
    // don't know the @ syntax — natural greetings like "Hi Maia" should
    // route to the AI handler).
    //
    // Body: only match "@maia" literally. Plain "Maia" mentions are too
    // permissive — quoted MAIA signatures from previous replies in a
    // thread will match and cause loops. Customers writing "Hi Maia," in
    // the body still trigger via the recipient address (maia@pmitop.com)
    // and via the subject — which is where the greeting usually shows up.
    const mentionsMaia = /\bmaia\b/.test(subjectNorm) || bodyNorm.includes('@maia')
    const allowed      = isAllowedSender(parsed.senderEmail)

    // Determine trigger: explicit phrase > subject keyword (authorized).
    // No fallback to '@maia' here — staff mentioning @maia in passing
    // (e.g., asking a general question) should go to handleGeneralEmailQuery
    // below, which has skills + association-type context loaded. The old
    // fallback forced those into the structured-record extraction pipeline
    // and produced confusing "couldn't extract required information"
    // replies for what were just questions.
    const trigger = detectTrigger(parsed.body) ?? inferTrigger(parsed.subject, parsed.body, allowed)

    console.log(`[MAIA] subject="${subjectNorm.slice(0,80)}" sender="${parsed.senderEmail}" trigger="${trigger}" mentionsMaia=${mentionsMaia} allowed=${allowed}`)
    console.log(`[MAIA] body_preview="${parsed.body.slice(0,300).replace(/\n/g,'↵')}"`)
    console.log(`[MAIA] body_tail="${parsed.body.slice(-150).replace(/\n/g,'↵')}"`)
    console.log(`[MAIA] body_hex_tail="${Buffer.from(parsed.body.slice(-50)).toString('hex')}"`)

    // Log every inbound email so the omnichannel view is complete.
    // Use strict mode: only trust explicit account-number patterns to avoid
    // cross-contamination between associations from incidental email body mentions.
    //
    // The ticket ingest is *awaited* so it completes before processEmailCommand
    // returns. Vercel's serverless runtime can freeze the container immediately
    // after the handler returns, killing in-flight Promises mid-flight — which
    // is why earlier fire-and-forget versions of this code created email_logs
    // rows (single fast INSERT) but no tickets rows (6 sequential ops).
    let assocCode: string | null = null
    try {
      assocCode = await detectAssociationCode(parsed.subject + ' ' + parsed.body, true)
    } catch { /* fall through with null */ }

    void logEmail({
      direction:       'inbound',
      fromEmail:       parsed.senderEmail,
      toEmail:         'maia@pmitop.com',
      subject:         parsed.subject,
      fullBody:        parsed.body,
      persona:         allowed ? 'staff' : 'external',
      associationCode: assocCode ?? undefined,
      status:          'received',
      gmailThreadId:   parsed.threadId,
      gmailMessageId:  parsed.messageId,
      emailDate:       parsed.internalDate,
    })

    // Invoice-intake trigger. Staff forwards a vendor invoice PDF to
    // maia@ with "@maia process invoice", "@maia invoice", or "@maia
    // upload invoice" in the body. This is the ONLY way an invoice
    // enters the intake
    // queue — the old "any PDF at billing@" implicit routing was
    // removed (it kept swallowing @maia DB-update commands that
    // happened to CC billing@). Returns early so we don't ALSO try to
    // open a ticket or run freeform Claude on the same message.
    if (allowed && detectInvoiceTrigger(parsed.body)) {
      const hasPdf = parsed.attachments.some(a => a.mimeType.toLowerCase() === 'application/pdf')
      if (hasPdf) {
        // Lazy import — the intake module also imports a few things
        // back from this file, and a top-level import would create a
        // small circular reference.
        const { handleInvoiceIntake } = await import('@/lib/invoice-intake')
        await handleInvoiceIntake(
          parsed,
          (attId) => fetchGmailAttachmentData(parsed.messageId, attId),
        )
        return
      }
      // Trigger present but no PDF — guide the sender. Falls through
      // to the freeform handler so they get a real reply (the prompt
      // will explain what's missing).
      console.warn(`[MAIA] invoice trigger from ${parsed.senderEmail} but no PDF attached — falling through`)
    }

    // Tickets are created only when staff initiate them via an explicit
    // trigger phrase (@maia ticket, @ticket, etc.). The helper itself
    // gates on `allowed` and on trigger presence; replies in existing
    // ticket threads are always appended.
    await ingestInboundEmailToTicket(
      parsed, allowed, assocCode,
      (attId) => fetchGmailAttachmentData(parsed.messageId, attId),
    )

    // Ticket-creation and ticket-append emails are handled by the ticket
    // pipeline above — skip the structured-record extraction pipeline
    // (owner / tenant / board updates) so we don't reply with a confusing
    // "couldn't extract required information" message for what was
    // clearly a ticket request.
    if (allowed && (detectTicketTrigger(parsed.body) || detectAppendTrigger(parsed.body))) return

    if (!trigger) {
      // No structured trigger phrase. Three cases route to the freeform
      // AI handler (which has skills + association-type context loaded);
      // anything else gets ignored.
      //   1. Staff mentioned @maia in passing — they want an answer.
      //   2. Reply on an already-active MAIA thread — continue the thread.
      //   3. External sender — let the freeform handler decide whether to
      //      reply (it has its own AUTO_REPLY filters).
      let isActiveThread = false
      if (parsed.threadId) {
        const { data: existing } = await supabaseAdmin
          .from('general_conversations')
          .select('id')
          .eq('gmail_thread_id', parsed.threadId)
          .limit(1)
          .maybeSingle()
        isActiveThread = !!existing
      }
      const shouldRoute = isActiveThread || (allowed && mentionsMaia) || (!allowed && mentionsMaia)
      if (!shouldRoute) return
      await handleGeneralEmailQuery(parsed)
      return
    }

    // DB command — restricted to authorized staff senders; external senders get freeform chat
    if (!allowed) {
      await handleGeneralEmailQuery(parsed)
      return
    }

    // Board updates branch into a two-step confirmation flow instead of
    // the immediate-write path. The preview email contains confirm/cancel
    // magic links and nothing is written to association_board_members
    // until the staff member clicks Confirm.
    if (trigger === '@maia update board members' || trigger === '@maia update board') {
      // Dedup against Pub/Sub retries — one pending row per gmail message.
      const { data: existing } = await supabaseAdmin
        .from('maia_pending_board_updates')
        .select('id')
        .eq('gmail_message_id', parsed.messageId)
        .limit(1)
        .maybeSingle()
      if (existing) return
      await handleBoardMembersUpdate(parsed)
      return
    }

    // Log as processing — unique constraint prevents double-processing on Pub/Sub retries
    const { data: cmdRow, error: cmdErr } = await supabaseAdmin
      .from('maia_email_commands')
      .insert({
        gmail_message_id: parsed.messageId,
        gmail_thread_id:  parsed.threadId,
        sender_email:     parsed.senderEmail,
        sender_name:      parsed.senderName,
        subject:          parsed.subject,
        body_text:        parsed.body.slice(0, 4000),
        trigger_phrase:   trigger,
        status:           'processing',
      })
      .select('id')
      .single()

    if (cmdErr) {
      if (cmdErr.code === '23505') return  // already processed
      throw cmdErr
    }
    commandId = cmdRow.id

    const emailContent = `Subject: ${parsed.subject}\nFrom: ${parsed.sender}\n\n${parsed.body}`
    const extracted    = await extractWithClaude(emailContent)

    const ref        = genRef()
    const isComplete = (extracted.missing_fields?.length ?? 0) === 0 && extracted.record_type !== null

    // Attachments
    const uploadedFiles: Array<{ filename: string; url: string | null }> = []
    for (const att of parsed.attachments) {
      uploadedFiles.push({ filename: att.filename, url: await uploadAttachment(parsed.messageId, att, extracted.record_type) })
    }

    // DB upsert
    let dbResult:    UpsertResult | null = null
    let upsertError: string | null = null
    if (isComplete) {
      try {
        dbResult = await upsertRecord(extracted, {
          commandId,
          actorEmail:     parsed.senderEmail,
          gmailMessageId: parsed.messageId,
        })
      }
      catch (err) {
        upsertError = err instanceof Error ? err.message : String(err)
        console.error('[MAIA] upsertRecord error:', upsertError, 'extracted:', JSON.stringify(extracted))
      }
    }

    const today = new Date().toISOString().slice(0, 10)

    // Fire-and-forget side effects after successful DB write
    if (isComplete && !upsertError && dbResult) {
      const isTenant = extracted.record_type === 'tenant'
      const isOwner  = extracted.record_type === 'owner'

      // Courtesy email to previous occupant on transfer
      if (dbResult.isTransfer && dbResult.previousOwner?.email) {
        const { name, email: prevEmail, endDate } = dbResult.previousOwner
        void sendEmail({
          to:      prevEmail,
          subject: `Your ${isTenant ? 'tenancy' : 'ownership'} record has been updated — ${dbResult.assocName ?? extracted.association_code ?? 'your association'}`,
          html:    isTenant
            ? tenantCourtesyHtml(name, dbResult.assocName ?? null, extracted.unit_number, endDate)
            : courtesyHtml(name, dbResult.assocName ?? null, extracted.unit_number, endDate),
        })
      }

      // Board notification on new tenant (transfer or fresh)
      if (isTenant && extracted.association_code) {
        const tenantName = [extracted.first_name, extracted.last_name].filter(Boolean).join(' ') || 'New Tenant'
        void notifyBoardOfNewTenant(extracted.association_code, dbResult.assocName ?? null, extracted.unit_number, tenantName)
      }

    }

    // Reply-all (sender + To + CC, minus maia itself)
    const allRecipients = [...new Set(
      [parsed.senderEmail, ...parsed.to, ...parsed.cc].filter(e => e && e !== MAIA_EMAIL && e.includes('@'))
    )]
    const replySubject = parsed.subject.startsWith('Re:') ? parsed.subject : `Re: ${parsed.subject}`
    const replyHtml    = (isComplete && !upsertError)
      ? (() => {
          if (dbResult?.isTransfer && dbResult.previousOwner) {
            if (extracted.record_type === 'tenant') {
              return tenantTransitionHtml({
                ext:        extracted,
                assocName:  dbResult.assocName ?? null,
                prevTenant: {
                  name:       dbResult.previousOwner.name,
                  email:      dbResult.previousOwner.email,
                  leaseStart: dbResult.previousOwner.leaseStart ?? null,
                  endDate:    dbResult.previousOwner.endDate,
                },
                today,
                ref,
                files: uploadedFiles,
              })
            }
            return transferHtml({
              ext:              extracted,
              assocName:        dbResult.assocName ?? null,
              prevOwner:        dbResult.previousOwner,
              today,
              ref,
              files:            uploadedFiles,
              hasActiveTenants: dbResult.hasActiveTenants ?? false,
            })
          }
          return successHtml(extracted, ref, uploadedFiles)
        })()
      : incompleteHtml(
          { ...extracted, missing_fields: [...(extracted.missing_fields ?? []), ...(upsertError ? [`database_error: ${upsertError}`] : [])] },
          ref,
        )

    const { messageId: replyMsgId } = await sendEmail({
      to:      allRecipients,
      subject: replySubject,
      html:    replyHtml,
      ...(parsed.rfcMessageId && {
        headers: { 'In-Reply-To': parsed.rfcMessageId, References: parsed.rfcMessageId },
      }),
    })

    void logEmail({
      direction:       'outbound',
      toEmail:         allRecipients.join(', '),
      subject:         replySubject,
      fullBody:        replyHtml,
      persona:         'staff',
      associationCode: extracted.association_code ?? undefined,
      status:          'sent',
      resendMessageId: replyMsgId,
      sentBy:          'maia-command',
      gmailThreadId:   parsed.threadId,
    })

    await supabaseAdmin
      .from('maia_email_commands')
      .update({
        extracted_data: extracted,
        record_type:    extracted.record_type,
        status:         isComplete && !upsertError ? 'completed' : 'incomplete',
        db_record_id:   dbResult?.recordId ?? null,
        db_table:       dbResult?.table ?? null,
        reply_sent:     true,
        attachments:    uploadedFiles,
        reference_code: ref,
        updated_at:     new Date().toISOString(),
      })
      .eq('id', commandId)

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[MAIA] processEmailCommand error:', msg)
    if (commandId) {
      await supabaseAdmin
        .from('maia_email_commands')
        .update({ status: 'failed', error_message: msg, updated_at: new Date().toISOString() })
        .eq('id', commandId)
    }
  }
}
