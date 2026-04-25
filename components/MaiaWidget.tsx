'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase =
  | 'persona' | 'lookup' | 'notfound' | 'chat'
  | 'agent-form' | 'agent-sent' | 'vendor-form' | 'vendor-sent'
type Persona = 'homeowner' | 'tenant' | 'buyer' | 'agent' | 'vendor' | 'board' | 'title'
type Lang = 'en' | 'es' | 'pt' | 'fr' | 'he' | 'ru'

interface Msg {
  id: string
  role: 'user' | 'assistant'
  content: string
  feedback?: 'positive' | 'negative'
}

interface Assoc { association_code: string; association_name: string }

// ── Persona config ────────────────────────────────────────────────────────────

const PERSONAS: { key: Persona; icon: string; tk: string; sk: string }[] = [
  { key: 'homeowner', icon: '🏠', tk: 'homeowner', sk: 'homeowner_sub' },
  { key: 'tenant',    icon: '🏢', tk: 'tenant',    sk: 'tenant_sub'    },
  { key: 'buyer',     icon: '🔑', tk: 'buyer',     sk: 'buyer_sub'     },
  { key: 'agent',     icon: '🤝', tk: 'agent',     sk: 'agent_sub'     },
  { key: 'vendor',    icon: '🔧', tk: 'vendor',    sk: 'vendor_sub'    },
  { key: 'board',     icon: '📋', tk: 'board',     sk: 'board_sub'     },
  { key: 'title',     icon: '📄', tk: 'title_co',  sk: 'title_sub'     },
]

// ── Translations ──────────────────────────────────────────────────────────────

const T: Record<Lang, Record<string, string>> = {
  en: {
    opening: "Hi! I'm MAIA, your PMI Top Florida Properties assistant. How can I help you today?",
    who: 'Who are you?',
    homeowner: 'Homeowner',       homeowner_sub: 'Unit owner or resident',
    tenant:    'Tenant',          tenant_sub:    'Renting a unit',
    buyer:     'Buyer',           buyer_sub:     'Purchasing a property',
    agent:     'Agent / Realtor', agent_sub:     'Real estate professional',
    vendor:    'Vendor',          vendor_sub:    'Service provider',
    board:     'Board Member',    board_sub:     'HOA board officer',
    title_co:  'Title Company',   title_sub:     'Closing & escrow',
    lookup_title:   'Find your community',
    first_name: 'First name', last_name: 'Last name', email: 'Email', phone: 'Phone',
    find: 'Find My Community', finding: 'Searching…',
    not_found:      "We couldn't find your account.",
    not_found_help: 'Please contact us directly:',
    placeholder: 'Type a message…', send: 'Send', typing: 'MAIA is typing…',
    back: '← Back', close: '✕',
    agent_title:  'Agent / Realtor Inquiry',
    vendor_title: 'Vendor / Contractor Inquiry',
    your_name: 'Your name', company: 'Company name', contact: 'Contact name',
    license: 'License number', assoc: 'Association',
    submit: 'Send Inquiry', submitting: 'Sending…',
    agent_thanks:  "Inquiry sent! We'll follow up within one business day.",
    vendor_thanks: 'Inquiry sent! Check your email for ACH and COI forms.',
    start_over: 'Start over', optional: 'optional',
  },
  es: {
    opening: '¡Hola! Soy MAIA, tu asistente de PMI Top Florida Properties. ¿Cómo puedo ayudarte?',
    who: '¿Quién eres?',
    homeowner: 'Propietario',     homeowner_sub: 'Dueño o residente',
    tenant:    'Inquilino',       tenant_sub:    'Rentando una unidad',
    buyer:     'Comprador',       buyer_sub:     'Comprando una propiedad',
    agent:     'Agente / Realtor', agent_sub:    'Profesional inmobiliario',
    vendor:    'Proveedor',       vendor_sub:    'Proveedor de servicios',
    board:     'Miembro de Junta', board_sub:    'Oficial de la junta HOA',
    title_co:  'Compañía de Título', title_sub:  'Cierre y depósito',
    lookup_title:   'Encuentra tu comunidad',
    first_name: 'Nombre', last_name: 'Apellido', email: 'Correo', phone: 'Teléfono',
    find: 'Buscar Mi Comunidad', finding: 'Buscando…',
    not_found:      'No pudimos encontrar tu cuenta.',
    not_found_help: 'Por favor contáctanos directamente:',
    placeholder: 'Escribe un mensaje…', send: 'Enviar', typing: 'MAIA está escribiendo…',
    back: '← Atrás', close: '✕',
    agent_title:  'Consulta de Agente / Realtor',
    vendor_title: 'Consulta de Proveedor / Contratista',
    your_name: 'Tu nombre', company: 'Nombre de empresa', contact: 'Nombre de contacto',
    license: 'Número de licencia', assoc: 'Asociación',
    submit: 'Enviar Consulta', submitting: 'Enviando…',
    agent_thanks:  '¡Consulta enviada! Te contactaremos pronto.',
    vendor_thanks: '¡Consulta enviada! Revisa tu correo para los formularios.',
    start_over: 'Comenzar de nuevo', optional: 'opcional',
  },
  pt: {
    opening: 'Olá! Sou MAIA, sua assistente PMI Top Florida Properties. Como posso ajudá-lo?',
    who: 'Quem é você?',
    homeowner: 'Proprietário',   homeowner_sub: 'Dono ou residente',
    tenant:    'Inquilino',      tenant_sub:    'Alugando uma unidade',
    buyer:     'Comprador',      buyer_sub:     'Comprando uma propriedade',
    agent:     'Agente / Corretor', agent_sub:  'Profissional imobiliário',
    vendor:    'Fornecedor',     vendor_sub:    'Prestador de serviços',
    board:     'Membro do Conselho', board_sub: 'Diretor do HOA',
    title_co:  'Empresa de Título', title_sub:  'Fechamento e custódia',
    lookup_title:   'Encontre sua comunidade',
    first_name: 'Nome', last_name: 'Sobrenome', email: 'E-mail', phone: 'Telefone',
    find: 'Encontrar Minha Comunidade', finding: 'Buscando…',
    not_found:      'Não encontramos sua conta.',
    not_found_help: 'Por favor, entre em contato diretamente:',
    placeholder: 'Digite uma mensagem…', send: 'Enviar', typing: 'MAIA está digitando…',
    back: '← Voltar', close: '✕',
    agent_title:  'Consulta de Agente / Corretor',
    vendor_title: 'Consulta de Fornecedor / Empreiteiro',
    your_name: 'Seu nome', company: 'Nome da empresa', contact: 'Nome do contato',
    license: 'Número de licença', assoc: 'Associação',
    submit: 'Enviar Consulta', submitting: 'Enviando…',
    agent_thanks:  'Consulta enviada! Entraremos em contato em breve.',
    vendor_thanks: 'Consulta enviada! Verifique seu e-mail para os formulários.',
    start_over: 'Recomeçar', optional: 'opcional',
  },
  fr: {
    opening: "Bonjour! Je suis MAIA, votre assistante PMI Top Florida Properties. Comment puis-je vous aider?",
    who: 'Qui êtes-vous?',
    homeowner: 'Propriétaire',    homeowner_sub: 'Propriétaire ou résident',
    tenant:    'Locataire',       tenant_sub:    "Location d'un logement",
    buyer:     'Acheteur',        buyer_sub:     "Achat d'une propriété",
    agent:     'Agent / Courtier', agent_sub:    "Professionnel de l'immobilier",
    vendor:    'Fournisseur',     vendor_sub:    'Prestataire de services',
    board:     'Membre du Conseil', board_sub:   'Administrateur du HOA',
    title_co:  'Société de Titre', title_sub:    'Clôture et séquestre',
    lookup_title:   'Trouvez votre communauté',
    first_name: 'Prénom', last_name: 'Nom', email: 'E-mail', phone: 'Téléphone',
    find: 'Trouver Ma Communauté', finding: 'Recherche…',
    not_found:      "Nous n'avons pas trouvé votre compte.",
    not_found_help: 'Veuillez nous contacter directement:',
    placeholder: 'Tapez un message…', send: 'Envoyer', typing: "MAIA écrit…",
    back: '← Retour', close: '✕',
    agent_title:  'Demande Agent / Courtier',
    vendor_title: 'Demande Fournisseur / Entrepreneur',
    your_name: 'Votre nom', company: "Nom de l'entreprise", contact: 'Nom du contact',
    license: 'Numéro de licence', assoc: 'Association',
    submit: 'Envoyer la demande', submitting: 'Envoi…',
    agent_thanks:  'Demande envoyée! Nous vous contacterons bientôt.',
    vendor_thanks: 'Demande envoyée! Consultez votre e-mail pour les formulaires.',
    start_over: 'Recommencer', optional: 'optionnel',
  },
  he: {
    opening: 'שלום! אני MAIA, העוזרת שלך מ-PMI Top Florida Properties. כיצד אוכל לעזור?',
    who: 'מי אתה?',
    homeowner: 'בעל דירה',      homeowner_sub: 'בעל יחידה או דייר',
    tenant:    'שוכר',          tenant_sub:    'השכרת יחידה',
    buyer:     'קונה',          buyer_sub:     'רכישת נכס',
    agent:     'סוכן / מתווך', agent_sub:     'איש מקצוע בנדל"ן',
    vendor:    'ספק',           vendor_sub:    'נותן שירות',
    board:     'חבר ועד',       board_sub:     'ממונה ועד הבית',
    title_co:  'חברת כותרות',  title_sub:     'סגירה ונאמנות',
    lookup_title:   'מצא את הקהילה שלך',
    first_name: 'שם פרטי', last_name: 'שם משפחה', email: 'דוא"ל', phone: 'טלפון',
    find: 'מצא את הקהילה שלי', finding: 'מחפש…',
    not_found:      'לא הצלחנו למצוא את החשבון שלך.',
    not_found_help: 'אנא צור קשר ישירות:',
    placeholder: 'כתוב הודעה…', send: 'שלח', typing: 'MAIA מקלידה…',
    back: 'חזרה →', close: '✕',
    agent_title:  'פנייה של סוכן / מתווך',
    vendor_title: 'פנייה של ספק / קבלן',
    your_name: 'שמך', company: 'שם החברה', contact: 'שם איש הקשר',
    license: 'מספר רישיון', assoc: 'אגודה',
    submit: 'שלח פנייה', submitting: 'שולח…',
    agent_thanks:  'הפנייה נשלחה! ניצור איתך קשר תוך יום עסקים.',
    vendor_thanks: 'הפנייה נשלחה! בדוק את הדוא"ל שלך לטפסים.',
    start_over: 'התחל מחדש', optional: 'אופציונלי',
  },
  ru: {
    opening: 'Здравствуйте! Я MAIA, ваш помощник PMI Top Florida Properties. Чем я могу помочь?',
    who: 'Кто вы?',
    homeowner: 'Владелец',           homeowner_sub: 'Владелец или жилец',
    tenant:    'Арендатор',          tenant_sub:    'Аренда жилья',
    buyer:     'Покупатель',         buyer_sub:     'Покупка недвижимости',
    agent:     'Агент / Риелтор',    agent_sub:     'Специалист по недвижимости',
    vendor:    'Поставщик',          vendor_sub:    'Поставщик услуг',
    board:     'Член правления',     board_sub:     'Директор ТСЖ',
    title_co:  'Титульная компания', title_sub:     'Закрытие сделки',
    lookup_title:   'Найдите свое сообщество',
    first_name: 'Имя', last_name: 'Фамилия', email: 'Эл. почта', phone: 'Телефон',
    find: 'Найти Мое Сообщество', finding: 'Поиск…',
    not_found:      'Мы не смогли найти ваш аккаунт.',
    not_found_help: 'Пожалуйста, свяжитесь с нами напрямую:',
    placeholder: 'Напишите сообщение…', send: 'Отправить', typing: 'MAIA печатает…',
    back: '← Назад', close: '✕',
    agent_title:  'Запрос Агента / Риелтора',
    vendor_title: 'Запрос Поставщика / Подрядчика',
    your_name: 'Ваше имя', company: 'Название компании', contact: 'Имя контакта',
    license: 'Номер лицензии', assoc: 'Ассоциация',
    submit: 'Отправить запрос', submitting: 'Отправка…',
    agent_thanks:  'Запрос отправлен! Свяжемся в течение рабочего дня.',
    vendor_thanks: 'Запрос отправлен! Проверьте почту для форм.',
    start_over: 'Начать заново', optional: 'необязательно',
  },
}

// ── Shared inline style helpers ────────────────────────────────────────────────

const S = {
  // Input field — matches the reference design
  input: {
    width: '100%', boxSizing: 'border-box' as const,
    border: '1px solid var(--border)',
    borderRadius: '2px',
    padding: '10px 12px',
    fontFamily: 'var(--font-body)',
    fontSize: '0.92rem',
    color: 'var(--navy)',
    background: 'var(--surface)',
    outline: 'none',
  } as React.CSSProperties,

  // Label — DM Mono, uppercase, muted
  label: {
    display: 'block',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.6rem',
    letterSpacing: '0.12em',
    textTransform: 'uppercase' as const,
    color: 'var(--muted)',
    marginBottom: '5px',
  } as React.CSSProperties,

  // Primary button (dark)
  btnPrimary: {
    width: '100%', cursor: 'pointer',
    background: 'var(--navy)',
    color: '#fff',
    border: '1px solid var(--navy)',
    borderRadius: '2px',
    padding: '11px 20px',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.68rem',
    letterSpacing: '0.1em',
    textTransform: 'uppercase' as const,
    transition: 'background 0.15s',
  } as React.CSSProperties,

  // Gold / orange button
  btnGold: {
    width: '100%', cursor: 'pointer',
    background: 'var(--gold)',
    color: '#fff',
    border: '1px solid var(--gold)',
    borderRadius: '2px',
    padding: '11px 20px',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.68rem',
    letterSpacing: '0.1em',
    textTransform: 'uppercase' as const,
    transition: 'background 0.15s',
  } as React.CSSProperties,

  // Ghost button
  btnGhost: {
    cursor: 'pointer',
    background: 'transparent',
    color: 'var(--muted)',
    border: '1px solid var(--border)',
    borderRadius: '2px',
    padding: '9px 20px',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.65rem',
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    transition: 'all 0.15s',
  } as React.CSSProperties,

  // Card
  card: {
    background: 'var(--card)',
    border: '1px solid var(--border)',
    borderRadius: '3px',
    boxShadow: '0 2px 12px rgba(13,13,13,.07)',
  } as React.CSSProperties,

  // Card title bar
  cardTitle: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.65rem',
    letterSpacing: '0.14em',
    textTransform: 'uppercase' as const,
    color: 'var(--gold)',
    paddingBottom: '10px',
    borderBottom: '1px solid var(--border)',
    marginBottom: '16px',
  } as React.CSSProperties,
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MaiaWidget({ embedded = false }: { embedded?: boolean }) {
  const router = useRouter()

  const [open,       setOpen]       = useState(false)
  const [phase,      setPhase]      = useState<Phase>('persona')
  const [persona,    setPersona]    = useState<Persona | null>(null)
  const [lang,       setLang]       = useState<Lang>('en')
  const [msgs,       setMsgs]       = useState<Msg[]>([])
  const [input,      setInput]      = useState('')
  const [loading,    setLoading]    = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [isMobile,   setIsMobile]   = useState(false)
  const [assocs,     setAssocs]     = useState<Assoc[]>([])
  const [assocCode,  setAssocCode]  = useState('')
  const [assocName,  setAssocName]  = useState('')

  const [sessionId] = useState<string>(() =>
    typeof crypto !== 'undefined' ? crypto.randomUUID() : Math.random().toString(36).slice(2)
  )

  // Form state
  const [lookup,     setLookup]     = useState({ firstName: '', lastName: '', email: '', phone: '' })
  const [agentForm,  setAgentForm]  = useState({ name: '', email: '', phone: '', licenseNumber: '', association: '' })
  const [vendorForm, setVendorForm] = useState({ companyName: '', contactName: '', email: '', phone: '', association: '' })

  const bottomRef = useRef<HTMLDivElement>(null)
  const t = T[lang]
  const isRTL = lang === 'he'

  // Responsive
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 500)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Associations for dropdowns
  useEffect(() => {
    fetch('/api/associations').then(r => r.json()).then(setAssocs).catch(() => {})
  }, [])

  // Scroll chat to bottom
  useEffect(() => {
    if (phase === 'chat') bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs, loading, phase])

  // ── Handlers ───────────────────────────────────────────────────────────────

  const startChat = (p: Persona, greeting?: string, ac?: string, an?: string) => {
    setPersona(p)
    setAssocCode(ac ?? '')
    setAssocName(an ?? '')
    setMsgs([{ id: crypto.randomUUID(), role: 'assistant', content: greeting ?? t.opening }])
    setPhase('chat')
  }

  const handlePersona = (p: Persona) => {
    setPersona(p)
    if (p === 'homeowner')  { setPhase('lookup');      return }
    if (p === 'agent')      { setPhase('agent-form');  return }
    if (p === 'vendor')     { setPhase('vendor-form'); return }
    startChat(p)
  }

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const res  = await fetch('/api/homeowner-lookup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lookup),
      })
      const data = await res.json()
      if (data.found && data.staff) {
        if (embedded) window.parent.postMessage('maia:redirect:/admin', '*')
        else router.push('/admin')
      } else if (data.found && data.association_code) {
        const greet = lang === 'en'
          ? `Welcome${data.first_name ? `, ${data.first_name}` : ''}! I'm MAIA, your assistant for ${data.association_name || 'your community'}. How can I help you today?`
          : t.opening
        startChat('homeowner', greet, data.association_code, data.association_name)
      } else {
        setPhase('notfound')
      }
    } catch { setPhase('notfound') }
    finally  { setLoading(false) }
  }

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || loading) return
    const userMsg: Msg = { id: crypto.randomUUID(), role: 'user', content: input.trim() }
    const next = [...msgs, userMsg]
    setMsgs(next); setInput(''); setLoading(true)
    try {
      const res  = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: next.map(m => ({ role: m.role, content: m.content })),
          persona, associationCode: assocCode, language: lang, sessionId,
        }),
      })
      const data = await res.json()
      setMsgs(p => [...p, { id: crypto.randomUUID(), role: 'assistant', content: data.reply ?? '…' }])
    } catch {
      setMsgs(p => [...p, { id: crypto.randomUUID(), role: 'assistant', content: 'Something went wrong. Please contact us at maia@pmitop.com.' }])
    } finally { setLoading(false) }
  }

  const handleFeedback = (msgId: string, type: 'positive' | 'negative') => {
    setMsgs(p => p.map(m => m.id === msgId ? { ...m, feedback: type } : m))
    if (type === 'negative') {
      fetch('/api/chat-feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, messages: msgs.map(m => ({ role: m.role, content: m.content })), persona, language: lang, associationCode: assocCode }),
      }).catch(() => {})
    }
  }

  const handleAgentSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setSubmitting(true)
    await fetch('/api/agent-inquiry', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(agentForm),
    }).catch(() => {})
    setSubmitting(false); setPhase('agent-sent')
  }

  const handleVendorSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setSubmitting(true)
    await fetch('/api/vendor-inquiry', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(vendorForm),
    }).catch(() => {})
    setSubmitting(false); setPhase('vendor-sent')
  }

  const handleBack = () => {
    if (['lookup', 'agent-form', 'vendor-form'].includes(phase)) { setPhase('persona'); setPersona(null) }
    else if (phase === 'notfound') setPhase('lookup')
    else if (phase === 'chat')     { setPhase('persona'); setPersona(null); setMsgs([]); setAssocCode(''); setAssocName('') }
  }

  const handleClose = () => {
    if (embedded) window.parent.postMessage('maia:close', '*')
    else setOpen(false)
  }

  // ── Phase renderers ────────────────────────────────────────────────────────

  const renderPersona = () => (
    <div style={{ padding: '16px 14px 14px' }}>
      {/* Opening greeting bubble */}
      <div style={{ ...S.card, padding: '12px 14px', marginBottom: '18px', fontSize: '0.88rem', lineHeight: 1.6, color: 'var(--navy)', fontFamily: 'var(--font-body)' }}>
        {t.opening}
      </div>
      {/* Section tag */}
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--gold)', marginBottom: '10px' }}>
        {t.who}
      </div>
      {/* Persona grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
        {PERSONAS.map(p => (
          <button
            key={p.key}
            onClick={() => handlePersona(p.key)}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start', textAlign: 'left',
              background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '3px',
              padding: '10px 10px 9px', cursor: 'pointer',
              boxShadow: '0 1px 4px rgba(13,13,13,.05)',
              transition: 'border-color 0.14s, transform 0.12s',
              gap: '3px',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--gold)'; e.currentTarget.style.transform = 'translateY(-1px)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = 'translateY(0)' }}
          >
            <span style={{ fontSize: '1.25rem', lineHeight: 1, marginBottom: '4px' }}>{p.icon}</span>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 500, color: 'var(--navy)', lineHeight: 1.2 }}>{t[p.tk]}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.58rem', color: 'var(--muted)', lineHeight: 1.3, letterSpacing: '0.02em' }}>{t[p.sk]}</span>
          </button>
        ))}
      </div>
    </div>
  )

  const renderLookup = () => (
    <div style={{ padding: '16px 14px' }}>
      <div style={{ ...S.card, padding: '20px' }}>
        <div style={S.cardTitle}>{t.lookup_title}</div>
        <form onSubmit={handleLookup} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div><label style={S.label}>{t.first_name}</label><input style={S.input} value={lookup.firstName} onChange={e => setLookup(p => ({ ...p, firstName: e.target.value }))} /></div>
            <div><label style={S.label}>{t.last_name}</label><input style={S.input} value={lookup.lastName}  onChange={e => setLookup(p => ({ ...p, lastName:  e.target.value }))} /></div>
          </div>
          <div><label style={S.label}>{t.email}</label><input type="email" style={S.input} value={lookup.email} onChange={e => setLookup(p => ({ ...p, email: e.target.value }))} /></div>
          <div><label style={S.label}>{t.phone}</label><input type="tel"   style={S.input} value={lookup.phone} onChange={e => setLookup(p => ({ ...p, phone: e.target.value }))} /></div>
          <button type="submit" disabled={loading || (!lookup.email && !lookup.phone)} style={{ ...S.btnGold, opacity: loading || (!lookup.email && !lookup.phone) ? 0.5 : 1 }}>
            {loading ? t.finding : t.find}
          </button>
        </form>
      </div>
    </div>
  )

  const renderNotFound = () => (
    <div style={{ padding: '32px 16px', textAlign: 'center' }}>
      <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>🔍</div>
      <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', fontWeight: 300, color: 'var(--navy)', margin: '0 0 6px' }}>{t.not_found}</p>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', color: 'var(--muted)', margin: '0 0 18px' }}>{t.not_found_help}</p>
      <div style={{ ...S.card, padding: '14px 16px', display: 'inline-block', textAlign: 'left' }}>
        <a href="tel:+13059005077"          style={{ display: 'block', fontSize: '0.82rem', color: 'var(--gold)', textDecoration: 'none', marginBottom: '5px' }}>📞 (305) 900-5077</a>
        <a href="mailto:maia@pmitop.com"    style={{ display: 'block', fontSize: '0.82rem', color: 'var(--gold)', textDecoration: 'none' }}>✉️ maia@pmitop.com</a>
      </div>
    </div>
  )

  const renderChat = () => (
    <>
      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {assocName && (
          <div style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '0.58rem', color: 'var(--muted)', letterSpacing: '0.06em', paddingBottom: '8px', borderBottom: '1px solid var(--border)' }}>
            {assocName.toUpperCase()}
          </div>
        )}
        {msgs.map(msg => (
          <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? (isRTL ? 'flex-start' : 'flex-end') : (isRTL ? 'flex-end' : 'flex-start') }}>
            <div style={{
              maxWidth: '86%',
              padding: '9px 12px',
              borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
              background: msg.role === 'user' ? 'var(--gold)' : 'var(--card)',
              color: msg.role === 'user' ? '#fff' : 'var(--navy)',
              border: msg.role === 'user' ? 'none' : '1px solid var(--border)',
              fontFamily: 'var(--font-body)',
              fontSize: '0.85rem',
              lineHeight: 1.55,
              whiteSpace: 'pre-wrap',
              boxShadow: msg.role === 'assistant' ? '0 1px 4px rgba(13,13,13,.07)' : 'none',
            }}>
              {msg.content}
            </div>
            {msg.role === 'assistant' && !msg.feedback && (
              <div style={{ display: 'flex', gap: '3px', marginTop: '3px' }}>
                {(['positive', 'negative'] as const).map(fb => (
                  <button key={fb} onClick={() => handleFeedback(msg.id, fb)}
                    style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '2px', fontSize: '0.7rem', cursor: 'pointer', padding: '1px 5px', lineHeight: 1, color: 'var(--muted)' }}>
                    {fb === 'positive' ? '👍' : '👎'}
                  </button>
                ))}
              </div>
            )}
            {msg.role === 'assistant' && msg.feedback && (
              <span style={{ fontSize: '0.62rem', color: 'var(--muted)', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
                {msg.feedback === 'positive' ? '👍 Thanks' : '👎 Noted'}
              </span>
            )}
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: 'var(--muted)', letterSpacing: '0.04em' }}>
            <span style={{ width: '16px', height: '16px', border: '2px solid var(--border)', borderTopColor: 'var(--gold)', borderRadius: '50%', display: 'inline-block', animation: 'spin .7s linear infinite' }} />
            {t.typing}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </>
  )

  const AssocSelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <select value={value} onChange={e => onChange(e.target.value)} style={{ ...S.input, appearance: 'none', backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%237a7570' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center', paddingRight: '32px' }}>
      <option value="">{t.assoc} ({t.optional})</option>
      {assocs.map(a => <option key={a.association_code} value={a.association_name}>{a.association_name}</option>)}
    </select>
  )

  const renderAgentForm = () => (
    <div style={{ padding: '16px 14px' }}>
      <div style={{ ...S.card, padding: '20px' }}>
        <div style={S.cardTitle}>{t.agent_title}</div>
        <form onSubmit={handleAgentSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div><label style={S.label}>{t.your_name} *</label><input required style={S.input} value={agentForm.name}          onChange={e => setAgentForm(p => ({ ...p, name:          e.target.value }))} /></div>
          <div><label style={S.label}>{t.email} *</label>     <input required type="email" style={S.input} value={agentForm.email}         onChange={e => setAgentForm(p => ({ ...p, email:         e.target.value }))} /></div>
          <div><label style={S.label}>{t.phone}</label>        <input type="tel"   style={S.input} value={agentForm.phone}         onChange={e => setAgentForm(p => ({ ...p, phone:         e.target.value }))} /></div>
          <div><label style={S.label}>{t.license}</label>      <input           style={S.input} value={agentForm.licenseNumber} onChange={e => setAgentForm(p => ({ ...p, licenseNumber: e.target.value }))} /></div>
          <div><label style={S.label}>{t.assoc}</label><AssocSelect value={agentForm.association} onChange={v => setAgentForm(p => ({ ...p, association: v }))} /></div>
          <button type="submit" disabled={submitting} style={{ ...S.btnGold, opacity: submitting ? 0.6 : 1 }}>{submitting ? t.submitting : t.submit}</button>
        </form>
      </div>
    </div>
  )

  const renderVendorForm = () => (
    <div style={{ padding: '16px 14px' }}>
      <div style={{ ...S.card, padding: '20px' }}>
        <div style={S.cardTitle}>{t.vendor_title}</div>
        <form onSubmit={handleVendorSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div><label style={S.label}>{t.company} *</label>   <input required style={S.input} value={vendorForm.companyName}  onChange={e => setVendorForm(p => ({ ...p, companyName:  e.target.value }))} /></div>
          <div><label style={S.label}>{t.contact}</label>     <input           style={S.input} value={vendorForm.contactName} onChange={e => setVendorForm(p => ({ ...p, contactName: e.target.value }))} /></div>
          <div><label style={S.label}>{t.email} *</label>     <input required type="email" style={S.input} value={vendorForm.email}       onChange={e => setVendorForm(p => ({ ...p, email:       e.target.value }))} /></div>
          <div><label style={S.label}>{t.phone}</label>        <input type="tel"   style={S.input} value={vendorForm.phone}       onChange={e => setVendorForm(p => ({ ...p, phone:       e.target.value }))} /></div>
          <div><label style={S.label}>{t.assoc}</label><AssocSelect value={vendorForm.association} onChange={v => setVendorForm(p => ({ ...p, association: v }))} /></div>
          <button type="submit" disabled={submitting} style={{ ...S.btnGold, opacity: submitting ? 0.6 : 1 }}>{submitting ? t.submitting : t.submit}</button>
        </form>
      </div>
    </div>
  )

  const renderSent = (msg: string) => (
    <div style={{ padding: '40px 16px', textAlign: 'center' }}>
      <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>✅</div>
      <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: 300, color: 'var(--navy)', margin: '0 0 20px', lineHeight: 1.4 }}>{msg}</p>
      <button onClick={() => { setPhase('persona'); setPersona(null) }} style={{ ...S.btnGhost, width: 'auto' }}>{t.start_over}</button>
    </div>
  )

  const renderBody = () => {
    switch (phase) {
      case 'persona':     return renderPersona()
      case 'lookup':      return renderLookup()
      case 'notfound':    return renderNotFound()
      case 'chat':        return renderChat()
      case 'agent-form':  return renderAgentForm()
      case 'agent-sent':  return renderSent(t.agent_thanks)
      case 'vendor-form': return renderVendorForm()
      case 'vendor-sent': return renderSent(t.vendor_thanks)
    }
  }

  const isBackable = ['lookup', 'notfound', 'chat', 'agent-form', 'vendor-form'].includes(phase)

  // ── Panel ──────────────────────────────────────────────────────────────────

  const panelContent = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)', overflow: 'hidden' }}>

      {/* ── Header ── */}
      <div style={{
        background: 'var(--navy)',
        color: '#fff',
        height: '56px',
        padding: '0 10px 0 14px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        flexShrink: 0,
        boxShadow: '0 2px 8px rgba(13,13,13,.3)',
      }}>
        {/* Back */}
        {isBackable && (
          <button onClick={handleBack} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.5)', cursor: 'pointer', fontSize: '0.75rem', padding: '4px 6px', borderRadius: '2px', flexShrink: 0 }}>
            {isRTL ? '→' : '←'}
          </button>
        )}

        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flex: 1, minWidth: 0 }}>
          <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--gold)', flexShrink: 0 }} />
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 600, lineHeight: 1 }}>MAIA</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,.4)', marginTop: '1px' }}>PMI Top Florida</div>
          </div>
        </div>

        {/* Language tabs */}
        <div style={{ display: 'flex', gap: '2px' }}>
          {(['en','es','pt','fr','he','ru'] as Lang[]).map(l => (
            <button
              key={l}
              onClick={() => setLang(l)}
              style={{
                background: l === lang ? 'var(--gold)' : 'transparent',
                color: l === lang ? '#fff' : 'rgba(255,255,255,.4)',
                border: 'none',
                borderRadius: '2px',
                padding: '3px 5px',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.55rem',
                letterSpacing: '0.05em',
                cursor: 'pointer',
                transition: 'all 0.14s',
              }}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Close */}
        <button
          onClick={handleClose}
          aria-label="Close"
          style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.45)', cursor: 'pointer', fontSize: '0.9rem', padding: '4px 6px', borderRadius: '2px', flexShrink: 0, lineHeight: 1 }}
        >
          ✕
        </button>
      </div>

      {/* ── Animated body ── */}
      <div
        key={phase}
        className="maia-fade"
        dir={isRTL ? 'rtl' : 'ltr'}
        style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: phase === 'chat' ? 'hidden' : 'auto' }}
      >
        {renderBody()}
      </div>

      {/* ── Chat input ── */}
      {phase === 'chat' && (
        <form
          onSubmit={handleSend}
          style={{ display: 'flex', gap: '6px', padding: '8px 10px', borderTop: '1px solid var(--border)', background: 'var(--card)', flexShrink: 0 }}
        >
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={t.placeholder}
            disabled={loading}
            dir={isRTL ? 'rtl' : 'ltr'}
            style={{ flex: 1, ...S.input, borderRadius: '2px', padding: '9px 12px' }}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            style={{ ...S.btnGold, width: 'auto', padding: '0 16px', opacity: loading || !input.trim() ? 0.5 : 1 }}
          >
            {t.send}
          </button>
        </form>
      )}
    </div>
  )

  // ── Embedded mode ──────────────────────────────────────────────────────────

  if (embedded) {
    return (
      <div style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
        {panelContent}
      </div>
    )
  }

  // ── Floating mode ──────────────────────────────────────────────────────────

  // Panel size & position
  const panelStyle: React.CSSProperties = isMobile
    ? { position: 'fixed', inset: 0, zIndex: 9998 }
    : { position: 'fixed', bottom: '86px', right: '20px', width: '380px', height: '560px', zIndex: 9998, borderRadius: '4px', overflow: 'hidden', boxShadow: '0 8px 40px rgba(13,13,13,.22)', border: '1px solid var(--border)' }

  return (
    <>
      {/* Panel */}
      {open && (
        <div style={panelStyle}>
          {panelContent}
        </div>
      )}

      {/* Floating button */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-label={open ? 'Close MAIA' : 'Open MAIA'}
        style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          zIndex: 9999,
          width: '56px',
          height: '56px',
          border: 'none',
          borderRadius: '50%',
          background: open ? 'var(--navy2)' : 'var(--gold)',
          cursor: 'pointer',
          boxShadow: '0 4px 20px rgba(242,106,27,.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          padding: 0,
          transition: 'background 0.2s, transform 0.12s',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.07)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)' }}
      >
        {open
          ? <span style={{ color: '#fff', fontSize: '1rem', fontFamily: 'var(--font-mono)' }}>✕</span>
          : <Image src="/pmi-logo.png" alt="PMI" width={56} height={56} style={{ objectFit: 'cover', borderRadius: '50%' }} />
        }
      </button>
    </>
  )
}
