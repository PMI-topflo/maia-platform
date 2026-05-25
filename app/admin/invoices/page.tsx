// =====================================================================
// app/admin/invoices/page.tsx
// Invoice intake queue. Karen reviews each PDF MAIA pulled from the
// billing@ inbox, edits any fields where extraction was off, then
// clicks Push to CINC. Server component — loads the initial draft
// list + vendor catalog and hands off to the client queue.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { listVendorsFull } from '@/lib/integrations/cinc'
import InvoiceIntakeQueue from './components/InvoiceIntakeQueue'

const PDF_BUCKET            = 'invoice-intake-pdfs'
const PDF_SIGNED_URL_TTL_S  = 60 * 60      // 1 hour

export const metadata = { title: 'Invoice intake — PMI Top Florida' }
export const dynamic  = 'force-dynamic'

interface SP { status?: string }

interface PageProps {
  searchParams: Promise<SP>
}

export default async function InvoicesPage({ searchParams }: PageProps) {
  const sp     = await searchParams
  const status = typeof sp.status === 'string' ? sp.status : 'pending_review'

  // Server-side initial load — counts for tab pills + vendor catalog +
  // associations. The client component refetches drafts as Karen
  // changes tabs / edits / pushes.
  const [counts, vendors, assocs, drafts] = await Promise.all([
    loadStatusCounts(),
    safeFetchVendors(),
    loadAssociations(),
    loadDrafts(status),
  ])

  // Sign one URL per draft so the client can iframe-preview the PDF
  // without a second round-trip. Done server-side because the bucket
  // is private and the SA key shouldn't leave the server.
  const pdfUrlsById = await buildSignedUrls(drafts.map(d => d.pdf_storage_key).filter(Boolean) as string[])
  const draftsWithUrls = drafts.map(d => ({
    ...d,
    pdf_signed_url: d.pdf_storage_key ? (pdfUrlsById.get(d.pdf_storage_key) ?? null) : null,
  }))

  return (
    <InvoiceIntakeQueue
      initialStatus  = {status}
      initialDrafts  = {draftsWithUrls}
      initialCounts  = {counts}
      vendors        = {vendors}
      associations   = {assocs}
    />
  )
}

async function buildSignedUrls(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (paths.length === 0) return out
  const { data, error } = await supabaseAdmin.storage
    .from(PDF_BUCKET)
    .createSignedUrls(paths, PDF_SIGNED_URL_TTL_S)
  if (error) return out
  for (let i = 0; i < paths.length; i++) {
    const url = data?.[i]?.signedUrl
    if (url) out.set(paths[i], url)
  }
  return out
}

async function loadStatusCounts(): Promise<Record<string, number>> {
  const { data } = await supabaseAdmin
    .from('invoice_intake_drafts')
    .select('status')
  const out: Record<string, number> = {}
  for (const row of (data ?? [])) out[row.status as string] = (out[row.status as string] ?? 0) + 1
  return out
}

async function loadDrafts(status: string) {
  let q = supabaseAdmin
    .from('invoice_intake_drafts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)
  if (status !== 'all') q = q.eq('status', status)
  const { data } = await q
  return data ?? []
}

async function safeFetchVendors() {
  try {
    const v = await listVendorsFull()
    return v.map(x => ({
      id:        x.VendorId,
      name:      x.VendorName,
      shortName: x.UserDefined1 ?? null,
    }))
  } catch {
    return []
  }
}

async function loadAssociations() {
  const { data } = await supabaseAdmin
    .from('associations')
    .select('association_code, association_name')
    .eq('active', true)
    .order('association_name')
  return (data ?? []).map(r => ({
    code: String(r.association_code ?? ''),
    name: String(r.association_name ?? ''),
  }))
}
