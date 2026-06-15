// =====================================================================
// app/admin/help/manuals/financial/page.tsx
// Financial Manual — step-by-step for staff with annotated mockups:
// how invoices arrive (email + manual upload), reviewing the invoice
// card, pushing to CINC, and monthly reconciliation.
// =====================================================================

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../../../components/AdminNav'
import { ManualHeader, Step, P, UI, Tip, Figure, Pin, Frame, TabStrip, Badge, FakeBtn } from '../components/ManualUI'

export const metadata = { title: 'Financial Manual — PMI Top Florida' }
export const dynamic = 'force-dynamic'

export default async function FinancialManual() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') redirect('/')

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD"><AdminNav /></SiteHeader>
      <main className="mx-auto max-w-screen-lg px-6 py-6">
        <ManualHeader icon="💵" title="Financial Manual"
          intro="How invoices flow through Maia: arriving by email or manual upload, getting reviewed, pushed to CINC for payment, and reconciled against the bank." />

        {/* STEP 1 — email intake */}
        <Step n={1} title="How invoices arrive — by email">
          <P>Vendors email their invoice to <UI>billing@topfloridaproperties.com</UI>. Maia reads each PDF, matches the vendor in CINC, checks for duplicates, and creates a draft in <UI>Invoice intake → Pending review</UI>. No manual step is needed for emailed invoices to appear.</P>
          <Tip>Phone photos work too — Maia converts an image to a one-page PDF automatically.</Tip>
        </Step>

        {/* STEP 2 — manual upload */}
        <Step n={2} title="Add an invoice manually">
          <P>For an invoice that didn&apos;t come by email, open <UI>Invoice intake</UI> and click <UI>+ Add invoice</UI> (top right), or use <UI>Add invoice</UI> from an association&apos;s Actions menu to pre-tag it. Pick the PDF/photo — it runs through the same pipeline and lands in <UI>Pending review</UI>.</P>
          <Figure legend={[{ n: 1, text: <>The <UI>+ Add invoice</UI> button on the intake page</> }]}>
            <Frame title="Invoice intake">
              <div className="relative flex items-center justify-between px-4 py-3">
                <span className="text-sm font-medium text-gray-800">Invoice intake</span>
                <span className="relative"><FakeBtn variant="orange">+ Add invoice</FakeBtn><Pin n={1} style={{ top: -7, right: -8 }} /></span>
              </div>
              <TabStrip tabs={['Pending review', 'On hold', 'Ready to push', 'Archived', 'Rejected']} active="Pending review" />
            </Frame>
          </Figure>
        </Step>

        {/* STEP 3 — review card */}
        <Step n={3} title="Review the invoice and confirm each field">
          <P>Open the draft and check Maia&apos;s read against the PDF shown beside it: <UI>vendor</UI>, <UI>association</UI>, <UI>invoice #</UI>, <UI>amount</UI>, <UI>GL line</UI>, and <UI>pay-from bank account</UI>. Fix anything that&apos;s off, then mark it <UI>Ready to push</UI>. Maia runs a funds check and blocks obvious double-payments.</P>
          <Figure legend={[
            { n: 1, text: <>The PDF preview, side-by-side with the fields</> },
            { n: 2, text: <>Confirm vendor, GL line, bank account, amount</> },
            { n: 3, text: <>Mark <em>Ready to push</em> when it&apos;s correct</> },
          ]}>
            <Frame title="Invoice intake — review">
              <div className="grid grid-cols-[120px_1fr]">
                <div className="relative border-r border-gray-200 bg-gray-100 p-3 text-center text-[10px] text-gray-400">
                  PDF<br />preview
                  <Pin n={1} style={{ top: 4, left: 4 }} />
                </div>
                <div className="relative p-3 text-xs leading-7">
                  <div><span className="text-gray-400">Vendor</span>&nbsp;&nbsp;ABCO Roofing</div>
                  <div><span className="text-gray-400">GL line</span>&nbsp;&nbsp;Repairs &amp; maintenance</div>
                  <div><span className="text-gray-400">Bank</span>&nbsp;&nbsp;Operating ····1950 &nbsp;·&nbsp; <span className="text-gray-400">Amount</span>&nbsp;&nbsp;$1,250.00</div>
                  <Pin n={2} style={{ top: 8, right: -8 }} />
                  <div className="relative mt-1 inline-block"><FakeBtn variant="orange">Mark ready to push</FakeBtn><Pin n={3} style={{ top: -7, right: -8 }} /></div>
                </div>
              </div>
            </Frame>
          </Figure>
        </Step>

        {/* STEP 4 — push to CINC */}
        <Step n={4} title="Push to CINC for payment">
          <P>From the <UI>Ready to push</UI> tab, click <UI>Push to CINC</UI>. Maia creates the invoice in CINC, attaches the PDF, mirrors it to Drive, and moves the draft to <UI>Archived</UI>. If the invoice was tied to a work order, that work order is closed as paid.</P>
          <Figure legend={[
            { n: 1, text: <>The <UI>Ready to push</UI> tab</> },
            { n: 2, text: <>Push to CINC — creates the invoice + attaches the PDF</> },
          ]}>
            <Frame title="Invoice intake">
              <div className="relative">
                <TabStrip tabs={['Pending review', 'On hold', 'Ready to push', 'Archived', 'Rejected']} active="Ready to push" />
                <Pin n={1} style={{ top: 4, left: 150 }} />
              </div>
              <div className="px-4 py-3 text-xs">
                <div>ABCO Roofing · $1,250.00 · Delvista</div>
                <div className="relative mt-2 inline-block"><FakeBtn variant="orange">Push to CINC</FakeBtn><Pin n={2} style={{ top: -7, right: -8 }} /></div>
              </div>
            </Frame>
          </Figure>
        </Step>

        {/* STEP 5 — reconciliation */}
        <Step n={5} title="Reconcile the month">
          <P>In <UI>Reconciliation</UI>, pick the association and month. Maia matches bank activity against CINC and surfaces what still needs to be paid or recorded. Work the list until the bank and CINC agree for the period.</P>
          <Figure legend={[{ n: 1, text: <>Items to pay or record so the bank and CINC match</> }]}>
            <Frame title="Reconciliation — Delvista · June 2026">
              <div className="px-4 py-3 text-xs">
                <div className="grid grid-cols-[1fr_90px] gap-2 border-b border-gray-200 pb-1.5 text-[10px] uppercase text-gray-400"><span>Item</span><span>Status</span></div>
                <div className="relative grid grid-cols-[1fr_90px] items-center gap-2 border-b border-gray-100 py-2">
                  <span className="text-gray-700">ABCO Roofing · $1,250.00</span><span className="justify-self-end"><Badge tone="warn">to pay</Badge></span>
                  <Pin n={1} style={{ top: 6, right: -8 }} />
                </div>
                <div className="grid grid-cols-[1fr_90px] items-center gap-2 py-2">
                  <span className="text-gray-700">FPL electric · $310.40</span><span className="justify-self-end"><Badge tone="paid">matched</Badge></span>
                </div>
              </div>
            </Frame>
          </Figure>
        </Step>
      </main>
    </div>
  )
}
