'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import AddressSearch from '@/components/AddressSearch'
import TwoFactorAuth from '@/components/TwoFactorAuth'
import type { AddressResult } from '@/app/api/address-search/route'

// ── Types ─────────────────────────────────────────────────────────────────────

type Lang = 'en' | 'es' | 'pt' | 'fr' | 'he' | 'ru'
type View =
  | 'home' | 'homeowner-form' | 'homeowner-notfound' | 'role-selector'
  | 'hw-step2' | 'hw-step3' | 'hw-escalate' | 'hw-escalate-form' | 'hw-escalate-sent'
  | 'hw-chat' | 'hw-chat-sent' | 'hw-2fa'
  | 'agent-form' | 'agent-sent' | 'vendor-form' | 'vendor-sent'

type MatchedRole =
  | { type: 'staff' }
  | { type: 'owner';  owner_id: number; association_code: string; association_name: string }
  | { type: 'board';  board_member_id: string; association_code: string; association_name: string; position: string | null }
  | { type: 'tenant'; association_code: string; association_name: string }

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
  { icon: '💳', label: 'Pay HOA Fees',  desc: 'Secure online payments for dues & assessments', side: 'left'  as const, anim: 'bfl-1' },
  { icon: '📄', label: 'Documents',     desc: 'Rules, financials & governing documents',        side: 'left'  as const, anim: 'bfl-2' },
  { icon: '📋', label: 'Applications',  desc: 'Rental & purchase application portal',           side: 'left'  as const, anim: 'bfl-3' },
  { icon: '🔧', label: 'Maintenance',   desc: 'Submit & track requests 24/7',                   side: 'left'  as const, anim: 'bfl-4' },
  { icon: '🏗',  label: 'ARC Requests', desc: 'Architectural modification permits',             side: 'right' as const, anim: 'bfl-5' },
  { icon: '🚗', label: 'Parking',       desc: 'Vehicle registration & parking passes',          side: 'right' as const, anim: 'bfl-6' },
  { icon: '📞', label: 'Contact Us',    desc: '24/7 support — phone, SMS & WhatsApp',           side: 'right' as const, anim: 'bfl-7' },
  { icon: '🏦', label: 'Vendor ACH',    desc: 'ACH setup & COI document submission',            side: 'right' as const, anim: 'bfl-8' },
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

// ── Multi-step identification messages (all 6 languages) ─────────────────────

interface IdMsgs {
  step2: string; step3: string; step4: string; chatWelcome: string
  step2Addr: string; step2Btn: string; step2Busy: string
  step3Assoc: string; step3Unit: string; step3Btn: string; step3Busy: string
  optATitle: string; optADesc: string; optBTitle: string; optBDesc: string
  escTitle: string; escUnit: string; escHowHear: string; escNeedHelp: string
  escSendBtn: string; escBusy: string; escSentTitle: string; escSentBody: string
  chatPlaceholder: string; chatSend: string; chatEndBtn: string
  chatSentTitle: string; chatSentBody: string
}

const ID_MSGS: Record<Lang, IdMsgs> = {
  en: {
    step2: "I wasn't able to find your account with that information. Let me try another way — can you tell me your property address and unit number?",
    step3: "Let me try one more thing. Do you know the name of your association or community?",
    step4: "I'm sorry, I wasn't able to locate your account. I don't want to leave you without help — I have two options for you:",
    chatWelcome: "I'm here to help! Tell me what you need and I'll make sure our team follows up with you personally.",
    step2Addr: 'Property Address & Unit', step2Btn: 'Search by Address', step2Busy: 'Searching…',
    step3Assoc: 'Association / Community Name', step3Unit: 'Unit Number (optional)', step3Btn: 'Search by Association', step3Busy: 'Searching…',
    optATitle: 'Fill a Quick Form', optADesc: 'Share your details and our team will get back to you within 1 business day.',
    optBTitle: 'Chat with MAIA', optBDesc: "Continue this conversation and I'll make sure our team follows up.",
    escTitle: 'Help Us Find You', escUnit: 'Unit Number', escHowHear: 'How did you hear about us?', escNeedHelp: 'What do you need help with?',
    escSendBtn: 'Send My Info', escBusy: 'Sending…',
    escSentTitle: 'Thank you', escSentBody: 'Paola from our customer service team will review your information and get back to you within 1 business day.',
    chatPlaceholder: 'Type your message…', chatSend: 'Send', chatEndBtn: 'End Chat & Get Follow-up',
    chatSentTitle: 'All set!', chatSentBody: "I've sent a summary of our conversation to our team. Paola will follow up within 1 business day.",
  },
  es: {
    step2: "No pude encontrar tu cuenta con esa información. Déjame intentarlo de otra manera — ¿puedes decirme tu dirección y número de unidad?",
    step3: "Déjame probar algo más. ¿Sabes el nombre de tu asociación o comunidad?",
    step4: "Lo siento, no pude localizar tu cuenta. ¡No quiero dejarte sin ayuda! Tengo dos opciones para ti:",
    chatWelcome: "¡Estoy aquí para ayudar! Cuéntame qué necesitas y me aseguraré de que el equipo te contacte.",
    step2Addr: 'Dirección y Número de Unidad', step2Btn: 'Buscar por Dirección', step2Busy: 'Buscando…',
    step3Assoc: 'Asociación / Comunidad', step3Unit: 'Número de Unidad (opcional)', step3Btn: 'Buscar por Asociación', step3Busy: 'Buscando…',
    optATitle: 'Completa un Formulario', optADesc: 'Comparte tus datos y nuestro equipo te contactará en 1 día hábil.',
    optBTitle: 'Chatear con MAIA', optBDesc: "Continúa la conversación y me aseguraré de que el equipo te haga seguimiento.",
    escTitle: 'Ayúdanos a Encontrarte', escUnit: 'Número de Unidad', escHowHear: '¿Cómo nos conociste?', escNeedHelp: '¿En qué necesitas ayuda?',
    escSendBtn: 'Enviar Mi Información', escBusy: 'Enviando…',
    escSentTitle: 'Gracias', escSentBody: 'Paola de nuestro equipo de servicio al cliente revisará tu información y te contactará en 1 día hábil.',
    chatPlaceholder: 'Escribe tu mensaje…', chatSend: 'Enviar', chatEndBtn: 'Terminar Chat y Obtener Seguimiento',
    chatSentTitle: '¡Listo!', chatSentBody: "He enviado un resumen de nuestra conversación. Paola hará seguimiento en 1 día hábil.",
  },
  pt: {
    step2: "Não consegui encontrar sua conta com essas informações. Vou tentar de outra forma — pode me dizer seu endereço e número da unidade?",
    step3: "Deixa eu tentar mais uma coisa. Você sabe o nome da sua associação ou condomínio?",
    step4: "Lamento, não consegui localizar sua conta. Não quero te deixar sem ajuda — tenho duas opções:",
    chatWelcome: "Estou aqui para ajudar! Me diga o que precisa e garantirei que nossa equipe entre em contato.",
    step2Addr: 'Endereço e Número da Unidade', step2Btn: 'Buscar por Endereço', step2Busy: 'Buscando…',
    step3Assoc: 'Associação / Condomínio', step3Unit: 'Número da Unidade (opcional)', step3Btn: 'Buscar por Associação', step3Busy: 'Buscando…',
    optATitle: 'Preencher um Formulário', optADesc: 'Compartilhe seus dados e nossa equipe retornará em 1 dia útil.',
    optBTitle: 'Conversar com MAIA', optBDesc: "Continue a conversa e garantirei que nossa equipe faça o acompanhamento.",
    escTitle: 'Nos Ajude a Encontrar Você', escUnit: 'Número da Unidade', escHowHear: 'Como nos conheceu?', escNeedHelp: 'Com o que você precisa de ajuda?',
    escSendBtn: 'Enviar Meus Dados', escBusy: 'Enviando…',
    escSentTitle: 'Obrigado', escSentBody: 'Paola da nossa equipe de atendimento revisará suas informações e entrará em contato em 1 dia útil.',
    chatPlaceholder: 'Digite sua mensagem…', chatSend: 'Enviar', chatEndBtn: 'Encerrar e Obter Acompanhamento',
    chatSentTitle: 'Tudo certo!', chatSentBody: "Enviei um resumo da conversa para nossa equipe. Paola entrará em contato em 1 dia útil.",
  },
  fr: {
    step2: "Je n'ai pas pu trouver votre compte. Essayons autrement — pouvez-vous me donner votre adresse et numéro d'unité ?",
    step3: "Laissez-moi essayer encore une chose. Connaissez-vous le nom de votre association ou résidence ?",
    step4: "Je suis désolée, je n'ai pas pu localiser votre compte. Je ne veux pas vous laisser sans aide — voici deux options :",
    chatWelcome: "Je suis là pour vous aider ! Dites-moi ce dont vous avez besoin et je m'assurerai que notre équipe vous contacte.",
    step2Addr: "Adresse et Numéro d'Unité", step2Btn: 'Rechercher par Adresse', step2Busy: 'Recherche…',
    step3Assoc: 'Association / Résidence', step3Unit: "Numéro d'Unité (optionnel)", step3Btn: 'Rechercher par Association', step3Busy: 'Recherche…',
    optATitle: 'Remplir un Formulaire', optADesc: 'Partagez vos coordonnées et notre équipe vous recontactera en 1 jour ouvrable.',
    optBTitle: 'Chatter avec MAIA', optBDesc: "Continuez la conversation et je m'assurerai que notre équipe vous suit.",
    escTitle: 'Aidez-nous à Vous Trouver', escUnit: "Numéro d'Unité", escHowHear: 'Comment nous avez-vous connus ?', escNeedHelp: "En quoi avez-vous besoin d'aide ?",
    escSendBtn: 'Envoyer Mes Informations', escBusy: 'Envoi…',
    escSentTitle: 'Merci', escSentBody: 'Paola de notre équipe service client examinera vos informations et vous recontactera sous 1 jour ouvrable.',
    chatPlaceholder: 'Tapez votre message…', chatSend: 'Envoyer', chatEndBtn: 'Terminer et Obtenir un Suivi',
    chatSentTitle: "C'est noté !", chatSentBody: "J'ai envoyé un résumé à notre équipe. Paola vous recontactera sous 1 jour ouvrable.",
  },
  he: {
    step2: 'לא הצלחתי למצוא את חשבונך. בוא ננסה דרך אחרת — האם תוכל לספר לי את כתובת הנכס ומספר היחידה?',
    step3: 'תן לי לנסות עוד דבר. האם אתה יודע את שם העמותה או הקהילה שלך?',
    step4: 'אני מצטערת, לא הצלחתי לאתר את חשבונך. אני לא רוצה להשאיר אותך ללא עזרה — יש לי שתי אפשרויות:',
    chatWelcome: 'אני כאן לעזור! ספר לי מה אתה צריך ואוודא שהצוות שלנו יצור קשר איתך.',
    step2Addr: 'כתובת ומספר יחידה', step2Btn: 'חפש לפי כתובת', step2Busy: 'מחפש…',
    step3Assoc: 'שם עמותה / קהילה', step3Unit: 'מספר יחידה (אופציונלי)', step3Btn: 'חפש לפי עמותה', step3Busy: 'מחפש…',
    optATitle: 'מלא טופס קצר', optADesc: 'שתף את הפרטים שלך והצוות שלנו יחזור אליך תוך יום עסקים.',
    optBTitle: 'שוחח עם MAIA', optBDesc: 'המשך את השיחה ואוודא שהצוות שלנו יצור קשר.',
    escTitle: 'עזור לנו למצוא אותך', escUnit: 'מספר יחידה', escHowHear: 'כיצד שמעת עלינו?', escNeedHelp: 'במה אתה צריך עזרה?',
    escSendBtn: 'שלח את הפרטים שלי', escBusy: 'שולח…',
    escSentTitle: 'תודה', escSentBody: 'פאולה מצוות שירות הלקוחות תסקור את המידע שלך ותחזור אליך תוך יום עסקים.',
    chatPlaceholder: 'הקלד את הודעתך…', chatSend: 'שלח', chatEndBtn: "סיים צ'אט וקבל מעקב",
    chatSentTitle: 'הכל מסודר!', chatSentBody: 'שלחתי סיכום השיחה שלנו לצוות. פאולה תעשה מעקב תוך יום עסקים.',
  },
  ru: {
    step2: 'Мне не удалось найти аккаунт по этим данным. Давайте попробуем иначе — можете сообщить адрес объекта и номер квартиры?',
    step3: 'Позвольте попробовать ещё кое-что. Вы знаете название своего ТСЖ или жилого комплекса?',
    step4: 'Сожалею, аккаунт найти не удалось. Я не хочу оставлять вас без помощи — у меня есть два варианта:',
    chatWelcome: 'Я здесь, чтобы помочь! Расскажите, что нужно, и я прослежу, чтобы наша команда с вами связалась.',
    step2Addr: 'Адрес и Номер Квартиры', step2Btn: 'Поиск по Адресу', step2Busy: 'Поиск…',
    step3Assoc: 'ТСЖ / Жилой Комплекс', step3Unit: 'Номер Квартиры (необязательно)', step3Btn: 'Поиск по ТСЖ', step3Busy: 'Поиск…',
    optATitle: 'Заполнить Форму', optADesc: 'Поделитесь данными, и наша команда свяжется в течение 1 рабочего дня.',
    optBTitle: 'Чат с MAIA', optBDesc: 'Продолжите разговор, и я прослежу, чтобы команда с вами связалась.',
    escTitle: 'Помогите Нам Вас Найти', escUnit: 'Номер Квартиры', escHowHear: 'Откуда вы о нас узнали?', escNeedHelp: 'Чем мы можем помочь?',
    escSendBtn: 'Отправить Данные', escBusy: 'Отправка…',
    escSentTitle: 'Спасибо', escSentBody: 'Паола из нашей команды рассмотрит информацию и свяжется в течение 1 рабочего дня.',
    chatPlaceholder: 'Введите сообщение…', chatSend: 'Отправить', chatEndBtn: 'Завершить Чат и Получить Ответ',
    chatSentTitle: 'Готово!', chatSentBody: 'Я отправила сводку нашего разговора команде. Паола свяжется в течение 1 рабочего дня.',
  },
}

// ── Shared input/label styles ─────────────────────────────────────────────────

const inputCls = 'w-full px-3 py-2.5 border border-[#333] rounded-[2px] text-sm focus:outline-none focus:border-[#f26a1b] focus:shadow-[0_0_0_3px_rgba(242,106,27,.18)] bg-[#1a1a1a] text-white placeholder:text-[#555] transition-shadow'
const labelCls = 'block mb-1 text-[0.62rem] font-medium uppercase tracking-[0.1em] text-[#9ca3af] [font-family:var(--font-mono)]'

// ── VendorCoiCard ─────────────────────────────────────────────────────────────

function VendorCoiCard({ result }: { result: AddressResult | null }) {
  if (!result?.principal_address) {
    return (
      <div className="bg-[#1a1a1a] border border-[#333] rounded-[3px] p-3 text-[0.72rem] text-[#9ca3af] leading-relaxed">
        <span className="font-medium text-white">📋 COI Additional Insured</span><br />
        Contact <a href="mailto:billing@topfloridaproperties.com" className="text-[#f26a1b]">billing@topfloridaproperties.com</a> or call <a href="tel:+13059005077" className="text-[#f26a1b]">305.900.5077</a> for COI requirements for this association.
      </div>
    )
  }
  const addr = [result.principal_address, result.city, result.state ?? 'FL', result.zip].filter(Boolean).join(', ')
  return (
    <div className="bg-[#0d1a10] border border-[#1e4d2b] rounded-[3px] p-3 space-y-1.5">
      <div className="text-[0.6rem] font-medium uppercase tracking-[0.1em] text-[#4ade80] [font-family:var(--font-mono)]">📋 COI Additional Insured Requirements</div>
      <ol className="text-[0.72rem] text-white leading-relaxed space-y-1 list-decimal list-inside">
        <li><span className="font-medium">{result.association_name}</span><br /><span className="text-[#9ca3af] pl-4">{addr}</span></li>
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
  const [hwFirst,   setHwFirst]   = useState('')
  const [hwLast,    setHwLast]    = useState('')
  const [hwEmail,   setHwEmail]   = useState('')
  const [hwPhone,   setHwPhone]   = useState('')
  const [hwAddress, setHwAddress] = useState('')
  const [hwNudge,   setHwNudge]   = useState(false)

  // Multi-step identification
  const [hwStep2Addr,   setHwStep2Addr]   = useState('')
  const [hwStep3Assoc,  setHwStep3Assoc]  = useState('')
  const [hwStep3Unit,   setHwStep3Unit]   = useState('')
  const [escalFirst,    setEscalFirst]    = useState('')
  const [escalLast,     setEscalLast]     = useState('')
  const [escalEmail,    setEscalEmail]    = useState('')
  const [escalPhone,    setEscalPhone]    = useState('')
  const [escalAddr,     setEscalAddr]     = useState('')
  const [escalUnit,     setEscalUnit]     = useState('')
  const [escalAssoc,    setEscalAssoc]    = useState('')
  const [escalHowHear,  setEscalHowHear]  = useState('')
  const [escalNeedHelp, setEscalNeedHelp] = useState('')
  const [escalRef,      setEscalRef]      = useState('')
  const [chatMessages,  setChatMessages]  = useState<Array<{role:'user'|'assistant';content:string}>>([])
  const [chatInput,     setChatInput]     = useState('')
  const [chatBusy,      setChatBusy]      = useState(false)
  const [pending2FA,    setPending2FA]    = useState<MatchedRole | null>(null)

  // Agent form
  const [agName,    setAgName]    = useState('')
  const [agEmail,   setAgEmail]   = useState('')
  const [agPhone,   setAgPhone]   = useState('')
  const [agLicense, setAgLicense] = useState('')
  const [agAssoc,   setAgAssoc]   = useState<AddressResult | null>(null)

  // Vendor form
  const [vdCompany, setVdCompany] = useState('')
  const [vdContact, setVdContact] = useState('')
  const [vdEmail,   setVdEmail]   = useState('')
  const [vdPhone,   setVdPhone]   = useState('')
  const [vdAssoc,   setVdAssoc]   = useState<AddressResult | null>(null)

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

  function navigateToPortal(role: MatchedRole) {
    try { sessionStorage.setItem('maia_persona', JSON.stringify(role)) } catch { /* ignore */ }
    // Use window.location.href (hard navigation) so the browser makes a fresh
    // HTTP request that includes the maia_session cookie set by verify-otp.
    // router.push (soft navigation) can serve a cached RSC payload predating
    // authentication, causing middleware to see no session and redirect back.
    if (role.type === 'staff')  { window.location.href = '/admin'; return }
    if (role.type === 'owner')  { window.location.href = `/my-account?id=${role.owner_id}&assoc=${role.association_code}`; return }
    if (role.type === 'board')  { window.location.href = `/board?id=${role.board_member_id}&assoc=${role.association_code}`; return }
    if (role.type === 'tenant') { window.location.href = `/my-account?assoc=${role.association_code}`; return }
  }

  function routeToRole(role: MatchedRole) {
    setPending2FA(role)
    setView('hw-2fa')
  }

  async function handleHomeownerLookup(e: React.FormEvent) {
    e.preventDefault()
    if (!hwEmail.trim() && !hwPhone.trim() && !hwAddress.trim()) {
      setHwNudge(true)
      return
    }
    setBusy(true)
    try {
      const res  = await fetch('/api/homeowner-lookup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName: hwFirst, lastName: hwLast, email: hwEmail, phone: hwPhone }),
      })
      const data = await res.json()
      if (!data.found || !data.roles?.length) { setHwStep2Addr(hwAddress); setView('hw-step2'); return }
      if (data.roles.length === 1) {
        routeToRole(data.roles[0] as MatchedRole)
      } else {
        setMatchedRoles(data.roles as MatchedRole[])
        try { sessionStorage.setItem('maia_roles', JSON.stringify(data.roles)) } catch { /* ignore */ }
        setView('role-selector')
      }
    } catch { setHwStep2Addr(hwAddress); setView('hw-step2') } finally { setBusy(false) }
  }

  async function handleAgentSubmit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true)
    try {
      await fetch('/api/agent-inquiry', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: agName, email: agEmail, phone: agPhone, licenseNumber: agLicense, association: agAssoc?.association_name ?? '' }),
      })
      setView('agent-sent')
    } finally { setBusy(false) }
  }

  async function handleVendorSubmit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true)
    try {
      await fetch('/api/vendor-inquiry', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName: vdCompany, contactName: vdContact, email: vdEmail, phone: vdPhone, association: vdAssoc?.association_name ?? '' }),
      })
      setView('vendor-sent')
    } finally { setBusy(false) }
  }

  async function handleStep2(e: React.FormEvent) {
    e.preventDefault(); setBusy(true)
    try {
      const res  = await fetch('/api/homeowner-lookup-step2', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: hwStep2Addr }),
      })
      const data = await res.json()
      if (!data.found || !data.roles?.length) { setView('hw-step3'); return }
      if (data.roles.length === 1) {
        routeToRole(data.roles[0] as MatchedRole)
      } else {
        setMatchedRoles(data.roles as MatchedRole[])
        try { sessionStorage.setItem('maia_roles', JSON.stringify(data.roles)) } catch { /* ignore */ }
        setView('role-selector')
      }
    } catch { setView('hw-step3') } finally { setBusy(false) }
  }

  async function handleStep3(e: React.FormEvent) {
    e.preventDefault(); setBusy(true)
    try {
      const res  = await fetch('/api/homeowner-lookup-step3', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ association: hwStep3Assoc, unit: hwStep3Unit }),
      })
      const data = await res.json()
      if (!data.found || !data.roles?.length) { setView('hw-escalate'); return }
      if (data.roles.length === 1) {
        routeToRole(data.roles[0] as MatchedRole)
      } else {
        setMatchedRoles(data.roles as MatchedRole[])
        try { sessionStorage.setItem('maia_roles', JSON.stringify(data.roles)) } catch { /* ignore */ }
        setView('role-selector')
      }
    } catch { setView('hw-escalate') } finally { setBusy(false) }
  }

  async function handleEscalateForm(e: React.FormEvent) {
    e.preventDefault(); setBusy(true)
    try {
      const res = await fetch('/api/escalate-unidentified', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: escalFirst, lastName: escalLast,
          email: escalEmail, phone: escalPhone,
          address: escalAddr, unit: escalUnit,
          association: escalAssoc, howHear: escalHowHear,
          needHelp: escalNeedHelp, lang,
        }),
      })
      const data = await res.json()
      setEscalRef(data.refNumber ?? '')
      setView('hw-escalate-sent')
    } catch { setView('hw-escalate-sent') } finally { setBusy(false) }
  }

  async function handleChatSend(e?: React.FormEvent) {
    if (e) e.preventDefault()
    if (!chatInput.trim() || chatBusy) return
    const userMsg = chatInput.trim()
    setChatInput('')
    setChatMessages(prev => [...prev, { role: 'user' as const, content: userMsg }])
    setChatBusy(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg, history: chatMessages, lang, context: 'unidentified' }),
      })
      const data = await res.json()
      setChatMessages(prev => [...prev, { role: 'assistant' as const, content: data.reply ?? "I'm sorry, I couldn't process that. Our team will follow up with you." }])
    } catch {
      setChatMessages(prev => [...prev, { role: 'assistant' as const, content: "I'm having trouble right now. Please try again or use the form option." }])
    } finally { setChatBusy(false) }
  }

  async function handleChatEscalate() {
    setBusy(true)
    try {
      const transcript = chatMessages.map(m => `${m.role === 'user' ? 'Visitor' : 'MAIA'}: ${m.content}`).join('\n')
      const res = await fetch('/api/escalate-unidentified', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: hwFirst, lastName: hwLast,
          email: hwEmail, phone: hwPhone,
          needHelp: transcript, lang, howHear: 'MAIA Chat',
        }),
      })
      const data = await res.json()
      setEscalRef(data.refNumber ?? '')
      setView('hw-chat-sent')
    } catch { setView('hw-chat-sent') } finally { setBusy(false) }
  }

  // ── Shared sub-components ─────────────────────────────────────────────────────

  const BackBtn = ({ onClick }: { onClick?: () => void } = {}) => (
    <button
      onClick={onClick ?? (() => { setMatchedRoles([]); setView('home') })}
      className="inline-flex items-center gap-1 text-[0.72rem] text-[#9ca3af] hover:text-[#f26a1b] [font-family:var(--font-mono)] uppercase tracking-[0.08em] mb-4 transition-colors"
    >
      {t.back}
    </button>
  )

  function MaiaBubble({ text }: { text: string }) {
    return (
      <div className={`flex gap-2.5 mb-4 ${isRtl ? 'flex-row-reverse' : ''}`}>
        <div className="flex-shrink-0 w-7 h-7 rounded-full overflow-hidden mt-0.5">
          <Image src="/pmi-icon.jpg" alt="MAIA" width={28} height={28} className="object-cover" />
        </div>
        <div
          className="flex-1 rounded-2xl px-4 py-3 text-[0.82rem] text-white leading-relaxed"
          style={{
            borderTopLeftRadius: isRtl ? undefined : '4px',
            borderTopRightRadius: isRtl ? '4px' : undefined,
            background: 'rgba(242,106,27,0.10)',
            border: '1px solid rgba(242,106,27,0.22)',
          }}
        >
          {text}
        </div>
      </div>
    )
  }

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
                <Image src="/pmi-logo-white.png" alt="PMI Top Florida" width={180} height={90} className="relative z-10 object-contain" />
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
          {/* Desktop layout: left bubbles · widget · right bubbles */}
          <div className="flex items-center justify-center w-full gap-0">

            {/* Left bubble column */}
            <div className="hidden xl:flex flex-col gap-5 mr-5 flex-shrink-0">
              {BUBBLES.filter(b => b.side === 'left').map((b, i) => (
                <div
                  key={b.label}
                  className="group relative flex-shrink-0 cursor-default select-none"
                  style={{
                    width: '120px', height: '120px',
                    animation: `${b.anim} ${5.5 + i * 0.55}s ease-in-out infinite`,
                    animationDelay: `${i * 0.38}s`,
                  }}
                >
                  <div
                    className="bubble-circle w-[120px] h-[120px] rounded-full flex flex-col items-center justify-center gap-1.5"
                    style={{
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.09)',
                      backdropFilter: 'blur(14px)',
                    }}
                  >
                    <span style={{ fontSize: '32px', lineHeight: 1 }}>{b.icon}</span>
                    <span style={{ fontSize: '13px', fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.65)', textAlign: 'center', lineHeight: 1.2, padding: '0 10px' }}>{b.label}</span>
                  </div>
                  {/* Expanded hover card — grows left (away from widget) */}
                  <div
                    className="bubble-hover-card absolute top-0 z-20 rounded-2xl flex items-center gap-3 px-4"
                    style={{
                      right: 0, width: '240px', height: '120px',
                      background: 'rgba(14,14,14,0.97)',
                      border: '1px solid rgba(242,106,27,0.5)',
                      boxShadow: '0 0 24px rgba(242,106,27,0.22)',
                    }}
                  >
                    <span style={{ fontSize: '32px', lineHeight: 1, flexShrink: 0 }}>{b.icon}</span>
                    <div>
                      <p style={{ fontSize: '13px', fontFamily: 'var(--font-mono)', color: '#fff', fontWeight: 600, marginBottom: '3px' }}>{b.label}</p>
                      <p style={{ fontSize: '11px', color: '#9ca3af', lineHeight: 1.4 }}>{b.desc}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

          {/* MAIA widget */}
          <div
            className="relative z-10 w-full xl:w-[50vw] xl:min-w-[700px] xl:max-w-[900px]"
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
                minHeight: '600px',
                display: 'flex',
                flexDirection: 'column',
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
              <div className="px-5 py-4 overflow-y-auto flex-1" style={{ maxHeight: '560px' }}>

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
                            {savedPersona.type === 'tenant' && `Tenant — ${savedPersona.association_name}`}
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

                    {/* MAIA nudge bubble */}
                    {hwNudge && (
                      <div className={`flex gap-2.5 mb-4 ${isRtl ? 'flex-row-reverse' : ''}`}>
                        <div className="flex-shrink-0 w-7 h-7 rounded-full overflow-hidden mt-0.5">
                          <Image src="/pmi-icon.jpg" alt="MAIA" width={28} height={28} className="object-cover" />
                        </div>
                        <div
                          className="flex-1 rounded-2xl px-4 py-3 text-[0.82rem] text-white leading-relaxed"
                          style={{
                            borderTopLeftRadius: isRtl ? undefined : '4px',
                            borderTopRightRadius: isRtl ? '4px' : undefined,
                            background: 'rgba(242,106,27,0.10)',
                            border: '1px solid rgba(242,106,27,0.22)',
                          }}
                        >
                          I&apos;d love to help you! To find your account I&apos;ll need a bit more information. Could you also provide your email address, phone number, or property address? The more you share, the faster I can find you.
                        </div>
                      </div>
                    )}

                    <form onSubmit={handleHomeownerLookup} className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div><label className={labelCls}>{t.firstName}</label><input className={inputCls} value={hwFirst} onChange={e => setHwFirst(e.target.value)} dir="ltr" /></div>
                        <div><label className={labelCls}>{t.lastName}</label><input className={inputCls} value={hwLast} onChange={e => setHwLast(e.target.value)} dir="ltr" /></div>
                      </div>
                      <div>
                        <label className={labelCls}>{t.email}</label>
                        <input type="email" className={inputCls} value={hwEmail} onChange={e => { setHwEmail(e.target.value); if (e.target.value) setHwNudge(false) }} dir="ltr" />
                        <p className="mt-1 text-[0.62rem] text-[#555] leading-snug">The email you used when signing your lease or HOA documents</p>
                      </div>
                      <div>
                        <label className={labelCls}>{t.phone}</label>
                        <input type="tel" className={inputCls} value={hwPhone} onChange={e => { setHwPhone(e.target.value); if (e.target.value) setHwNudge(false) }} dir="ltr" />
                        <p className="mt-1 text-[0.62rem] text-[#555] leading-snug">The phone number on file with your association</p>
                      </div>
                      <div>
                        <label className={labelCls}>Property Address</label>
                        <input className={inputCls} value={hwAddress} onChange={e => { setHwAddress(e.target.value); if (e.target.value) setHwNudge(false) }} placeholder="e.g. 203 · 1234 Sunset Blvd" dir="ltr" />
                        <p className="mt-1 text-[0.62rem] text-[#555] leading-snug">Your unit address including unit number</p>
                      </div>
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
                        const icon  = role.type === 'staff' ? '🔒' : role.type === 'owner' ? '🏠' : role.type === 'tenant' ? '🏘' : '👥'
                        const title = role.type === 'staff' ? 'PMI Staff' : role.type === 'owner' ? 'Unit Owner' : role.type === 'tenant' ? 'Tenant' : role.type === 'board' ? `Board Member${role.position ? ` — ${role.position}` : ''}` : 'Unknown'
                        const sub   = role.type === 'staff' ? 'Access staff dashboard' : role.type === 'owner' ? `View my account — ${role.association_name}` : role.type === 'tenant' ? `Resident portal — ${role.association_name}` : role.type === 'board' ? `Access board portal — ${role.association_name}` : ''
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
                      <AddressSearch label={t.agentAssoc} selected={agAssoc} onSelect={setAgAssoc} dark />
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
                      <AddressSearch label={t.vendorAssoc} selected={vdAssoc} onSelect={setVdAssoc} dark />
                      {vdAssoc && <VendorCoiCard result={vdAssoc} />}
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

                {/* ── HW STEP 2 (address search) ───────────────────────── */}
                {view === 'hw-step2' && (
                  <div className="maia-fade">
                    <BackBtn onClick={() => setView('homeowner-form')} />
                    <MaiaBubble text={ID_MSGS[lang].step2} />
                    <form onSubmit={handleStep2} className="space-y-3">
                      <div>
                        <label className={labelCls}>{ID_MSGS[lang].step2Addr}</label>
                        <input
                          className={inputCls}
                          value={hwStep2Addr}
                          onChange={e => setHwStep2Addr(e.target.value)}
                          placeholder="e.g. 203 · 1234 Sunset Blvd"
                          dir="ltr"
                        />
                      </div>
                      <OrangeBtn label={busy ? ID_MSGS[lang].step2Busy : ID_MSGS[lang].step2Btn} disabled={busy || !hwStep2Addr.trim()} />
                    </form>
                  </div>
                )}

                {/* ── HW STEP 3 (association + unit) ───────────────────── */}
                {view === 'hw-step3' && (
                  <div className="maia-fade">
                    <BackBtn onClick={() => setView('hw-step2')} />
                    <MaiaBubble text={ID_MSGS[lang].step3} />
                    <form onSubmit={handleStep3} className="space-y-3">
                      <div>
                        <label className={labelCls}>{ID_MSGS[lang].step3Assoc}</label>
                        <input
                          className={inputCls}
                          value={hwStep3Assoc}
                          onChange={e => setHwStep3Assoc(e.target.value)}
                          placeholder="e.g. Sunset Gardens"
                          dir="ltr"
                        />
                      </div>
                      <div>
                        <label className={labelCls}>{ID_MSGS[lang].step3Unit}</label>
                        <input
                          className={inputCls}
                          value={hwStep3Unit}
                          onChange={e => setHwStep3Unit(e.target.value)}
                          placeholder="e.g. 203"
                          dir="ltr"
                        />
                      </div>
                      <OrangeBtn label={busy ? ID_MSGS[lang].step3Busy : ID_MSGS[lang].step3Btn} disabled={busy || !hwStep3Assoc.trim()} />
                    </form>
                  </div>
                )}

                {/* ── HW ESCALATE (choose option) ──────────────────────── */}
                {view === 'hw-escalate' && (
                  <div className="maia-fade">
                    <BackBtn onClick={() => setView('hw-step3')} />
                    <MaiaBubble text={ID_MSGS[lang].step4} />
                    <div className="flex flex-col gap-3">
                      <button
                        onClick={() => {
                          setEscalFirst(hwFirst); setEscalLast(hwLast)
                          setEscalEmail(hwEmail); setEscalPhone(hwPhone)
                          setEscalAddr(hwStep2Addr); setEscalAssoc(hwStep3Assoc)
                          setEscalUnit(hwStep3Unit)
                          setView('hw-escalate-form')
                        }}
                        className="flex items-start gap-3 p-4 rounded-[4px] text-left transition-all"
                        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(242,106,27,0.45)'; e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
                      >
                        <span className="text-2xl flex-shrink-0">📋</span>
                        <div>
                          <div className="text-sm font-semibold text-white mb-1">{ID_MSGS[lang].optATitle}</div>
                          <div className="text-[0.72rem] text-[#9ca3af] leading-snug">{ID_MSGS[lang].optADesc}</div>
                        </div>
                      </button>
                      <button
                        onClick={() => {
                          setChatMessages([{ role: 'assistant', content: ID_MSGS[lang].chatWelcome }])
                          setView('hw-chat')
                        }}
                        className="flex items-start gap-3 p-4 rounded-[4px] text-left transition-all"
                        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(242,106,27,0.45)'; e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
                      >
                        <span className="text-2xl flex-shrink-0">💬</span>
                        <div>
                          <div className="text-sm font-semibold text-white mb-1">{ID_MSGS[lang].optBTitle}</div>
                          <div className="text-[0.72rem] text-[#9ca3af] leading-snug">{ID_MSGS[lang].optBDesc}</div>
                        </div>
                      </button>
                    </div>
                  </div>
                )}

                {/* ── HW ESCALATE FORM ─────────────────────────────────── */}
                {view === 'hw-escalate-form' && (
                  <div className="maia-fade">
                    <BackBtn onClick={() => setView('hw-escalate')} />
                    <h2 className={`text-base font-light text-white mb-4 [font-family:var(--font-display)] ${isRtl ? 'text-right' : ''}`}>{ID_MSGS[lang].escTitle}</h2>
                    <form onSubmit={handleEscalateForm} className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div><label className={labelCls}>{t.firstName}</label><input className={inputCls} value={escalFirst} onChange={e => setEscalFirst(e.target.value)} dir="ltr" /></div>
                        <div><label className={labelCls}>{t.lastName}</label><input className={inputCls} value={escalLast} onChange={e => setEscalLast(e.target.value)} dir="ltr" /></div>
                      </div>
                      <div><label className={labelCls}>{t.email}</label><input type="email" className={inputCls} value={escalEmail} onChange={e => setEscalEmail(e.target.value)} dir="ltr" /></div>
                      <div><label className={labelCls}>{t.phone}</label><input type="tel" className={inputCls} value={escalPhone} onChange={e => setEscalPhone(e.target.value)} dir="ltr" /></div>
                      <div><label className={labelCls}>Property Address</label><input className={inputCls} value={escalAddr} onChange={e => setEscalAddr(e.target.value)} dir="ltr" /></div>
                      <div className="grid grid-cols-2 gap-3">
                        <div><label className={labelCls}>{ID_MSGS[lang].escUnit}</label><input className={inputCls} value={escalUnit} onChange={e => setEscalUnit(e.target.value)} dir="ltr" /></div>
                        <div><label className={labelCls}>Association</label><input className={inputCls} value={escalAssoc} onChange={e => setEscalAssoc(e.target.value)} dir="ltr" /></div>
                      </div>
                      <div>
                        <label className={labelCls}>{ID_MSGS[lang].escHowHear}</label>
                        <input className={inputCls} value={escalHowHear} onChange={e => setEscalHowHear(e.target.value)} dir="ltr" />
                      </div>
                      <div>
                        <label className={labelCls}>{ID_MSGS[lang].escNeedHelp}</label>
                        <textarea
                          className={`${inputCls} resize-none`}
                          rows={3}
                          value={escalNeedHelp}
                          onChange={e => setEscalNeedHelp(e.target.value)}
                          dir={isRtl ? 'rtl' : 'ltr'}
                        />
                      </div>
                      <OrangeBtn label={busy ? ID_MSGS[lang].escBusy : ID_MSGS[lang].escSendBtn} disabled={busy} />
                    </form>
                  </div>
                )}

                {/* ── HW ESCALATE SENT ─────────────────────────────────── */}
                {view === 'hw-escalate-sent' && (
                  <div className="maia-fade text-center py-4">
                    <div className="text-4xl mb-3">✅</div>
                    <h2 className="text-base font-light text-white mb-2 [font-family:var(--font-display)]">{ID_MSGS[lang].escSentTitle}</h2>
                    <p className="text-sm text-[#9ca3af] mb-4">{ID_MSGS[lang].escSentBody}</p>
                    {escalRef && (
                      <div className="inline-block px-4 py-3 rounded-[4px] mb-4" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                        <div className="text-[0.6rem] [font-family:var(--font-mono)] uppercase tracking-[0.1em] text-[#9ca3af] mb-1">Reference Number</div>
                        <div className="text-lg font-bold [font-family:var(--font-mono)] text-[#f26a1b]">{escalRef}</div>
                      </div>
                    )}
                    <button onClick={() => setView('home')} className="block mx-auto text-[0.72rem] text-[#9ca3af] hover:text-[#f26a1b] [font-family:var(--font-mono)] uppercase tracking-[0.08em] transition-colors">
                      {t.back}
                    </button>
                  </div>
                )}

                {/* ── HW CHAT ──────────────────────────────────────────── */}
                {view === 'hw-chat' && (
                  <div className="maia-fade flex flex-col h-full">
                    <BackBtn onClick={() => setView('hw-escalate')} />
                    <div className="flex flex-col gap-3 mb-4 flex-1 overflow-y-auto" style={{ maxHeight: '320px' }}>
                      {chatMessages.map((msg, i) => (
                        <div key={i} className={`flex gap-2.5 ${msg.role === 'user' ? (isRtl ? '' : 'flex-row-reverse') : (isRtl ? 'flex-row-reverse' : '')}`}>
                          {msg.role === 'assistant' && (
                            <div className="flex-shrink-0 w-7 h-7 rounded-full overflow-hidden mt-0.5">
                              <Image src="/pmi-icon.jpg" alt="MAIA" width={28} height={28} className="object-cover" />
                            </div>
                          )}
                          <div
                            className="max-w-[80%] rounded-2xl px-4 py-3 text-[0.82rem] leading-relaxed"
                            style={msg.role === 'assistant' ? {
                              borderTopLeftRadius: isRtl ? undefined : '4px',
                              borderTopRightRadius: isRtl ? '4px' : undefined,
                              background: 'rgba(242,106,27,0.10)',
                              border: '1px solid rgba(242,106,27,0.22)',
                              color: '#fff',
                            } : {
                              background: 'rgba(255,255,255,0.06)',
                              border: '1px solid rgba(255,255,255,0.10)',
                              color: '#e5e7eb',
                            }}
                          >
                            {msg.content}
                          </div>
                        </div>
                      ))}
                      {chatBusy && (
                        <div className={`flex gap-2.5 ${isRtl ? 'flex-row-reverse' : ''}`}>
                          <div className="flex-shrink-0 w-7 h-7 rounded-full overflow-hidden mt-0.5">
                            <Image src="/pmi-icon.jpg" alt="MAIA" width={28} height={28} className="object-cover" />
                          </div>
                          <div className="px-4 py-3 rounded-2xl text-[0.82rem] text-[#9ca3af]" style={{ background: 'rgba(242,106,27,0.06)', border: '1px solid rgba(242,106,27,0.15)' }}>
                            <span style={{ animation: 'dot-pulse 1.2s ease-in-out infinite' }}>●</span>
                          </div>
                        </div>
                      )}
                    </div>
                    <form onSubmit={handleChatSend} className="flex gap-2">
                      <input
                        className={`${inputCls} flex-1`}
                        value={chatInput}
                        onChange={e => setChatInput(e.target.value)}
                        placeholder={ID_MSGS[lang].chatPlaceholder}
                        disabled={chatBusy}
                        dir={isRtl ? 'rtl' : 'ltr'}
                      />
                      <button
                        type="submit"
                        disabled={chatBusy || !chatInput.trim()}
                        className="bg-[#f26a1b] hover:bg-[#f58140] disabled:opacity-50 text-white [font-family:var(--font-mono)] text-[0.62rem] uppercase tracking-[0.08em] px-4 py-2 rounded-[2px] transition-colors flex-shrink-0"
                      >
                        {ID_MSGS[lang].chatSend}
                      </button>
                    </form>
                    <button
                      onClick={handleChatEscalate}
                      disabled={busy || chatMessages.length < 2}
                      className="mt-3 w-full text-[0.62rem] [font-family:var(--font-mono)] uppercase tracking-[0.08em] py-2 rounded-[2px] transition-colors disabled:opacity-50"
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#9ca3af' }}
                    >
                      {ID_MSGS[lang].chatEndBtn}
                    </button>
                  </div>
                )}

                {/* ── HW CHAT SENT ─────────────────────────────────────── */}
                {view === 'hw-chat-sent' && (
                  <div className="maia-fade text-center py-4">
                    <div className="text-4xl mb-3">💬</div>
                    <h2 className="text-base font-light text-white mb-2 [font-family:var(--font-display)]">{ID_MSGS[lang].chatSentTitle}</h2>
                    <p className="text-sm text-[#9ca3af] mb-4">{ID_MSGS[lang].chatSentBody}</p>
                    {escalRef && (
                      <div className="inline-block px-4 py-3 rounded-[4px] mb-4" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                        <div className="text-[0.6rem] [font-family:var(--font-mono)] uppercase tracking-[0.1em] text-[#9ca3af] mb-1">Reference Number</div>
                        <div className="text-lg font-bold [font-family:var(--font-mono)] text-[#f26a1b]">{escalRef}</div>
                      </div>
                    )}
                    <button onClick={() => setView('home')} className="block mx-auto text-[0.72rem] text-[#9ca3af] hover:text-[#f26a1b] [font-family:var(--font-mono)] uppercase tracking-[0.08em] transition-colors">
                      {t.back}
                    </button>
                  </div>
                )}

                {/* ── HW 2FA ───────────────────────────────────────────── */}
                {view === 'hw-2fa' && pending2FA && (() => {
                  const role2fa = pending2FA  // capture non-null value for callbacks
                  return (
                    <div className="maia-fade">
                      <BackBtn onClick={() => { setPending2FA(null); setView('homeowner-form') }} />
                      <TwoFactorAuth
                        role={role2fa}
                        email={hwEmail}
                        phone={hwPhone}
                        lang={lang}
                        onVerified={() => navigateToPortal(role2fa)}
                        onBack={() => { setPending2FA(null); setView('homeowner-form') }}
                      />
                    </div>
                  )
                })()}

              </div>
            </div>
          </div>{/* end widget wrapper */}

            {/* Right bubble column */}
            <div className="hidden xl:flex flex-col gap-5 ml-5 flex-shrink-0">
              {BUBBLES.filter(b => b.side === 'right').map((b, i) => (
                <div
                  key={b.label}
                  className="group relative flex-shrink-0 cursor-default select-none"
                  style={{
                    width: '120px', height: '120px',
                    animation: `${b.anim} ${5.5 + (i + 4) * 0.55}s ease-in-out infinite`,
                    animationDelay: `${(i + 4) * 0.38}s`,
                  }}
                >
                  <div
                    className="bubble-circle w-[120px] h-[120px] rounded-full flex flex-col items-center justify-center gap-1.5"
                    style={{
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.09)',
                      backdropFilter: 'blur(14px)',
                    }}
                  >
                    <span style={{ fontSize: '32px', lineHeight: 1 }}>{b.icon}</span>
                    <span style={{ fontSize: '13px', fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.65)', textAlign: 'center', lineHeight: 1.2, padding: '0 10px' }}>{b.label}</span>
                  </div>
                  {/* Expanded hover card — grows right (away from widget) */}
                  <div
                    className="bubble-hover-card absolute top-0 z-20 rounded-2xl flex items-center gap-3 px-4"
                    style={{
                      left: 0, width: '240px', height: '120px',
                      background: 'rgba(14,14,14,0.97)',
                      border: '1px solid rgba(242,106,27,0.5)',
                      boxShadow: '0 0 24px rgba(242,106,27,0.22)',
                    }}
                  >
                    <span style={{ fontSize: '32px', lineHeight: 1, flexShrink: 0 }}>{b.icon}</span>
                    <div>
                      <p style={{ fontSize: '13px', fontFamily: 'var(--font-mono)', color: '#fff', fontWeight: 600, marginBottom: '3px' }}>{b.label}</p>
                      <p style={{ fontSize: '11px', color: '#9ca3af', lineHeight: 1.4 }}>{b.desc}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

          </div>{/* end desktop flex layout */}

          {/* Mobile bubble strip (hidden on xl+) */}
          <div className="xl:hidden flex gap-2.5 overflow-x-auto mt-5 pb-1 w-full" style={{ scrollbarWidth: 'none' }}>
            {BUBBLES.map(b => (
              <div
                key={b.label}
                className="flex-shrink-0 flex flex-col items-center gap-1.5 px-3 py-2.5 rounded-lg cursor-default"
                style={{
                  background: 'rgba(255,255,255,0.035)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  minWidth: '72px',
                }}
              >
                <span style={{ fontSize: '24px', lineHeight: 1 }}>{b.icon}</span>
                <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: '#6b7280', textAlign: 'center', lineHeight: 1.2 }}>{b.label}</span>
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
