'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import SiteHeader from '@/components/SiteHeader'

type Lang = 'en' | 'es' | 'pt' | 'fr' | 'he' | 'ru'
type View =
  | 'home'
  | 'homeowner-form'
  | 'homeowner-notfound'
  | 'role-selector'
  | 'agent-form'
  | 'agent-sent'
  | 'vendor-form'
  | 'vendor-sent'

type MatchedRole =
  | { type: 'staff' }
  | { type: 'owner';  owner_id: number; association_code: string; association_name: string }
  | { type: 'board';  board_member_id: string; association_code: string; association_name: string; position: string | null }

const LANG_TABS: { code: Lang; label: string }[] = [
  { code: 'en', label: 'EN' },
  { code: 'es', label: 'ES' },
  { code: 'pt', label: 'PT' },
  { code: 'fr', label: 'FR' },
  { code: 'he', label: 'HE' },
  { code: 'ru', label: 'RU' },
]

interface AssocOption {
  association_code: string
  association_name: string
  principal_address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
}

function VendorCoiCard({ assocData }: { assocData: AssocOption | undefined }) {
  if (!assocData?.principal_address) {
    return (
      <div className="bg-[#f9fafb] border border-[#e5e7eb] rounded-[3px] p-3 text-[0.72rem] text-[#6b7280] leading-relaxed">
        <span className="font-medium text-[#0d0d0d]">📋 COI Additional Insured</span><br/>
        Contact <a href="mailto:billing@topfloridaproperties.com" className="text-[#f26a1b]">billing@topfloridaproperties.com</a> or call <a href="tel:+13059005077" className="text-[#f26a1b]">305.900.5077</a> for COI requirements for this association.
      </div>
    )
  }
  const addr = `${assocData.principal_address}, ${assocData.city}, ${assocData.state ?? 'FL'} ${assocData.zip}`
  return (
    <div className="bg-[#f0fdf4] border border-[#86efac] rounded-[3px] p-3 space-y-1.5">
      <div className="text-[0.6rem] font-medium uppercase tracking-[0.1em] text-[#16a34a] [font-family:var(--font-mono)]">📋 COI Additional Insured Requirements</div>
      <p className="text-[0.72rem] text-[#0d0d0d] leading-relaxed">Your Certificate of Insurance must list:</p>
      <ol className="text-[0.72rem] text-[#0d0d0d] leading-relaxed space-y-1 list-decimal list-inside">
        <li><span className="font-medium">{assocData.association_name}</span><br/><span className="text-[#6b7280] pl-4">{addr}</span></li>
        <li><span className="font-medium">PMI Top Florida Properties</span><br/><span className="text-[#6b7280] pl-4">1031 Ives Dairy Road Suite 228, Miami, FL 33179</span></li>
      </ol>
      <p className="text-[0.68rem] text-[#6b7280] pt-1">Forward to your insurance agent · Questions? <a href="mailto:billing@topfloridaproperties.com" className="text-[#f26a1b]">billing@topfloridaproperties.com</a></p>
    </div>
  )
}

// ── Translations ─────────────────────────────────────────────────────────────

interface Persona { key: string; icon: string; title: string; desc: string }
interface T {
  welcome: string; subtitle: string; back: string; contact: string
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
    welcome: 'How can we help you today?',
    subtitle: 'Select who you are to get started.',
    back: '← Back',
    contact: 'Questions?',
    lookupTitle: 'Find Your Association',
    lookupSubtitle: 'Enter your contact info to look up your account.',
    firstName: 'First Name', lastName: 'Last Name', email: 'Email Address', phone: 'Phone Number',
    lookupBtn: 'Look Up My Account', lookupBusy: 'Looking up…',
    notFoundTitle: 'Account Not Found',
    notFoundBody: 'We couldn\'t find an account matching that information. Please contact PMI directly:',
    agentTitle: 'Real Estate Agent Inquiry',
    agentSubtitle: 'Our team will reach out within one business day.',
    agentName: 'Full Name', agentLicense: 'License Number', agentAssoc: 'Association',
    agentSendBtn: 'Submit Inquiry', agentBusy: 'Sending…',
    agentSentTitle: 'Inquiry Received',
    agentSentBody: 'Thank you! Our team will be in touch within one business day.',
    vendorTitle: 'Vendor Inquiry',
    vendorSubtitle: 'Submit your info and we\'ll send you the ACH and COI forms.',
    company: 'Company Name', contactName: 'Contact Name', vendorAssoc: 'Association',
    vendorSendBtn: 'Submit', vendorBusy: 'Sending…',
    vendorSentTitle: 'Thank You!',
    vendorSentBody: 'We\'ve sent the required forms to your email. Our billing team will follow up shortly.',
    selectAssoc: '— Select Association —',
    personas: [
      { key: 'homeowner', icon: '🏠', title: 'Unit Owner',  desc: 'Access your association portal & account' },
      { key: 'applicant', icon: '📋', title: 'Rental Applicant',       desc: 'Apply to rent in one of our communities' },
      { key: 'agent',     icon: '🏢', title: 'Real Estate Agent',      desc: 'Listings, buyers & estoppel requests' },
      { key: 'board',     icon: '👥', title: 'Board Member',           desc: 'Review invoices & approvals' },
      { key: 'vendor',    icon: '🔧', title: 'Vendor / Contractor',    desc: 'Invoices, ACH setup & coordination' },
      { key: 'buyer',     icon: '🏡', title: 'Buyer Applicant',        desc: 'Apply to purchase a unit' },
      { key: 'title',     icon: '🏛️', title: 'Title Company',          desc: 'Estoppel requests & closing documents' },
      { key: 'staff',     icon: '🔒', title: 'PMI Staff',              desc: 'Internal dashboard' },
    ],
  },
  es: {
    welcome: '¿Cómo podemos ayudarte hoy?',
    subtitle: 'Selecciona quién eres para comenzar.',
    back: '← Volver',
    contact: '¿Preguntas?',
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
      { key: 'homeowner', icon: '🏠', title: 'Propietario de Unidad', desc: 'Accede al portal y tu cuenta de asociación' },
      { key: 'applicant', icon: '📋', title: 'Solicitante de Alquiler',  desc: 'Solicita alquilar en nuestras comunidades' },
      { key: 'agent',     icon: '🏢', title: 'Agente de Bienes Raíces',  desc: 'Propiedades, compradores y estoppel' },
      { key: 'board',     icon: '👥', title: 'Miembro de la Junta',      desc: 'Revisa facturas y aprobaciones' },
      { key: 'vendor',    icon: '🔧', title: 'Proveedor / Contratista',  desc: 'Facturas, ACH y coordinación' },
      { key: 'buyer',     icon: '🏡', title: 'Comprador',                desc: 'Solicita la compra de una unidad' },
      { key: 'title',     icon: '🏛️', title: 'Compañía de Título',       desc: 'Estoppel y documentos de cierre' },
      { key: 'staff',     icon: '🔒', title: 'Personal PMI',             desc: 'Panel interno' },
    ],
  },
  pt: {
    welcome: 'Como podemos ajudá-lo hoje?',
    subtitle: 'Selecione quem você é para começar.',
    back: '← Voltar',
    contact: 'Dúvidas?',
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
      { key: 'applicant', icon: '📋', title: 'Candidato a Inquilino',    desc: 'Candidate-se em nossas comunidades' },
      { key: 'agent',     icon: '🏢', title: 'Corretor de Imóveis',      desc: 'Imóveis, compradores e estoppel' },
      { key: 'board',     icon: '👥', title: 'Membro da Diretoria',      desc: 'Revise faturas e aprovações' },
      { key: 'vendor',    icon: '🔧', title: 'Fornecedor / Contratado',  desc: 'Faturas, ACH e coordenação' },
      { key: 'buyer',     icon: '🏡', title: 'Comprador',                desc: 'Solicite a compra de uma unidade' },
      { key: 'title',     icon: '🏛️', title: 'Empresa de Título',        desc: 'Estoppel e documentos de fechamento' },
      { key: 'staff',     icon: '🔒', title: 'Equipe PMI',               desc: 'Painel interno' },
    ],
  },
  fr: {
    welcome: 'Comment pouvons-nous vous aider ?',
    subtitle: 'Sélectionnez qui vous êtes pour commencer.',
    back: '← Retour',
    contact: 'Questions ?',
    lookupTitle: 'Trouver Votre Association',
    lookupSubtitle: 'Entrez vos coordonnées pour rechercher votre compte.',
    firstName: 'Prénom', lastName: 'Nom', email: 'Adresse E-mail', phone: 'Numéro de Téléphone',
    lookupBtn: 'Rechercher Mon Compte', lookupBusy: 'Recherche…',
    notFoundTitle: 'Compte Introuvable',
    notFoundBody: 'Nous n\'avons pas trouvé de compte correspondant. Veuillez contacter PMI directement :',
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
      { key: 'homeowner', icon: '🏠', title: 'Propriétaire d\'Unité',  desc: 'Accédez au portail et à votre compte' },
      { key: 'applicant', icon: '📋', title: 'Candidat Locataire',       desc: 'Postulez dans nos communautés' },
      { key: 'agent',     icon: '🏢', title: 'Agent Immobilier',         desc: 'Annonces, acheteurs et estoppel' },
      { key: 'board',     icon: '👥', title: 'Membre du Conseil',        desc: 'Factures et approbations' },
      { key: 'vendor',    icon: '🔧', title: 'Fournisseur',              desc: 'Factures, ACH et coordination' },
      { key: 'buyer',     icon: '🏡', title: 'Acheteur',                 desc: "Demandez l'achat d'une unité" },
      { key: 'title',     icon: '🏛️', title: 'Société de Titre',         desc: "Estoppel et documents de clôture" },
      { key: 'staff',     icon: '🔒', title: 'Personnel PMI',            desc: 'Tableau de bord interne' },
    ],
  },
  he: {
    welcome: 'כיצד נוכל לעזור לך היום?',
    subtitle: 'בחר מי אתה כדי להתחיל.',
    back: 'חזרה →',
    contact: 'שאלות?',
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
      { key: 'homeowner', icon: '🏠', title: 'בעל יחידה',  desc: 'גש לפורטל ולחשבון העמותה שלך' },
      { key: 'applicant', icon: '📋', title: 'מועמד לשכירות',     desc: 'הגש מועמדות בקהילות שלנו' },
      { key: 'agent',     icon: '🏢', title: 'סוכן נדל"ן',        desc: 'רישומים, קונים ו-estoppel' },
      { key: 'board',     icon: '👥', title: 'חבר ועד',           desc: 'סקור חשבוניות ואישורים' },
      { key: 'vendor',    icon: '🔧', title: 'ספק / קבלן',        desc: 'חשבוניות, ACH ותיאום' },
      { key: 'buyer',     icon: '🏡', title: 'קונה דירה',         desc: 'הגש מועמדות לרכישה' },
      { key: 'title',     icon: '🏛️', title: 'חברת טייטל',        desc: 'estoppel ומסמכי סגירה' },
      { key: 'staff',     icon: '🔒', title: 'צוות PMI',          desc: 'לוח פנימי' },
    ],
  },
  ru: {
    welcome: 'Как мы можем вам помочь?',
    subtitle: 'Выберите, кто вы, чтобы начать.',
    back: '← Назад',
    contact: 'Вопросы?',
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
      { key: 'homeowner', icon: '🏠', title: 'Владелец Единицы',   desc: 'Доступ к порталу и аккаунту ассоциации' },
      { key: 'applicant', icon: '📋', title: 'Арендатор',               desc: 'Подайте заявку в наших комплексах' },
      { key: 'agent',     icon: '🏢', title: 'Агент по недвижимости',   desc: 'Объявления, покупатели и estoppel' },
      { key: 'board',     icon: '👥', title: 'Член правления',          desc: 'Счета и одобрения' },
      { key: 'vendor',    icon: '🔧', title: 'Поставщик / Подрядчик',  desc: 'Счета, ACH и координация' },
      { key: 'buyer',     icon: '🏡', title: 'Покупатель',              desc: 'Подайте заявку на покупку' },
      { key: 'title',     icon: '🏛️', title: 'Титульная Компания',      desc: 'Запросы estoppel и документы' },
      { key: 'staff',     icon: '🔒', title: 'Персонал PMI',            desc: 'Внутренняя панель' },
    ],
  },
}

// ── Shared input/label styles ─────────────────────────────────────────────────
const inputCls = 'w-full px-3 py-2.5 border border-[#e5e7eb] rounded-[2px] text-sm focus:outline-none focus:border-[#f26a1b] focus:shadow-[0_0_0_3px_rgba(242,106,27,.12)] bg-white transition-shadow'
const labelCls = 'block mb-1 text-[0.62rem] font-medium uppercase tracking-[0.1em] text-[#6b7280] [font-family:var(--font-mono)]'

export default function Home() {
  const router = useRouter()
  const [lang, setLang]   = useState<Lang>('en')
  const [view, setView]         = useState<View>('home')
  const [busy, setBusy]         = useState(false)
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

  // Associations — fetched dynamically from Supabase via API
  const [associations, setAssociations] = useState<AssocOption[]>([])
  useEffect(() => {
    fetch('/api/associations')
      .then(r => r.json())
      .then(setAssociations)
      .catch(() => {/* silently ignore — dropdowns will just be empty */})
  }, [])

  // Restore saved persona from sessionStorage
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('maia_persona')
      if (saved) setSavedPersona(JSON.parse(saved) as MatchedRole)
    } catch { /* ignore */ }
  }, [])

  const t     = COPY[lang]
  const isRtl = lang === 'he'

  // ── Handlers ────────────────────────────────────────────────────────────────

  function handlePersona(key: string) {
    if (key === 'homeowner') { setView('homeowner-form'); return }
    if (key === 'applicant') { router.push('/apply'); return }
    if (key === 'buyer')     { router.push('/apply'); return }
    if (key === 'agent')     { setView('agent-form'); return }
    if (key === 'board')     { setView('homeowner-form'); return }
    if (key === 'vendor')    { setView('vendor-form'); return }
    if (key === 'title')     { window.open('https://secure.condocerts.com/resale/', '_blank'); return }
    if (key === 'staff')     { setView('homeowner-form'); return }
  }

  function routeToRole(role: MatchedRole) {
    try { sessionStorage.setItem('maia_persona', JSON.stringify(role)) } catch { /* ignore */ }
    if (role.type === 'staff') { router.push('/admin'); return }
    if (role.type === 'owner') { router.push(`/my-account?id=${role.owner_id}&assoc=${role.association_code}`); return }
    if (role.type === 'board') { router.push(`/board?id=${role.board_member_id}&assoc=${role.association_code}`); return }
  }

  async function handleHomeownerLookup(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const res = await fetch('/api/homeowner-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName: hwFirst, lastName: hwLast, email: hwEmail, phone: hwPhone }),
      })
      const data = await res.json()
      if (!data.found || !data.roles?.length) {
        setView('homeowner-notfound')
        return
      }
      if (data.roles.length === 1) {
        routeToRole(data.roles[0] as MatchedRole)
      } else {
        setMatchedRoles(data.roles as MatchedRole[])
        try { sessionStorage.setItem('maia_roles', JSON.stringify(data.roles)) } catch { /* ignore */ }
        setView('role-selector')
      }
    } catch {
      setView('homeowner-notfound')
    } finally {
      setBusy(false)
    }
  }

  async function handleAgentSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await fetch('/api/agent-inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: agName, email: agEmail, phone: agPhone, licenseNumber: agLicense, association: agAssoc }),
      })
      setView('agent-sent')
    } finally {
      setBusy(false)
    }
  }

  async function handleVendorSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await fetch('/api/vendor-inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName: vdCompany, contactName: vdContact, email: vdEmail, phone: vdPhone, association: vdAssoc }),
      })
      setView('vendor-sent')
    } finally {
      setBusy(false)
    }
  }

  // ── Shared UI pieces ─────────────────────────────────────────────────────────

  const BackBtn = () => (
    <button
      onClick={() => { setMatchedRoles([]); setView('home') }}
      className="inline-flex items-center gap-1 text-[0.72rem] text-[#6b7280] hover:text-[#f26a1b] [font-family:var(--font-mono)] uppercase tracking-[0.08em] mb-6 transition-colors"
    >
      {t.back}
    </button>
  )

  const AssocSelect = ({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) => (
    <div>
      <label className={labelCls}>{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} className={inputCls}>
        <option value="">{associations.length === 0 ? '— Loading… —' : t.selectAssoc}</option>
        {associations.map(a => (
          <option key={a.association_code} value={a.association_name}>
            {a.association_name}
          </option>
        ))}
      </select>
    </div>
  )

  const OrangeBtn = ({ label, disabled }: { label: string; disabled?: boolean }) => (
    <button
      type="submit"
      disabled={disabled}
      className="w-full bg-[#f26a1b] hover:bg-[#f58140] disabled:opacity-50 text-white [font-family:var(--font-mono)] text-[0.62rem] font-medium uppercase tracking-[0.08em] py-2.5 px-4 rounded-[2px] transition-colors"
    >
      {label}
    </button>
  )

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex flex-col bg-[#f5f5f4]" dir={isRtl ? 'rtl' : 'ltr'}>

      <SiteHeader subtitle="HOMEOWNER PORTAL">
        <div className="flex gap-0.5 bg-white/10 rounded-lg p-1">
          {LANG_TABS.map(l => (
            <button
              key={l.code}
              onClick={() => setLang(l.code)}
              className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all ${
                lang === l.code
                  ? 'bg-[#f26a1b] text-white shadow-sm'
                  : 'text-white/60 hover:text-white hover:bg-white/10'
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      </SiteHeader>

      {/* ── Main ───────────────────────────────────────────── */}
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-8">

        {/* ── HOME — persona grid ─────────────────────────── */}
        {view === 'home' && (
          <>
            {/* Saved persona quick-access */}
            {savedPersona && (
              <div className="max-w-md mx-auto mb-6 bg-white border border-[#e5e7eb] rounded-[3px] shadow-[0_1px_4px_rgba(13,13,13,.06)] p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[0.6rem] font-medium uppercase tracking-[0.1em] text-[#6b7280] [font-family:var(--font-mono)] mb-0.5">Quick Access</div>
                  <div className="text-sm font-semibold text-[#0d0d0d] leading-snug">
                    {savedPersona.type === 'staff' && 'PMI Staff Dashboard'}
                    {savedPersona.type === 'owner' && `Unit Owner — ${savedPersona.association_name}`}
                    {savedPersona.type === 'board' && `Board Member — ${savedPersona.association_name}`}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => routeToRole(savedPersona)}
                    className="bg-[#f26a1b] hover:bg-[#f58140] text-white [font-family:var(--font-mono)] text-[0.6rem] uppercase tracking-[0.08em] px-3 py-1.5 rounded-[2px] transition-colors"
                  >
                    Continue
                  </button>
                  <button
                    onClick={() => { try { sessionStorage.removeItem('maia_persona') } catch { /* ignore */ }; setSavedPersona(null) }}
                    className="text-[0.6rem] text-[#6b7280] hover:text-[#0d0d0d] [font-family:var(--font-mono)] uppercase tracking-[0.08em] transition-colors"
                  >
                    Not you?
                  </button>
                </div>
              </div>
            )}

            <div className={`mb-8 ${isRtl ? 'text-right' : 'text-center'}`}>
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-1">{t.welcome}</h1>
              <p className="text-gray-500 text-base">{t.subtitle}</p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {t.personas.map(p => (
                <button
                  key={p.key}
                  onClick={() => handlePersona(p.key)}
                  className={`group bg-white border border-gray-200 rounded-xl p-5 hover:border-orange-400 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-150 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-2 ${isRtl ? 'text-right' : 'text-left'}`}
                >
                  <div className="text-3xl mb-3 leading-none">{p.icon}</div>
                  <div className="font-semibold text-gray-900 text-sm mb-1 group-hover:text-orange-600 transition-colors leading-tight">
                    {p.title}
                  </div>
                  <div className="text-xs text-gray-400 leading-snug">{p.desc}</div>
                </button>
              ))}
            </div>
          </>
        )}

        {/* ── HOMEOWNER — lookup form ─────────────────────── */}
        {view === 'homeowner-form' && (
          <div className="max-w-md mx-auto">
            <BackBtn />
            <div className="bg-white border border-[#e5e7eb] rounded-[3px] shadow-[0_1px_4px_rgba(13,13,13,.06)] p-6">
              <h2 className={`text-lg font-light text-[#0d0d0d] mb-1 [font-family:var(--font-display)] ${isRtl ? 'text-right' : ''}`}>{t.lookupTitle}</h2>
              <p className={`text-sm text-[#6b7280] mb-5 ${isRtl ? 'text-right' : ''}`}>{t.lookupSubtitle}</p>
              <form onSubmit={handleHomeownerLookup} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>{t.firstName}</label>
                    <input className={inputCls} value={hwFirst} onChange={e => setHwFirst(e.target.value)} dir="ltr" />
                  </div>
                  <div>
                    <label className={labelCls}>{t.lastName}</label>
                    <input className={inputCls} value={hwLast} onChange={e => setHwLast(e.target.value)} dir="ltr" />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>{t.email}</label>
                  <input type="email" className={inputCls} value={hwEmail} onChange={e => setHwEmail(e.target.value)} dir="ltr" />
                </div>
                <div>
                  <label className={labelCls}>{t.phone}</label>
                  <input type="tel" className={inputCls} value={hwPhone} onChange={e => setHwPhone(e.target.value)} dir="ltr" />
                </div>
                <OrangeBtn label={busy ? t.lookupBusy : t.lookupBtn} disabled={busy} />
              </form>
            </div>
          </div>
        )}

        {/* ── HOMEOWNER — not found ───────────────────────── */}
        {view === 'homeowner-notfound' && (
          <div className="max-w-md mx-auto">
            <BackBtn />
            <div className="bg-white border border-[#e5e7eb] rounded-[3px] shadow-[0_1px_4px_rgba(13,13,13,.06)] p-6 text-center">
              <div className="text-4xl mb-3">🔍</div>
              <h2 className="text-lg font-light text-[#0d0d0d] mb-2 [font-family:var(--font-display)]">{t.notFoundTitle}</h2>
              <p className="text-sm text-[#6b7280] mb-4">{t.notFoundBody}</p>
              <div className="space-y-2">
                <a href="mailto:PMI@topfloridaproperties.com" className="block text-[#f26a1b] hover:underline [font-family:var(--font-mono)] text-[0.72rem] uppercase tracking-[0.06em]">
                  PMI@topfloridaproperties.com
                </a>
                <a href="tel:+13059005077" className="block text-[#f26a1b] hover:underline [font-family:var(--font-mono)] text-[0.72rem] uppercase tracking-[0.06em]">
                  📞 305.900.5077
                </a>
                <a href="https://wa.me/17866863223" target="_blank" rel="noreferrer" className="block hover:underline [font-family:var(--font-mono)] text-[0.72rem] uppercase tracking-[0.06em]" style={{ color: '#25d366' }}>
                  💬 (786) 686-3223
                </a>
              </div>
            </div>
          </div>
        )}

        {/* ── ROLE SELECTOR — multiple matches ─────────────── */}
        {view === 'role-selector' && (
          <div className="max-w-md mx-auto">
            <BackBtn />
            <div className="bg-white border border-[#e5e7eb] rounded-[3px] shadow-[0_1px_4px_rgba(13,13,13,.06)] p-6">
              <h2 className="text-lg font-light text-[#0d0d0d] mb-1 [font-family:var(--font-display)]">Multiple Roles Found</h2>
              <p className="text-sm text-[#6b7280] mb-5">Your account exists in multiple roles. How would you like to access today?</p>
              <div className="flex flex-col gap-2">
                {matchedRoles.map((role, i) => {
                  const icon = role.type === 'staff' ? '🔒' : role.type === 'owner' ? '🏠' : '👥'
                  const title = role.type === 'staff'
                    ? 'PMI Staff'
                    : role.type === 'owner'
                    ? 'Unit Owner'
                    : `Board Member${role.position ? ` — ${role.position}` : ''}`
                  const sub = role.type === 'staff'
                    ? 'Access staff dashboard'
                    : role.type === 'owner'
                    ? `View my account — ${role.association_name}`
                    : `Access board portal — ${role.association_name}`
                  return (
                    <button
                      key={i}
                      onClick={() => routeToRole(role)}
                      className="flex items-center gap-3 p-3 bg-white border border-[#e5e7eb] rounded-[3px] hover:border-[#f26a1b] hover:shadow-[0_3px_12px_rgba(242,106,27,.14)] transition-all text-left group"
                    >
                      <span className="text-2xl w-9 text-center flex-shrink-0">{icon}</span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold text-[#0d0d0d] group-hover:text-[#f26a1b] transition-colors">{title}</span>
                        <span className="block text-[0.62rem] text-[#6b7280] [font-family:var(--font-mono)] mt-0.5 truncate">{sub}</span>
                      </span>
                      <span className="text-[0.6rem] text-white bg-[#f26a1b] [font-family:var(--font-mono)] uppercase tracking-[0.08em] px-2.5 py-1 rounded-[2px] flex-shrink-0">
                        Select
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── AGENT — form ─────────────────────────────────── */}
        {view === 'agent-form' && (
          <div className="max-w-md mx-auto">
            <BackBtn />
            <div className="bg-white border border-[#e5e7eb] rounded-[3px] shadow-[0_1px_4px_rgba(13,13,13,.06)] p-6">
              <h2 className={`text-lg font-light text-[#0d0d0d] mb-1 [font-family:var(--font-display)] ${isRtl ? 'text-right' : ''}`}>{t.agentTitle}</h2>
              <p className={`text-sm text-[#6b7280] mb-5 ${isRtl ? 'text-right' : ''}`}>{t.agentSubtitle}</p>
              <form onSubmit={handleAgentSubmit} className="space-y-3">
                <div>
                  <label className={labelCls}>{t.agentName} *</label>
                  <input required className={inputCls} value={agName} onChange={e => setAgName(e.target.value)} dir="ltr" />
                </div>
                <div>
                  <label className={labelCls}>{t.email} *</label>
                  <input required type="email" className={inputCls} value={agEmail} onChange={e => setAgEmail(e.target.value)} dir="ltr" />
                </div>
                <div>
                  <label className={labelCls}>{t.phone}</label>
                  <input type="tel" className={inputCls} value={agPhone} onChange={e => setAgPhone(e.target.value)} dir="ltr" />
                </div>
                <div>
                  <label className={labelCls}>{t.agentLicense}</label>
                  <input className={inputCls} value={agLicense} onChange={e => setAgLicense(e.target.value)} dir="ltr" />
                </div>
                <AssocSelect value={agAssoc} onChange={setAgAssoc} label={t.agentAssoc} />
                <OrangeBtn label={busy ? t.agentBusy : t.agentSendBtn} disabled={busy} />
              </form>
            </div>
          </div>
        )}

        {/* ── AGENT — sent ─────────────────────────────────── */}
        {view === 'agent-sent' && (
          <div className="max-w-md mx-auto">
            <BackBtn />
            <div className="bg-white border border-[#e5e7eb] rounded-[3px] shadow-[0_1px_4px_rgba(13,13,13,.06)] p-6 text-center">
              <div className="text-4xl mb-3">✅</div>
              <h2 className="text-lg font-light text-[#0d0d0d] mb-2 [font-family:var(--font-display)]">{t.agentSentTitle}</h2>
              <p className="text-sm text-[#6b7280]">{t.agentSentBody}</p>
            </div>
          </div>
        )}

        {/* ── VENDOR — form ────────────────────────────────── */}
        {view === 'vendor-form' && (
          <div className="max-w-md mx-auto">
            <BackBtn />

            {/* Required documents card */}
            <div className="bg-[#fff8f4] border border-[#f26a1b]/30 rounded-[3px] p-4 mb-4">
              <div className="text-[0.6rem] font-medium uppercase tracking-[0.1em] text-[#f26a1b] [font-family:var(--font-mono)] mb-3">Required Documents for Vendors</div>
              <div className="flex items-center justify-between gap-3 mb-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-base flex-shrink-0">📄</span>
                  <span className="text-sm text-[#0d0d0d] font-medium leading-snug">Vendor ACH Authorization Form</span>
                </div>
                <a
                  href="/vendor-ach-form.pdf"
                  download="Vendor-ACH-Authorization-Form.pdf"
                  className="flex-shrink-0 bg-[#f26a1b] hover:bg-[#f58140] text-white [font-family:var(--font-mono)] text-[0.58rem] uppercase tracking-[0.08em] px-3 py-1.5 rounded-[2px] transition-colors whitespace-nowrap"
                >
                  Download
                </a>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-base flex-shrink-0">📋</span>
                <div className="min-w-0">
                  <span className="text-sm text-[#0d0d0d] font-medium">Certificate of Insurance (COI)</span>
                  <p className="text-[0.7rem] text-[#6b7280] mt-0.5 leading-snug">Requirements will appear after selecting your association below.</p>
                </div>
              </div>
            </div>

            <div className="bg-white border border-[#e5e7eb] rounded-[3px] shadow-[0_1px_4px_rgba(13,13,13,.06)] p-6">
              <h2 className={`text-lg font-light text-[#0d0d0d] mb-1 [font-family:var(--font-display)] ${isRtl ? 'text-right' : ''}`}>{t.vendorTitle}</h2>
              <p className={`text-sm text-[#6b7280] mb-5 ${isRtl ? 'text-right' : ''}`}>{t.vendorSubtitle}</p>
              <form onSubmit={handleVendorSubmit} className="space-y-3">
                <div>
                  <label className={labelCls}>{t.company} *</label>
                  <input required className={inputCls} value={vdCompany} onChange={e => setVdCompany(e.target.value)} dir="ltr" />
                </div>
                <div>
                  <label className={labelCls}>{t.contactName}</label>
                  <input className={inputCls} value={vdContact} onChange={e => setVdContact(e.target.value)} dir="ltr" />
                </div>
                <div>
                  <label className={labelCls}>{t.email} *</label>
                  <input required type="email" className={inputCls} value={vdEmail} onChange={e => setVdEmail(e.target.value)} dir="ltr" />
                </div>
                <div>
                  <label className={labelCls}>{t.phone}</label>
                  <input type="tel" className={inputCls} value={vdPhone} onChange={e => setVdPhone(e.target.value)} dir="ltr" />
                </div>
                <AssocSelect value={vdAssoc} onChange={setVdAssoc} label={t.vendorAssoc} />

                {/* COI additional insured card — shows immediately on association selection */}
                {vdAssoc && <VendorCoiCard assocData={associations.find(a => a.association_name === vdAssoc)} />}

                <OrangeBtn label={busy ? t.vendorBusy : t.vendorSendBtn} disabled={busy} />
              </form>
            </div>
          </div>
        )}

        {/* ── VENDOR — sent ────────────────────────────────── */}
        {view === 'vendor-sent' && (
          <div className="max-w-md mx-auto">
            <BackBtn />
            <div className="bg-white border border-[#e5e7eb] rounded-[3px] shadow-[0_1px_4px_rgba(13,13,13,.06)] p-6 text-center">
              <div className="text-4xl mb-3">✅</div>
              <h2 className="text-lg font-light text-[#0d0d0d] mb-2 [font-family:var(--font-display)]">{t.vendorSentTitle}</h2>
              <p className="text-sm text-[#6b7280] mb-5">{t.vendorSentBody}</p>
              <a
                href="/vendor-ach-form.pdf"
                download="Vendor-ACH-Authorization-Form.pdf"
                className="inline-flex items-center gap-2 bg-[#f26a1b] hover:bg-[#f58140] text-white [font-family:var(--font-mono)] text-[0.62rem] uppercase tracking-[0.08em] px-5 py-2.5 rounded-[2px] transition-colors"
              >
                📄 Download ACH Authorization Form
              </a>
            </div>
          </div>
        )}

      </main>

      {/* ── Footer ─────────────────────────────────────────── */}
      <footer className="bg-black text-white/50 px-4 py-5">
        <div className={`max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs ${isRtl ? 'sm:flex-row-reverse' : ''}`}>
          <div className="flex items-center gap-2 flex-wrap justify-center">
            <span>{t.contact}</span>
            <a href="mailto:PMI@topfloridaproperties.com" className="text-orange-400 hover:text-orange-300 hover:underline">PMI@topfloridaproperties.com</a>
            <span className="text-white/20">·</span>
            <a href="tel:+13059005077" className="text-orange-400 hover:text-orange-300 hover:underline">305.900.5077</a>
            <span className="text-white/20">·</span>
            <a href="https://wa.me/17866863223" target="_blank" rel="noreferrer" className="hover:underline" style={{ color: '#25d366' }}>💬 (786) 686-3223</a>
          </div>
          <div className="text-white/30">© 2026 PMI Top Florida Properties</div>
        </div>
      </footer>

    </div>
  )
}
