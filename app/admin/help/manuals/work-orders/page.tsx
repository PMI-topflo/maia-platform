// =====================================================================
// app/admin/help/manuals/work-orders/page.tsx
// Work Order Manual — step-by-step for staff, with annotated mockups of
// each screen (association hub, +Add invoice, vendor portal, invoice
// review, board approval popup, paid).
// =====================================================================

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../../../components/AdminNav'
import { ManualHeader, Step, P, UI, Tip, Figure, Pin, Frame, TabStrip, Badge, FakeBtn } from '../components/ManualUI'

export const metadata = { title: 'Work Order Manual — PMI Top Florida' }
export const dynamic = 'force-dynamic'

export default async function WorkOrderManual() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') redirect('/')

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD"><AdminNav /></SiteHeader>
      <main className="mx-auto max-w-screen-lg px-6 py-6">
        <ManualHeader icon="🔧" title="Work Order Manual"
          intro="How to take a work order from done-work to paid: add the vendor's invoice, confirm the board approved it, and let Maia close the work order as paid." />

        {/* STEP 1 */}
        <Step n={1} title="Open the association and go to Work Orders">
          <P>From <UI>Associations</UI>, open the association, then click the <UI>Work Orders</UI> tab. Each work order shows its work status and a <UI>Payment</UI> badge. Use the dropdown by the title to jump to another association.</P>
          <Figure legend={[
            { n: 1, text: <>The <UI>Work Orders</UI> tab</> },
            { n: 2, text: <>The <UI>Payment</UI> column — <em>Ready for payment</em> → <em>Paid</em></> },
          ]}>
            <Frame title="Delvista Condominium Association">
              <div className="relative">
                <TabStrip tabs={['Overview', 'Board & owners', 'Vendors', 'Work Orders', 'Financials']} active="Work Orders" />
                <Pin n={1} style={{ top: 4, left: 196 }} />
              </div>
              <div className="px-3 py-3">
                <div className="grid grid-cols-[64px_1fr_72px_92px] gap-2 border-b border-gray-200 pb-1.5 text-[10px] uppercase text-gray-400">
                  <span>Ref</span><span>Subject</span><span>Status</span><span>Payment</span>
                </div>
                <div className="grid grid-cols-[64px_1fr_72px_92px] items-center gap-2 border-b border-gray-100 py-2 text-xs">
                  <span className="font-mono text-[11px] text-[#f26a1b]">WO-126</span>
                  <span className="text-gray-600">Roof leak repair</span>
                  <span><Badge>resolved</Badge></span>
                  <span className="relative"><Badge tone="info">ready</Badge><Pin n={2} style={{ top: -6, left: 60 }} /></span>
                </div>
                <div className="grid grid-cols-[64px_1fr_72px_92px] items-center gap-2 py-2 text-xs">
                  <span className="font-mono text-[11px] text-[#f26a1b]">WO-171</span>
                  <span className="text-gray-600">Pool pump service</span>
                  <span><Badge tone="success">open</Badge></span>
                  <span className="text-gray-300">—</span>
                </div>
              </div>
            </Frame>
          </Figure>
        </Step>

        {/* STEP 2 */}
        <Step n={2} title="Add the vendor's invoice to the work order">
          <P>On the work order row, click <UI>+ Add invoice</UI> and choose the invoice PDF or a phone photo. Maia reads the vendor, amount and invoice number, links the invoice to this work order, and marks the work order <UI>Ready for payment</UI>.</P>
          <Tip>The work order stays open while it&apos;s Ready for payment. It only closes once the invoice is actually paid (Step 6).</Tip>
          <Figure legend={[{ n: 1, text: <>The green <UI>+ Add invoice</UI> button on each work order row</> }]}>
            <Frame title="Delvista — Work Orders">
              <div className="grid grid-cols-[64px_1fr_120px] items-center gap-2 px-3 py-3 text-xs">
                <span className="font-mono text-[11px] text-[#f26a1b]">WO-126</span>
                <span className="text-gray-600">Roof leak repair · ABCO Roofing</span>
                <span className="relative justify-self-end"><FakeBtn variant="green">+ Add invoice</FakeBtn><Pin n={1} style={{ top: -7, right: -8 }} /></span>
              </div>
            </Frame>
          </Figure>
        </Step>

        {/* STEP 3 — vendor portal */}
        <Step n={3} title="Where the invoice comes from (the vendor screen)">
          <P>Vendors can also send their invoice themselves. From a work order you send the vendor a private link; they open it (no login) and upload the invoice or estimate. It flows into the same review queue, already linked to the work order.</P>
          <Figure legend={[
            { n: 1, text: <>Vendor picks <UI>Invoice</UI> and uploads the file</> },
            { n: 2, text: <>Their upload is tagged to the work order automatically</> },
          ]}>
            <Frame title="Vendor upload · WO-126 (no login)">
              <div className="px-4 py-4">
                <div className="text-xs text-gray-500">Upload for <span className="font-medium text-gray-800">Delvista · WO-126 — Roof leak repair</span></div>
                <div className="mt-3 flex gap-2">
                  <span className="relative"><FakeBtn variant="orange">Invoice</FakeBtn><Pin n={1} style={{ top: -7, right: -8 }} /></span>
                  <FakeBtn>Estimate</FakeBtn>
                  <FakeBtn>Photos</FakeBtn>
                </div>
                <div className="relative mt-3 rounded-md border border-dashed border-gray-300 px-3 py-6 text-center text-[11px] text-gray-400">
                  Drag a file here, or tap to choose
                  <Pin n={2} style={{ top: -7, right: -8 }} />
                </div>
              </div>
            </Frame>
          </Figure>
        </Step>

        {/* STEP 4 — review queue */}
        <Step n={4} title="Review it in Invoice intake">
          <P>The invoice lands in <UI>Invoice intake</UI> under the <UI>Pending review</UI> tab. Isabela checks Maia&apos;s read — vendor, association, amount, GL line, bank account — and corrects anything before it moves on. Nothing pays without this review.</P>
          <Figure legend={[
            { n: 1, text: <>The <UI>Pending review</UI> tab (new invoices land here)</> },
            { n: 2, text: <>Confirm each field Maia read from the PDF</> },
          ]}>
            <Frame title="Invoice intake">
              <div className="relative">
                <TabStrip tabs={['Pending review', 'On hold', 'Ready to push', 'Archived', 'Rejected']} active="Pending review" />
                <Pin n={1} style={{ top: 4, left: 6 }} />
              </div>
              <div className="px-4 py-3 text-xs leading-7">
                <div><span className="text-gray-400">Vendor</span>&nbsp;&nbsp;ABCO Roofing</div>
                <div><span className="text-gray-400">Association</span>&nbsp;&nbsp;Delvista (DELA)&nbsp;&nbsp;·&nbsp;&nbsp;<span className="text-gray-400">Amount</span>&nbsp;&nbsp;$1,250.00</div>
                <div className="relative mt-1 inline-block"><FakeBtn variant="orange">Confirm fields</FakeBtn><Pin n={2} style={{ top: -7, right: -8 }} /></div>
              </div>
            </Frame>
          </Figure>
        </Step>

        {/* STEP 5 — board approval */}
        <Step n={5} title="Confirm the board approved it before paying">
          <P>On a work-order invoice, click <UI>View board approval</UI>. Maia pops up the board-approved estimate with each board member&apos;s signature and the date — so Karen can confirm sign-off at a glance. If there&apos;s no approval on file, the popup says so.</P>
          <Figure legend={[
            { n: 1, text: <>The <UI>View board approval</UI> button on the invoice</> },
            { n: 2, text: <>Board members&apos; signatures + approval date</> },
          ]}>
            <Frame title="Invoice intake — board approval">
              <div className="px-4 py-3">
                <div className="relative inline-block"><FakeBtn variant="violet">🛡 View board approval</FakeBtn><Pin n={1} style={{ top: -7, right: -8 }} /></div>
                <div className="relative mt-3 rounded-md border border-gray-200 bg-gray-50 p-3">
                  <div className="text-xs font-medium text-gray-800">ABCO Roofing · $1,250.00 · <span className="text-emerald-700">✓ Approved Jun 9, 2026</span></div>
                  <div className="mt-2 flex gap-2">
                    <div className="rounded border border-gray-200 bg-white px-2 py-1.5 text-[10px] text-gray-600">Gil Marianowsky<br /><span className="italic text-gray-400">— signed —</span></div>
                    <div className="rounded border border-gray-200 bg-white px-2 py-1.5 text-[10px] text-gray-600">Eitan Levy<br /><span className="italic text-gray-400">— signed —</span></div>
                  </div>
                  <Pin n={2} style={{ top: 30, right: -8 }} />
                </div>
              </div>
            </Frame>
          </Figure>
          <Tip>The board signs through their own private link (the board approval screen). The signatures you see here are captured there.</Tip>
        </Step>

        {/* STEP 6 — pushed/paid */}
        <Step n={6} title="Push to CINC — the work order closes as Paid">
          <P>Once reviewed, the invoice is marked <UI>Ready to push</UI> and pushed to CINC for payment. When that happens, Maia automatically closes the linked work order and stamps it <UI>Paid</UI> — no extra step.</P>
          <Figure legend={[{ n: 1, text: <>The work order is now <em>Paid</em> and closed</> }]}>
            <Frame title="Delvista — Work Orders">
              <div className="grid grid-cols-[64px_1fr_72px_92px] items-center gap-2 px-3 py-3 text-xs">
                <span className="font-mono text-[11px] text-[#f26a1b]">WO-126</span>
                <span className="text-gray-600">Roof leak repair</span>
                <span><Badge>closed</Badge></span>
                <span className="relative"><Badge tone="paid">✓ Paid</Badge><Pin n={1} style={{ top: -7, left: 56 }} /></span>
              </div>
            </Frame>
          </Figure>
        </Step>
      </main>
    </div>
  )
}
