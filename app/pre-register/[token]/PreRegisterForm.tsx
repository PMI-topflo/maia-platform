'use client'

import { useState } from 'react'

// Compact per-language copy. en/es/pt/fr filled; other languages fall back to en.
const T: Record<string, Record<string, string>> = {
  en: { title: 'Pre-registration', intro: "We couldn't find your number in our system. Tell us who you are and how we can help — a team member will follow up and add you if needed.",
        role: 'I am a…', name: 'Full name', email: 'Email', prop: 'Property / association (optional)', unit: 'Unit (optional)',
        request: 'How can we help?', submit: 'Submit', sending: 'Sending…', done: 'Thank you! Your request was sent to our team — we’ll be in touch.', req: 'Please add your name, a valid email, and your request.',
        uploadTitle: 'One more thing', uploadIntro: 'Since you told us you’re a tenant, please upload your lease and board-approval letter now if you have them — this speeds up verification.',
        uploadLease: 'Lease agreement', uploadLetter: 'Board approval letter', uploadBtn: 'Upload', uploading: 'Uploading…', uploaded: '✓ Uploaded', uploadSkip: 'I’ll send these later', uploadThanks: 'Thanks — our team will follow up on anything still missing.' },
  es: { title: 'Pre-registro', intro: 'No encontramos tu número en nuestro sistema. Cuéntanos quién eres y cómo podemos ayudarte — un miembro del equipo te contactará y te agregará si es necesario.',
        role: 'Soy…', name: 'Nombre completo', email: 'Correo', prop: 'Propiedad / asociación (opcional)', unit: 'Unidad (opcional)',
        request: '¿Cómo podemos ayudarte?', submit: 'Enviar', sending: 'Enviando…', done: '¡Gracias! Tu solicitud fue enviada a nuestro equipo — te contactaremos.', req: 'Agrega tu nombre, un correo válido y tu solicitud.',
        uploadTitle: 'Una cosa más', uploadIntro: 'Ya que nos dijiste que eres inquilino, sube tu contrato de arrendamiento y la carta de aprobación de la junta si los tienes — esto acelera la verificación.',
        uploadLease: 'Contrato de arrendamiento', uploadLetter: 'Carta de aprobación de la junta', uploadBtn: 'Subir', uploading: 'Subiendo…', uploaded: '✓ Subido', uploadSkip: 'Los enviaré después', uploadThanks: 'Gracias — nuestro equipo dará seguimiento a lo que falte.' },
  pt: { title: 'Pré-cadastro', intro: 'Não encontramos seu número em nosso sistema. Diga-nos quem você é e como podemos ajudar — um membro da equipe entrará em contato e adicionará você se necessário.',
        role: 'Eu sou…', name: 'Nome completo', email: 'E-mail', prop: 'Propriedade / associação (opcional)', unit: 'Unidade (opcional)',
        request: 'Como podemos ajudar?', submit: 'Enviar', sending: 'Enviando…', done: 'Obrigado! Sua solicitação foi enviada à nossa equipe — entraremos em contato.', req: 'Preencha seu nome, um e-mail válido e sua solicitação.',
        uploadTitle: 'Mais uma coisa', uploadIntro: 'Como você nos disse que é inquilino, envie seu contrato de locação e a carta de aprovação do conselho, se já os tiver — isso agiliza a verificação.',
        uploadLease: 'Contrato de locação', uploadLetter: 'Carta de aprovação do conselho', uploadBtn: 'Enviar', uploading: 'Enviando…', uploaded: '✓ Enviado', uploadSkip: 'Vou enviar depois', uploadThanks: 'Obrigado — nossa equipe fará o acompanhamento do que faltar.' },
  fr: { title: 'Pré-inscription', intro: "Nous n'avons pas trouvé votre numéro dans notre système. Dites-nous qui vous êtes et comment nous pouvons aider — un membre de l'équipe vous contactera.",
        role: 'Je suis…', name: 'Nom complet', email: 'Email', prop: 'Propriété / association (facultatif)', unit: 'Unité (facultatif)',
        request: 'Comment pouvons-nous aider ?', submit: 'Envoyer', sending: 'Envoi…', done: 'Merci ! Votre demande a été envoyée à notre équipe.', req: 'Indiquez votre nom, un email valide et votre demande.',
        uploadTitle: 'Encore une chose', uploadIntro: 'Puisque vous nous avez dit être locataire, téléversez votre bail et la lettre d’approbation du conseil si vous les avez — cela accélère la vérification.',
        uploadLease: 'Contrat de bail', uploadLetter: 'Lettre d’approbation du conseil', uploadBtn: 'Téléverser', uploading: 'Téléversement…', uploaded: '✓ Téléversé', uploadSkip: 'Je les enverrai plus tard', uploadThanks: 'Merci — notre équipe suivra ce qu’il manque.' },
}
const PERSONAS: Record<string, [string, string][]> = {
  en: [['owner', 'Homeowner / Owner'], ['tenant', 'Tenant / Renter'], ['buyer', 'Buyer'], ['board', 'Board Member'], ['vendor', 'Vendor / Contractor'], ['agent', 'Real Estate Agent'], ['other', 'Other']],
  es: [['owner', 'Propietario'], ['tenant', 'Inquilino'], ['buyer', 'Comprador'], ['board', 'Miembro de la junta'], ['vendor', 'Proveedor / Contratista'], ['agent', 'Agente inmobiliario'], ['other', 'Otro']],
  pt: [['owner', 'Proprietário'], ['tenant', 'Inquilino'], ['buyer', 'Comprador'], ['board', 'Membro do conselho'], ['vendor', 'Fornecedor / Prestador'], ['agent', 'Corretor de imóveis'], ['other', 'Outro']],
  fr: [['owner', 'Propriétaire'], ['tenant', 'Locataire'], ['buyer', 'Acheteur'], ['board', 'Membre du conseil'], ['vendor', 'Fournisseur / Prestataire'], ['agent', 'Agent immobilier'], ['other', 'Autre']],
}

export default function PreRegisterForm({ token, phone, lang }: { token: string; phone: string; lang: string }) {
  const t = T[lang] ?? T.en
  const personas = PERSONAS[lang] ?? PERSONAS.en
  const [persona, setPersona] = useState('owner')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [association, setAssociation] = useState('')
  const [unit, setUnit] = useState('')
  const [request, setRequest] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tenantVerificationId, setTenantVerificationId] = useState<string | null>(null)
  const [uploaded, setUploaded] = useState<{ lease: boolean; board_letter: boolean }>({ lease: false, board_letter: false })
  const [uploadingDoc, setUploadingDoc] = useState<'lease' | 'board_letter' | null>(null)
  const [uploadDone, setUploadDone] = useState(false)

  async function submit() {
    setError(null)
    if (!fullName.trim() || !email.includes('@') || !request.trim()) { setError(t.req); return }
    setBusy(true)
    try {
      const res = await fetch(`/api/pre-register/${token}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ persona, fullName, email, association, unit, request }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error ?? 'failed')
      setTenantVerificationId(j.tenantVerificationId ?? null)
      setDone(true)
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  async function uploadDoc(docType: 'lease' | 'board_letter', file: File) {
    if (!tenantVerificationId) return
    setUploadingDoc(docType); setError(null)
    try {
      const fd = new FormData()
      fd.append('verificationId', tenantVerificationId); fd.append('docType', docType); fd.append('file', file)
      const res = await fetch(`/api/pre-register/${token}/tenant-docs`, { method: 'POST', body: fd })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error ?? 'upload failed')
      setUploaded(u => ({ ...u, [docType]: true }))
    } catch (e) { setError((e as Error).message) } finally { setUploadingDoc(null) }
  }

  const field = 'w-full px-3 py-2 text-sm border border-gray-300 rounded mb-3 focus:outline-none focus:ring-2 focus:ring-[var(--gold,#c9a227)]'
  const label = 'block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1'

  if (done && persona === 'tenant' && tenantVerificationId && !uploadDone) {
    const DocRow = ({ docType, text }: { docType: 'lease' | 'board_letter'; text: string }) => (
      <div className="mb-3">
        <label className={label}>{text}</label>
        {uploaded[docType] ? (
          <div className="text-sm text-emerald-700">{t.uploaded}</div>
        ) : (
          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.heic,.webp" disabled={uploadingDoc === docType}
            onChange={e => { const f = e.target.files?.[0]; if (f) uploadDoc(docType, f) }}
            className="block w-full text-xs" />
        )}
        {uploadingDoc === docType && <div className="text-xs text-gray-400 mt-1">{t.uploading}</div>}
      </div>
    )
    return (
      <div className="max-w-md mx-auto mt-16 bg-white border border-gray-200 rounded-xl p-6">
        <h1 className="text-lg font-semibold text-gray-900">{t.uploadTitle}</h1>
        <p className="text-sm text-gray-500 mt-1 mb-5">{t.uploadIntro}</p>
        <DocRow docType="lease" text={t.uploadLease} />
        <DocRow docType="board_letter" text={t.uploadLetter} />
        {error && <div className="text-sm text-red-600 mb-3">⚠ {error}</div>}
        <button onClick={() => setUploadDone(true)}
          className="w-full text-sm font-semibold px-4 py-2.5 rounded bg-[#f26a1b] text-white hover:bg-[#d95c12] mt-2">
          {(uploaded.lease && uploaded.board_letter) ? t.submit : t.uploadSkip}
        </button>
      </div>
    )
  }

  if (done) {
    return (
      <div className="max-w-md mx-auto mt-16 bg-white border border-gray-200 rounded-xl p-6 text-center">
        <div className="text-3xl mb-2">🌸</div>
        <p className="text-sm text-gray-700">{persona === 'tenant' && tenantVerificationId ? t.uploadThanks : t.done}</p>
      </div>
    )
  }

  return (
    <div className="max-w-md mx-auto mt-10 mb-16 bg-white border border-gray-200 rounded-xl p-6">
      <h1 className="text-lg font-semibold text-gray-900">{t.title}</h1>
      <p className="text-sm text-gray-500 mt-1 mb-5">{t.intro}</p>

      <label className={label}>{t.role}</label>
      <select value={persona} onChange={e => setPersona(e.target.value)} className={field}>
        {personas.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>

      <label className={label}>{t.name}</label>
      <input value={fullName} onChange={e => setFullName(e.target.value)} className={field} />

      <label className={label}>{t.email}</label>
      <input value={email} onChange={e => setEmail(e.target.value)} type="email" className={field} />

      <label className={label}>{t.prop}</label>
      <input value={association} onChange={e => setAssociation(e.target.value)} className={field} />

      <label className={label}>{t.unit}</label>
      <input value={unit} onChange={e => setUnit(e.target.value)} className={field} />

      <label className={label}>{t.request}</label>
      <textarea value={request} onChange={e => setRequest(e.target.value)} rows={4} className={field + ' resize-y'} />

      <div className="text-xs text-gray-400 mb-3">{phone}</div>
      {error && <div className="text-sm text-red-600 mb-3">⚠ {error}</div>}
      <button onClick={submit} disabled={busy}
        className="w-full text-sm font-semibold px-4 py-2.5 rounded bg-[#f26a1b] text-white hover:bg-[#d95c12] disabled:opacity-60">
        {busy ? t.sending : t.submit}
      </button>
    </div>
  )
}
