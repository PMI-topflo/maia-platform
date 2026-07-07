// =====================================================================
// app/admin/applications/page.tsx
//
// Admin applications dashboard. Server Component for the data fetch,
// Client Component for the interactive table.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin';
import SiteHeader from '@/components/SiteHeader';
import AdminNav from '../components/AdminNav';
import { ApplicationsTable } from './ApplicationsTable';

export const metadata = { title: 'Applications — PMI Top Florida' };
export const dynamic = 'force-dynamic';

interface ApplicationRow {
  acknowledged_document_ids?: string[] | null
  [k: string]: unknown
}

async function getData() {
  // Shared admin client resolves the canonical SUPABASE_URL + service key.
  // (Was an inline createClient on NEXT_PUBLIC_SUPABASE_URL, which is the
  // app domain — not the project URL — so every query 404'd.)
  const supabase = supabaseAdmin;

  const { data: applications, error } = await supabase
    .from('applications')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[applications/page] fetch error', error);
  }

  // Resolve acknowledged_document_ids to actual filename + category in
  // one batched IN query so the detail panel can show "Acknowledged
  // Rules & Regulations (2026-rules.pdf, effective 2026-01-15)" instead
  // of opaque UUIDs. Pre-existing applications with empty arrays cost
  // nothing — the IN list is empty so the query short-circuits.
  const allDocIds = new Set<string>();
  for (const a of (applications ?? []) as ApplicationRow[]) {
    for (const id of (a.acknowledged_document_ids ?? [])) allDocIds.add(id);
  }
  const documentLookup: Record<string, { filename: string; category: string; effective_date: string | null }> = {};
  if (allDocIds.size > 0) {
    const { data: docs } = await supabase
      .from('association_documents')
      .select('id, filename, category, effective_date')
      .in('id', [...allDocIds]);
    for (const d of (docs ?? [])) {
      documentLookup[d.id] = {
        filename:       d.filename,
        category:       d.category,
        effective_date: d.effective_date ?? null,
      };
    }
  }

  // Per-applicant Checkr status + report link -- applications.screening_report_url
  // only ever covers the single-subject case, so couples/commercial need
  // each subject's own row to show every applicant's report individually.
  const subjectsByApplication: Record<string, { name: string | null; status: string | null; report_url: string | null }[]> = {};
  const appIds = (applications ?? []).map((a) => a.id as string);
  if (appIds.length > 0) {
    const { data: subjects } = await supabase
      .from('screening_subjects')
      .select('application_id, subject_index, name, status, report_url')
      .in('application_id', appIds)
      .order('subject_index', { ascending: true });
    for (const s of (subjects ?? [])) {
      const key = s.application_id as string;
      (subjectsByApplication[key] ??= []).push({ name: s.name, status: s.status, report_url: s.report_url });
    }
  }

  return { applications: applications ?? [], documentLookup, subjectsByApplication };
}

export default async function ApplicationsPage() {
  const { applications, documentLookup, subjectsByApplication } = await getData();

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD">
        <AdminNav />
      </SiteHeader>

      <main className="max-w-screen-2xl mx-auto px-6 py-6">
        <header className="mb-6 border-l-4 border-[#f26a1b] pl-4">
          <h1 className="text-xl font-semibold text-gray-900">Applications</h1>
          <p className="text-sm text-gray-500 mt-1">
            Tenant and buyer applications submitted through the portal
          </p>
        </header>

        <ApplicationsTable applications={applications} documentLookup={documentLookup} subjectsByApplication={subjectsByApplication} />
      </main>
    </div>
  );
}
