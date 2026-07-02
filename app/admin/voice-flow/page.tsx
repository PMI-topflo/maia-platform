// =====================================================================
// app/admin/voice-flow/page.tsx
//
// Reference diagram of the live Twilio voice IVR call flow (language
// menu, identification, routing). Staff-facing — nothing interactive
// server-side, just a maintained snapshot of app/api/webhook/route.ts's
// handleVoice()/handleVoiceInput() logic.
// =====================================================================

import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../components/AdminNav'
import VoiceFlowDiagram from '../components/VoiceFlowDiagram'

export const metadata = { title: 'Voice Flow — PMI Top Florida' }

export default function VoiceFlowPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD">
        <AdminNav />
      </SiteHeader>

      <main style={{ padding: '2rem', maxWidth: 1180, margin: '0 auto' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.25rem' }}>Voice IVR Call Flow</h1>
        <p style={{ color: '#6b7280', marginBottom: '1.5rem' }}>
          How MAIA handles an inbound phone call — language menu, identification, and how a request gets routed
          (goodbye / WhatsApp / category menu / straight to an answer). Hover any box for the function it maps to
          in <code>app/api/webhook/route.ts</code>. This is a maintained reference snapshot, not auto-generated —
          update it alongside the code when the flow changes.
        </p>

        <section style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '1.25rem' }}>
            <VoiceFlowDiagram />
          </div>
        </section>
      </main>
    </div>
  )
}
