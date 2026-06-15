// =====================================================================
// app/admin/help/manuals/compliance/page.tsx
// Compliance Manual — step-by-step for staff with annotated mockups:
// Compliance Hub, the document matrix, unit/owner docs, Compliance
// Outreach (sent/clicked/received), and the owner & tenant self-service
// screens.
// =====================================================================

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../../../components/AdminNav'
import { ManualHeader, Step, P, UI, Tip, Figure, Pin, Frame, Badge, FakeBtn } from '../components/ManualUI'

export const metadata = { title: 'Compliance Manual — PMI Top Florida' }
export const dynamic = 'force-dynamic'

export default async function ComplianceManual() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') redirect('/')

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD"><AdminNav /></SiteHeader>
      <main className="mx-auto max-w-screen-lg px-6 py-6">
        <ManualHeader icon="🛡" title="Compliance Manual"
          intro="How to keep association, unit and owner documents complete: file documents in the Compliance Hub, run owner outreach, and close the loop with the owner & tenant self-service screens." />

        {/* STEP 1 */}
        <Step n={1} title="File any document in the Compliance Hub">
          <P>Open <UI>Compliance Hub</UI> (under Associations → Audit). Drop any document in the upload zone — Maia reads it, suggests the association and document type, and files it after you confirm. One upload can be split into several documents if it&apos;s a packet.</P>
          <Figure legend={[
            { n: 1, text: <>Upload zone — drop a PDF or photo</> },
            { n: 2, text: <>Maia&apos;s suggested association + document type; confirm to file</> },
          ]}>
            <Frame title="Compliance Hub — Documents & Compliance">
              <div className="px-4 py-4">
                <div className="relative rounded-md border border-dashed border-gray-300 px-3 py-6 text-center text-[11px] text-gray-400">
                  Drag documents here, or tap to choose
                  <Pin n={1} style={{ top: -7, right: -8 }} />
                </div>
                <div className="relative mt-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-xs">
                  <div><span className="text-gray-400">Association</span>&nbsp;&nbsp;Delvista (DELA)</div>
                  <div><span className="text-gray-400">Type</span>&nbsp;&nbsp;Insurance — property policy</div>
                  <div className="mt-2"><FakeBtn variant="orange">Apply / file</FakeBtn></div>
                  <Pin n={2} style={{ top: -7, right: -8 }} />
                </div>
              </div>
            </Frame>
          </Figure>
        </Step>

        {/* STEP 2 */}
        <Step n={2} title="See what's on file and what's missing">
          <P>Pick an association to see its full document set — what&apos;s present (with the filed file) and what&apos;s still missing, including Sunbiz, insurance, DBPR and tax. Missing rows are flagged so you know what to chase.</P>
          <Figure legend={[
            { n: 1, text: <>A document on file — click to view it</> },
            { n: 2, text: <>A missing document, flagged for follow-up</> },
          ]}>
            <Frame title="Compliance Hub — Association documents">
              <div className="px-4 py-3 text-xs">
                <div className="relative grid grid-cols-[1fr_90px] items-center gap-2 border-b border-gray-100 py-2">
                  <span className="text-gray-700">Property insurance policy</span>
                  <span className="justify-self-end"><Badge tone="success">on file</Badge></span>
                  <Pin n={1} style={{ top: 2, right: -8 }} />
                </div>
                <div className="relative grid grid-cols-[1fr_90px] items-center gap-2 py-2">
                  <span className="text-gray-700">Sunbiz annual report</span>
                  <span className="justify-self-end"><Badge tone="warn">missing</Badge></span>
                  <Pin n={2} style={{ top: 6, right: -8 }} />
                </div>
              </div>
            </Frame>
          </Figure>
        </Step>

        {/* STEP 3 */}
        <Step n={3} title="Unit & owner documents — one row per unit">
          <P>Switch to <UI>Unit / owner documents</UI> to see each unit&apos;s required documents by occupancy (owner-occupied, leased, vacant). The list is one row per physical unit, so co-owners don&apos;t duplicate it.</P>
          <Figure legend={[{ n: 1, text: <>Each unit, its occupancy, and how many documents are missing</> }]}>
            <Frame title="Compliance Hub — Unit / owner documents">
              <div className="px-4 py-3 text-xs">
                <div className="grid grid-cols-[1fr_90px_70px] gap-2 border-b border-gray-200 pb-1.5 text-[10px] uppercase text-gray-400">
                  <span>Unit / owner</span><span>Occupancy</span><span>Missing</span>
                </div>
                <div className="relative grid grid-cols-[1fr_90px_70px] items-center gap-2 border-b border-gray-100 py-2">
                  <span className="text-gray-700">Unit 4 · L. Da Silva +1</span><span><Badge tone="info">leased</Badge></span><span className="font-medium text-amber-700">3</span>
                  <Pin n={1} style={{ top: 6, right: -8 }} />
                </div>
                <div className="grid grid-cols-[1fr_90px_70px] items-center gap-2 py-2">
                  <span className="text-gray-700">Unit 5 · L. Araujo</span><span><Badge>owner-occ.</Badge></span><span className="text-emerald-600">0</span>
                </div>
              </div>
            </Frame>
          </Figure>
        </Step>

        {/* STEP 4 — outreach */}
        <Step n={4} title="Run Compliance Outreach — one association at a time">
          <P>Open <UI>Compliance Outreach</UI>, pick an association, and use <UI>Preview (dry-run)</UI> then <UI>Send to this association</UI> to email owners their self-service link. Each unit shows where it stands: <UI>Sent</UI> → <UI>Clicked</UI> → <UI>✅ Received</UI>, with links to view the documents owners uploaded.</P>
          <Figure legend={[
            { n: 1, text: <>Preview, then send to the chosen association</> },
            { n: 2, text: <>Status per unit — Sent → Clicked → ✅ Received</> },
          ]}>
            <Frame title="Compliance Outreach — Delvista">
              <div className="relative flex justify-end gap-2 px-4 py-3">
                <FakeBtn>Preview (dry-run)</FakeBtn>
                <FakeBtn variant="orange">Send to this association</FakeBtn>
                <Pin n={1} style={{ top: -3, right: -8 }} />
              </div>
              <div className="px-4 pb-3 text-xs">
                <div className="grid grid-cols-[1fr_110px] items-center gap-2 border-b border-gray-100 py-2">
                  <span className="text-gray-700">Unit 4 · L. Da Silva</span><span className="justify-self-end"><Badge tone="paid">✅ Received</Badge></span>
                </div>
                <div className="relative grid grid-cols-[1fr_110px] items-center gap-2 border-b border-gray-100 py-2">
                  <span className="text-gray-700">Unit 5 · L. Araujo</span><span className="justify-self-end"><Badge tone="info">Clicked</Badge></span>
                  <Pin n={2} style={{ top: 6, right: -8 }} />
                </div>
                <div className="grid grid-cols-[1fr_110px] items-center gap-2 py-2">
                  <span className="text-gray-700">Unit 6 · N. Santos</span><span className="justify-self-end"><Badge>Sent</Badge></span>
                </div>
              </div>
            </Frame>
          </Figure>
          <Tip>The page only tracks reliable signals — Sent, Clicked and Received. It does not guess whether an email was &quot;opened&quot;.</Tip>
        </Step>

        {/* STEP 5 — owner self-service */}
        <Step n={5} title="What the owner sees (self-service screen)">
          <P>The owner&apos;s link opens a simple page: they confirm whether the unit is owner-occupied, leased or vacant, then see exactly which documents are still needed and upload them. Their uploads come back into the review queue for staff to file.</P>
          <Figure legend={[
            { n: 1, text: <>Owner picks how the unit is used</> },
            { n: 2, text: <>The exact documents still needed, with upload</> },
          ]}>
            <Frame title="Owner document portal (no login)">
              <div className="px-4 py-4">
                <div className="text-xs text-gray-500">Delvista · Unit 4</div>
                <div className="relative mt-2 flex gap-2">
                  <FakeBtn>Owner-occupied</FakeBtn><FakeBtn variant="orange">Leased</FakeBtn><FakeBtn>Vacant</FakeBtn>
                  <Pin n={1} style={{ top: -7, right: -8 }} />
                </div>
                <div className="relative mt-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-xs">
                  <div className="text-gray-700">Still needed:</div>
                  <div className="mt-1 text-gray-500">• Tenant insurance (HO-4) &nbsp; • Lease agreement &nbsp; • Tenant contact</div>
                  <div className="mt-2"><FakeBtn variant="orange">Upload documents</FakeBtn></div>
                  <Pin n={2} style={{ top: -7, right: -8 }} />
                </div>
              </div>
            </Frame>
          </Figure>
        </Step>

        {/* STEP 6 — tenant self-service */}
        <Step n={6} title="Closing the loop on leased units (tenant screen)">
          <P>When an owner says the unit is leased, Maia triggers a second request to the tenant for their renter&apos;s insurance and contact details. The tenant uploads through their own link, and it lands in the same review queue tagged to the unit.</P>
          <Figure legend={[{ n: 1, text: <>Tenant provides renter&apos;s insurance + contact info</> }]}>
            <Frame title="Tenant document portal (no login)">
              <div className="px-4 py-4 text-xs">
                <div className="text-gray-500">Delvista · Unit 4 — tenant</div>
                <div className="relative mt-2 rounded-md border border-gray-200 bg-gray-50 p-3">
                  <div className="text-gray-700">Please provide:</div>
                  <div className="mt-1 text-gray-500">• Renter&apos;s insurance (HO-4) &nbsp; • Phone &amp; email &nbsp; • Vehicle / pet info</div>
                  <div className="mt-2"><FakeBtn variant="orange">Upload &amp; submit</FakeBtn></div>
                  <Pin n={1} style={{ top: -7, right: -8 }} />
                </div>
              </div>
            </Frame>
          </Figure>
        </Step>
      </main>
    </div>
  )
}
