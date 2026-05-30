// =====================================================================
// app/admin/invoices/cinc/[invoiceId]/page.tsx
// CINC invoice detail page — server-rendered. Mirrors the layout of
// CINC's own invoice detail view so Karen can see vendor / Pay From /
// Pay By / status / expense items / notes / payment history / audit
// trail without leaving MAIA.
//
// Linked from:
//   - the invoice intake card's pushed-to-CINC banner
//   - the reconciliation page's invoice # column on CINC-sourced rows
//
// All data is pulled live from CINC on each request. Fetches run in
// parallel (Promise.all) so the page loads in one round-trip's worth
// of latency, not five.
// =====================================================================

import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../../../components/AdminNav'
import {
  getCincInvoice,
  listInvoiceNotes,
  listInvoicePayments,
  listInvoiceHistory,
  type CincInvoice,
  type CincInvoiceNote,
  type CincInvoicePayment,
  type CincInvoiceHistoryEntry,
} from '@/lib/integrations/cinc'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

interface Props { params: Promise<{ invoiceId: string }> }

export async function generateMetadata({ params }: Props) {
  const { invoiceId } = await params
  return { title: `Invoice #${invoiceId} — PMI Top Florida` }
}

function fmt$(n: number | null | undefined): string {
  if (n == null) return '—'
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

function statusBadgeColors(status: string | null | undefined): { bg: string; fg: string; border: string } {
  const s = (status ?? '').toUpperCase()
  if (s === 'PAID')               return { bg: '#dcfce7', fg: '#166534', border: '#86efac' }
  if (s === 'READY FOR PAYMENT')  return { bg: '#dbeafe', fg: '#1e40af', border: '#93c5fd' }
  if (s === 'PENDING APPROVAL')   return { bg: '#fef3c7', fg: '#92400e', border: '#fcd34d' }
  if (s === 'VOID' || s === 'VOIDED') return { bg: '#fee2e2', fg: '#991b1b', border: '#fca5a5' }
  return { bg: '#f3f4f6', fg: '#374151', border: '#d1d5db' }
}

export default async function CincInvoicePage({ params }: Props) {
  const { invoiceId: invoiceIdStr } = await params
  const invoiceId = parseInt(invoiceIdStr, 10)

  if (!Number.isFinite(invoiceId)) {
    return (
      <>
        <SiteHeader subtitle="INVOICE DETAIL"><AdminNav /></SiteHeader>
        <ErrorState message={`Invalid invoice id: ${invoiceIdStr}`} />
      </>
    )
  }

  // Pull everything in parallel — invoice + notes + payments + history.
  // Also peek at our local invoice_intake_drafts to see if this is a
  // MAIA-pushed invoice (gives us a Drive link to the PDF).
  const [invoice, notes, payments, history, mailDraft] = await Promise.all([
    getCincInvoice(invoiceId).catch(() => null),
    listInvoiceNotes(invoiceId).catch(() => [] as CincInvoiceNote[]),
    listInvoicePayments(invoiceId).catch(() => [] as CincInvoicePayment[]),
    listInvoiceHistory(invoiceId).catch(() => [] as CincInvoiceHistoryEntry[]),
    findMaiaDraftByCincInvoiceId(invoiceId),
  ])

  if (!invoice || !invoice.InvoiceID) {
    return (
      <>
        <SiteHeader subtitle="INVOICE DETAIL"><AdminNav /></SiteHeader>
        <ErrorState message={`Invoice #${invoiceId} not found in CINC.`} />
      </>
    )
  }

  const status     = invoice.InvoiceStatus ?? '—'
  const statusCols = statusBadgeColors(status)
  // CINC stores expense-item amounts as NEGATIVE (a debit allocation),
  // while TotalInvoiceAmount is positive. Compare magnitudes so a balanced
  // invoice reads $0 difference — otherwise (160) − (−160) shows a phantom
  // $320. Items render as positive magnitudes too, for readability.
  const linesSum   = invoice.ExpenseItems?.reduce((s, e) => s + (e.Amount ?? 0), 0) ?? 0
  const totalLines = Math.abs(linesSum)
  const difference = Math.abs(invoice.TotalInvoiceAmount ?? 0) - totalLines

  return (
    <>
      <SiteHeader subtitle="INVOICE DETAIL"><AdminNav /></SiteHeader>
      <div style={{ maxWidth: 1200, margin: '24px auto', padding: '0 16px', fontFamily: 'system-ui, sans-serif' }}>

        {/* Header strip */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>
              Invoice #{invoice.InvoiceNumber ?? invoice.InvoiceID}
            </h1>
            <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 13 }}>
              {invoice.AssociationName ?? invoice.AssocCode} · {invoice.Vendor ?? 'Vendor unknown'}
            </p>
          </div>
          <span style={{ padding: '6px 12px', borderRadius: 4, fontSize: 12, fontWeight: 600, ...statusCols, border: `1px solid ${statusCols.border}` }}>
            {status}
          </span>
        </div>

        {/* MAIA provenance — only shown if this invoice came from MAIA */}
        {mailDraft && (
          <div style={{ padding: 10, marginBottom: 14, background: '#ecfdf5', border: '1px solid #86efac', borderRadius: 4, fontSize: 12, color: '#065f46' }}>
            <strong>Pushed by MAIA</strong> · draft #{mailDraft.id}
            {mailDraft.pushed_by && ` · pushed by ${mailDraft.pushed_by}`}
            {mailDraft.pushed_at && ` on ${fmtDateTime(mailDraft.pushed_at)}`}
            {mailDraft.drive_file_id && (
              <>
                {' · '}
                <a href={`https://drive.google.com/file/d/${mailDraft.drive_file_id}/view`} target="_blank" rel="noreferrer" style={{ color: '#065f46', fontWeight: 600 }}>
                  Open PDF in Drive
                </a>
              </>
            )}
          </div>
        )}

        {/* Core invoice info — two columns. Left = invoice metadata,
            right = vendor. */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
          <InfoCard title="Invoice">
            <Row label="Association">{invoice.AssociationName ?? invoice.AssocCode ?? '—'}</Row>
            <Row label="Invoice #">{invoice.InvoiceNumber ?? '—'}</Row>
            <Row label="Invoice Date">{fmtDate(invoice.InvoiceDate)}</Row>
            <Row label="Due Date">{fmtDate(invoice.InvoiceDueDate)}</Row>
            <Row label="Vendor Account #">{invoice.VendorAccountNumber ?? '—'}</Row>
            <Row label="Work Order #">{invoice.WorkOrderNumber ?? '—'}</Row>
            <Row label="Total"><strong style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt$(invoice.TotalInvoiceAmount)}</strong></Row>
            <Row label="Pay From">{invoice.BankAccountDescription ?? '—'}</Row>
            <Row label="Pay By">{invoice.PayByType ?? '—'}</Row>
            <Row label="Check Memo">{invoice.CheckMemo ?? '—'}</Row>
            <Row label="Note Description">{invoice.NoteDescription ?? '—'}</Row>
          </InfoCard>

          <InfoCard title="Vendor">
            <Row label="Name"><strong>{invoice.Vendor ?? '—'}</strong></Row>
            <Row label="Address">
              <div style={{ lineHeight: 1.5 }}>
                {invoice.VendorAddress1 && <div>{invoice.VendorAddress1}</div>}
                {invoice.VendorAddress2 && <div>{invoice.VendorAddress2}</div>}
                {(invoice.VendorCity || invoice.VendorState || invoice.VendorZip) && (
                  <div>{[invoice.VendorCity, invoice.VendorState, invoice.VendorZip].filter(Boolean).join(', ')}</div>
                )}
                {!invoice.VendorAddress1 && !invoice.VendorAddress2 && !invoice.VendorCity && '—'}
              </div>
            </Row>
            <Row label="Vendor ID">{invoice.VendorID ?? '—'}</Row>
            <Row label="Created">{fmtDateTime(invoice.InvoiceCreatedDate)}</Row>
            <Row label="Created by">{invoice.InvoiceCreatedByName ?? (invoice.InvoiceCreatedById ?? '—')}</Row>
          </InfoCard>
        </div>

        {/* Expense items table */}
        <Section title={`Expense items (${invoice.ExpenseItems?.length ?? 0})`}>
          {!invoice.ExpenseItems || invoice.ExpenseItems.length === 0 ? (
            <p style={{ color: '#9ca3af', fontSize: 12, margin: 0 }}>No expense items on this invoice.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#f3f4f6' }}>
                  <th style={thStyle}>GL Account</th>
                  <th style={thStyle}>Description</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {invoice.ExpenseItems.map((item, i) => (
                  <tr key={item.ID ?? i} style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={tdStyle}>{item.GLAccount ?? '—'}</td>
                    <td style={tdStyle}>{item.ItemDescription ?? '—'}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt$(Math.abs(item.Amount ?? 0))}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: '1px solid #d1d5db', background: '#f9fafb', fontWeight: 600 }}>
                  <td style={tdStyle} colSpan={2}>Subtotal</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt$(totalLines)}</td>
                </tr>
                {Math.abs(difference) > 0.005 && (
                  <tr style={{ background: '#fef3c7' }}>
                    <td style={tdStyle} colSpan={2}><strong>Difference (Total − Items)</strong></td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#92400e' }}>{fmt$(difference)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </Section>

        {/* Invoice notes */}
        <Section title={`Notes (${notes.length})`}>
          {notes.length === 0 ? (
            <p style={{ color: '#9ca3af', fontSize: 12, margin: 0 }}>No notes on this invoice.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {notes.map((n, i) => (
                <li key={n.NoteID ?? i} style={{ padding: '8px 0', borderTop: i > 0 ? '1px solid #f3f4f6' : 'none', fontSize: 12 }}>
                  <div style={{ color: '#6b7280', fontSize: 11, marginBottom: 2 }}>
                    {fmtDateTime(n.NoteDate)}
                    {n.CreatedBy && ` · ${n.CreatedBy}`}
                    {n.DeletedFlag && ' · DELETED'}
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{n.NoteContent ?? ''}</div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Payment history */}
        <Section title={`Payments (${payments.length})`}>
          {payments.length === 0 ? (
            <p style={{ color: '#9ca3af', fontSize: 12, margin: 0 }}>No payments recorded yet.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#f3f4f6' }}>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>Description</th>
                  <th style={thStyle}>Check #</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Amount</th>
                  <th style={thStyle}>Reconciled</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p, i) => (
                  <tr key={i} style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={tdStyle}>{fmtDate(p.TransDate)}</td>
                    <td style={tdStyle}>{p.Description ?? '—'}</td>
                    <td style={tdStyle}>{p.CheckNo ?? '—'}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#991b1b' }}>−{fmt$(p.Amount)}</td>
                    <td style={tdStyle}>{p.ReconcileDate ? fmtDate(p.ReconcileDate) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        {/* Audit trail */}
        <Section title={`Audit trail (${history.length})`}>
          {history.length === 0 ? (
            <p style={{ color: '#9ca3af', fontSize: 12, margin: 0 }}>No history yet. CINC may take a few minutes to log a newly-created invoice.</p>
          ) : (
            <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {history.map((h, i) => (
                <li
                  key={i}
                  style={{
                    padding: '6px 0',
                    borderTop: i > 0 ? '1px solid #f3f4f6' : 'none',
                    fontSize: 12,
                    display: 'grid',
                    gridTemplateColumns: '160px 1fr auto',
                    gap: 10,
                    alignItems: 'baseline',
                  }}
                >
                  <span style={{ color: '#6b7280' }}>{fmtDateTime(h.Date)}</span>
                  <span>
                    <strong>{h.Action ?? '—'}</strong>
                    {h.Message && <span style={{ color: '#4b5563' }}> · {h.Message}</span>}
                  </span>
                  <span style={{ color: '#9ca3af', fontSize: 11 }}>{h.User ?? ''}</span>
                </li>
              ))}
            </ol>
          )}
        </Section>

        {/* Attachments — CINC stores ImageID; the binary is at
            /document/{ImageID} but we don't currently fetch the raw
            bytes here. If MAIA pushed this invoice we link to the
            Drive copy at the top. CINC-side attachments are listed
            here for reference. */}
        {invoice.AttachmentInfo && invoice.AttachmentInfo.length > 0 && (
          <Section title={`CINC attachments (${invoice.AttachmentInfo.length})`}>
            <ul style={{ listStyle: 'disc', paddingLeft: 18, margin: 0, fontSize: 12 }}>
              {invoice.AttachmentInfo.map((a, i) => (
                <li key={a.ImageID ?? i}>
                  {a.FileName ?? `Attachment #${a.ImageID}`}
                  {a.ImageID != null && <span style={{ color: '#6b7280' }}> (ImageID {a.ImageID})</span>}
                </li>
              ))}
            </ul>
          </Section>
        )}

        <p style={{ marginTop: 20, fontSize: 11, color: '#9ca3af' }}>
          Live data from CINC · refreshed on every page load
        </p>
      </div>
    </>
  )
}

// ── Tiny presentational helpers ────────────────────────────────────
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: '#374151', fontSize: 11, borderBottom: '1px solid #e5e7eb' }
const tdStyle: React.CSSProperties = { padding: '6px 8px', verticalAlign: 'top' }

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 4, padding: 14, background: '#fff' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>{title}</div>
      <dl style={{ margin: 0 }}>{children}</dl>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 6, padding: '3px 0', fontSize: 12 }}>
      <dt style={{ color: '#6b7280' }}>{label}</dt>
      <dd style={{ margin: 0, color: '#111827' }}>{children}</dd>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 18, border: '1px solid #e5e7eb', borderRadius: 4, padding: 14, background: '#fff' }}>
      <h2 style={{ fontSize: 13, fontWeight: 600, margin: '0 0 10px', color: '#111827' }}>{title}</h2>
      {children}
    </section>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <div style={{ maxWidth: 700, margin: '40px auto', padding: '0 16px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ padding: 16, background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 4, color: '#991b1b' }}>
        <strong>Couldn&apos;t load the invoice.</strong> {message}
      </div>
    </div>
  )
}

// ── Local DB lookup ──────────────────────────────────────────────────
async function findMaiaDraftByCincInvoiceId(invoiceId: number) {
  const { data } = await supabaseAdmin
    .from('invoice_intake_drafts')
    .select('id, drive_file_id, pushed_by, pushed_at')
    .eq('cinc_invoice_id', String(invoiceId))
    .maybeSingle()
  return data as { id: number; drive_file_id: string | null; pushed_by: string | null; pushed_at: string | null } | null
}
