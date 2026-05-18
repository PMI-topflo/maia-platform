// =====================================================================
// /api/apply/send-resume-link
//
// Sends the applicant an email with a "Resume your application" link
// to /apply?id=<applicationId>. Triggered by the form right after the
// applicant first leaves an email address — gives them an escape
// hatch if their browser crashes mid-application.
//
// Rate-limited via applications.resume_link_sent_at so the form can
// call this opportunistically (e.g., on every step) without spamming
// the applicant. We only send once per 30 minutes per row.
// =====================================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RESEND_COOLDOWN_MS = 30 * 60 * 1000   // 30 min

interface Body {
  applicationId?: string
  email?:         string
  lang?:          string
}

const TRANSLATIONS: Record<string, { subject: string; greeting: string; body: string; cta: string; footer: string }> = {
  en: {
    subject:  'Resume your PMI application',
    greeting: 'Hello,',
    body:     'You started an application with PMI Top Florida Properties. If you close the browser before submitting, you can pick up where you left off at any time using the link below — your progress is saved.',
    cta:      'Resume application',
    footer:   'If you didn\'t start an application, you can safely ignore this email.',
  },
  es: {
    subject:  'Continúe su solicitud de PMI',
    greeting: 'Hola,',
    body:     'Inició una solicitud con PMI Top Florida Properties. Si cierra el navegador antes de enviarla, puede retomar donde la dejó en cualquier momento usando el enlace de abajo — su progreso está guardado.',
    cta:      'Continuar solicitud',
    footer:   'Si no inició una solicitud, puede ignorar este correo de forma segura.',
  },
  pt: {
    subject:  'Continue sua solicitação PMI',
    greeting: 'Olá,',
    body:     'Você iniciou uma solicitação com a PMI Top Florida Properties. Se fechar o navegador antes de enviar, pode retomar de onde parou a qualquer momento usando o link abaixo — seu progresso está salvo.',
    cta:      'Continuar solicitação',
    footer:   'Se você não iniciou uma solicitação, pode ignorar este e-mail com segurança.',
  },
  fr: {
    subject:  'Reprenez votre demande PMI',
    greeting: 'Bonjour,',
    body:     'Vous avez commencé une demande avec PMI Top Florida Properties. Si vous fermez le navigateur avant de soumettre, vous pouvez reprendre où vous vous êtes arrêté à tout moment en utilisant le lien ci-dessous — votre progression est enregistrée.',
    cta:      'Reprendre la demande',
    footer:   'Si vous n\'avez pas commencé de demande, vous pouvez ignorer cet e-mail.',
  },
  he: {
    subject:  'המשך הבקשה שלך ב-PMI',
    greeting: 'שלום,',
    body:     'התחלת בקשה עם PMI Top Florida Properties. אם תסגור את הדפדפן לפני השליחה, תוכל להמשיך מהיכן שהפסקת בכל עת באמצעות הקישור למטה — ההתקדמות שלך נשמרת.',
    cta:      'המשך בקשה',
    footer:   'אם לא התחלת בקשה, אתה יכול להתעלם מהדוא"ל הזה בבטחה.',
  },
  ru: {
    subject:  'Продолжить заявку PMI',
    greeting: 'Здравствуйте,',
    body:     'Вы начали заявку в PMI Top Florida Properties. Если вы закроете браузер до отправки, вы можете продолжить с того места, где остановились, в любое время, используя ссылку ниже — ваш прогресс сохранен.',
    cta:      'Продолжить заявку',
    footer:   'Если вы не начинали заявку, вы можете спокойно проигнорировать это письмо.',
  },
}

export async function POST(req: NextRequest) {
  let body: Body
  try { body = await req.json() as Body }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const { applicationId, email, lang } = body
  if (!applicationId || !email) {
    return NextResponse.json({ error: 'applicationId and email required' }, { status: 400 })
  }

  // Cooldown — if we already sent recently to this same row, skip.
  const { data: existing } = await supabaseAdmin
    .from('applications')
    .select('resume_link_sent_at, resume_email')
    .eq('id', applicationId)
    .maybeSingle()

  if (existing?.resume_link_sent_at) {
    const last = new Date(existing.resume_link_sent_at).getTime()
    if (Date.now() - last < RESEND_COOLDOWN_MS && existing.resume_email === email) {
      return NextResponse.json({ ok: true, skipped: 'recent' })
    }
  }

  const tr = TRANSLATIONS[lang ?? 'en'] ?? TRANSLATIONS.en
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
  const resumeUrl = `${baseUrl}/apply?id=${encodeURIComponent(applicationId)}&lang=${encodeURIComponent(lang ?? 'en')}`

  const html = `
    <div style="font-family: -apple-system, system-ui, sans-serif; max-width: 540px; margin: 0 auto; padding: 24px; color: #0d0d0d;">
      <h2 style="font-size: 18px; margin: 0 0 16px;">${tr.greeting}</h2>
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
    await sendEmail({ to: email, subject: tr.subject, html })
  } catch (err) {
    console.error('[send-resume-link] email failed', err)
    return NextResponse.json({ error: 'Email send failed' }, { status: 500 })
  }

  // Stamp the row so cooldown works for the next call.
  await supabaseAdmin
    .from('applications')
    .update({ resume_email: email, resume_link_sent_at: new Date().toISOString() })
    .eq('id', applicationId)

  return NextResponse.json({ ok: true })
}
