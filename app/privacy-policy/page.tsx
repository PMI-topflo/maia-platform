import SiteHeader from '@/components/SiteHeader'

export const metadata = {
  title: 'Privacy Policy — PMI Top Florida Properties',
  description: 'Privacy policy covering SMS/WhatsApp communications, data handling, and homeowner information for PMI Top Florida Properties.',
}

export default function PrivacyPolicy() {
  return (
    <main className="assoc-page">

      <div className="assoc-topbar">
        <span className="assoc-topbar-l">PMI Top Florida Properties · Miami, FL</span>
        <span className="assoc-topbar-r">305.900.5077 · (786) 686-3223</span>
      </div>

      <SiteHeader subtitle="Privacy Policy" />

      <div className="section" style={{ paddingTop: '2rem', paddingBottom: '3rem' }}>

        <div style={{ maxWidth: 680 }}>

          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', fontWeight: 600, color: 'var(--navy)', marginBottom: '0.25rem' }}>
            Privacy Policy
          </h1>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '2rem' }}>
            Effective Date: April 28, 2026 · PMI Top Florida Properties
          </p>

          <Policy />

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

function Policy() {
  return (
    <>
      <Section title="1. Who We Are">
        <P>
          PMI Top Florida Properties (&quot;PMI,&quot; &quot;we,&quot; &quot;our,&quot; or &quot;us&quot;) is a licensed HOA and condominium management company
          operating in South Florida. We manage associations, coordinate maintenance, and communicate with homeowners,
          tenants, vendors, and board members on behalf of the communities we serve.
        </P>
        <P>
          <strong>Contact:</strong> PMI Top Florida Properties · 1031 Ives Dairy Road Suite 228, Miami, FL 33179 ·{' '}
          <a href="tel:+13059005077" style={{ color: 'var(--gold)' }}>305.900.5077</a> ·{' '}
          <a href="mailto:maia@pmitop.com" style={{ color: 'var(--gold)' }}>maia@pmitop.com</a>
        </P>
      </Section>

      <Section title="2. Information We Collect">
        <P>We collect information you provide directly to us, including:</P>
        <UL>
          <LI>Name, email address, phone number, and unit/property address</LI>
          <LI>HOA account information and payment history</LI>
          <LI>Maintenance requests and service correspondence</LI>
          <LI>Messages sent to MAIA via WhatsApp or SMS</LI>
          <LI>Vendor company name, contact details, and insurance documents</LI>
          <LI>Real estate agent license information and inquiry details</LI>
        </UL>
        <P>We also collect limited technical data when you use our website, including IP address and browser type, for security and analytics purposes.</P>
      </Section>

      <Section title="3. SMS & WhatsApp Communications">
        <P>
          By providing your phone number and opting in to SMS or WhatsApp communications from PMI Top Florida Properties,
          you agree to receive messages related to:
        </P>
        <UL>
          <LI>HOA account notices, payment reminders, and balance updates</LI>
          <LI>Maintenance request status updates</LI>
          <LI>Community announcements and board meeting notices</LI>
          <LI>Lease and application status notifications</LI>
          <LI>Responses to inquiries submitted through MAIA</LI>
        </UL>
        <P>
          <strong>Message frequency varies</strong> depending on your account activity. Standard message and data rates may apply.
        </P>
        <P>
          <strong>To opt out:</strong> Reply <strong>STOP</strong> to any SMS message, or send &quot;unsubscribe&quot; via WhatsApp.
          You will receive one confirmation message and will not receive further messages unless you re-opt in.
        </P>
        <P>
          <strong>For help:</strong> Reply <strong>HELP</strong> or contact us at{' '}
          <a href="mailto:maia@pmitop.com" style={{ color: 'var(--gold)' }}>maia@pmitop.com</a> or{' '}
          <a href="tel:+13059005077" style={{ color: 'var(--gold)' }}>305.900.5077</a>.
        </P>
        <P>
          We do not sell or share your phone number with third parties for their marketing purposes.
          Message content is not shared with unaffiliated third parties.
        </P>
      </Section>

      <Section title="4. How We Use Your Information">
        <P>We use the information we collect to:</P>
        <UL>
          <LI>Manage your HOA account and process payments</LI>
          <LI>Respond to maintenance requests and service inquiries</LI>
          <LI>Send account notices, statements, and community updates</LI>
          <LI>Process vendor onboarding and work order coordination</LI>
          <LI>Assist real estate agents and title companies with closing requirements</LI>
          <LI>Improve MAIA and our communication services</LI>
          <LI>Comply with legal obligations and association governing documents</LI>
        </UL>
      </Section>

      <Section title="5. How We Share Your Information">
        <P>We do not sell your personal information. We may share your information with:</P>
        <UL>
          <LI><strong>Association boards:</strong> Board members may access owner account information relevant to governance</LI>
          <LI><strong>Service providers:</strong> Vendors and contractors as necessary to fulfill work orders</LI>
          <LI><strong>Technology partners:</strong> Supabase (database), Resend (email delivery), Twilio (SMS/WhatsApp), and Anthropic (AI assistant) — each under confidentiality obligations</LI>
          <LI><strong>Legal or regulatory authorities:</strong> When required by law or to protect rights and safety</LI>
        </UL>
      </Section>

      <Section title="6. Data Retention">
        <P>
          We retain personal information for as long as necessary to fulfill the purposes described in this policy,
          comply with legal obligations, and resolve disputes. HOA account records are typically retained for the
          duration of the management relationship plus seven years.
        </P>
        <P>
          SMS and WhatsApp conversation logs are retained for up to 90 days for quality and compliance purposes.
        </P>
      </Section>

      <Section title="7. Security">
        <P>
          We use industry-standard technical and organizational measures to protect your information, including
          encrypted data storage, access controls, and secure transmission protocols. No method of transmission
          over the internet is 100% secure; we cannot guarantee absolute security.
        </P>
      </Section>

      <Section title="8. Your Rights">
        <P>Depending on applicable law, you may have the right to:</P>
        <UL>
          <LI>Access the personal information we hold about you</LI>
          <LI>Request correction of inaccurate information</LI>
          <LI>Request deletion of your information (subject to legal retention requirements)</LI>
          <LI>Opt out of SMS/WhatsApp communications at any time</LI>
        </UL>
        <P>
          To exercise these rights, contact us at{' '}
          <a href="mailto:maia@pmitop.com" style={{ color: 'var(--gold)' }}>maia@pmitop.com</a>.
        </P>
      </Section>

      <Section title="9. Cookies & Analytics">
        <P>
          Our website uses essential cookies for functionality. We may use analytics tools to understand how
          visitors use our site. We do not use third-party advertising cookies.
        </P>
      </Section>

      <Section title="10. Changes to This Policy">
        <P>
          We may update this policy from time to time. We will post the updated policy on this page with a
          revised effective date. Continued use of our services after changes constitutes acceptance of the
          updated policy.
        </P>
      </Section>

      <Section title="11. Contact Us">
        <P>
          For questions about this privacy policy or your personal information:
        </P>
        <UL>
          <LI>Email: <a href="mailto:maia@pmitop.com" style={{ color: 'var(--gold)' }}>maia@pmitop.com</a></LI>
          <LI>Phone: <a href="tel:+13059005077" style={{ color: 'var(--gold)' }}>305.900.5077</a></LI>
          <LI>Mail: PMI Top Florida Properties · 1031 Ives Dairy Road Suite 228, Miami, FL 33179</LI>
        </UL>
      </Section>

    </>
  )
}
