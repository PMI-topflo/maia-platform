// =====================================================================
// app/admin/audit/page.tsx
//
// Compliance audit dashboard. Server Component for the data fetch,
// Client Component for the interactive table.
// =====================================================================

import { createClient } from '@supabase/supabase-js';
import { AuditTable } from './AuditTable';

export const dynamic = 'force-dynamic';

async function getData() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  // Pull from the v_unit_compliance view + join homeowner address
  const { data: compliance } = await supabase
    .from('v_unit_compliance')
    .select('*');

  // Get homeowner addresses
  const { data: homeowners } = await supabase
    .from('homeowners')
    .select('account_number, association_code, association_name, street_number, address, unit_number, first_name, last_name, emails');

  // Get active alerts grouped by account
  const { data: alerts } = await supabase
    .from('compliance_alerts')
    .select('account_number, severity, alert_type, message, days_delta')
    .is('resolved_at', null);

  // Get association config (for hiding LCLUB/VPREC)
  const { data: configs } = await supabase
    .from('association_config')
    .select('association_code, is_master, requires_cou');

  return {
    compliance: compliance ?? [],
    homeowners: homeowners ?? [],
    alerts: alerts ?? [],
    configs: configs ?? [],
  };
}

export default async function AuditPage(props: {
  searchParams: Promise<{ association?: string }>;
}) {
  const { association } = await props.searchParams;
  const data = await getData();

  return (
    <main className="min-h-screen bg-white p-6">
      <header className="mb-6 border-l-4 border-[#f26a1b] pl-4">
        <h1 className="text-3xl font-bold text-[#0d0d0d]">Compliance Audit</h1>
        <p className="text-gray-600 mt-1">
          Lease, insurance, Lauderhill Certificate of Use, and violation tracking
        </p>
      </header>

      <AuditTable {...data} initialAssociation={association} />
    </main>
  );
}
