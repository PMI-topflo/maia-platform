import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'
import { logEmail } from '@/lib/email-logger'
import {
  fetchGmailMessage,
  fetchGmailAttachmentData,
  type GmailFullMessage,
  type GmailMessagePart,
} from '@/lib/gmail'

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

interface ParsedEmail {
  messageId:    string
  threadId:     string
  rfcMessageId: string
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
    body = plain || html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim()
  }

  return {
    messageId:    msg.id,
    threadId:     msg.threadId,
    rfcMessageId: hdr(headers, 'Message-ID'),
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

function isAllowedSender(email: string): boolean {
  return ALLOWED_DOMAINS.some(d => email.toLowerCase().endsWith(d))
}

function detectTrigger(body: string): string | null {
  const lower = body.toLowerCase()
  return TRIGGER_PHRASES.find(p => lower.includes(p)) ?? null
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
- For record_type, infer from context (@maia add owner → owner, @maia add tenant → tenant, etc.)
- If you see multiple people (couple, co-owners), list the primary in main fields and extras in additional_people
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

async function upsertRecord(ext: ExtractedRecord): Promise<UpsertResult> {
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
      const newName = [ext.first_name, ext.last_name].filter(Boolean).join(' ') || ext.entity_name || 'New Owner'

      // Find existing active owner at this unit
      type PrevRow = { id: number; first_name: string | null; last_name: string | null; entity_name: string | null; emails: string | null }
      let prevOwner: PrevRow | null = null
      if (code && ext.unit_number) {
        const { data } = await supabaseAdmin
          .from('owners')
          .select('id, first_name, last_name, entity_name, emails')
          .eq('association_code', code)
          .eq('unit_number', ext.unit_number)
          .neq('status', 'previous')
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
            active:             false,
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
      const { data, error } = await supabaseAdmin
        .from('owners')
        .insert({
          association_code:     code,
          association_name:     assocName,
          unit_number:          ext.unit_number,
          entity_name:          ext.entity_name,
          first_name:           ext.first_name,
          last_name:            ext.last_name,
          emails:               ext.email,
          phone:                ext.phone,
          address:              ext.address,
          notes:                ext.notes,
          status:               'active',
          active:               true,
          ownership_start_date: today,
          transferred_from:     prevName,
          previous_owner_id:    prevOwner?.id ?? null,
        })
        .select('id')
        .single()
      if (error) throw new Error(`owners: ${error.message}`)

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
      const { data, error } = await supabaseAdmin
        .from('board_members')
        .insert({
          association_code: code,
          first_name:       ext.first_name,
          last_name:        ext.last_name,
          email:            ext.email,
          phone:            ext.phone,
          active:           true,
          notes:            ext.notes,
        })
        .select('id')
        .single()
      if (error) throw new Error(`board_members: ${error.message}`)
      return { table: 'board_members', recordId: String(data.id) }
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
  const { data: board } = await supabaseAdmin
    .from('board_members')
    .select('email')
    .eq('association_code', associationCode)
    .eq('active', true)
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
  const name      = [ext.first_name, ext.last_name].filter(Boolean).join(' ') || ext.entity_name || '—'
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
  <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600">Name</td><td style="padding:8px 12px;border:1px solid #e5e7eb">${name}</td></tr>
  <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600">Association</td><td style="padding:8px 12px;border:1px solid #e5e7eb">${ext.association_code ?? '—'}${ext.unit_number ? ` — Unit ${ext.unit_number}` : ''}</td></tr>
  <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600">Email</td><td style="padding:8px 12px;border:1px solid #e5e7eb">${ext.email ?? '—'}</td></tr>
  <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600">Phone</td><td style="padding:8px 12px;border:1px solid #e5e7eb">${ext.phone ?? '—'}</td></tr>
  <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600">Documents</td><td style="padding:8px 12px;border:1px solid #e5e7eb"><ul style="margin:0;padding-left:16px">${filesHtml}</ul></td></tr>
</table>
<p><a href="https://www.pmitop.com/admin?search=${encodeURIComponent(name)}" style="background:#f26a1b;color:white;padding:10px 20px;text-decoration:none;border-radius:4px;font-weight:600">View &amp; Edit Record →</a></p>
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

RULES:
- Respond in English only
- Be professional and concise
- If unsure, direct to service@topfloridaproperties.com or 305.900.5077
- Never fabricate financial figures or legal details
- Always sign as: Maia | PMI Top Florida Properties AI Assistant`

const AUTO_REPLY_SUBJECTS = ['out of office', 'auto-reply', 'automatic reply', 'delivery failed', 'undeliverable', 'autoreply']
const AUTO_REPLY_SENDERS  = ['maia@', 'noreply@', 'no-reply@', 'mailer-daemon@']

async function handleGeneralEmailQuery(parsed: ParsedEmail): Promise<void> {
  // Anti-loop: skip automated senders and auto-reply subjects
  if (AUTO_REPLY_SENDERS.some(s => parsed.senderEmail.toLowerCase().includes(s))) return
  const subjectLower = parsed.subject.toLowerCase()
  if (AUTO_REPLY_SUBJECTS.some(s => subjectLower.includes(s))) return

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
    // Fetch up to last 5 exchanges in this thread for context
    const { data: history } = await supabaseAdmin
      .from('general_conversations')
      .select('message, response')
      .eq('gmail_thread_id', parsed.threadId)
      .not('response', 'is', null)
      .order('created_at', { ascending: false })
      .limit(5)

    type MsgPair = { role: 'user' | 'assistant'; content: string }
    const historyMessages: MsgPair[] = (history ?? [])
      .reverse()
      .flatMap(h => [
        { role: 'user'      as const, content: h.message  ?? '' },
        { role: 'assistant' as const, content: h.response ?? '' },
      ])
      .filter(m => m.content)

    const currentMessage = `From: ${parsed.senderName} <${parsed.senderEmail}>\nSubject: ${parsed.subject}\n\n${parsed.body}`
    const messages: MsgPair[] = [
      ...historyMessages,
      { role: 'user', content: currentMessage },
    ]

    const message = await anthropic.messages.create({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system:     GENERAL_SYSTEM_PROMPT,
      messages,
    })

    const aiText  = message.content.find(b => b.type === 'text')?.text ?? ''
    const replyHtml = `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#222;max-width:600px;margin:0 auto;padding:20px">
${aiText.split('\n').map(line => `<p style="margin:0 0 12px">${line}</p>`).join('')}
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
    })

    await supabaseAdmin
      .from('general_conversations')
      .update({
        response:    aiText,
        reply_sent:  true,
        status:      'completed',
        updated_at:  new Date().toISOString(),
      })
      .eq('id', convRow.id)

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[MAIA general] error:', msg)
    await supabaseAdmin
      .from('general_conversations')
      .update({ status: 'failed', error_message: msg, updated_at: new Date().toISOString() })
      .eq('id', convRow.id)
  }
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

export async function processEmailCommand(messageId: string): Promise<void> {
  let commandId: string | null = null

  try {
    const msg    = await fetchGmailMessage(messageId)
    const parsed = parseGmailMessage(msg)

    const trigger = detectTrigger(parsed.body)
    if (!trigger) {
      const mentionsMaia =
        parsed.subject.toLowerCase().includes('@maia') ||
        parsed.body.toLowerCase().includes('@maia')

      // Check if this reply belongs to a thread Maia already joined
      let isActiveThread = false
      if (!mentionsMaia && parsed.threadId) {
        const { data: existing } = await supabaseAdmin
          .from('general_conversations')
          .select('id')
          .eq('gmail_thread_id', parsed.threadId)
          .limit(1)
          .maybeSingle()
        isActiveThread = !!existing
      }

      if (!mentionsMaia && !isActiveThread) return
      await handleGeneralEmailQuery(parsed)
      return
    }

    // DB command — restricted to authorized staff senders
    if (!isAllowedSender(parsed.senderEmail)) return

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
      try { dbResult = await upsertRecord(extracted) }
      catch (err) { upsertError = err instanceof Error ? err.message : String(err) }
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
          { ...extracted, missing_fields: [...(extracted.missing_fields ?? []), ...(upsertError ? ['database_error'] : [])] },
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
