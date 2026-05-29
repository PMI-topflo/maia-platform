import Link from 'next/link'

import SiteHeader from '@/components/SiteHeader'

export const metadata = {
  title: 'SMS Consent — Dawnus LLC d/b/a PMI Top Florida Properties',
  description: 'SMS opt-in consent disclosure for Dawnus LLC d/b/a PMI Top Florida Properties. Learn what messages you will receive, how to opt out, and our data practices.',
}

export default function SmsConsent() {
  return (
    <main className="assoc-page">

      <div className="assoc-topbar">
        <span className="assoc-topbar-l">Dawnus LLC d/b/a PMI Top Florida Properties · Miami, FL</span>
        <span className="assoc-topbar-r">305.900.5077 · (786) 686-3223</span>
      </div>

      <SiteHeader subtitle="SMS Consent & Opt-In" />

      <div className="section" style={{ paddingTop: '2rem', paddingBottom: '3rem' }}>
        <div style={{ maxWidth: 680 }}>

          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', fontWeight: 600, color: 'var(--navy)', marginBottom: '0.25rem' }}>
            SMS / Text Message Consent
          </h1>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '2rem' }}>
            Dawnus LLC d/b/a PMI Top Florida Properties · Updated May 2026
          </p>

          {/* ── Who is sending ── */}
          <Section title="Who is sending these messages?">
            <P>
              <strong>Dawnus LLC</strong>, a Florida limited liability company doing business as{' '}
              <strong>PMI Top Florida Properties</strong> (&quot;PMI,&quot; &quot;we,&quot; &quot;our&quot;), sends SMS text
              messages to property owners, tenants, vendors, and real estate agents who have provided
              their phone number and consented to receive communications from us. Our business is located
              at 1031 Ives Dairy Road, Suite 228, Miami, FL 33179.
            </P>
            <P>
              We use <strong>Twilio</strong> as our messaging provider. Messages are sent from a
              registered 10-digit long-code (10DLC) number on behalf of Dawnus LLC d/b/a PMI Top
              Florida Properties.
            </P>
          </Section>

          {/* ── How opt-in works ── */}
          <Section title="How you opt in">
            <P>You may opt in to receive SMS messages from PMI Top Florida Properties in any of the following ways:</P>
            <UL>
              <LI>
                <strong>Online portal:</strong> When you create or access your account on our owner,
                tenant, or board portal, you provide your mobile number and agree to our{' '}
                <Link href="/terms" style={{ color: 'var(--gold)' }}>Terms &amp; Conditions</Link> and{' '}
                <Link href="/privacy-policy" style={{ color: 'var(--gold)' }}>Privacy Policy</Link>, which
                include SMS communication consent.
              </LI>
              <LI>
                <strong>Lease or management agreement:</strong> Property owners and tenants who sign
                agreements with PMI Top Florida Properties are informed that they will receive
                property-management-related text messages and can opt out at any time by replying STOP.
              </LI>
              <LI>
                <strong>WhatsApp / SMS inbound:</strong> By texting or messaging our number directly,
                you consent to receive replies and follow-up messages from us.
              </LI>
            </UL>
            <P style={{ marginTop: '1rem', padding: '1rem', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, fontSize: '0.875rem' }}>
              ✅ <strong>By providing your phone number and submitting any form, agreement, or
              direct message to PMI Top Florida Properties, you consent to receive SMS text messages
              from us at the number provided.</strong> Consent is not a condition of purchase or
              service. Message &amp; data rates may apply.
            </P>
          </Section>

          {/* ── What messages you receive ── */}
          <Section title="What messages you will receive">
            <P>Depending on your relationship with PMI Top Florida Properties, messages may include:</P>
            <UL>
              <LI>HOA account notices, payment reminders, and balance updates</LI>
              <LI>Maintenance request confirmations and status updates</LI>
              <LI>Community announcements and board meeting notices</LI>
              <LI>Lease application status and onboarding notifications</LI>
              <LI>Vendor work order coordination and payment confirmations</LI>
              <LI>Replies to inquiries submitted through our MAIA assistant</LI>
            </UL>
            <P>
              <strong>Message frequency:</strong> Varies based on your account activity and
              association events. Typically 1–8 messages per month.
            </P>
          </Section>

          {/* ── Opt-out ── */}
          <Section title="How to opt out (STOP)">
            <P>
              You may opt out at any time by replying <strong>STOP</strong> to any SMS message
              from us. After opting out, you will receive one final confirmation message and will
              not receive further SMS messages unless you re-opt in by replying <strong>START</strong>.
            </P>
            <P>
              Opting out of SMS does not affect email communications or your account standing.
            </P>
          </Section>

          {/* ── Help ── */}
          <Section title="How to get help (HELP)">
            <P>
              Reply <strong>HELP</strong> to any SMS from us for assistance, or contact us directly:
            </P>
            <UL>
              <LI>Phone: <a href="tel:+13059005077" style={{ color: 'var(--gold)' }}>305.900.5077</a></LI>
              <LI>Phone: <a href="tel:+17866863223" style={{ color: 'var(--gold)' }}>(786) 686-3223</a></LI>
              <LI>Email: <a href="mailto:pmi@pmitop.com" style={{ color: 'var(--gold)' }}>pmi@pmitop.com</a></LI>
            </UL>
          </Section>

          {/* ── Data & privacy ── */}
          <Section title="Your data & privacy">
            <P>
              We do not sell or share your phone number with third parties for their marketing
              purposes. Your number is used solely to send the messages described above.
              See our full <Link href="/privacy-policy" style={{ color: 'var(--gold)' }}>Privacy Policy</Link> for
              details on data retention and your rights.
            </P>
          </Section>

          {/* ── Carrier disclaimer ── */}
          <div style={{ marginTop: '2rem', padding: '1rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, fontSize: '0.78rem', color: 'var(--muted)' }}>
            Message &amp; data rates may apply. Messages sent via Twilio on behalf of PMI Top Florida
            Properties. For support, reply HELP or email{' '}
            <a href="mailto:maia@pmitop.com" style={{ color: 'var(--gold)' }}>maia@pmitop.com</a>.
            To stop messages, reply STOP. Carriers are not liable for delayed or undelivered messages.
          </div>

        </div>
      </div>
    </main>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: '2rem' }}>
      <h2 style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '0.62rem',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
        color: 'var(--gold)',
        marginBottom: '0.6rem',
        paddingBottom: '0.4rem',
        borderBottom: '1px solid var(--border)',
      }}>
        {title}
      </h2>
      {children}
    </section>
  )
}

function P({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <p style={{ fontSize: '0.875rem', lineHeight: 1.7, color: 'var(--body)', marginBottom: '0.75rem', ...style }}>
      {children}
    </p>
  )
}

function UL({ children }: { children: React.ReactNode }) {
  return (
    <ul style={{ paddingLeft: '1.25rem', marginBottom: '0.75rem' }}>
      {children}
    </ul>
  )
}

function LI({ children }: { children: React.ReactNode }) {
  return (
    <li style={{ fontSize: '0.875rem', lineHeight: 1.7, color: 'var(--body)', marginBottom: '0.35rem' }}>
      {children}
    </li>
  )
}
