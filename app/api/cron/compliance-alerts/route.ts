// =====================================================================
// app/api/cron/compliance-alerts/route.ts
//
// Runs daily at 06:00 ET via Vercel Cron (vercel.json schedule below).
// Generates compliance_alerts rows for anything expiring/expired,
// dedupes against existing un-resolved alerts, and emails staff.
//
// vercel.json:
//   { "crons": [{ "path": "/api/cron/compliance-alerts", "schedule": "0 10 * * *" }] }
//   (10:00 UTC = 06:00 ET during DST, 05:00 ET in winter — adjust if needed)
// =====================================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendComplianceDigestEmail } from '@/lib/email/compliance-digest';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

interface AlertRow {
  account_number: string;
  association_code: string;
  alert_type: string;
  severity: 'warning' | 'urgent' | 'critical';
  reference_id: number;
  reference_table: string;
  expiration_date: string;
  days_delta: number;
  message: string;
}

function severityFor(daysDelta: number): 'warning' | 'urgent' | 'critical' {
  if (daysDelta < 0) return 'critical';
  if (daysDelta <= 30) return 'urgent';
  return 'warning';
}

function daysBetween(date: string): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

export async function GET(req: Request) {
  // Vercel cron auth
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const newAlerts: AlertRow[] = [];

  // ---- 1. Leases ----
  const { data: leases } = await supabase
    .from('unit_leases')
    .select('id, account_number, association_code, tenant_name, lease_end_date')
    .not('lease_end_date', 'is', null)
    .in('application_status', ['active', 'approved', 'renewed']);

  for (const l of leases ?? []) {
    const days = daysBetween(l.lease_end_date);
    if (days > 60) continue;
    newAlerts.push({
      account_number: l.account_number,
      association_code: l.association_code,
      alert_type: days < 0 ? 'lease_expired' : 'lease_expiring',
      severity: severityFor(days),
      reference_id: l.id,
      reference_table: 'unit_leases',
      expiration_date: l.lease_end_date,
      days_delta: days,
      message: days < 0
        ? `Lease for ${l.tenant_name ?? 'unknown tenant'} expired ${Math.abs(days)} days ago`
        : `Lease for ${l.tenant_name ?? 'unknown tenant'} expires in ${days} days`,
    });
  }

  // ---- 2. Insurance ----
  const { data: insurance } = await supabase
    .from('unit_insurance')
    .select('id, account_number, association_code, carrier, expiration_date')
    .not('expiration_date', 'is', null);

  for (const i of insurance ?? []) {
    const days = daysBetween(i.expiration_date);
    if (days > 60) continue;
    newAlerts.push({
      account_number: i.account_number,
      association_code: i.association_code,
      alert_type: days < 0 ? 'insurance_expired' : 'insurance_expiring',
      severity: severityFor(days),
      reference_id: i.id,
      reference_table: 'unit_insurance',
      expiration_date: i.expiration_date,
      days_delta: days,
      message: days < 0
        ? `Insurance (${i.carrier ?? 'carrier unknown'}) expired ${Math.abs(days)} days ago`
        : `Insurance (${i.carrier ?? 'carrier unknown'}) expires in ${days} days`,
    });
  }

  // ---- 3. Lauderhill Certificate of Use ----
  const { data: cous } = await supabase
    .from('unit_certificate_of_use')
    .select('id, account_number, association_code, city, expiration_date')
    .not('expiration_date', 'is', null);

  for (const c of cous ?? []) {
    const days = daysBetween(c.expiration_date);
    if (days > 60) continue;
    newAlerts.push({
      account_number: c.account_number,
      association_code: c.association_code,
      alert_type: days < 0 ? 'cou_expired' : 'cou_expiring',
      severity: severityFor(days),
      reference_id: c.id,
      reference_table: 'unit_certificate_of_use',
      expiration_date: c.expiration_date,
      days_delta: days,
      message: days < 0
        ? `${c.city} Certificate of Use expired ${Math.abs(days)} days ago — code violation risk`
        : `${c.city} Certificate of Use expires in ${days} days`,
    });
  }

  // ---- 4. Violations ----
  const { data: violations } = await supabase
    .from('unit_violations')
    .select('id, account_number, association_code, violation_type, resolution_due_date, status')
    .in('status', ['open', 'in_progress', 'escalated'])
    .not('resolution_due_date', 'is', null);

  for (const v of violations ?? []) {
    const days = daysBetween(v.resolution_due_date);
    if (days > 60) continue;
    newAlerts.push({
      account_number: v.account_number,
      association_code: v.association_code,
      alert_type: days < 0 ? 'violation_overdue' : 'violation_due',
      severity: severityFor(days),
      reference_id: v.id,
      reference_table: 'unit_violations',
      expiration_date: v.resolution_due_date,
      days_delta: days,
      message: days < 0
        ? `Violation (${v.violation_type}) overdue by ${Math.abs(days)} days`
        : `Violation (${v.violation_type}) resolution due in ${days} days`,
    });
  }

  // ---- Dedupe & insert ----
  // Skip alerts that already exist and are unresolved (same reference_id + alert_type)
  const { data: existing } = await supabase
    .from('compliance_alerts')
    .select('reference_id, reference_table, alert_type')
    .is('resolved_at', null);

  const existingKeys = new Set(
    (existing ?? []).map(e => `${e.reference_table}:${e.reference_id}:${e.alert_type}`)
  );

  const toInsert = newAlerts.filter(a =>
    !existingKeys.has(`${a.reference_table}:${a.reference_id}:${a.alert_type}`)
  );

  if (toInsert.length) {
    await supabase.from('compliance_alerts').insert(toInsert);
  }

  // Auto-resolve alerts whose underlying record is no longer expiring (e.g. lease was renewed)
  const activeKeys = new Set(
    newAlerts.map(a => `${a.reference_table}:${a.reference_id}:${a.alert_type}`)
  );
  const toResolve = (existing ?? []).filter(e =>
    !activeKeys.has(`${e.reference_table}:${e.reference_id}:${e.alert_type}`)
  );
  if (toResolve.length) {
    // Mark as resolved; need IDs — re-query
    const { data: resolveTargets } = await supabase
      .from('compliance_alerts')
      .select('id, reference_id, reference_table, alert_type')
      .is('resolved_at', null);
    const resolveIds = (resolveTargets ?? [])
      .filter(r => !activeKeys.has(`${r.reference_table}:${r.reference_id}:${r.alert_type}`))
      .map(r => r.id);
    if (resolveIds.length) {
      await supabase
        .from('compliance_alerts')
        .update({ resolved_at: new Date().toISOString() })
        .in('id', resolveIds);
    }
  }

  // ---- Email digest to staff ----
  await sendComplianceDigestEmail({
    newAlerts: toInsert,
    totalActive: newAlerts.length,
  });

  return NextResponse.json({
    ok: true,
    scanned: {
      leases: leases?.length ?? 0,
      insurance: insurance?.length ?? 0,
      cou: cous?.length ?? 0,
      violations: violations?.length ?? 0,
    },
    newAlerts: toInsert.length,
    autoResolved: toResolve.length,
  });
}
