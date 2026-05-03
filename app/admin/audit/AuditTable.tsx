// =====================================================================
// app/admin/audit/AuditTable.tsx
// Client component — sortable, filterable, with re-scan button.
// =====================================================================

'use client';

import { useMemo, useState } from 'react';

type ComplianceRow = {
  account_number: string;
  tenant_name: string | null;
  lease_end_date: string | null;
  lease_status: 'expired' | 'urgent' | 'warning' | 'ok' | null;
  insurance_carrier: string | null;
  insurance_expiration: string | null;
  insurance_status: 'expired' | 'urgent' | 'warning' | 'ok' | null;
  cou_expiration: string | null;
  cou_status: 'expired' | 'urgent' | 'warning' | 'ok' | null;
  open_violation_count: number;
  next_violation_due: string | null;
};

type Homeowner = {
  account_number: string;
  association_code: string;
  association_name: string;
  street_number: number | null;
  address: string;
  unit_number: string;
  first_name: string | null;
  last_name: string | null;
  emails: string | null;
};

type Alert = {
  account_number: string;
  severity: 'warning' | 'urgent' | 'critical';
  alert_type: string;
  message: string;
  days_delta: number;
};

type Config = {
  association_code: string;
  is_master: boolean;
  requires_cou: boolean;
};

interface Props {
  compliance: ComplianceRow[];
  homeowners: Homeowner[];
  alerts: Alert[];
  configs: Config[];
  initialAssociation?: string;
}

const STATUS_STYLES: Record<string, string> = {
  expired: 'bg-red-100 text-red-900 font-bold',
  urgent:  'bg-orange-100 text-orange-900 font-semibold',
  warning: 'bg-yellow-100 text-yellow-900',
  ok:      'bg-green-50 text-green-800',
};

function StatusBadge({ status, date }: { status: string | null; date: string | null }) {
  if (!status) return <span className="text-gray-400 text-sm">—</span>;
  const cls = STATUS_STYLES[status] ?? 'bg-gray-100';
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs ${cls}`}>
      {date ?? status}
    </span>
  );
}

export function AuditTable({ compliance, homeowners, alerts, configs, initialAssociation }: Props) {
  const [association, setAssociation] = useState(initialAssociation ?? 'ALL');
  const [statusFilter, setStatusFilter] = useState<'all' | 'expired' | 'urgent' | 'warning'>('all');
  const [search, setSearch] = useState('');
  const [rescanning, setRescanning] = useState(false);

  const homeownerByAcct = useMemo(() => {
    const m = new Map<string, Homeowner>();
    for (const h of homeowners) if (!m.has(h.account_number)) m.set(h.account_number, h);
    return m;
  }, [homeowners]);

  const alertsByAcct = useMemo(() => {
    const m = new Map<string, Alert[]>();
    for (const a of alerts) {
      if (!m.has(a.account_number)) m.set(a.account_number, []);
      m.get(a.account_number)!.push(a);
    }
    return m;
  }, [alerts]);

  const associationsList = useMemo(() => {
    const set = new Set(homeowners.map(h => h.association_code));
    return Array.from(set).sort();
  }, [homeowners]);

  // Build rows: every unit in homeowners (so we see units with NO data, not just ones with data)
  const rows = useMemo(() => {
    const complianceByAcct = new Map(compliance.map(c => [c.account_number, c]));
    const seen = new Set<string>();
    const out: Array<{ h: Homeowner; c: ComplianceRow | null }> = [];
    for (const h of homeowners) {
      if (seen.has(h.account_number)) continue;
      seen.add(h.account_number);
      out.push({ h, c: complianceByAcct.get(h.account_number) ?? null });
    }
    return out;
  }, [compliance, homeowners]);

  const filtered = useMemo(() => {
    return rows.filter(({ h, c }) => {
      if (association !== 'ALL' && h.association_code !== association) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${h.account_number} ${h.first_name ?? ''} ${h.last_name ?? ''} ${h.unit_number} ${c?.tenant_name ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (statusFilter !== 'all') {
        const statuses = [c?.lease_status, c?.insurance_status, c?.cou_status];
        if (!statuses.includes(statusFilter)) return false;
      }
      return true;
    });
  }, [rows, association, search, statusFilter]);

  const cfg = configs.find(c => c.association_code === association);
  const showCou = association === 'ALL' || cfg?.requires_cou;

  async function rescan() {
    if (association === 'ALL') {
      alert('Pick a specific association to re-scan');
      return;
    }
    setRescanning(true);
    try {
      for (const folderType of ['lease', 'insurance', 'cou', 'violations']) {
        await fetch('/api/indexer/drive-scan', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // Note: in production this endpoint should be called from a server action,
            // not directly from the client, to keep INTERNAL_API_SECRET out of the browser.
          },
          body: JSON.stringify({ associationCode: association, folderType }),
        });
      }
      window.location.reload();
    } finally {
      setRescanning(false);
    }
  }

  // Counts for header
  const counts = filtered.reduce(
    (acc, { c }) => {
      for (const s of [c?.lease_status, c?.insurance_status, c?.cou_status]) {
        if (s === 'expired') acc.expired++;
        else if (s === 'urgent') acc.urgent++;
        else if (s === 'warning') acc.warning++;
      }
      return acc;
    },
    { expired: 0, urgent: 0, warning: 0 }
  );

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <div>
          <label className="block text-xs text-gray-600 mb-1">Association</label>
          <select
            value={association}
            onChange={e => setAssociation(e.target.value)}
            className="border rounded px-3 py-2 bg-white"
          >
            <option value="ALL">All associations</option>
            {associationsList.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Status</label>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as any)}
            className="border rounded px-3 py-2 bg-white"
          >
            <option value="all">All</option>
            <option value="expired">Expired only</option>
            <option value="urgent">Urgent (≤30d)</option>
            <option value="warning">Warning (≤60d)</option>
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-gray-600 mb-1">Search</label>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Account #, owner, tenant…"
            className="border rounded px-3 py-2 w-full"
          />
        </div>
        <button
          onClick={rescan}
          disabled={rescanning || association === 'ALL'}
          className="bg-[#f26a1b] hover:bg-[#d85a0f] disabled:bg-gray-300 text-white px-4 py-2 rounded"
        >
          {rescanning ? 'Re-scanning…' : `Re-scan ${association === 'ALL' ? '(pick assoc)' : association}`}
        </button>
      </div>

      {/* Summary chips */}
      <div className="flex gap-2 mb-4 text-sm">
        <span className="px-3 py-1 rounded bg-red-100 text-red-900">🚨 Expired: {counts.expired}</span>
        <span className="px-3 py-1 rounded bg-orange-100 text-orange-900">⚠️ Urgent: {counts.urgent}</span>
        <span className="px-3 py-1 rounded bg-yellow-100 text-yellow-900">⚡ Warning: {counts.warning}</span>
        <span className="px-3 py-1 rounded bg-gray-100 text-gray-700">Total units: {filtered.length}</span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto border rounded">
        <table className="w-full text-sm">
          <thead className="bg-[#0d0d0d] text-white">
            <tr>
              <th className="px-3 py-2 text-left">Account</th>
              <th className="px-3 py-2 text-left">Address</th>
              <th className="px-3 py-2 text-left">Owner</th>
              <th className="px-3 py-2 text-left">Tenant</th>
              <th className="px-3 py-2 text-left">Lease End</th>
              <th className="px-3 py-2 text-left">Insurance</th>
              {showCou && <th className="px-3 py-2 text-left">Lauderhill CoU</th>}
              <th className="px-3 py-2 text-left">Violations</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(({ h, c }) => {
              const owner = `${h.first_name ?? ''} ${h.last_name ?? ''}`.trim() || '—';
              return (
                <tr key={h.account_number} className="border-b hover:bg-gray-50">
                  <td className="px-3 py-2 font-mono text-xs">{h.account_number}</td>
                  <td className="px-3 py-2">{h.street_number ?? ''} {h.address} #{h.unit_number}</td>
                  <td className="px-3 py-2">{owner}</td>
                  <td className="px-3 py-2">{c?.tenant_name ?? '—'}</td>
                  <td className="px-3 py-2"><StatusBadge status={c?.lease_status ?? null} date={c?.lease_end_date ?? null} /></td>
                  <td className="px-3 py-2"><StatusBadge status={c?.insurance_status ?? null} date={c?.insurance_expiration ?? null} /></td>
                  {showCou && (
                    <td className="px-3 py-2"><StatusBadge status={c?.cou_status ?? null} date={c?.cou_expiration ?? null} /></td>
                  )}
                  <td className="px-3 py-2">
                    {c && c.open_violation_count > 0
                      ? <span className="text-red-700 font-semibold">{c.open_violation_count} open</span>
                      : <span className="text-gray-400">—</span>}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={showCou ? 8 : 7} className="px-3 py-8 text-center text-gray-500">No units match the current filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
