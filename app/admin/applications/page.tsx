// =====================================================================
// app/admin/applications/page.tsx
//
// Admin applications dashboard. Server Component for the data fetch,
// Client Component for the interactive table.
// =====================================================================

import { createClient } from '@supabase/supabase-js';
import SiteHeader from '@/components/SiteHeader';
import AdminNav from '../components/AdminNav';
import { ApplicationsTable } from './ApplicationsTable';

export const metadata = { title: 'Applications — PMI Top Florida' };
export const dynamic = 'force-dynamic';

async function getData() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } }
  );

  const { data: applications, error } = await supabase
    .from('applications')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[applications/page] fetch error', error);
  }

  return { applications: applications ?? [] };
}

export default async function ApplicationsPage() {
  const { applications } = await getData();

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD">
        <AdminNav />
      </SiteHeader>

      <main className="max-w-screen-xl mx-auto px-6 py-6">
        <header className="mb-6 border-l-4 border-[#f26a1b] pl-4">
          <h1 className="text-xl font-semibold text-gray-900">Applications</h1>
          <p className="text-sm text-gray-500 mt-1">
            Tenant and buyer applications submitted through the portal
          </p>
        </header>

        <ApplicationsTable applications={applications} />
      </main>
    </div>
  );
}
