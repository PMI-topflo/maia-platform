'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'

// ── Types ─────────────────────────────────────────────────────────────────────

type Lang = 'en' | 'es' | 'pt' | 'fr' | 'he' | 'ru'
type View =
  | 'home' | 'homeowner-form' | 'homeowner-notfound' | 'role-selector'
  | 'agent-form' | 'agent-sent' | 'vendor-form' | 'vendor-sent'

type MatchedRole =
  | { type: 'staff' }
  | { type: 'owner';  owner_id: number; association_code: string; association_name: string }
  | { type: 'board';  board_member_id: string; association_code: string; association_name: string; position: string | null }

interface AssocOption {
  association_code: string; association_name: string
  principal_address?: string | null; city?: string | null; state?: string | null; zip?: string | null
}

// ── Config ────────────────────────────────────────────────────────────────────

const LANG_TABS: { code: Lang; label: string }[] = [
  { code: 'en', label: 'EN' }, { code: 'es', label: 'ES' }, { code: 'pt', label: 'PT' },
  { code: 'fr', label: 'FR' }, { code: 'he', label: 'HE' }, { code: 'ru', label: 'RU' },
]

const GREETING: Record<Lang, string> = {
  en: "Hi! I'm MAIA, your PMI Top Florida assistant. How can I help you today?",
  es: '¡Hola! Soy MAIA, tu asistente de PMI Top Florida. ¿Cómo puedo ayudarte?',
  pt: 'Olá! Sou a MAIA, sua assistente da PMI Top Florida. Como posso ajudar?',
  fr: 'Bonjour ! Je suis MAIA, votre assistante PMI Top Florida. Comment puis-je vous aider ?',
  he: '!שלום! אני MAIA, העוזרת שלך של PMI Top Florida. כיצד אוכל לעזור לך היום',
  ru: 'Привет! Я MAIA, ваш ассистент PMI Top Florida. Как я могу помочь вам сегодня?',
}

const BUBBLES = [
  { icon: '💳', label: 'Pay HOA Fees',  desc: 'Secure online payments for dues & assessments', cls: 'left-[3%] top-[15%]',   anim: 'bfl-1' },
  { icon: '📄', label: 'Documents',     desc: 'Rules, financials & governing documents',       cls: 'left-[11%] top-[38%]',  anim: 'bfl-2' },
  { icon: '📋', label: 'Applications',  desc: 'Rental & purchase application portal',          cls: 'left-[4%] top-[63%]',   anim: 'bfl-3' },
  { icon: '🔧', label: 'Maintenance',   desc: 'Submit & track requests 24/7',                  cls: 'left-[14%] top-[79%]',  anim: 'bfl-4' },
  { icon: '🏗',  label: 'ARC Requests', desc: 'Architectural modification permits',            cls: 'right-[3%] top-[15%]',  anim: 'bfl-5' },
  { icon: '🚗', label: 'Parking',       desc: 'Vehicle registration & parking passes',         cls: 'right-[11%] top-[38%]', anim: 'bfl-6' },
  { icon: '📞', label: 'Contact Us',    desc: '24/7 support — phone, SMS & WhatsApp',          cls: 'right-[4%] top-[63%]',  anim: 'bfl-7' },
  { icon: '🏦', label: 'Vendor ACH',    desc: 'ACH setup & COI document submission',           cls: 'right-[14%] top-[79%]', anim: 'bfl-8' },
]

// ── Translations ──────────────────────────────────────────────────────────────

interface Persona { key: string; icon: string; title: string; desc: string }
interface T {
  back: string; contact: string
  lookupTitle: string; lookupSubtitle: string
  firstName: string; lastName: string; email: string; phone: string
  lookupBtn: string; lookupBusy: string
  notFoundTitle: string; notFoundBody: string
  agentTitle: string; agentSubtitle: string
  agentName: string; agentLicense: string; agentAssoc: string; agentSendBtn: string; agentBusy: string
  agentSentTitle: string; agentSentBody: string
  vendorTitle: string; vendorSubtitle: string
  company: string; contactName: string; vendorAssoc: string; vendorSendBtn: string; vendorBusy: string
  vendorSentTitle: string; vendorSentBody: string
  selectAssoc: string
  personas: Persona[]
}

const COPY: Record<Lang, T> = {
  en: {
    back: '← Back', contact: 'Questions?',
    lookupTitle: 'Find Your Association',
    lookupSubtitle: 'Enter your contact info to look up your account.',
    firstName: 'First Name', lastName: 'Last Name', email: 'Email Address', phone: 'Phone Number',
    lookupBtn: 'Look Up My Account', lookupBusy: 'Looking up…',
    notFoundTitle: 'Account Not Found',
    notFoundBody: "We couldn't find an account matching that information. Please contact PMI directly:",
    agentTitle: 'Real Estate Agent Inquiry',
    agentSubtitle: 'Our team will reach out within one business day.',
    agentName: 'Full Name', agentLicense: 'License Number', agentAssoc: 'Association',
    agentSendBtn: 'Submit Inquiry', agentBusy: 'Sending…',
    agentSentTitle: 'Inquiry Received',
    agentSentBody: 'Thank you! Our team will be in touch within one business day.',
    vendorTitle: 'Vendor Inquiry',
    vendorSubtitle: "Submit your info and we'll send you the ACH and COI forms.",
    company: 'Company Name', contactName: 'Contact Name', vendorAssoc: 'Association',
    vendorSendBtn: 'Submit', vendorBusy: 'Sending…',
    vendorSentTitle: 'Thank You!',
    vendorSentBody: "We've sent the required forms to your email. Our billing team will follow up shortly.",
    selectAssoc: '— Select Association —',
    personas: [
      { key: 'homeowner', icon: '🏠', title: 'Unit Owner',       desc: 'Access your association portal & account' },
      { key: 'applicant', icon: '📋', title: 'Applicant',         desc: 'Apply to rent or purchase a unit' },
      { key: 'agent',     icon: '🏢', title: 'Real Estate Agent', desc: 'Listings, buyers & estoppel requests' },
      { key: 'board',     icon: '👥', title: 'Board Member',      desc: 'Review invoices & approvals' },
      { key: 'vendor',    icon: '🔧', title: 'Vendor',            desc: 'Invoices, ACH setup & coordination' },
      { key: 'staff',     icon: '🔒', title: 'PMI Staff',         desc: 'Internal dashboard' },
    ],
  },
  es: {
    back: '← Volver', contact: '¿Preguntas?',
    lookupTitle: 'Encuentra Tu Asociación',
    lookupSubtitle: 'Ingresa tu información de contacto para buscar tu cuenta.',
    firstName: 'Nombre', lastName: 'Apellido', email: 'Correo Electrónico', phone: 'Número de Teléfono',
    lookupBtn: 'Buscar Mi Cuenta', lookupBusy: 'Buscando…',
    notFoundTitle: 'Cuenta No Encontrada',
    notFoundBody: 'No encontramos una cuenta con esa información. Por favor contacta a PMI directamente:',
    agentTitle: 'Consulta de Agente Inmobiliario',
    agentSubtitle: 'Nuestro equipo se comunicará en un día hábil.',
    agentName: 'Nombre Completo', agentLicense: 'Número de Licencia', agentAssoc: 'Asociación',
    agentSendBtn: 'Enviar Consulta', agentBusy: 'Enviando…',
    agentSentTitle: 'Consulta Recibida',
    agentSentBody: '¡Gracias! Nuestro equipo se comunicará en un día hábil.',
    vendorTitle: 'Consulta de Proveedor',
    vendorSubtitle: 'Envía tu información y te enviaremos los formularios ACH y COI.',
    company: 'Nombre de la Empresa', contactName: 'Nombre de Contacto', vendorAssoc: 'Asociación',
    vendorSendBtn: 'Enviar', vendorBusy: 'Enviando…',
    vendorSentTitle: '¡Gracias!',
    vendorSentBody: 'Hemos enviado los formularios requeridos a tu correo. Nuestro equipo de facturación hará seguimiento.',
    selectAssoc: '— Seleccionar Asociación —',
    personas: [
      { key: 'homeowner', icon: '🏠', title: 'Propietario de Unidad',  desc: 'Accede al portal y tu cuenta de asociación' },
      { key: 'applicant', icon: '📋', title: 'Solicitante',            desc: 'Solicita alquilar o comprar una unidad' },
      { key: 'agent',     icon: '🏢', title: 'Agente de Bienes Raíces',desc: 'Propiedades, compradores y estoppel' },
      { key: 'board',     icon: '👥', title: 'Miembro de la Junta',    desc: 'Revisa facturas y aprobaciones' },
      { key: 'vendor',    icon: '🔧', title: 'Proveedor',              desc: 'Facturas, ACH y coordinación' },
      { key: 'staff',     icon: '🔒', title: 'Personal PMI',           desc: 'Panel interno' },
    ],
  },
  pt: {
    back: '← Voltar', contact: 'Dúvidas?',
    lookupTitle: 'Encontre Sua Associação',
    lookupSubtitle: 'Digite suas informações de contato para encontrar sua conta.',
    firstName: 'Nome', lastName: 'Sobrenome', email: 'E-mail', phone: 'Telefone',
    lookupBtn: 'Buscar Minha Conta', lookupBusy: 'Buscando…',
    notFoundTitle: 'Conta Não Encontrada',
    notFoundBody: 'Não encontramos uma conta com essas informações. Entre em contato com a PMI:',
    agentTitle: 'Consulta de Corretor',
    agentSubtitle: 'Nossa equipe entrará em contato em um dia útil.',
    agentName: 'Nome Completo', agentLicense: 'Número de Licença', agentAssoc: 'Associação',
    agentSendBtn: 'Enviar Consulta', agentBusy: 'Enviando…',
    agentSentTitle: 'Consulta Recebida',
    agentSentBody: 'Obrigado! Nossa equipe entrará em contato em um dia útil.',
    vendorTitle: 'Consulta de Fornecedor',
    vendorSubtitle: 'Envie suas informações e enviaremos os formulários ACH e COI.',
    company: 'Nome da Empresa', contactName: 'Nome do Contato', vendorAssoc: 'Associação',
    vendorSendBtn: 'Enviar', vendorBusy: 'Enviando…',
    vendorSentTitle: 'Obrigado!',
    vendorSentBody: 'Enviamos os formulários necessários para seu e-mail. Nossa equipe de cobrança entrará em contato.',
    selectAssoc: '— Selecionar Associação —',
    personas: [
      { key: 'homeowner', icon: '🏠', title: 'Proprietário de Unidade', desc: 'Acesse o portal e sua conta de associação' },
      { key: 'applicant', icon: '📋', title: 'Candidato',               desc: 'Candidate-se para alugar ou comprar' },
      { key: 'agent',     icon: '🏢', title: 'Corretor de Imóveis',     desc: 'Imóveis, compradores e estoppel' },
      { key: 'board',     icon: '👥', title: 'Membro da Diretoria',     desc: 'Revise faturas e aprovações' },
      { key: 'vendor',    icon: '🔧', title: 'Fornecedor',              desc: 'Faturas, ACH e coordenação' },
      { key: 'staff',     icon: '🔒', title: 'Equipe PMI',              desc: 'Painel interno' },
    ],
  },
  fr: {
    back: '← Retour', contact: 'Questions ?',
    lookupTitle: 'Trouver Votre Association',
    lookupSubtitle: 'Entrez vos coordonnées pour rechercher votre compte.',
    firstName: 'Prénom', lastName: 'Nom', email: 'Adresse E-mail', phone: 'Numéro de Téléphone',
    lookupBtn: 'Rechercher Mon Compte', lookupBusy: 'Recherche…',
    notFoundTitle: 'Compte Introuvable',
    notFoundBody: "Nous n'avons pas trouvé de compte correspondant. Veuillez contacter PMI directement :",
    agentTitle: 'Demande Agent Immobilier',
    agentSubtitle: 'Notre équipe vous contactera dans un jour ouvrable.',
    agentName: 'Nom Complet', agentLicense: 'Numéro de Licence', agentAssoc: 'Association',
    agentSendBtn: 'Soumettre', agentBusy: 'Envoi…',
    agentSentTitle: 'Demande Reçue',
    agentSentBody: 'Merci ! Notre équipe vous contactera dans un jour ouvrable.',
    vendorTitle: 'Demande Fournisseur',
    vendorSubtitle: 'Soumettez vos infos et nous vous enverrons les formulaires ACH et COI.',
    company: 'Nom de la Société', contactName: 'Nom du Contact', vendorAssoc: 'Association',
    vendorSendBtn: 'Envoyer', vendorBusy: 'Envoi…',
    vendorSentTitle: 'Merci !',
    vendorSentBody: 'Nous avons envoyé les formulaires requis à votre adresse e-mail.',
    selectAssoc: '— Sélectionner une Association —',
    personas: [
      { key: 'homeowner', icon: '🏠', title: "Propriétaire d'Unité",  desc: 'Accédez au portail et à votre compte' },
      { key: 'applicant', icon: '📋', title: 'Candidat',              desc: 'Postulez dans nos communautés' },
      { key: 'agent',     icon: '🏢', title: 'Agent Immobilier',      desc: 'Annonces, acheteurs et estoppel' },
      { key: 'board',     icon: '👥', title: 'Membre du Conseil',     desc: 'Factures et approbations' },
      { key: 'vendor',    icon: '🔧', title: 'Fournisseur',           desc: 'Factures, ACH et coordination' },
      { key: 'staff',     icon: '🔒', title: 'Personnel PMI',         desc: 'Tableau de bord interne' },
    ],
  },
  he: {
    back: 'חזרה →', contact: 'שאלות?',
    lookupTitle: 'מצא את העמותה שלך',
    lookupSubtitle: 'הזן את פרטי הקשר שלך כדי לחפש את חשבונך.',
    firstName: 'שם פרטי', lastName: 'שם משפחה', email: 'כתובת מייל', phone: 'מספר טלפון',
    lookupBtn: 'חפש את חשבוני', lookupBusy: 'מחפש…',
    notFoundTitle: 'חשבון לא נמצא',
    notFoundBody: 'לא מצאנו חשבון עם הפרטים האלה. אנא פנה ישירות ל-PMI:',
    agentTitle: 'פנייה של סוכן נדל"ן',
    agentSubtitle: 'הצוות שלנו יחזור אליך תוך יום עסקים אחד.',
    agentName: 'שם מלא', agentLicense: 'מספר רישיון', agentAssoc: 'עמותה',
    agentSendBtn: 'שלח פנייה', agentBusy: 'שולח…',
    agentSentTitle: 'הפנייה התקבלה',
    agentSentBody: 'תודה! הצוות שלנו יצור קשר תוך יום עסקים אחד.',
    vendorTitle: 'פנייה של ספק',
    vendorSubtitle: 'שלח את הפרטים שלך ונשלח לך את טפסי ה-ACH וה-COI.',
    company: 'שם החברה', contactName: 'שם איש הקשר', vendorAssoc: 'עמותה',
    vendorSendBtn: 'שלח', vendorBusy: 'שולח…',
    vendorSentTitle: 'תודה!',
    vendorSentBody: 'שלחנו את הטפסים הנדרשים לכתובת המייל שלך.',
    selectAssoc: '— בחר עמותה —',
    personas: [
      { key: 'homeowner', icon: '🏠', title: 'בעל יחידה',      desc: 'גש לפורטל ולחשבון העמותה שלך' },
      { key: 'applicant', icon: '📋', title: 'מועמד',           desc: 'הגש מועמדות לשכירות או רכישה' },
      { key: 'agent',     icon: '🏢', title: 'סוכן נדל"ן',     desc: 'רישומים, קונים ו-estoppel' },
      { key: 'board',     icon: '👥', title: 'חבר ועד',        desc: 'סקור חשבוניות ואישורים' },
      { key: 'vendor',    icon: '🔧', title: 'ספק / קבלן',     desc: 'חשבוניות, ACH ותיאום' },
      { key: 'staff',     icon: '🔒', title: 'צוות PMI',       desc: 'לוח פנימי' },
    ],
  },
  ru: {
    back: '← Назад', contact: 'Вопросы?',
    lookupTitle: 'Найти Вашу Ассоциацию',
    lookupSubtitle: 'Введите контактные данные для поиска вашего аккаунта.',
    firstName: 'Имя', lastName: 'Фамилия', email: 'Электронная почта', phone: 'Номер телефона',
    lookupBtn: 'Найти мой аккаунт', lookupBusy: 'Поиск…',
    notFoundTitle: 'Аккаунт не найден',
    notFoundBody: 'Мы не нашли аккаунт с этими данными. Свяжитесь с PMI напрямую:',
    agentTitle: 'Запрос агента по недвижимости',
    agentSubtitle: 'Наша команда свяжется с вами в течение одного рабочего дня.',
    agentName: 'Полное имя', agentLicense: 'Номер лицензии', agentAssoc: 'Ассоциация',
    agentSendBtn: 'Отправить запрос', agentBusy: 'Отправка…',
    agentSentTitle: 'Запрос получен',
    agentSentBody: 'Спасибо! Наша команда свяжется с вами в течение одного рабочего дня.',
    vendorTitle: 'Запрос поставщика',
    vendorSubtitle: 'Отправьте данные и мы вышлем вам формы ACH и COI.',
    company: 'Название компании', contactName: 'Имя контактного лица', vendorAssoc: 'Ассоциация',
    vendorSendBtn: 'Отправить', vendorBusy: 'Отправка…',
    vendorSentTitle: 'Спасибо!',
    vendorSentBody: 'Мы отправили необходимые формы на ваш email. Наша команда по выставлению счетов свяжется с вами.',
    selectAssoc: '— Выберите ассоциацию —',
    personas: [
      { key: 'homeowner', icon: '🏠', title: 'Владелец Единицы',     desc: 'Доступ к порталу и аккаунту ассоциации' },
      { key: 'applicant', icon: '📋', title: 'Соискатель',            desc: 'Подайте заявку на аренду или покупку' },
      { key: 'agent',     icon: '🏢', title: 'Агент по недвижимости', desc: 'Объявления, покупатели и estoppel' },
      { key: 'board',     icon: '👥', title: 'Член правления',        desc: 'Счета и одобрения' },
      { key: 'vendor',    icon: '🔧', title: 'Поставщик',             desc: 'Счета, ACH и координация' },
      { key: 'staff',     icon: '🔒', title: 'Персонал PMI',          desc: 'Внутренняя панель' },
    ],
  },
}

// ── Shared input/label styles ─────────────────────────────────────────────────

const inputCls = 'w-full px-3 py-2.5 border border-[#333] rounded-[2px] text-sm focus:outline-none focus:border-[#f26a1b] focus:shadow-[0_0_0_3px_rgba(242,106,27,.18)] bg-[#1a1a1a] text-white placeholder:text-[#555] transition-shadow'
const labelCls = 'block mb-1 text-[0.62rem] font-medium uppercase tracking-[0.1em] text-[#9ca3af] [font-family:var(--font-mono)]'

// ── VendorCoiCard ─────────────────────────────────────────────────────────────

function VendorCoiCard({ assocData }: { assocData: AssocOption | undefined }) {
  if (!assocData?.principal_address) {
    return (
      <div className="bg-[#1a1a1a] border border-[#333] rounded-[3px] p-3 text-[0.72rem] text-[#9ca3af] leading-relaxed">
        <span className="font-medium text-white">📋 COI Additional Insured</span><br />
        Contact <a href="mailto:billing@topfloridaproperties.com" className="text-[#f26a1b]">billing@topfloridaproperties.com</a> or call <a href="tel:+13059005077" className="text-[#f26a1b]">305.900.5077</a> for COI requirements for this association.
      </div>
    )
  }
  const addr = `${assocData.principal_address}, ${assocData.city}, ${assocData.state ?? 'FL'} ${assocData.zip}`
  return (
    <div className="bg-[#0d1a10] border border-[#1e4d2b] rounded-[3px] p-3 space-y-1.5">
      <div className="text-[0.6rem] font-medium uppercase tracking-[0.1em] text-[#4ade80] [font-family:var(--font-mono)]">📋 COI Additional Insured Requirements</div>
      <ol className="text-[0.72rem] text-white leading-relaxed space-y-1 list-decimal list-inside">
        <li><span className="font-medium">{assocData.association_name}</span><br /><span className="text-[#9ca3af] pl-4">{addr}</span></li>
        <li><span className="font-medium">PMI Top Florida Properties</span><br /><span className="text-[#9ca3af] pl-4">1031 Ives Dairy Road Suite 228, Miami, FL 33179</span></li>
      </ol>
      <p className="text-[0.68rem] text-[#9ca3af] pt-1">Forward to your insurance agent · Questions? <a href="mailto:billing@topfloridaproperties.com" className="text-[#f26a1b]">billing@topfloridaproperties.com</a></p>
    </div>
  )
}

// ── Gateway ───────────────────────────────────────────────────────────────────

export default function Home() {
  const router = useRouter()

  // Animation
  const [phase, setPhase]           = useState<0 | 1 | 2>(0)
  const [sloganIdx, setSloganIdx]   = useState(0)
  const [greetingText, setGreetingText] = useState('')
  const [greetingDone, setGreetingDone] = useState(false)

  // UI state
  const [lang, setLang]             = useState<Lang>('en')
  const [view, setView]             = useState<View>('home')
  const [busy, setBusy]             = useState(false)
  const [matchedRoles, setMatchedRoles] = useState<MatchedRole[]>([])
  const [savedPersona, setSavedPersona] = useState<MatchedRole | null>(null)

  // Homeowner form
  const [hwFirst, setHwFirst] = useState('')
  const [hwLast,  setHwLast]  = useState('')
  const [hwEmail, setHwEmail] = useState('')
  const [hwPhone, setHwPhone] = useState('')

  // Agent form
  const [agName,    setAgName]    = useState('')
  const [agEmail,   setAgEmail]   = useState('')
  const [agPhone,   setAgPhone]   = useState('')
  const [agLicense, setAgLicense] = useState('')
  const [agAssoc,   setAgAssoc]   = useState('')

  // Vendor form
  const [vdCompany, setVdCompany] = useState('')
  const [vdContact, setVdContact] = useState('')
  const [vdEmail,   setVdEmail]   = useState('')
  const [vdPhone,   setVdPhone]   = useState('')
  const [vdAssoc,   setVdAssoc]   = useState('')

  // Associations list
  const [associations, setAssociations] = useState<AssocOption[]>([])

  useEffect(() => {
    fetch('/api/associations').then(r => r.json()).then(setAssociations).catch(() => {})
  }, [])

  // Restore saved persona
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('maia_persona')
      if (saved) setSavedPersona(JSON.parse(saved) as MatchedRole)
    } catch { /* ignore */ }
  }, [])

  // Opening animation sequence
  useEffect(() => {
    setPhase(1)
    const SLOGAN = 'the property management people'
    let i = 0
    const typeId = setInterval(() => { setSloganIdx(++i); if (i >= SLOGAN.length) clearInterval(typeId) }, 55)
    const phaseId = setTimeout(() => setPhase(2), 2700)
    return () => { clearInterval(typeId); clearTimeout(phaseId) }
  }, [])

  // Greeting typewriter — reruns on phase 2 start and on language change
  useEffect(() => {
    if (phase < 2) return
    setGreetingText('')
    setGreetingDone(false)
    const full = GREETING[lang]
    let i = 0
    const id = setInterval(() => {
      setGreetingText(full.slice(0, ++i))
      if (i >= full.length) { setGreetingDone(true); clearInterval(id) }
    }, 28)
    return () => clearInterval(id)
  }, [phase, lang])

  const t = COPY[lang]
  const isRtl = lang === 'he'
  const SLOGAN = 'the property management people'

  // ── Handlers ─────────────────────────────────────────────────────────────────

  function logPersona(key: string) {
    void fetch('/api/log-persona', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ persona: key, channel: 'web' }),
    })
  }

  function handlePersona(key: string) {
    logPersona(key)
    if (key === 'homeowner') { setView('homeowner-form'); return }
    if (key === 'applicant') { router.push('/apply'); return }
    if (key === 'agent')     { setView('agent-form'); return }
    if (key === 'board')     { setView('homeowner-form'); return }
    if (key === 'vendor')    { setView('vendor-form'); return }
    if (key === 'staff')     { setView('homeowner-form'); return }
  }

  function routeToRole(role: MatchedRole) {
    try { sessionStorage.setItem('maia_persona', JSON.stringify(role)) } catch { /* ignore */ }
    if (role.type === 'staff') { router.push('/admin'); return }
    if (role.type === 'owner') { router.push(`/my-account?id=${role.owner_id}&assoc=${role.association_code}`); return }
    if (role.type === 'board') { router.push(`/board?id=${role.board_member_id}&assoc=${role.association_code}`); return }
  }

  async function handleHomeownerLookup(e: React.FormEvent) {
    e.preventDefault(); setBusy(true)
    try {
      const res  = await fetch('/api/homeowner-lookup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName: hwFirst, lastName: hwLast, email: hwEmail, phone: hwPhone }),
      })
      const data = await res.json()
      if (!data.found || !data.roles?.length) { setView('homeowner-notfound'); return }
      if (data.roles.length === 1) {
        routeToRole(data.roles[0] as MatchedRole)
      } else {
        setMatchedRoles(data.roles as MatchedRole[])
        try { sessionStorage.setItem('maia_roles', JSON.stringify(data.roles)) } catch { /* ignore */ }
        setView('role-selector')
      }
    } catch { setView('homeowner-notfound') } finally { setBusy(false) }
  }

  async function handleAgentSubmit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true)
    try {
      await fetch('/api/agent-inquiry', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: agName, email: agEmail, phone: agPhone, licenseNumber: agLicense, association: agAssoc }),
      })
      setView('agent-sent')
    } finally { setBusy(false) }
  }

  async function handleVendorSubmit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true)
    try {
      await fetch('/api/vendor-inquiry', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName: vdCompany, contactName: vdContact, email: vdEmail, phone: vdPhone, association: vdAssoc }),
      })
      setView('vendor-sent')
    } finally { setBusy(false) }
  }

  // ── Shared sub-components ─────────────────────────────────────────────────────

  const BackBtn = () => (
    <button
      onClick={() => { setMatchedRoles([]); setView('home') }}
      className="inline-flex items-center gap-1 text-[0.72rem] text-[#9ca3af] hover:text-[#f26a1b] [font-family:var(--font-mono)] uppercase tracking-[0.08em] mb-4 transition-colors"
    >
      {t.back}
    </button>
  )

  const AssocSelect = ({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) => (
    <div>
      <label className={labelCls}>{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} className={inputCls + ' [color-scheme:dark]'}>
        <option value="">{associations.length === 0 ? '— Loading… —' : t.selectAssoc}</option>
        {associations.map(a => (
          <option key={a.association_code} value={a.association_name}>{a.association_name}</option>
        ))}
      </select>
    </div>
  )

  const OrangeBtn = ({ label, disabled }: { label: string; disabled?: boolean }) => (
    <button type="submit" disabled={disabled}
      className="w-full bg-[#f26a1b] hover:bg-[#f58140] disabled:opacity-50 text-white [font-family:var(--font-mono)] text-[0.62rem] font-medium uppercase tracking-[0.08em] py-2.5 px-4 rounded-[2px] transition-colors"
    >
      {label}
    </button>
  )

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{`
        @keyframes bfl-1{0%,100%{transform:translateY(0) rotate(0deg)}50%{transform:translateY(-22px) rotate(2deg)}}
        @keyframes bfl-2{0%,100%{transform:translateY(0) rotate(0deg)}40%{transform:translateY(-16px) rotate(-1.5deg)}75%{transform:translateY(8px) rotate(1deg)}}
        @keyframes bfl-3{0%,100%{transform:translateY(0) rotate(0deg)}55%{transform:translateY(-18px) rotate(1.5deg)}}
        @keyframes bfl-4{0%,100%{transform:translateY(0) rotate(0deg)}30%{transform:translateY(12px) rotate(-2deg)}70%{transform:translateY(-14px) rotate(1deg)}}
        @keyframes bfl-5{0%,100%{transform:translateY(0) rotate(0deg)}45%{transform:translateY(-20px) rotate(-1deg)}80%{transform:translateY(6px) rotate(2deg)}}
        @keyframes bfl-6{0%,100%{transform:translateY(0) rotate(0deg)}55%{transform:translateY(-12px) rotate(1deg)}}
        @keyframes bfl-7{0%,100%{transform:translateY(0) rotate(0deg)}35%{transform:translateY(-24px) rotate(-2deg)}65%{transform:translateY(10px) rotate(1.5deg)}}
        @keyframes bfl-8{0%,100%{transform:translateY(0) rotate(0deg)}50%{transform:translateY(-10px) rotate(0.5deg)}}
        @keyframes intro-up{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
        @keyframes dot-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.4;transform:scale(1.5)}}
        @keyframes cursor-blink{0%,100%{opacity:1}50%{opacity:0}}
        .cursor-blink{animation:cursor-blink 0.8s step-end infinite}
        .bubble-hover-card{opacity:0;pointer-events:none;transition:opacity 0.2s ease,transform 0.2s ease;transform:translateY(4px)}
        .bubble-wrap:hover .bubble-hover-card{opacity:1;transform:translateY(0)}
        .bubble-circle{transition:border-color 0.2s,box-shadow 0.2s}
        .bubble-wrap:hover .bubble-circle{border-color:rgba(242,106,27,0.5)!important;box-shadow:0 0 20px rgba(242,106,27,0.25)}
      `}</style>

      <div
        className="min-h-screen flex flex-col overflow-hidden"
        style={{ background: 'linear-gradient(150deg, #0d0d0d 0%, #141414 50%, #111111 100%)' }}
        dir={isRtl ? 'rtl' : 'ltr'}
      >

        {/* ── Intro overlay (phases 0 & 1) ───────────────────────────────── */}
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center"
          style={{
            background: '#0d0d0d',
            opacity: phase < 2 ? 1 : 0,
            pointerEvents: phase < 2 ? 'auto' : 'none',
            transition: 'opacity 0.9s ease',
          }}
        >
          {phase >= 1 && (
            <div className="flex flex-col items-center gap-7" style={{ animation: 'intro-up 0.7s ease both' }}>
              {/* Logo with glow */}
              <div className="relative">
                <div
                  className="absolute inset-0 rounded-full"
                  style={{ background: 'radial-gradient(circle, rgba(242,106,27,0.35) 0%, transparent 70%)', filter: 'blur(24px)', transform: 'scale(1.8)' }}
                />
                <Image src="/pmi-logo.png" alt="PMI Top Florida" width={130} height={65} className="relative z-10 object-contain" />
              </div>
              {/* Slogan typewriter */}
              <div className="text-center space-y-2.5">
                <div className="[font-family:var(--font-display)] italic text-[#f26a1b] text-2xl sm:text-3xl tracking-wide min-h-[36px]">
                  {SLOGAN.slice(0, sloganIdx)}
                  <span className="cursor-blink" style={{ opacity: sloganIdx < SLOGAN.length ? 1 : 0 }}>|</span>
                </div>
                <div
                  className="text-white/50 text-xs [font-family:var(--font-body)] tracking-[0.22em] uppercase"
                  style={{ opacity: sloganIdx >= SLOGAN.length ? 1 : 0, transition: 'opacity 0.7s ease 0.2s' }}
                >
                  Making Property Management Manageable
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Top bar ────────────────────────────────────────────────────── */}
        <div
          className="flex-shrink-0 flex items-center justify-between px-4 sm:px-6 gap-2"
          style={{
            height: '32px',
            background: 'rgba(242,106,27,0.90)',
            opacity: phase >= 2 ? 1 : 0,
            transition: 'opacity 0.6s ease 0.3s',
          }}
        >
          <span className="text-white/90 text-[0.58rem] sm:text-[0.62rem] [font-family:var(--font-mono)] uppercase tracking-[0.1em] truncate">
            WHATSAPP &amp; SMS 24/7&nbsp; ·&nbsp; +1 (786) 686-3223&nbsp; ·&nbsp; EN · ES · PT · FR · HE · RU
          </span>
          <a
            href="tel:+13059005077"
            className="text-white font-bold text-[0.7rem] sm:text-[0.78rem] [font-family:var(--font-mono)] tracking-wide flex-shrink-0 hover:text-white/80 transition-colors"
          >
            305.900.5077
          </a>
        </div>

        {/* ── Main content ───────────────────────────────────────────────── */}
        <div
          className="flex-1 relative flex flex-col items-center justify-center py-5 px-4"
          style={{
            opacity: phase >= 2 ? 1 : 0,
            transition: 'opacity 0.8s ease 0.15s',
          }}
        >
          {/* Desktop floating bubbles (xl+ only) */}
          <div className="hidden xl:block absolute inset-0" style={{ pointerEvents: 'none' }}>
            {BUBBLES.map((b, i) => (
              <div
                key={b.label}
                className={`absolute bubble-wrap ${b.cls}`}
                style={{
                  animation: `${b.anim} ${5.5 + i * 0.55}s ease-in-out infinite`,
                  animationDelay: `${i * 0.38}s`,
                  pointerEvents: 'auto',
                  zIndex: 5,
                }}
              >
                {/* Bubble circle */}
                <div
                  className="bubble-circle flex items-center justify-center rounded-full cursor-default select-none"
                  style={{
                    width: '80px', height: '80px',
                    background: 'rgba(255,255,255,0.035)',
                    border: '1px solid rgba(255,255,255,0.09)',
                    backdropFilter: 'blur(14px)',
                  }}
                >
                  <span className="text-[1.6rem] leading-none">{b.icon}</span>
                </div>
                {/* Hover info card */}
                <div
                  className="bubble-hover-card absolute left-1/2 z-20 rounded-lg"
                  style={{
                    top: '90px',
                    transform: 'translateX(-50%)',
                    background: 'rgba(14,14,14,0.97)',
                    border: '1px solid rgba(242,106,27,0.45)',
                    boxShadow: '0 4px 24px rgba(242,106,27,0.18), 0 8px 32px rgba(0,0,0,0.5)',
                    borderRadius: '10px',
                    padding: '11px 15px',
                    width: '188px',
                  }}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-lg leading-none">{b.icon}</span>
                    <span className="text-white text-[0.76rem] font-semibold [font-family:var(--font-body)]">{b.label}</span>
                  </div>
                  <p className="text-[#9ca3af] text-[0.64rem] leading-relaxed [font-family:var(--font-body)]">{b.desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* MAIA widget */}
          <div
            className="relative z-10 w-full max-w-[600px]"
            style={{
              transform: phase >= 2 ? 'scale(1)' : 'scale(0.88)',
              transition: 'transform 0.65s cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}
          >
            <div
              className="rounded-xl overflow-hidden"
              style={{
                background: '#111111',
                border: '1px solid rgba(242,106,27,0.22)',
                boxShadow: '0 0 50px rgba(242,106,27,0.10), 0 24px 64px rgba(0,0,0,0.7)',
              }}
            >
              {/* Widget header */}
              <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="flex items-center gap-2.5">
                  <Image src="/pmi-icon.jpg" alt="PMI" width={28} height={28} className="rounded-full object-cover flex-shrink-0" />
                  <span className="text-white text-[1.15rem] [font-family:var(--font-display)] font-light tracking-wider">MAIA</span>
                  <span
                    className="w-2 h-2 rounded-full bg-[#f26a1b] flex-shrink-0"
                    style={{ animation: 'dot-pulse 2.2s ease-in-out infinite' }}
                  />
                </div>
                {/* Language tabs */}
                <div className="flex gap-0.5 rounded-md p-0.5" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  {LANG_TABS.map(l => (
                    <button
                      key={l.code}
                      onClick={() => { setLang(l.code); if (view !== 'home') setView('home') }}
                      className={`px-2 py-0.5 text-[0.63rem] font-bold rounded transition-all [font-family:var(--font-mono)] ${
                        lang === l.code ? 'bg-[#f26a1b] text-white' : 'text-white/45 hover:text-white/75 hover:bg-white/[0.07]'
                      }`}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Widget body */}
              <div className="px-5 py-4 overflow-y-auto" style={{ maxHeight: '60vh' }}>

                {/* ── HOME ─────────────────────────────────────────────── */}
                {view === 'home' && (
                  <>
                    {/* Quick access saved persona */}
                    {savedPersona && (
                      <div className="mb-4 flex items-center justify-between gap-3 px-3 py-2.5 rounded-[3px]" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                        <div className="min-w-0">
                          <div className="text-[0.56rem] font-medium uppercase tracking-[0.1em] text-[#9ca3af] [font-family:var(--font-mono)] mb-0.5">Quick Access</div>
                          <div className="text-sm font-semibold text-white leading-snug truncate">
                            {savedPersona.type === 'staff' && 'PMI Staff Dashboard'}
                            {savedPersona.type === 'owner' && `Unit Owner — ${savedPersona.association_name}`}
                            {savedPersona.type === 'board' && `Board Member — ${savedPersona.association_name}`}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            onClick={() => routeToRole(savedPersona)}
                            className="bg-[#f26a1b] hover:bg-[#f58140] text-white [font-family:var(--font-mono)] text-[0.58rem] uppercase tracking-[0.08em] px-3 py-1.5 rounded-[2px] transition-colors"
                          >
                            Continue
                          </button>
                          <button
                            onClick={() => { try { sessionStorage.removeItem('maia_persona') } catch { /* ignore */ }; setSavedPersona(null) }}
                            className="text-[0.58rem] text-[#6b7280] hover:text-white [font-family:var(--font-mono)] uppercase tracking-[0.08em] transition-colors"
                          >
                            Not you?
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Greeting bubble */}
                    <div className={`flex gap-2.5 mb-5 ${isRtl ? 'flex-row-reverse' : ''}`}>
                      <div className="flex-shrink-0 w-7 h-7 rounded-full overflow-hidden mt-0.5">
                        <Image src="/pmi-icon.jpg" alt="MAIA" width={28} height={28} className="object-cover" />
                      </div>
                      <div
                        className="flex-1 rounded-2xl px-4 py-3 text-sm text-white leading-relaxed min-h-[48px]"
                        style={{
                          borderTopLeftRadius: isRtl ? undefined : '4px',
                          borderTopRightRadius: isRtl ? '4px' : undefined,
                          background: 'rgba(242,106,27,0.10)',
                          border: '1px solid rgba(242,106,27,0.18)',
                        }}
                        dir={isRtl ? 'rtl' : 'ltr'}
                      >
                        {greetingText}
                        {!greetingDone && <span className="cursor-blink text-[#f26a1b]">▋</span>}
                      </div>
                    </div>

                    {/* Persona buttons — appear when greeting finishes */}
                    {greetingDone && (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 maia-fade">
                        {t.personas.map(p => (
                          <button
                            key={p.key}
                            onClick={() => handlePersona(p.key)}
                            className={`group flex flex-col items-center text-center p-3.5 rounded-lg transition-all duration-200 active:scale-[0.97] ${isRtl ? '' : ''}`}
                            style={{
                              border: '1px solid rgba(255,255,255,0.07)',
                              background: 'rgba(255,255,255,0.02)',
                            }}
                            onMouseEnter={e => {
                              const el = e.currentTarget
                              el.style.borderColor = 'rgba(242,106,27,0.45)'
                              el.style.background   = 'rgba(255,255,255,0.04)'
                              el.style.boxShadow    = '0 0 18px rgba(242,106,27,0.14)'
                            }}
                            onMouseLeave={e => {
                              const el = e.currentTarget
                              el.style.borderColor = 'rgba(255,255,255,0.07)'
                              el.style.background   = 'rgba(255,255,255,0.02)'
                              el.style.boxShadow    = 'none'
                            }}
                          >
                            <span className="text-2xl mb-1.5 leading-none">{p.icon}</span>
                            <span className="text-[0.76rem] font-semibold text-white leading-tight mb-0.5 group-hover:text-[#f26a1b] transition-colors">{p.title}</span>
                            <span className="text-[0.62rem] text-[#6b7280] leading-snug">{p.desc}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}

                {/* ── HOMEOWNER FORM ──────────────────────────────────── */}
                {view === 'homeowner-form' && (
                  <div className="maia-fade">
                    <BackBtn />
                    <h2 className={`text-base font-light text-white mb-1 [font-family:var(--font-display)] ${isRtl ? 'text-right' : ''}`}>{t.lookupTitle}</h2>
                    <p className={`text-sm text-[#9ca3af] mb-4 ${isRtl ? 'text-right' : ''}`}>{t.lookupSubtitle}</p>
                    <form onSubmit={handleHomeownerLookup} className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div><label className={labelCls}>{t.firstName}</label><input className={inputCls} value={hwFirst} onChange={e => setHwFirst(e.target.value)} dir="ltr" /></div>
                        <div><label className={labelCls}>{t.lastName}</label><input className={inputCls} value={hwLast} onChange={e => setHwLast(e.target.value)} dir="ltr" /></div>
                      </div>
                      <div><label className={labelCls}>{t.email}</label><input type="email" className={inputCls} value={hwEmail} onChange={e => setHwEmail(e.target.value)} dir="ltr" /></div>
                      <div><label className={labelCls}>{t.phone}</label><input type="tel" className={inputCls} value={hwPhone} onChange={e => setHwPhone(e.target.value)} dir="ltr" /></div>
                      <OrangeBtn label={busy ? t.lookupBusy : t.lookupBtn} disabled={busy} />
                    </form>
                  </div>
                )}

                {/* ── NOT FOUND ───────────────────────────────────────── */}
                {view === 'homeowner-notfound' && (
                  <div className="maia-fade text-center py-4">
                    <BackBtn />
                    <div className="text-4xl mb-3">🔍</div>
                    <h2 className="text-base font-light text-white mb-2 [font-family:var(--font-display)]">{t.notFoundTitle}</h2>
                    <p className="text-sm text-[#9ca3af] mb-4">{t.notFoundBody}</p>
                    <div className="space-y-2">
                      <a href="mailto:PMI@topfloridaproperties.com" className="block text-[#f26a1b] hover:underline [font-family:var(--font-mono)] text-[0.72rem] uppercase tracking-[0.06em]">PMI@topfloridaproperties.com</a>
                      <a href="tel:+13059005077" className="block text-[#f26a1b] hover:underline [font-family:var(--font-mono)] text-[0.72rem] uppercase tracking-[0.06em]">📞 305.900.5077</a>
                      <a href="https://wa.me/17866863223" target="_blank" rel="noreferrer" className="block hover:underline [font-family:var(--font-mono)] text-[0.72rem] uppercase tracking-[0.06em]" style={{ color: '#25d366' }}>💬 (786) 686-3223</a>
                    </div>
                  </div>
                )}

                {/* ── ROLE SELECTOR ───────────────────────────────────── */}
                {view === 'role-selector' && (
                  <div className="maia-fade">
                    <BackBtn />
                    <h2 className="text-base font-light text-white mb-1 [font-family:var(--font-display)]">Multiple Roles Found</h2>
                    <p className="text-sm text-[#9ca3af] mb-4">Your account exists in multiple roles. How would you like to access today?</p>
                    <div className="flex flex-col gap-2">
                      {matchedRoles.map((role, i) => {
                        const icon  = role.type === 'staff' ? '🔒' : role.type === 'owner' ? '🏠' : '👥'
                        const title = role.type === 'staff' ? 'PMI Staff' : role.type === 'owner' ? 'Unit Owner' : `Board Member${role.position ? ` — ${role.position}` : ''}`
                        const sub   = role.type === 'staff' ? 'Access staff dashboard' : role.type === 'owner' ? `View my account — ${role.association_name}` : `Access board portal — ${role.association_name}`
                        return (
                          <button key={i} onClick={() => routeToRole(role)}
                            className="group flex items-center gap-3 p-3 rounded-[3px] transition-all text-left"
                            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(242,106,27,0.45)'; e.currentTarget.style.boxShadow = '0 0 14px rgba(242,106,27,0.14)' }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'; e.currentTarget.style.boxShadow = 'none' }}
                          >
                            <span className="text-2xl w-9 text-center flex-shrink-0">{icon}</span>
                            <span className="flex-1 min-w-0">
                              <span className="block text-sm font-semibold text-white group-hover:text-[#f26a1b] transition-colors">{title}</span>
                              <span className="block text-[0.62rem] text-[#6b7280] [font-family:var(--font-mono)] mt-0.5 truncate">{sub}</span>
                            </span>
                            <span className="text-[0.58rem] text-white bg-[#f26a1b] [font-family:var(--font-mono)] uppercase tracking-[0.08em] px-2.5 py-1 rounded-[2px] flex-shrink-0">Select</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* ── AGENT FORM ──────────────────────────────────────── */}
                {view === 'agent-form' && (
                  <div className="maia-fade">
                    <BackBtn />
                    <h2 className={`text-base font-light text-white mb-1 [font-family:var(--font-display)] ${isRtl ? 'text-right' : ''}`}>{t.agentTitle}</h2>
                    <p className={`text-sm text-[#9ca3af] mb-4 ${isRtl ? 'text-right' : ''}`}>{t.agentSubtitle}</p>
                    <form onSubmit={handleAgentSubmit} className="space-y-3">
                      <div><label className={labelCls}>{t.agentName} *</label><input required className={inputCls} value={agName} onChange={e => setAgName(e.target.value)} dir="ltr" /></div>
                      <div><label className={labelCls}>{t.email} *</label><input required type="email" className={inputCls} value={agEmail} onChange={e => setAgEmail(e.target.value)} dir="ltr" /></div>
                      <div><label className={labelCls}>{t.phone}</label><input type="tel" className={inputCls} value={agPhone} onChange={e => setAgPhone(e.target.value)} dir="ltr" /></div>
                      <div><label className={labelCls}>{t.agentLicense}</label><input className={inputCls} value={agLicense} onChange={e => setAgLicense(e.target.value)} dir="ltr" /></div>
                      <AssocSelect value={agAssoc} onChange={setAgAssoc} label={t.agentAssoc} />
                      <OrangeBtn label={busy ? t.agentBusy : t.agentSendBtn} disabled={busy} />
                    </form>
                  </div>
                )}

                {/* ── AGENT SENT ──────────────────────────────────────── */}
                {view === 'agent-sent' && (
                  <div className="maia-fade text-center py-4">
                    <BackBtn />
                    <div className="text-4xl mb-3">✅</div>
                    <h2 className="text-base font-light text-white mb-2 [font-family:var(--font-display)]">{t.agentSentTitle}</h2>
                    <p className="text-sm text-[#9ca3af]">{t.agentSentBody}</p>
                  </div>
                )}

                {/* ── VENDOR FORM ─────────────────────────────────────── */}
                {view === 'vendor-form' && (
                  <div className="maia-fade">
                    <BackBtn />
                    {/* Required docs card */}
                    <div className="rounded-[3px] p-3 mb-4" style={{ background: 'rgba(242,106,27,0.06)', border: '1px solid rgba(242,106,27,0.18)' }}>
                      <div className="text-[0.58rem] font-medium uppercase tracking-[0.1em] text-[#f26a1b] [font-family:var(--font-mono)] mb-2.5">Required Documents for Vendors</div>
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-base flex-shrink-0">📄</span>
                          <span className="text-sm text-white font-medium leading-snug">Vendor ACH Authorization Form</span>
                        </div>
                        <a
                          href="/vendor-ach-form.pdf"
                          download="Vendor-ACH-Authorization-Form.pdf"
                          className="flex-shrink-0 bg-[#f26a1b] hover:bg-[#f58140] text-white [font-family:var(--font-mono)] text-[0.56rem] uppercase tracking-[0.08em] px-3 py-1.5 rounded-[2px] transition-colors whitespace-nowrap"
                        >
                          Download
                        </a>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="text-base flex-shrink-0">📋</span>
                        <div className="min-w-0">
                          <span className="text-sm text-white font-medium">Certificate of Insurance (COI)</span>
                          <p className="text-[0.68rem] text-[#9ca3af] mt-0.5 leading-snug">Requirements appear after selecting your association below.</p>
                        </div>
                      </div>
                    </div>
                    <h2 className={`text-base font-light text-white mb-1 [font-family:var(--font-display)] ${isRtl ? 'text-right' : ''}`}>{t.vendorTitle}</h2>
                    <p className={`text-sm text-[#9ca3af] mb-4 ${isRtl ? 'text-right' : ''}`}>{t.vendorSubtitle}</p>
                    <form onSubmit={handleVendorSubmit} className="space-y-3">
                      <div><label className={labelCls}>{t.company} *</label><input required className={inputCls} value={vdCompany} onChange={e => setVdCompany(e.target.value)} dir="ltr" /></div>
                      <div><label className={labelCls}>{t.contactName}</label><input className={inputCls} value={vdContact} onChange={e => setVdContact(e.target.value)} dir="ltr" /></div>
                      <div><label className={labelCls}>{t.email} *</label><input required type="email" className={inputCls} value={vdEmail} onChange={e => setVdEmail(e.target.value)} dir="ltr" /></div>
                      <div><label className={labelCls}>{t.phone}</label><input type="tel" className={inputCls} value={vdPhone} onChange={e => setVdPhone(e.target.value)} dir="ltr" /></div>
                      <AssocSelect value={vdAssoc} onChange={setVdAssoc} label={t.vendorAssoc} />
                      {vdAssoc && <VendorCoiCard assocData={associations.find(a => a.association_name === vdAssoc)} />}
                      <OrangeBtn label={busy ? t.vendorBusy : t.vendorSendBtn} disabled={busy} />
                    </form>
                  </div>
                )}

                {/* ── VENDOR SENT ─────────────────────────────────────── */}
                {view === 'vendor-sent' && (
                  <div className="maia-fade text-center py-4">
                    <BackBtn />
                    <div className="text-4xl mb-3">✅</div>
                    <h2 className="text-base font-light text-white mb-2 [font-family:var(--font-display)]">{t.vendorSentTitle}</h2>
                    <p className="text-sm text-[#9ca3af] mb-5">{t.vendorSentBody}</p>
                    <a
                      href="/vendor-ach-form.pdf"
                      download="Vendor-ACH-Authorization-Form.pdf"
                      className="inline-flex items-center gap-2 bg-[#f26a1b] hover:bg-[#f58140] text-white [font-family:var(--font-mono)] text-[0.62rem] uppercase tracking-[0.08em] px-5 py-2.5 rounded-[2px] transition-colors"
                    >
                      📄 Download ACH Authorization Form
                    </a>
                  </div>
                )}

              </div>
            </div>
          </div>

          {/* Mobile bubble strip (hidden on xl+) */}
          <div className="xl:hidden flex gap-2.5 overflow-x-auto mt-5 pb-1 max-w-[600px] w-full" style={{ scrollbarWidth: 'none' }}>
            {BUBBLES.map(b => (
              <div
                key={b.label}
                className="flex-shrink-0 flex flex-col items-center gap-1.5 px-3 py-2.5 rounded-lg cursor-default"
                style={{
                  background: 'rgba(255,255,255,0.035)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  minWidth: '70px',
                }}
              >
                <span className="text-xl leading-none">{b.icon}</span>
                <span className="text-[0.55rem] text-[#6b7280] [font-family:var(--font-mono)] uppercase tracking-[0.05em] text-center leading-tight">{b.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Bottom bar ─────────────────────────────────────────────────── */}
        <div
          className="flex-shrink-0 flex items-center justify-between px-5 py-2"
          style={{
            borderTop: '1px solid rgba(255,255,255,0.04)',
            opacity: phase >= 2 ? 1 : 0,
            transition: 'opacity 0.6s ease 0.5s',
          }}
        >
          <div className="flex items-center gap-3 text-[0.6rem] text-white/25 [font-family:var(--font-mono)]">
            <a href="mailto:maia@pmitop.com" className="hover:text-white/50 transition-colors">maia@pmitop.com</a>
            <span className="text-white/15">·</span>
            <a href="https://www.pmitop.com" target="_blank" rel="noreferrer" className="hover:text-white/50 transition-colors">www.pmitop.com</a>
          </div>
          <div className="text-[0.6rem] text-white/20 [font-family:var(--font-mono)]">
            © 2026 PMI Top Florida Properties
          </div>
        </div>

      </div>
    </>
  )
}
