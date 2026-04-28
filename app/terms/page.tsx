import SiteHeader from '@/components/SiteHeader'

export const metadata = {
  title: 'Terms & Conditions — PMI Top Florida Properties',
  description: 'Terms and conditions for using MAIA and receiving SMS communications from PMI Top Florida Properties.',
}

export default function Terms() {
  return (
    <main className="assoc-page">

      <div className="assoc-topbar">
        <span className="assoc-topbar-l">PMI Top Florida Properties · Miami, FL</span>
        <span className="assoc-topbar-r">305.900.5077</span>
      </div>

      <SiteHeader subtitle="Terms & Conditions" />

      <div className="section" style={{ paddingTop: '2rem', paddingBottom: '3rem' }}>

        <div style={{ maxWidth: 680 }}>

          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', fontWeight: 600, color: 'var(--navy)', marginBottom: '0.25rem' }}>
            Terms &amp; Conditions
          </h1>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '2rem' }}>
            Effective Date: April 28, 2026 · PMI Top Florida Properties
          </p>

          <TermsContent />

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
      <div style={{ fontSize: '0.875rem', color: '#374151', lineHeight: 1.75 }}>
        {children}
      </div>
    </section>
  )
}

function P({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: '0 0 0.75rem' }}>{children}</p>
}

function UL({ children }: { children: React.ReactNode }) {
  return <ul style={{ margin: '0 0 0.75rem', paddingLeft: '1.25rem' }}>{children}</ul>
}

function LI({ children }: { children: React.ReactNode }) {
  return <li style={{ marginBottom: '0.3rem' }}>{children}</li>
}

function TermsContent() {
  return (
    <>
      <Section title="1. Acceptance of Terms">
        <P>
          By accessing or using the MAIA platform, submitting inquiries through our website, or opting in to
          SMS or WhatsApp communications from PMI Top Florida Properties (&quot;PMI,&quot; &quot;we,&quot; &quot;our,&quot; or &quot;us&quot;),
          you agree to these Terms &amp; Conditions. If you do not agree, do not use our services.
        </P>
        <P>
          These terms govern your use of MAIA (Management AI Assistant), our website at pmitop.com, and any
          related communication services including SMS, WhatsApp, and email.
        </P>
      </Section>

      <Section title="2. Description of Services">
        <P>PMI Top Florida Properties provides HOA and condominium management services, including:</P>
        <UL>
          <LI><strong>MAIA:</strong> An AI-powered assistant that answers questions, routes requests, and provides information about your community</LI>
          <LI><strong>SMS &amp; WhatsApp messaging:</strong> Automated and agent-assisted communications for account notices and service updates</LI>
          <LI><strong>Owner portal:</strong> Access to HOA account balances, payment history, and community documents</LI>
          <LI><strong>Vendor onboarding:</strong> Tools for contractors to submit inquiries and receive onboarding documents</LI>
          <LI><strong>Application processing:</strong> Buyer and tenant application submission for board-managed communities</LI>
        </UL>
      </Section>

      <Section title="3. SMS & WhatsApp Messaging Terms">
        <P>
          By providing your phone number through our website, WhatsApp, or any other channel, you consent to
          receive text messages from PMI Top Florida Properties at the number provided. This includes:
        </P>
        <UL>
          <LI>Transactional messages: payment confirmations, maintenance updates, application status</LI>
          <LI>Account notices: balance reminders, assessment notices, violation alerts</LI>
          <LI>Community updates: meeting notices, announcements, emergency alerts</LI>
          <LI>Responses to inquiries you initiate via MAIA or WhatsApp</LI>
        </UL>
        <P>
          <strong>Opt-out:</strong> Reply <strong>STOP</strong> to any SMS to unsubscribe. For WhatsApp, send
          &quot;unsubscribe&quot; and we will remove you from automated messaging. You may opt back in at any time
          by contacting us or reinitiating a conversation.
        </P>
        <P>
          <strong>Help:</strong> Reply <strong>HELP</strong> or contact{' '}
          <a href="mailto:maia@pmitop.com" style={{ color: 'var(--gold)' }}>maia@pmitop.com</a> or{' '}
          <a href="tel:+13059005077" style={{ color: 'var(--gold)' }}>305.900.5077</a>.
        </P>
        <P>
          Message and data rates may apply. Message frequency depends on your account activity and inquiries.
          Carriers are not liable for delayed or undelivered messages.
        </P>
      </Section>

      <Section title="4. MAIA AI Assistant">
        <P>
          MAIA is an AI assistant powered by Anthropic&apos;s Claude. While MAIA strives to provide accurate and
          helpful information, it has limitations:
        </P>
        <UL>
          <LI>MAIA does not have access to real-time account balances or legal records</LI>
          <LI>Responses are informational and do not constitute legal, financial, or professional advice</LI>
          <LI>MAIA may occasionally provide incomplete or inaccurate information — always verify important details with our team</LI>
          <LI>For urgent matters (flooding, safety hazards, legal deadlines), contact our team directly</LI>
        </UL>
        <P>
          Conversations with MAIA may be reviewed by PMI staff to improve service quality and ensure compliance.
        </P>
      </Section>

      <Section title="5. User Responsibilities">
        <P>When using our services, you agree to:</P>
        <UL>
          <LI>Provide accurate and truthful information</LI>
          <LI>Not impersonate another person or submit false inquiries</LI>
          <LI>Not use our systems to send spam, harass staff or other residents, or attempt to breach security</LI>
          <LI>Comply with your association&apos;s governing documents and Florida HOA/condo law</LI>
          <LI>Keep your contact information current with your association</LI>
        </UL>
      </Section>

      <Section title="6. Vendor Terms">
        <P>Vendors and contractors using our platform agree that:</P>
        <UL>
          <LI>All work requires prior written approval from PMI or the relevant association</LI>
          <LI>A valid Certificate of Insurance with correct additional insured endorsements must be on file before starting any job</LI>
          <LI>Invoices must be submitted to <a href="mailto:billing@topfloridaproperties.com" style={{ color: 'var(--gold)' }}>billing@topfloridaproperties.com</a></LI>
          <LI>ACH authorization forms are required for electronic payment setup</LI>
          <LI>PMI does not guarantee work volume or exclusive contractor relationships</LI>
        </UL>
      </Section>

      <Section title="7. Payment Terms">
        <P>
          HOA assessments and fees are governed by your association&apos;s governing documents. PMI processes
          payments on behalf of associations and does not independently set assessment amounts.
          Late fees, interest, and collections procedures are determined by association policy and Florida law.
        </P>
        <P>
          Online payments are processed through third-party payment processors. PMI is not responsible for
          technical failures of third-party payment systems.
        </P>
      </Section>

      <Section title="8. Intellectual Property">
        <P>
          The MAIA name, PMI Top Florida Properties branding, and all content on this website are the property
          of PMI Top Florida Properties or its licensors. You may not reproduce, distribute, or create
          derivative works without written permission.
        </P>
      </Section>

      <Section title="9. Disclaimer of Warranties">
        <P>
          Our services are provided &quot;as is&quot; without warranties of any kind. We do not warrant that MAIA will
          be error-free, uninterrupted, or that responses will be accurate in all cases. Use of AI-generated
          information is at your own risk.
        </P>
      </Section>

      <Section title="10. Limitation of Liability">
        <P>
          To the fullest extent permitted by law, PMI Top Florida Properties shall not be liable for any
          indirect, incidental, special, or consequential damages arising from your use of our services,
          including reliance on information provided by MAIA.
        </P>
        <P>
          Our total liability for any claim arising from these terms shall not exceed the amount paid by
          you to PMI in the three months preceding the claim.
        </P>
      </Section>

      <Section title="11. Governing Law">
        <P>
          These terms are governed by the laws of the State of Florida. Any disputes shall be resolved in
          the courts of Miami-Dade County, Florida, and you consent to personal jurisdiction there.
        </P>
      </Section>

      <Section title="12. Changes to Terms">
        <P>
          We may update these terms at any time by posting the revised version on this page with an updated
          effective date. Continued use of our services after changes are posted constitutes acceptance.
          Material changes will be communicated via email or SMS where feasible.
        </P>
      </Section>

      <Section title="13. Contact">
        <P>For questions about these terms:</P>
        <UL>
          <LI>Email: <a href="mailto:maia@pmitop.com" style={{ color: 'var(--gold)' }}>maia@pmitop.com</a></LI>
          <LI>Phone: <a href="tel:+13059005077" style={{ color: 'var(--gold)' }}>305.900.5077</a></LI>
          <LI>Mail: PMI Top Florida Properties · 1031 Ives Dairy Road Suite 228, Miami, FL 33179</LI>
        </UL>
        <P>
          See also our <a href="/privacy-policy" style={{ color: 'var(--gold)' }}>Privacy Policy</a> for
          information on how we handle your personal data.
        </P>
      </Section>

    </>
  )
}
