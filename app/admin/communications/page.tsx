import Link from 'next/link'
import SiteHeader from '@/components/SiteHeader'
import { supabaseAdmin } from '@/lib/supabase-admin'
import CommunicationsDashboard from './components/CommunicationsDashboard'

export const metadata = { title: 'Communications — PMI Top Florida' }

export const dynamic = 'force-dynamic'

async function getData() {
  const [convRes, emailRes, ticketRes, staffRes] = await Promise.all([
    supabaseAdmin
      .from('general_conversations')
      .select('id, session_id, persona, language, association_code, topic, status, channel, contact_name, contact_phone, contact_email, assigned_to, handled_by, summary, created_at, updated_at, messages')
      .order('updated_at', { ascending: false })
      .limit(100),
    supabaseAdmin
      .from('email_logs')
      .select('id, direction, from_email, to_email, subject, body_preview, persona, association_code, status, resend_message_id, sent_by, created_at')
      .order('created_at', { ascending: false })
      .limit(200),
    supabaseAdmin
      .from('board_tickets')
      .select('id, title, subject, description, type, ticket_type, status, priority, association_code, channel_source, contact_name, contact_phone, contact_email, persona, assigned_to, created_by, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(100),
    supabaseAdmin
      .from('pmi_staff')
      .select('id, name, email, role, department')
      .eq('active', true)
      .order('name'),
  ])

  return {
    conversations: convRes.data ?? [],
    emails:        emailRes.data ?? [],
    tickets:       ticketRes.data ?? [],
    staff:         staffRes.data ?? [],
  }
}

export default async function CommunicationsPage() {
  const data = await getData()

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="COMMUNICATIONS">
        <div className="flex items-center gap-3">
          <Link
            href="/admin"
            className="text-white/70 hover:text-white [font-family:var(--font-mono)] text-[0.6rem] uppercase tracking-[0.08em] transition-colors"
          >
            ← Owners
          </Link>
          <Link
            href="/admin/communications"
            className="text-white border border-white/30 [font-family:var(--font-mono)] text-[0.6rem] uppercase tracking-[0.08em] px-3 py-1.5 rounded-[2px]"
          >
            Communications
          </Link>
        </div>
      </SiteHeader>

      <main className="max-w-screen-xl mx-auto px-6 py-6">
        <CommunicationsDashboard {...data} />
      </main>
    </div>
  )
}
