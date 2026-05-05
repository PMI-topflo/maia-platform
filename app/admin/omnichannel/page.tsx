import { supabaseAdmin } from '@/lib/supabase-admin'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../components/AdminNav'
import OmnichannelClient, { ConvItem } from './components/OmnichannelClient'

export const metadata = { title: 'Omnichannel — PMI Top Florida' }
export const dynamic = 'force-dynamic'

export default async function OmnichannelPage() {
  const [convsRes, ticketsRes, emailsRes, assocRes] = await Promise.all([
    supabaseAdmin
      .from('general_conversations')
      .select('id, channel, association_code, persona, contact_name, contact_email, subject, summary, status, created_at')
      .order('created_at', { ascending: false })
      .limit(500),
    supabaseAdmin
      .from('board_tickets')
      .select('id, channel_source, association_code, persona, contact_name, contact_email, subject, description, status, created_at')
      .order('created_at', { ascending: false })
      .limit(500),
    supabaseAdmin
      .from('email_logs')
      .select('id, direction, from_email, to_email, subject, body_preview, persona, association_code, status, created_at')
      .order('created_at', { ascending: false })
      .limit(500),
    supabaseAdmin
      .from('associations')
      .select('association_code, association_name')
      .eq('active', true)
      .order('association_name'),
  ])

  const convItems: ConvItem[] = (convsRes.data ?? []).map(r => ({
    id:               `conv-${r.id}`,
    type:             'conversation' as const,
    channel:          r.channel ?? 'web',
    association_code: r.association_code,
    persona:          r.persona,
    contact_name:     r.contact_name,
    contact_email:    r.contact_email,
    subject:          r.subject,
    summary:          r.summary,
    status:           r.status,
    created_at:       r.created_at,
  }))

  const ticketItems: ConvItem[] = (ticketsRes.data ?? []).map(r => ({
    id:               `ticket-${r.id}`,
    type:             'ticket' as const,
    channel:          r.channel_source ?? 'ticket',
    association_code: r.association_code,
    persona:          r.persona,
    contact_name:     r.contact_name,
    contact_email:    r.contact_email,
    subject:          r.subject,
    summary:          r.description,
    status:           r.status,
    created_at:       r.created_at,
  }))

  const emailItems: ConvItem[] = (emailsRes.data ?? []).map(r => ({
    id:               `email-${r.id}`,
    type:             'email' as const,
    channel:          r.direction === 'inbound' ? 'email-in' : 'email-out',
    association_code: r.association_code,
    persona:          r.persona,
    contact_name:     r.direction === 'inbound' ? r.from_email : r.to_email,
    contact_email:    r.direction === 'inbound' ? r.from_email : r.to_email,
    subject:          r.subject,
    summary:          r.body_preview,
    status:           r.status,
    created_at:       r.created_at,
  }))

  // Merge and sort by date descending
  const allItems = [...convItems, ...ticketItems, ...emailItems].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )

  const associations = (assocRes.data ?? []) as Array<{ association_code: string; association_name: string }>

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD">
        <AdminNav />
      </SiteHeader>

      <main className="max-w-screen-xl mx-auto px-6 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-gray-900">Omnichannel View</h1>
          <p className="text-sm text-gray-500 mt-1">
            All interactions across channels — {allItems.length} total · filter by association or persona below
          </p>
        </div>

        <OmnichannelClient items={allItems} associations={associations} />
      </main>
    </div>
  )
}
