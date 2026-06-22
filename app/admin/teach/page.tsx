// =====================================================================
// app/admin/teach/page.tsx
// "Teach MAIA" studio — upload PDFs / images / text, review what MAIA
// understood, approve or correct, scoped per association AND per persona.
// Approved knowledge is injected into MAIA's live answers.
// =====================================================================

import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../components/AdminNav'
import { supabaseAdmin } from '@/lib/supabase-admin'
import TeachStudioClient, { type KnowledgeItem } from './TeachStudioClient'

export const metadata = { title: 'Teach MAIA — PMI Top Florida' }
export const dynamic = 'force-dynamic'

export default async function TeachPage() {
  const [{ data: items }, { data: associations }] = await Promise.all([
    supabaseAdmin
      .from('maia_knowledge')
      .select('id, association_code, persona, account_number, unit_number, title, source_kind, source_filename, understood_summary, approved_body, status, created_by, reviewed_by, created_at, updated_at')
      .order('updated_at', { ascending: false })
      .limit(500),
    supabaseAdmin
      .from('associations')
      .select('association_code, association_name')
      .eq('active', true)
      .order('association_name', { ascending: true }),
  ])

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD">
        <AdminNav activeOverride="/admin/teach" />
      </SiteHeader>
      <main className="max-w-screen-2xl mx-auto px-6 py-6">
        <div className="mb-5">
          <h1 className="text-xl font-semibold text-gray-900">Teach MAIA</h1>
          <p className="text-sm text-gray-500 mt-1">
            Upload a PDF, image, or text. MAIA reads it and shows what she understood — you approve or correct it.
            Knowledge is scoped per association and per persona, and feeds her live answers.
          </p>
        </div>
        <TeachStudioClient
          initialItems={(items ?? []) as KnowledgeItem[]}
          associations={(associations ?? []).filter(a => a.association_code && a.association_name)}
        />
      </main>
    </div>
  )
}
