'use client'

import { useState, useEffect, useRef } from 'react'

type Method = 'sms' | 'whatsapp' | 'email'
type Step   = 'method' | 'code' | 'success'

type MatchedRole =
  | { type: 'staff' }
  | { type: 'owner';            owner_id: number;            association_code: string; association_name: string }
  | { type: 'board';            board_member_id: string;     association_code: string; association_name: string; position: string | null }
  | { type: 'tenant';           association_code: string;    association_name: string }
  | { type: 'unit_manager';     unit_manager_id: string;     association_code: string; association_name: string; managed_units: string[] }
  | { type: 'building_manager'; building_manager_id: string; association_code: string; association_name: string }

interface Props {
  role:       MatchedRole
  email:      string
  phone:      string
  lang:       string
  onVerified: () => void
  onBack:     () => void
}

const LABELS: Record<string, { title: string; subtitle: string; chooseMethod: string; codeSent: string; enterCode: string; verify: string; verifying: string; resend: string; tryAnother: string; success: string; sms: string; whatsapp: string; emailMethod: string }> = {
  en: { title: 'Verify It\'s You', subtitle: 'Choose how you\'d like to receive your verification code.', chooseMethod: 'How should we send your code?', codeSent: 'Code sent! Check your', enterCode: 'Enter the 6-digit code', verify: 'Verify Code', verifying: 'Verifying…', resend: 'Resend code', tryAnother: 'Try another method', success: 'Identity Verified!', sms: 'Text message (SMS)', whatsapp: 'WhatsApp message', emailMethod: 'Email' },
  es: { title: 'Verifica Tu Identidad', subtitle: 'Elige cómo recibir tu código de verificación.', chooseMethod: '¿Cómo enviamos tu código?', codeSent: 'Código enviado. Revisa tu', enterCode: 'Ingresa el código de 6 dígitos', verify: 'Verificar Código', verifying: 'Verificando…', resend: 'Reenviar código', tryAnother: 'Probar otro método', success: '¡Identidad Verificada!', sms: 'Mensaje de texto (SMS)', whatsapp: 'WhatsApp', emailMethod: 'Correo electrónico' },
  pt: { title: 'Verifique Sua Identidade', subtitle: 'Escolha como receber seu código de verificação.', chooseMethod: 'Como devemos enviar seu código?', codeSent: 'Código enviado. Verifique seu', enterCode: 'Digite o código de 6 dígitos', verify: 'Verificar Código', verifying: 'Verificando…', resend: 'Reenviar código', tryAnother: 'Tentar outro método', success: 'Identidade Verificada!', sms: 'Mensagem de texto (SMS)', whatsapp: 'WhatsApp', emailMethod: 'E-mail' },
  fr: { title: 'Vérifiez Votre Identité', subtitle: 'Choisissez comment recevoir votre code de vérification.', chooseMethod: 'Comment envoyer votre code ?', codeSent: 'Code envoyé ! Vérifiez votre', enterCode: 'Entrez le code à 6 chiffres', verify: 'Vérifier le code', verifying: 'Vérification…', resend: 'Renvoyer le code', tryAnother: 'Essayer une autre méthode', success: 'Identité Vérifiée !', sms: 'SMS', whatsapp: 'WhatsApp', emailMethod: 'E-mail' },
  he: { title: 'אמת את זהותך', subtitle: 'בחר כיצד לקבל את קוד האימות.', chooseMethod: 'כיצד נשלח את הקוד?', codeSent: 'הקוד נשלח. בדוק את ה', enterCode: 'הזן את הקוד בן 6 ספרות', verify: 'אמת קוד', verifying: 'מאמת…', resend: 'שלח קוד מחדש', tryAnother: 'נסה שיטה אחרת', success: 'הזהות אומתה!', sms: 'הודעת SMS', whatsapp: 'WhatsApp', emailMethod: 'מייל' },
  ru: { title: 'Подтвердите Личность', subtitle: 'Выберите способ получения кода.', chooseMethod: 'Как отправить код?', codeSent: 'Код отправлен! Проверьте ваш', enterCode: 'Введите 6-значный код', verify: 'Подтвердить код', verifying: 'Проверка…', resend: 'Отправить снова', tryAnother: 'Попробовать другой способ', success: 'Личность подтверждена!', sms: 'SMS', whatsapp: 'WhatsApp', emailMethod: 'Эл. почта' },
}

const inputCls = 'w-full px-3 py-2.5 border border-[#333] rounded-[2px] text-sm focus:outline-none focus:border-[#f26a1b] focus:shadow-[0_0_0_3px_rgba(242,106,27,.18)] bg-[#1a1a1a] text-white placeholder:text-[#555] transition-shadow'
const labelCls = 'block mb-1 text-[0.62rem] font-medium uppercase tracking-[0.1em] text-[#9ca3af] [font-family:var(--font-mono)]'

export default function TwoFactorAuth({ role, email, phone, lang, onVerified, onBack }: Props) {
  const l = LABELS[lang] ?? LABELS.en

  const [step,      setStep]      = useState<Step>('method')
  const [method,    setMethod]    = useState<Method | null>(null)
  const [contact,   setContact]   = useState('')
  const [code,      setCode]      = useState('')
  const [busy,      setBusy]      = useState(false)
  const [error,     setError]     = useState('')
  const [cooldown,  setCooldown]  = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Build available methods
  const hasPhone = phone.trim().length > 6
  const hasEmail = email.trim().includes('@')

  const methods: { key: Method; label: string; hint: string; contact: string }[] = [
    ...(hasPhone ? [
      { key: 'sms'      as Method, label: l.sms,         hint: `…${phone.slice(-4)}`, contact: phone },
      { key: 'whatsapp' as Method, label: l.whatsapp,    hint: `…${phone.slice(-4)}`, contact: phone },
    ] : []),
    ...(hasEmail ? [
      { key: 'email'    as Method, label: l.emailMethod, hint: email.replace(/(.{2}).+(@.+)/, '$1***$2'), contact: email },
    ] : []),
  ]

  useEffect(() => {
    if (cooldown > 0) {
      timerRef.current = setInterval(() => setCooldown(c => {
        if (c <= 1) { clearInterval(timerRef.current!); return 0 }
        return c - 1
      }), 1000)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [cooldown])

  async function sendOTP(m: Method, c: string) {
    setBusy(true); setError('')
    try {
      const res  = await fetch('/api/auth/send-otp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: c, method: m, persona: role.type, roleData: role }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to send code.'); return }
      setMethod(m); setContact(c); setStep('code'); setCooldown(60)
    } catch { setError('Network error. Please try again.') } finally { setBusy(false) }
  }

  async function verifyCode() {
    if (code.trim().length !== 6) { setError('Please enter the full 6-digit code.'); return }
    setBusy(true); setError('')
    try {
      const res  = await fetch('/api/auth/verify-otp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: contact, code: code.trim(), persona: role.type, roleData: role }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Incorrect code.'); return }
      setStep('success')
      setTimeout(() => onVerified(), 1200)
    } catch { setError('Network error. Please try again.') } finally { setBusy(false) }
  }

  if (step === 'success') {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-8">
        <div className="w-14 h-14 rounded-full bg-[#4ade80]/20 flex items-center justify-center">
          <span className="text-3xl">✓</span>
        </div>
        <p className="text-white font-semibold text-base">{l.success}</p>
      </div>
    )
  }

  if (step === 'code') {
    return (
      <div className="maia-fade space-y-4">
        <button onClick={onBack} className="inline-flex items-center gap-1 text-[0.72rem] text-[#9ca3af] hover:text-[#f26a1b] [font-family:var(--font-mono)] uppercase tracking-[0.08em] mb-2 transition-colors">← Back</button>
        <p className="text-[0.82rem] text-[#9ca3af]">
          {l.codeSent} {method === 'email' ? 'inbox' : method?.toUpperCase()} · <span className="text-white">{contact}</span>
        </p>
        <div>
          <label className={labelCls}>{l.enterCode}</label>
          <input
            className={`${inputCls} text-center text-2xl tracking-[0.5em] font-mono`}
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={e => { if (e.key === 'Enter') verifyCode() }}
            placeholder="· · · · · ·"
            inputMode="numeric"
            autoFocus
            dir="ltr"
          />
        </div>
        {error && <p className="text-[0.75rem] text-red-400">{error}</p>}
        <button
          type="button"
          onClick={verifyCode}
          disabled={busy || code.length !== 6}
          className="w-full bg-[#f26a1b] hover:bg-[#f58140] disabled:opacity-50 text-white [font-family:var(--font-mono)] text-[0.62rem] font-medium uppercase tracking-[0.08em] py-2.5 px-4 rounded-[2px] transition-colors"
        >
          {busy ? l.verifying : l.verify}
        </button>
        <div className="flex items-center justify-between text-[0.68rem] [font-family:var(--font-mono)]">
          <button
            type="button"
            onClick={() => { if (method && contact) sendOTP(method, contact) }}
            disabled={busy || cooldown > 0}
            className="text-[#9ca3af] hover:text-[#f26a1b] disabled:opacity-40 transition-colors"
          >
            {cooldown > 0 ? `${l.resend} (${cooldown}s)` : l.resend}
          </button>
          <button
            type="button"
            onClick={() => { setStep('method'); setCode(''); setError('') }}
            className="text-[#9ca3af] hover:text-[#f26a1b] transition-colors"
          >
            {l.tryAnother}
          </button>
        </div>
      </div>
    )
  }

  // Step: method selection
  return (
    <div className="maia-fade space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-[0.72rem] text-[#9ca3af] hover:text-[#f26a1b] [font-family:var(--font-mono)] uppercase tracking-[0.08em] mb-1 transition-colors">← Back</button>
      <div>
        <h2 className="text-base font-light text-white mb-1 [font-family:var(--font-display)]">{l.title}</h2>
        <p className="text-[0.82rem] text-[#9ca3af]">{l.subtitle}</p>
      </div>
      {methods.length === 0 && (
        <div className="space-y-3">
          <p className="text-[0.82rem] text-[#9ca3af]">Please enter a contact method to receive your code:</p>
          <div>
            <label className={labelCls}>Phone or Email</label>
            <input
              className={inputCls}
              value={contact}
              onChange={e => setContact(e.target.value)}
              placeholder="phone number or email address"
              dir="ltr"
            />
          </div>
          {contact.includes('@') && (
            <button onClick={() => sendOTP('email', contact)} disabled={busy} className="w-full bg-[#f26a1b] hover:bg-[#f58140] disabled:opacity-50 text-white [font-family:var(--font-mono)] text-[0.62rem] font-medium uppercase tracking-[0.08em] py-2.5 rounded-[2px] transition-colors">
              {busy ? 'Sending…' : 'Send Code by Email'}
            </button>
          )}
          {!contact.includes('@') && contact.length > 6 && (
            <button onClick={() => sendOTP('sms', contact)} disabled={busy} className="w-full bg-[#f26a1b] hover:bg-[#f58140] disabled:opacity-50 text-white [font-family:var(--font-mono)] text-[0.62rem] font-medium uppercase tracking-[0.08em] py-2.5 rounded-[2px] transition-colors">
              {busy ? 'Sending…' : 'Send Code by SMS'}
            </button>
          )}
        </div>
      )}
      {methods.length > 0 && (
        <div className="space-y-2">
          <p className="text-[0.72rem] text-[#9ca3af] [font-family:var(--font-mono)] uppercase tracking-[0.08em] mb-3">{l.chooseMethod}</p>
          {methods.map(m => (
            <button
              key={m.key}
              onClick={() => sendOTP(m.key, m.contact)}
              disabled={busy}
              className="w-full text-left p-3.5 rounded-lg transition-all disabled:opacity-50"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.09)' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(242,106,27,0.45)'; e.currentTarget.style.boxShadow = '0 0 14px rgba(242,106,27,0.14)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.09)'; e.currentTarget.style.boxShadow = 'none' }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-white">{m.label}</div>
                  <div className="text-[0.68rem] text-[#9ca3af] [font-family:var(--font-mono)] mt-0.5">{m.hint}</div>
                </div>
                <span className="text-[#f26a1b]">→</span>
              </div>
            </button>
          ))}
        </div>
      )}
      {error && <p className="text-[0.75rem] text-red-400">{error}</p>}
    </div>
  )
}
