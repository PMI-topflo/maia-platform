// =====================================================================
// /api/admin/applications/[id]/resend-resume-link
//
// Staff-triggered resend of the "Resume your application" email.
// Used when an applicant says they can't find / lost / never got the
// original auto-sent link. Bypasses the 30-min cooldown the public
// endpoint enforces, since staff is initiating it deliberately.
//
// Optional body: { email } — overrides the address on file. Useful
// when the applicant entered a typo on the original form OR is asking
// us to resend to a different inbox. When omitted, falls back to
// applications.resume_email, then to applicants[0].email.
//
// Returns: { ok: true, sent_to, applicant_name }
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Mirrors the localized email body in /api/apply/send-resume-link.
// Kept in sync by inspection — both surfaces should match wording.
const TRANSLATIONS: Record<string, { subject: string; greeting: string; body: string; cta: string; footer: string }> = {
  en: {
    subject:  'Your PMI application — pick up where you left off',
    greeting: 'Hello,',
    body:     'Here is the link to continue your application with PMI Top Florida Properties. Your previous progress is saved — just open the link below to resume.',
    cta:      'Resume application',
    footer:   'Sent by PMI Top Florida Properties staff. Reply to this email or call (305) 900-5077 if you need help.',
  },
  es: {
    subject:  'Su solicitud PMI — continúe donde la dejó',
    greeting: 'Hola,',
    body:     'Aquí está el enlace para continuar su solicitud con PMI Top Florida Properties. Su progreso anterior está guardado — solo abra el enlace de abajo para continuar.',
    cta:      'Continuar solicitud',
    footer:   'Enviado por el equipo de PMI Top Florida Properties. Responda a este correo o llame al (305) 900-5077 si necesita ayuda.',
  },
  pt: {
    subject:  'Sua solicitação PMI — continue de onde parou',
    greeting: 'Olá,',
    body:     'Aqui está o link para continuar sua solicitação com a PMI Top Florida Properties. Seu progresso anterior está salvo — basta abrir o link abaixo para continuar.',
    cta:      'Continuar solicitação',
    footer:   'Enviado pela equipe da PMI Top Florida Properties. Responda a este e-mail ou ligue para (305) 900-5077 se precisar de ajuda.',
  },
  fr: {
    subject:  'Votre demande PMI — reprenez où vous vous êtes arrêté',
    greeting: 'Bonjour,',
    body:     'Voici le lien pour continuer votre demande avec PMI Top Florida Properties. Votre progression précédente est enregistrée — ouvrez simplement le lien ci-dessous pour reprendre.',
    cta:      'Reprendre la demande',
    footer:   'Envoyé par l\'équipe de PMI Top Florida Properties. Répondez à cet e-mail ou appelez le (305) 900-5077 si vous avez besoin d\'aide.',
  },
  he: {
    subject:  'הבקשה שלך ב-PMI — המשך מהיכן שהפסקת',
    greeting: 'שלום,',
    body:     'הנה הקישור להמשך הבקשה שלך עם PMI Top Florida Properties. ההתקדמות הקודמת שלך נשמרה — פשוט פתח את הקישור למטה כדי להמשיך.',
    cta:      'המשך בקשה',
    footer:   'נשלח על ידי צוות PMI Top Florida Properties. השב לדוא"ל הזה או התקשר אל (305) 900-5077 אם אתה זקוק לעזרה.',
  },
  ru: {
    subject:  'Ваша заявка PMI — продолжите с того места, где остановились',
    greeting: 'Здравствуйте,',
    body:     'Вот ссылка для продолжения вашей заявки в PMI Top Florida Properties. Ваш предыдущий прогресс сохранен — просто откройте ссылку ниже, чтобы продолжить.',
    cta:      'Продолжить заявку',
    footer:   'Отправлено сотрудником PMI Top Florida Properties. Ответьте на это письмо или позвоните по номеру (305) 900-5077, если вам нужна помощь.',
  },
}

interface Body {
  email?: string
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await ctx.params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  let body: Body = {}
  try { body = await req.json() as Body }
  catch { /* empty body is fine */ }

  // Fetch the application so we can fall back through email options +
  // pull language preference for the localized template.
  const { data: app, error } = await supabaseAdmin
    .from('applications')
    .select('id, resume_email, applicants, language, stripe_payment_status')
    .eq('id', id)
    .maybeSingle()
  if (error)             return NextResponse.json({ error: error.message }, { status: 500 })
  if (!app)              return NextResponse.json({ error: 'application not found' }, { status: 404 })
  if (app.stripe_payment_status === 'succeeded' || app.stripe_payment_status === 'paid') {
    return NextResponse.json({ error: 'This application is already submitted — resume link would let the applicant overwrite their submission.' }, { status: 400 })
  }

  // Resolve the recipient email. Priority:
  //   1. staff-supplied override
  //   2. resume_email already on the row (last one we sent to)
  //   3. primary applicant email
  const applicants = (app.applicants ?? []) as Array<{ email?: string; firstName?: string; lastName?: string }>
  const primary = applicants[0]
  const recipient =
    (body.email ?? '').trim()
    || (app.resume_email ?? '').trim()
    || (primary?.email ?? '').trim()
  if (!recipient || !/@/.test(recipient)) {
    return NextResponse.json({
      error: 'No email on file for this application. Provide one in the body: { email: "..." }',
    }, { status: 400 })
  }

  const lang = typeof app.language === 'string' && TRANSLATIONS[app.language] ? app.language : 'en'
  const tr = TRANSLATIONS[lang]
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
  const resumeUrl = `${baseUrl}/apply?id=${encodeURIComponent(app.id)}&lang=${encodeURIComponent(lang)}`

  const applicantName = [primary?.firstName, primary?.lastName].filter(Boolean).join(' ') || ''
  const greetingLine = applicantName ? `${tr.greeting.replace(',', '')} ${applicantName},` : tr.greeting

  const html = `
    <div style="font-family: -apple-system, system-ui, sans-serif; max-width: 540px; margin: 0 auto; padding: 24px; color: #0d0d0d;">
      <h2 style="font-size: 18px; margin: 0 0 16px;">${greetingLine}</h2>
      <p style="font-size: 14px; line-height: 1.6; margin: 0 0 16px;">${tr.body}</p>
      <p style="margin: 24px 0;">
        <a href="${resumeUrl}" style="display: inline-block; padding: 12px 24px; background: #f26a1b; color: #fff; text-decoration: none; border-radius: 4px; font-weight: 600;">${tr.cta} →</a>
      </p>
      <p style="font-size: 12px; color: #6b7280; margin: 24px 0 0;">${tr.footer}</p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
      <p style="font-size: 11px; color: #9ca3af; font-family: monospace;">PMI Top Florida Properties · pmitop.com · (305) 900-5077</p>
    </div>
  `.trim()

  try {
    await sendEmail({ to: recipient, subject: tr.subject, html })
  } catch (err) {
    console.error('[admin resend-resume-link] email failed', err)
    return NextResponse.json({ error: 'Email send failed' }, { status: 500 })
  }

  // Stamp the row so the admin UI can show "last sent to X at Y" and
  // so the public-endpoint cooldown logic also benefits from the
  // staff send.
  await supabaseAdmin
    .from('applications')
    .update({ resume_email: recipient, resume_link_sent_at: new Date().toISOString() })
    .eq('id', app.id)

  return NextResponse.json({
    ok:             true,
    sent_to:        recipient,
    applicant_name: applicantName || null,
  })
}
