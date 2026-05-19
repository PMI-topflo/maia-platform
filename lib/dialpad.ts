import crypto from 'node:crypto'

const BASE_URL = 'https://dialpad.com/api/v2'

function apiKey(): string {
  const key = process.env.DIALPAD_API_KEY
  if (!key) throw new Error('DIALPAD_API_KEY is not set')
  return key
}

async function dpFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Dialpad ${init.method ?? 'GET'} ${path} failed (${res.status}): ${text.slice(0, 400)}`)
  }
  return text ? (JSON.parse(text) as T) : ({} as T)
}

interface Paginated<T> { items?: T[]; cursor?: string | null }

async function paginate<T>(path: string): Promise<T[]> {
  const out: T[] = []
  let cursor: string | undefined
  const sep = path.includes('?') ? '&' : '?'
  do {
    const url = cursor ? `${path}${sep}cursor=${encodeURIComponent(cursor)}` : path
    const data = await dpFetch<Paginated<T>>(url)
    if (Array.isArray(data.items)) out.push(...data.items)
    cursor = data.cursor ?? undefined
  } while (cursor)
  return out
}

export interface DialpadUser {
  id:             string | number
  emails?:        string[]
  phone_numbers?: string[]
  display_name?:  string
  state?:         string
  first_name?:    string
  last_name?:     string
}

export interface DialpadNumber {
  number:       string
  status?:      string
  target_type?: string
  target_id?:   string | number
  area_code?:   string
  label?:       string
}

export interface DialpadCallEvent {
  call_id:              number | string
  event_timestamp?:     number
  state?:               string
  direction?:           'inbound' | 'outbound'
  external_number?:     string
  internal_number?:     string
  target?:              { phone?: string; type?: string; id?: string | number; name?: string; email?: string; office_id?: string | number }
  contact?:             { phone?: string; type?: string; id?: string | number; name?: string; email?: string }
  date_started?:        number | null
  date_connected?:      number | null
  date_ended?:          number | null
  date_rang?:           number | null
  duration?:            number | null
  total_duration?:      number | null
  was_recorded?:        boolean
  is_transferred?:      boolean
  transcription_text?:  string | null
  voicemail_link?:      string | null
  recording_details?:   Array<{ id?: string | number; url?: string; duration?: number; start_time?: number; recording_type?: string }>
  master_call_id?:      number | string | null
  entry_point_call_id?: number | string | null
  operator_call_id?:    number | string | null
  recap_summary?:       string | null
  group_id?:            string | number | null
  entry_point_target?:  Record<string, unknown> | null
}

export interface DialpadSmsEvent {
  id:            string
  created_date?: string
  direction?:    'inbound' | 'outbound'
  target?:       { phone_number?: string; type?: string; id?: string | number; name?: string }
  contact?:      { phone_number?: string; id?: string | number; name?: string }
  sender_id?:    string | null
  from_number?:  string
  to_number?:    string[]
  mms?:          boolean
  text?:         string
  message_status?:          string
  message_delivery_result?: string
}

export async function listAllUsers(): Promise<DialpadUser[]> {
  return paginate<DialpadUser>('/users')
}

export async function listAllNumbers(): Promise<DialpadNumber[]> {
  return paginate<DialpadNumber>('/numbers')
}

export async function listAllCalls(params: { startedAfter: number; startedBefore: number }): Promise<DialpadCallEvent[]> {
  const qs = `started_after=${params.startedAfter}&started_before=${params.startedBefore}`
  return paginate<DialpadCallEvent>(`/call?${qs}`)
}

export interface DialpadWebhook {
  id:        string
  hook_url:  string
  signature: { algo: string; secret: string; type: string }
}

export async function createWebhook(hookUrl: string, secret: string): Promise<DialpadWebhook> {
  return dpFetch<DialpadWebhook>('/webhooks', {
    method: 'POST',
    body:   JSON.stringify({ hook_url: hookUrl, secret }),
  })
}

export async function listWebhooks(): Promise<DialpadWebhook[]> {
  const data = await dpFetch<{ items?: DialpadWebhook[] }>('/webhooks')
  return data.items ?? []
}

export async function deleteWebhook(id: string): Promise<void> {
  await dpFetch<unknown>(`/webhooks/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function createSmsSubscription(opts: {
  endpointId:       string
  direction:        'all' | 'inbound' | 'outbound'
  includeInternal?: boolean
}): Promise<{ id: string }> {
  return dpFetch<{ id: string }>('/subscriptions/sms', {
    method: 'POST',
    body:   JSON.stringify({
      endpoint_id:      opts.endpointId,
      direction:        opts.direction,
      enabled:          true,
      include_internal: opts.includeInternal ?? false,
      status:           'active',
    }),
  })
}

export async function createCallSubscription(opts: {
  endpointId: string
  callStates: string[]
}): Promise<{ id: string }> {
  return dpFetch<{ id: string }>('/subscriptions/call', {
    method: 'POST',
    body:   JSON.stringify({
      endpoint_id:       opts.endpointId,
      call_states:       opts.callStates,
      enabled:           true,
      group_calls_only:  false,
    }),
  })
}

// JWT (HS256) verification with no external deps. Dialpad signs the full
// webhook body as a JWT when a secret was supplied at webhook creation.
export function verifyDialpadJwt(token: string, secret: string): { valid: boolean; payload: Record<string, unknown> | null } {
  try {
    const parts = token.trim().split('.')
    if (parts.length !== 3) return { valid: false, payload: null }
    const [headerB64, payloadB64, sigB64] = parts

    const header = JSON.parse(b64uDecodeToString(headerB64)) as { alg?: string; typ?: string }
    if (header.alg !== 'HS256') return { valid: false, payload: null }

    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest()
    const provided = Buffer.from(b64uToBase64(sigB64), 'base64')
    if (expected.length !== provided.length) return { valid: false, payload: null }
    if (!crypto.timingSafeEqual(expected, provided)) return { valid: false, payload: null }

    const payload = JSON.parse(b64uDecodeToString(payloadB64)) as Record<string, unknown>
    return { valid: true, payload }
  } catch {
    return { valid: false, payload: null }
  }
}

function b64uToBase64(s: string): string {
  const t = s.replace(/-/g, '+').replace(/_/g, '/')
  return t + '='.repeat((4 - t.length % 4) % 4)
}

function b64uDecodeToString(s: string): string {
  return Buffer.from(b64uToBase64(s), 'base64').toString('utf8')
}
