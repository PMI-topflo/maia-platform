// =====================================================================
// lib/preapply-welcome-i18n.ts
//
// Copy for the public Pre-Application welcome landing + contact step, in all 7
// portal languages (Hebrew is RTL). The landing shows the MAIA/PMI intro, the
// 7-language advantage, the 2FA security explainer, and the application-type
// options; the applicant picks their language here and it carries forward.
// =====================================================================

import type { PortalLang } from '@/lib/portal-i18n'

export interface PreApplyStrings {
  title: string; lede: string; pill: string
  langEye: string; langH2: string; langP: string
  secEye: string; secH2: string; secP: string; chEmail: string; chText: string; first: string
  getEye: string; getH2: string; getP: string
  t1t: string; t1d: string; t2t: string; t2d: string; t3t: string; t3d: string; t4t: string; t4d: string
  cta: string; foot: string
  contactTitle: string; contactSub: string; nameL: string; emailL: string; phoneL: string; unitL: string
  chooseLang: string; continue2: string; back: string; loading: string
}

const en: PreApplyStrings = {
  title: 'Application & Compliance Portal',
  lede: 'Welcome. You’ve been invited to complete your application online — no paperwork to mail, no forms to print. This portal is powered by MAIA, the intelligent compliance assistant built exclusively by PMI Top Florida Properties to make your application simple, fast, and secure.',
  pill: '✦ MAIA guides you every step — so your application is complete, accurate, and ready for the Board’s review',
  langEye: 'In your language', langH2: 'Available in 7 languages',
  langP: 'This portal was thoughtfully developed in 7 languages so every resident can apply comfortably and understand every requirement. You’ll choose your language when you verify your identity to begin.',
  secEye: 'Bank-level security', secH2: 'Your identity & documents, protected',
  secP: 'Before you upload anything, MAIA confirms it’s really you with a one-time verification code (2-factor authentication) — so your personal documents stay private and secure.',
  chEmail: 'Email', chText: 'Text / SMS',
  first: '★ The Manors of Inverrary XI may be among the first communities in Florida to offer this level of verified, multi-channel protection.',
  getEye: 'Get started', getH2: 'What are you applying for?',
  getP: 'Tell us who you are and MAIA will show you exactly which documents your unit needs — nothing more, nothing less.',
  t1t: 'Rent — new lease', t1d: 'I’m applying to rent a unit', t2t: 'Purchase', t2d: 'I’m buying a unit',
  t3t: 'Lease renewal', t3d: 'I already rent here and I’m renewing', t4t: 'Additional occupant', t4d: 'Adding someone to an existing lease',
  cta: 'Begin my application →', foot: 'PMI Top Florida Properties · Miami · Broward · Palm Beach · Powered by MAIA',
  contactTitle: 'A few details', contactSub: 'So we can reach you and confirm it’s really you.',
  nameL: 'Your full name', emailL: 'Email', phoneL: 'Mobile phone', unitL: 'Unit number',
  chooseLang: 'Your language', continue2: 'Continue →', back: '← Back', loading: 'Loading…',
}

const es: PreApplyStrings = {
  title: 'Portal de Solicitud y Cumplimiento',
  lede: 'Bienvenido. Ha sido invitado a completar su solicitud en línea — sin papeleo por correo, sin formularios que imprimir. Este portal funciona con MAIA, el asistente inteligente de cumplimiento creado exclusivamente por PMI Top Florida Properties para hacer su solicitud simple, rápida y segura.',
  pill: '✦ MAIA lo guía en cada paso — para que su solicitud esté completa, exacta y lista para la revisión de la Junta',
  langEye: 'En su idioma', langH2: 'Disponible en 7 idiomas',
  langP: 'Este portal fue cuidadosamente desarrollado en 7 idiomas para que cada residente pueda aplicar con comodidad y entender cada requisito. Elegirá su idioma al verificar su identidad para comenzar.',
  secEye: 'Seguridad de nivel bancario', secH2: 'Su identidad y documentos, protegidos',
  secP: 'Antes de subir cualquier cosa, MAIA confirma que es realmente usted con un código de verificación de un solo uso (autenticación de dos factores) — para que sus documentos personales permanezcan privados y seguros.',
  chEmail: 'Correo', chText: 'Texto / SMS',
  first: '★ The Manors of Inverrary XI puede estar entre las primeras comunidades de Florida en ofrecer este nivel de protección verificada y multicanal.',
  getEye: 'Comenzar', getH2: '¿Para qué está aplicando?',
  getP: 'Díganos quién es y MAIA le mostrará exactamente qué documentos necesita su unidad — ni más, ni menos.',
  t1t: 'Alquiler — nuevo contrato', t1d: 'Solicito alquilar una unidad', t2t: 'Compra', t2d: 'Estoy comprando una unidad',
  t3t: 'Renovación de contrato', t3d: 'Ya alquilo aquí y voy a renovar', t4t: 'Ocupante adicional', t4d: 'Agregar a alguien a un contrato existente',
  cta: 'Comenzar mi solicitud →', foot: 'PMI Top Florida Properties · Miami · Broward · Palm Beach · Con la tecnología de MAIA',
  contactTitle: 'Algunos datos', contactSub: 'Para poder comunicarnos con usted y confirmar su identidad.',
  nameL: 'Su nombre completo', emailL: 'Correo', phoneL: 'Teléfono móvil', unitL: 'Número de unidad',
  chooseLang: 'Su idioma', continue2: 'Continuar →', back: '← Atrás', loading: 'Cargando…',
}

const pt: PreApplyStrings = {
  title: 'Portal de Inscrição e Conformidade',
  lede: 'Bem-vindo. Você foi convidado a concluir sua inscrição online — sem papelada pelo correio, sem formulários para imprimir. Este portal é operado pela MAIA, o assistente inteligente de conformidade criado exclusivamente pela PMI Top Florida Properties para tornar sua inscrição simples, rápida e segura.',
  pill: '✦ A MAIA orienta você em cada etapa — para que sua inscrição fique completa, precisa e pronta para a análise do Conselho',
  langEye: 'No seu idioma', langH2: 'Disponível em 7 idiomas',
  langP: 'Este portal foi cuidadosamente desenvolvido em 7 idiomas para que cada morador possa se inscrever com conforto e entender cada requisito. Você escolherá seu idioma ao verificar sua identidade para começar.',
  secEye: 'Segurança de nível bancário', secH2: 'Sua identidade e documentos, protegidos',
  secP: 'Antes de enviar qualquer coisa, a MAIA confirma que é realmente você com um código de verificação de uso único (autenticação de dois fatores) — para que seus documentos pessoais permaneçam privados e seguros.',
  chEmail: 'E-mail', chText: 'Texto / SMS',
  first: '★ The Manors of Inverrary XI pode estar entre as primeiras comunidades da Flórida a oferecer este nível de proteção verificada e multicanal.',
  getEye: 'Começar', getH2: 'Para que você está se inscrevendo?',
  getP: 'Diga-nos quem você é e a MAIA mostrará exatamente quais documentos sua unidade precisa — nada mais, nada menos.',
  t1t: 'Aluguel — novo contrato', t1d: 'Quero alugar uma unidade', t2t: 'Compra', t2d: 'Estou comprando uma unidade',
  t3t: 'Renovação de contrato', t3d: 'Já alugo aqui e vou renovar', t4t: 'Ocupante adicional', t4d: 'Adicionar alguém a um contrato existente',
  cta: 'Iniciar minha inscrição →', foot: 'PMI Top Florida Properties · Miami · Broward · Palm Beach · Desenvolvido com a MAIA',
  contactTitle: 'Alguns dados', contactSub: 'Para podermos contatá-lo e confirmar sua identidade.',
  nameL: 'Seu nome completo', emailL: 'E-mail', phoneL: 'Celular', unitL: 'Número da unidade',
  chooseLang: 'Seu idioma', continue2: 'Continuar →', back: '← Voltar', loading: 'Carregando…',
}

const fr: PreApplyStrings = {
  title: 'Portail de Demande et de Conformité',
  lede: 'Bienvenue. Vous avez été invité à remplir votre demande en ligne — aucun courrier, aucun formulaire à imprimer. Ce portail est propulsé par MAIA, l’assistant intelligent de conformité conçu exclusivement par PMI Top Florida Properties pour rendre votre demande simple, rapide et sécurisée.',
  pill: '✦ MAIA vous guide à chaque étape — pour que votre demande soit complète, exacte et prête pour l’examen du Conseil',
  langEye: 'Dans votre langue', langH2: 'Disponible en 7 langues',
  langP: 'Ce portail a été soigneusement développé en 7 langues afin que chaque résident puisse postuler en toute aisance et comprendre chaque exigence. Vous choisirez votre langue lors de la vérification de votre identité pour commencer.',
  secEye: 'Sécurité de niveau bancaire', secH2: 'Votre identité et vos documents, protégés',
  secP: 'Avant tout téléversement, MAIA confirme que c’est bien vous grâce à un code de vérification à usage unique (authentification à deux facteurs) — afin que vos documents personnels restent privés et sécurisés.',
  chEmail: 'E-mail', chText: 'Texte / SMS',
  first: '★ The Manors of Inverrary XI pourrait être parmi les premières communautés de Floride à offrir ce niveau de protection vérifiée et multicanale.',
  getEye: 'Commencer', getH2: 'Pour quoi faites-vous une demande ?',
  getP: 'Dites-nous qui vous êtes et MAIA vous montrera exactement quels documents votre unité nécessite — ni plus, ni moins.',
  t1t: 'Location — nouveau bail', t1d: 'Je souhaite louer une unité', t2t: 'Achat', t2d: 'J’achète une unité',
  t3t: 'Renouvellement de bail', t3d: 'Je loue déjà ici et je renouvelle', t4t: 'Occupant supplémentaire', t4d: 'Ajouter une personne à un bail existant',
  cta: 'Commencer ma demande →', foot: 'PMI Top Florida Properties · Miami · Broward · Palm Beach · Propulsé par MAIA',
  contactTitle: 'Quelques informations', contactSub: 'Pour vous joindre et confirmer votre identité.',
  nameL: 'Votre nom complet', emailL: 'E-mail', phoneL: 'Téléphone mobile', unitL: 'Numéro d’unité',
  chooseLang: 'Votre langue', continue2: 'Continuer →', back: '← Retour', loading: 'Chargement…',
}

const ht: PreApplyStrings = {
  title: 'Pòtal Aplikasyon ak Konfòmite',
  lede: 'Byenveni. Yo envite w pou w ranpli aplikasyon w sou entènèt — pa gen papye pou voye pa lapòs, pa gen fòm pou enprime. Pòtal sa a fonksyone ak MAIA, asistan konfòmite entelijan ke PMI Top Florida Properties kreye espesyalman pou fè aplikasyon w senp, rapid e an sekirite.',
  pill: '✦ MAIA gide w nan chak etap — pou aplikasyon w konplè, egzak e pare pou revizyon Konsèy la',
  langEye: 'Nan lang ou', langH2: 'Disponib nan 7 lang',
  langP: 'Pòtal sa a te devlope ak anpil swen nan 7 lang pou chak rezidan ka aplike alèz e konprann chak egzijans. W ap chwazi lang ou lè w verifye idantite w pou kòmanse.',
  secEye: 'Sekirite nivo labank', secH2: 'Idantite w ak dokiman w yo, pwoteje',
  secP: 'Anvan w telechaje anyen, MAIA konfime se vrèman ou ak yon kòd verifikasyon yon sèl fwa (otantifikasyon de faktè) — pou dokiman pèsonèl ou yo rete prive e an sekirite.',
  chEmail: 'Imèl', chText: 'Tèks / SMS',
  first: '★ The Manors of Inverrary XI ka pami premye kominote nan Florid ki ofri nivo pwoteksyon verifye e milti-kanal sa a.',
  getEye: 'Kòmanse', getH2: 'Pou kisa w ap aplike?',
  getP: 'Di nou kiyès ou ye epi MAIA ap montre w egzakteman ki dokiman inite w bezwen — pa plis, pa mwens.',
  t1t: 'Lwe — nouvo kontra', t1d: 'M ap aplike pou lwe yon inite', t2t: 'Achte', t2d: 'M ap achte yon inite',
  t3t: 'Renouvèlman kontra', t3d: 'M ap lwe isit deja epi m ap renouvle', t4t: 'Okipan anplis', t4d: 'Ajoute yon moun nan yon kontra ki egziste',
  cta: 'Kòmanse aplikasyon m →', foot: 'PMI Top Florida Properties · Miami · Broward · Palm Beach · Pwopilse pa MAIA',
  contactTitle: 'Kèk detay', contactSub: 'Pou nou ka kontakte w e konfime idantite w.',
  nameL: 'Non konplè w', emailL: 'Imèl', phoneL: 'Telefòn mobil', unitL: 'Nimewo inite',
  chooseLang: 'Lang ou', continue2: 'Kontinye →', back: '← Retounen', loading: 'Y ap chaje…',
}

const he: PreApplyStrings = {
  title: 'פורטל הגשת בקשה ותאימות',
  lede: 'ברוכים הבאים. הוזמנתם למלא את הבקשה שלכם באינטרנט — ללא ניירת בדואר, ללא טפסים להדפסה. הפורטל מופעל על ידי MAIA, עוזר התאימות החכם שפותח באופן בלעדי על ידי PMI Top Florida Properties כדי להפוך את הבקשה שלכם לפשוטה, מהירה ומאובטחת.',
  pill: '✦ MAIA מלווה אתכם בכל שלב — כדי שהבקשה תהיה מלאה, מדויקת ומוכנה לבדיקת הוועד',
  langEye: 'בשפה שלכם', langH2: 'זמין ב-7 שפות',
  langP: 'הפורטל פותח בקפידה ב-7 שפות כדי שכל דייר יוכל להגיש בקשה בנוחות ולהבין כל דרישה. תבחרו את השפה שלכם בעת אימות הזהות כדי להתחיל.',
  secEye: 'אבטחה ברמה בנקאית', secH2: 'הזהות והמסמכים שלכם, מוגנים',
  secP: 'לפני העלאת כל מסמך, MAIA מאמתת שזה באמת אתם באמצעות קוד אימות חד-פעמי (אימות דו-שלבי) — כך שהמסמכים האישיים שלכם נשארים פרטיים ומאובטחים.',
  chEmail: 'אימייל', chText: 'מסרון / SMS',
  first: '★ The Manors of Inverrary XI עשוי להיות בין הקהילות הראשונות בפלורידה שמציעות רמת הגנה מאומתת ורב-ערוצית זו.',
  getEye: 'להתחיל', getH2: 'עבור מה אתם מגישים בקשה?',
  getP: 'ספרו לנו מי אתם ו-MAIA תראה לכם בדיוק אילו מסמכים היחידה שלכם צריכה — לא יותר, לא פחות.',
  t1t: 'שכירות — חוזה חדש', t1d: 'אני מבקש לשכור יחידה', t2t: 'רכישה', t2d: 'אני קונה יחידה',
  t3t: 'חידוש חוזה', t3d: 'אני כבר שוכר כאן ומחדש', t4t: 'דייר נוסף', t4d: 'הוספת אדם לחוזה קיים',
  cta: 'להתחיל את הבקשה שלי →', foot: 'PMI Top Florida Properties · Miami · Broward · Palm Beach · מופעל על ידי MAIA',
  contactTitle: 'כמה פרטים', contactSub: 'כדי שנוכל ליצור איתכם קשר ולאמת את זהותכם.',
  nameL: 'שם מלא', emailL: 'אימייל', phoneL: 'טלפון נייד', unitL: 'מספר יחידה',
  chooseLang: 'השפה שלכם', continue2: 'המשך →', back: '→ חזרה', loading: 'טוען…',
}

const ru: PreApplyStrings = {
  title: 'Портал заявок и соответствия',
  lede: 'Добро пожаловать. Вас пригласили подать заявку онлайн — без бумаг по почте, без форм для печати. Портал работает на MAIA, интеллектуальном помощнике по соответствию, созданном исключительно PMI Top Florida Properties, чтобы сделать вашу заявку простой, быстрой и безопасной.',
  pill: '✦ MAIA проведёт вас через каждый шаг — чтобы ваша заявка была полной, точной и готовой к рассмотрению Правлением',
  langEye: 'На вашем языке', langH2: 'Доступно на 7 языках',
  langP: 'Портал был тщательно разработан на 7 языках, чтобы каждый житель мог подать заявку с комфортом и понять все требования. Вы выберете свой язык при подтверждении личности перед началом.',
  secEye: 'Банковский уровень безопасности', secH2: 'Ваша личность и документы под защитой',
  secP: 'Прежде чем что-либо загружать, MAIA подтверждает, что это действительно вы, с помощью одноразового кода подтверждения (двухфакторная аутентификация) — чтобы ваши личные документы оставались конфиденциальными и защищёнными.',
  chEmail: 'Эл. почта', chText: 'СМС / SMS',
  first: '★ The Manors of Inverrary XI может быть одним из первых сообществ во Флориде, предлагающих такой уровень проверенной многоканальной защиты.',
  getEye: 'Начать', getH2: 'На что вы подаёте заявку?',
  getP: 'Расскажите нам, кто вы, и MAIA покажет точно, какие документы нужны для вашей квартиры — ни больше, ни меньше.',
  t1t: 'Аренда — новый договор', t1d: 'Хочу арендовать квартиру', t2t: 'Покупка', t2d: 'Я покупаю квартиру',
  t3t: 'Продление аренды', t3d: 'Я уже арендую здесь и продлеваю', t4t: 'Дополнительный жилец', t4d: 'Добавить человека в действующий договор',
  cta: 'Начать мою заявку →', foot: 'PMI Top Florida Properties · Miami · Broward · Palm Beach · Работает на MAIA',
  contactTitle: 'Несколько данных', contactSub: 'Чтобы связаться с вами и подтвердить вашу личность.',
  nameL: 'Ваше полное имя', emailL: 'Эл. почта', phoneL: 'Мобильный телефон', unitL: 'Номер квартиры',
  chooseLang: 'Ваш язык', continue2: 'Продолжить →', back: '← Назад', loading: 'Загрузка…',
}

const COPY: Record<PortalLang, PreApplyStrings> = { en, es, pt, fr, ht, he, ru }
export function preApplyStrings(lang: PortalLang): PreApplyStrings { return COPY[lang] ?? en }

// =====================================================================
// Flow strings — the steps AFTER the welcome: choose your role, add the
// other people involved, verify email, upload documents, and (applicants +
// owners only) sign. English is the complete base; per-language overrides
// fall back to English key-by-key, so translations can be filled in safely
// without ever leaving a blank string on screen.
// =====================================================================

export interface PreApplyFlowStrings {
  // Persona / role step
  personaEye: string; personaH2: string; personaP: string
  roleApplicant: string; roleApplicantD: string; roleOwner: string; roleOwnerD: string
  roleListingAgent: string; roleListingAgentD: string; roleTenantAgent: string; roleTenantAgentD: string
  // Confirm-unit step
  confirmUnitEye: string; confirmUnitH2: string; confirmUnitFound: string; confirmUnitNotFound: string
  confirmUnitChecking: string; confirmUnitYes: string; confirmUnitEdit: string
  contactEmailOrPhoneNote: string; contactEmailRequiredNote: string
  // Invite collaborators step
  inviteEye: string; inviteH2: string; inviteP: string
  invNameL: string; invEmailL: string; invPhoneL: string; invRoleL: string; invRolePick: string
  invAdd: string; invSend: string; invSending: string; invSkip: string; invContinue: string; invSent: string
  // Email verification
  verifyH1: string; verifyP: string; sendCode: string; resendCode: string; codePlaceholder: string; verifyBtn: string; codeSentTo: string
  verifyH1Phone: string; verifyPPhone: string
  // Documents
  docsH1: string; docsP: string; yourDocsH: string; otherDocsH: string; otherDocsP: string; noDocsForYou: string
  otherDocsHAgent: string; otherDocsPAgent: string; noDocsForYouAgent: string
  optional: string; uploadedTag: string; uploadBtn: string; replaceBtn: string; uploadingBtn: string; uploadAllNote: string
  downloadForm: string; notarizeSteps: string; printSignUpload: string
  // Rules + signature
  rulesH: string; rulesFallback: string; agreeLine: string; signNameL: string; drawSig: string; noSignNote: string
  signDisclaimer: string
  submitMyPart: string; submittingBtn: string
  // Done screens
  doneH: string; doneP: string; doneSubmittedH: string; doneSubmittedP: string; questions: string
  // Manage collaborators (lead, on the documents page)
  peopleH: string; addSomeone: string
  statusInvited: string; statusActive: string; statusStarted: string; statusCompleted: string; youBadge: string; signsBadge: string
}

const flowEn: PreApplyFlowStrings = {
  personaEye: 'Who are you?', personaH2: 'Tell us your role',
  personaP: 'This lets MAIA show the right documents to each person and record who provided what. Only tenants/buyers and owners sign — agents just upload.',
  roleApplicant: 'Tenant / Buyer', roleApplicantD: 'I’m applying to lease or purchase',
  roleOwner: 'Owner', roleOwnerD: 'I own the unit (landlord / seller)',
  roleListingAgent: 'Listing agent', roleListingAgentD: 'I represent the owner / seller',
  roleTenantAgent: 'Tenant / Buyer agent', roleTenantAgentD: 'I represent the tenant or buyer',
  confirmUnitEye: 'Confirm your unit', confirmUnitH2: 'Is this the right unit?',
  confirmUnitFound: '✓ We have this unit on file.',
  confirmUnitNotFound: 'We don’t have this unit on file yet — that’s okay, just double-check the number is correct before continuing.',
  confirmUnitChecking: 'Checking…',
  confirmUnitYes: 'Yes, this is correct →', confirmUnitEdit: '← Edit unit number',
  contactEmailOrPhoneNote: 'Please provide at least one — email or mobile phone. No email? That’s okay, we can text or WhatsApp you instead.',
  contactEmailRequiredNote: '⚠ An email is required for you specifically — your background check consent link can only be sent by email (not text or WhatsApp). No email of your own? You can use someone else’s, like your agent’s, to receive it.',
  inviteEye: 'Work together', inviteH2: 'Add everyone involved',
  inviteP: 'Add the other people on this application — co-applicants, the owner, the agent. MAIA emails each of them their own secure link so everyone fills their part at the same time. You can also do this later.',
  invNameL: 'Full name', invEmailL: 'Email (or phone below)', invPhoneL: 'Mobile phone (if no email)', invRoleL: 'Role', invRolePick: 'Choose a role…',
  invAdd: '+ Add another person', invSend: 'Send invitations', invSending: 'Sending…',
  invSkip: 'Skip — it’s just me for now', invContinue: 'Continue to my documents →',
  invSent: 'Invitations sent — each person got their own link.',
  verifyH1: 'Verify your email', verifyP: 'We’ll send a code to confirm it’s you before you upload documents.',
  verifyH1Phone: 'Verify your phone', verifyPPhone: 'We’ll text or WhatsApp you a code to confirm it’s you before you upload documents.',
  sendCode: 'Send me a code', resendCode: 'Resend code', codePlaceholder: '6-digit code', verifyBtn: 'Verify', codeSentTo: 'Code sent to',
  docsH1: 'Your documents', docsP: 'Upload each document below in its own box.',
  yourDocsH: 'Your documents', otherDocsH: 'Other documents (if you have them)',
  otherDocsHAgent: '{name}’s documents', otherDocsPAgent: 'You can upload these on {name}’s behalf — helpful if they’re not comfortable doing this online themselves.',
  noDocsForYouAgent: 'Nothing is required directly from you — but you can upload {name}’s documents below, on their behalf, if that’s easier for them.',
  otherDocsP: 'These are usually provided by someone else on the application — upload only if you have them.',
  noDocsForYou: 'No documents are required from you — thank you.',
  optional: 'optional', uploadedTag: 'Uploaded', uploadBtn: 'Upload', replaceBtn: 'Replace', uploadingBtn: 'Uploading…',
  uploadAllNote: 'Upload all required documents before submitting.',
  downloadForm: 'Download the form to print & notarize',
  notarizeSteps: 'Print this form, sign it in front of a notary public, then upload the notarized copy here.',
  printSignUpload: 'Print this form, complete it, then upload it here.',
  rulesH: 'Association rules — please read & acknowledge',
  rulesFallback: 'By signing you acknowledge the association’s governing documents, rules, and restrictions.',
  agreeLine: 'I have read and agree to comply with the association’s rules and restrictions, and I certify the documents and information I provided are true and complete.',
  signNameL: 'Type your full name to sign', drawSig: 'Draw your signature',
  noSignNote: 'You don’t need to sign — just upload your documents. Only tenants/buyers and owners sign the acknowledgment.',
  signDisclaimer: 'This translation is provided only to help you understand. The English version of this form is the official document. Please have a trusted translator explain it to you before you sign.',
  submitMyPart: 'Submit my part', submittingBtn: 'Submitting…',
  doneH: 'Your part is complete', doneP: 'Thank you. We’ll take it from here and follow up if anything else is needed.',
  doneSubmittedH: 'Application submitted', doneSubmittedP: 'Thank you. PMI Top Florida Properties will review the documents and follow up. You don’t need to do anything else right now.',
  questions: 'Questions? PMI Top Florida Properties · (305) 900-5077',
  peopleH: 'People on this application', addSomeone: '+ Add someone',
  statusInvited: 'Invited', statusActive: 'In progress', statusStarted: 'In progress', statusCompleted: 'Done', youBadge: 'You', signsBadge: 'signs',
}

// Per-language overrides. Persona + invite (the collaborative welcome steps the
// applicant sees first) are translated now; remaining doc/rules keys fall back
// to English until their translation pass lands.
const FLOW: Record<PortalLang, Partial<PreApplyFlowStrings>> = {
  en: {},
  es: {
    personaEye: '¿Quién es usted?', personaH2: 'Indíquenos su rol',
    personaP: 'Esto permite que MAIA muestre los documentos correctos a cada persona y registre quién aportó qué. Solo los inquilinos/compradores y los propietarios firman — los agentes solo suben documentos.',
    roleApplicant: 'Inquilino / Comprador', roleApplicantD: 'Solicito alquilar o comprar',
    roleOwner: 'Propietario', roleOwnerD: 'Soy dueño de la unidad (arrendador / vendedor)',
    roleListingAgent: 'Agente del propietario', roleListingAgentD: 'Represento al propietario / vendedor',
    roleTenantAgent: 'Agente del inquilino / comprador', roleTenantAgentD: 'Represento al inquilino o comprador',
    confirmUnitEye: 'Confirme su unidad', confirmUnitH2: '¿Es esta la unidad correcta?',
    confirmUnitFound: '✓ Tenemos esta unidad registrada.',
    confirmUnitNotFound: 'Aún no tenemos esta unidad registrada — está bien, solo confirme que el número es correcto antes de continuar.',
    confirmUnitChecking: 'Verificando…',
    confirmUnitYes: 'Sí, es correcto →', confirmUnitEdit: '← Editar número de unidad',
    contactEmailOrPhoneNote: 'Proporcione al menos uno — correo o teléfono móvil. ¿No tiene correo? No hay problema, podemos enviarle un mensaje de texto o WhatsApp.',
    contactEmailRequiredNote: '⚠ Se requiere un correo específicamente para usted — el enlace de consentimiento para la verificación de antecedentes solo puede enviarse por correo (no por texto ni WhatsApp). ¿No tiene correo propio? Puede usar el de otra persona, como su agente, para recibirlo.',
    inviteEye: 'Trabajen juntos', inviteH2: 'Agregue a todos los involucrados',
    inviteP: 'Agregue a las demás personas de esta solicitud — coinquilinos, el propietario, el agente. MAIA enviará a cada uno su propio enlace seguro para que todos completen su parte al mismo tiempo. También puede hacerlo más tarde.',
    invNameL: 'Nombre completo', invEmailL: 'Correo (o teléfono abajo)', invPhoneL: 'Teléfono móvil (si no tiene correo)', invRoleL: 'Rol', invRolePick: 'Elija un rol…',
    invAdd: '+ Agregar otra persona', invSend: 'Enviar invitaciones', invSending: 'Enviando…',
    invSkip: 'Omitir — por ahora soy solo yo', invContinue: 'Continuar con mis documentos →',
    invSent: 'Invitaciones enviadas — cada persona recibió su propio enlace.',
    verifyH1: 'Verifique su correo', verifyP: 'Le enviaremos un código para confirmar que es usted antes de subir documentos.',
    sendCode: 'Envíenme un código', resendCode: 'Reenviar código', codePlaceholder: 'Código de 6 dígitos', verifyBtn: 'Verificar', codeSentTo: 'Código enviado a',
    docsH1: 'Sus documentos', docsP: 'Suba cada documento en su propia casilla.',
    yourDocsH: 'Sus documentos', otherDocsH: 'Otros documentos (si los tiene)',
    otherDocsHAgent: 'Documentos de {name}', otherDocsPAgent: 'Puede subir estos documentos en nombre de {name} — útil si esa persona no se siente cómoda haciéndolo en línea.',
    noDocsForYouAgent: 'No se requiere nada directamente de usted — pero puede subir los documentos de {name} a continuación, en su nombre, si eso le resulta más fácil.',
    otherDocsP: 'Normalmente los aporta otra persona de la solicitud — súbalos solo si los tiene.',
    noDocsForYou: 'No se requieren documentos de su parte — gracias.',
    optional: 'opcional', uploadedTag: 'Subido', uploadBtn: 'Subir', replaceBtn: 'Reemplazar', uploadingBtn: 'Subiendo…',
    uploadAllNote: 'Suba todos los documentos requeridos antes de enviar.',
    rulesH: 'Reglas de la asociación — lea y confirme',
    rulesFallback: 'Al firmar, usted reconoce los documentos rectores, reglas y restricciones de la asociación.',
    agreeLine: 'He leído y acepto cumplir las reglas y restricciones de la asociación, y certifico que los documentos e información que proporcioné son verdaderos y completos.',
    signNameL: 'Escriba su nombre completo para firmar', drawSig: 'Dibuje su firma',
    noSignNote: 'No necesita firmar — solo suba sus documentos. Solo los inquilinos/compradores y los propietarios firman la confirmación.',
    signDisclaimer: 'Esta traducción se proporciona solo para ayudarle a entender. La versión en inglés de este formulario es el documento oficial. Por favor, pida a un traductor de confianza que se lo explique antes de firmar.',
    submitMyPart: 'Enviar mi parte', submittingBtn: 'Enviando…',
    doneH: 'Su parte está completa', doneP: 'Gracias. Nosotros continuamos desde aquí y le contactaremos si se necesita algo más.',
    doneSubmittedH: 'Solicitud enviada', doneSubmittedP: 'Gracias. PMI Top Florida Properties revisará los documentos y le contactará. No necesita hacer nada más por ahora.',
    questions: '¿Preguntas? PMI Top Florida Properties · (305) 900-5077',
    peopleH: 'Personas en esta solicitud', addSomeone: '+ Agregar a alguien',
    statusInvited: 'Invitado', statusActive: 'En progreso', statusStarted: 'En progreso', statusCompleted: 'Listo', youBadge: 'Usted', signsBadge: 'firma',
  },
  pt: {
    personaEye: 'Quem é você?', personaH2: 'Informe sua função',
    personaP: 'Isso permite que a MAIA mostre os documentos certos para cada pessoa e registre quem forneceu o quê. Somente inquilinos/compradores e proprietários assinam — os corretores apenas enviam documentos.',
    roleApplicant: 'Inquilino / Comprador', roleApplicantD: 'Quero alugar ou comprar',
    roleOwner: 'Proprietário', roleOwnerD: 'Sou dono da unidade (locador / vendedor)',
    roleListingAgent: 'Corretor do proprietário', roleListingAgentD: 'Represento o proprietário / vendedor',
    roleTenantAgent: 'Corretor do inquilino / comprador', roleTenantAgentD: 'Represento o inquilino ou comprador',
    confirmUnitEye: 'Confirme sua unidade', confirmUnitH2: 'Esta é a unidade certa?',
    confirmUnitFound: '✓ Temos esta unidade registrada.',
    confirmUnitNotFound: 'Ainda não temos esta unidade registrada — tudo bem, apenas confirme se o número está correto antes de continuar.',
    confirmUnitChecking: 'Verificando…',
    confirmUnitYes: 'Sim, está correto →', confirmUnitEdit: '← Editar número da unidade',
    contactEmailOrPhoneNote: 'Forneça pelo menos um — e-mail ou celular. Não tem e-mail? Sem problema, podemos enviar por SMS ou WhatsApp.',
    contactEmailRequiredNote: '⚠ Um e-mail é obrigatório especificamente para você — o link de consentimento da verificação de antecedentes só pode ser enviado por e-mail (não por SMS ou WhatsApp). Não tem e-mail próprio? Pode usar o de outra pessoa, como seu corretor, para recebê-lo.',
    inviteEye: 'Trabalhem juntos', inviteH2: 'Adicione todos os envolvidos',
    inviteP: 'Adicione as outras pessoas desta inscrição — coinquilinos, o proprietário, o corretor. A MAIA envia a cada um seu próprio link seguro para que todos preencham sua parte ao mesmo tempo. Você também pode fazer isso depois.',
    invNameL: 'Nome completo', invEmailL: 'E-mail (ou telefone abaixo)', invPhoneL: 'Celular (se não tiver e-mail)', invRoleL: 'Função', invRolePick: 'Escolha uma função…',
    invAdd: '+ Adicionar outra pessoa', invSend: 'Enviar convites', invSending: 'Enviando…',
    invSkip: 'Pular — por enquanto sou só eu', invContinue: 'Continuar para meus documentos →',
    invSent: 'Convites enviados — cada pessoa recebeu seu próprio link.',
    verifyH1: 'Verifique seu e-mail', verifyP: 'Enviaremos um código para confirmar que é você antes de enviar documentos.',
    sendCode: 'Envie-me um código', resendCode: 'Reenviar código', codePlaceholder: 'Código de 6 dígitos', verifyBtn: 'Verificar', codeSentTo: 'Código enviado para',
    docsH1: 'Seus documentos', docsP: 'Envie cada documento em sua própria caixa.',
    yourDocsH: 'Seus documentos', otherDocsH: 'Outros documentos (se você os tiver)',
    otherDocsHAgent: 'Documentos de {name}', otherDocsPAgent: 'Você pode enviar estes documentos em nome de {name} — útil se essa pessoa não se sentir à vontade fazendo isso online.',
    noDocsForYouAgent: 'Nada é exigido diretamente de você — mas você pode enviar os documentos de {name} abaixo, em nome dela, se isso for mais fácil.',
    otherDocsP: 'Normalmente fornecidos por outra pessoa da inscrição — envie apenas se você os tiver.',
    noDocsForYou: 'Nenhum documento é exigido de você — obrigado.',
    optional: 'opcional', uploadedTag: 'Enviado', uploadBtn: 'Enviar', replaceBtn: 'Substituir', uploadingBtn: 'Enviando…',
    uploadAllNote: 'Envie todos os documentos obrigatórios antes de enviar.',
    rulesH: 'Regras da associação — leia e reconheça',
    rulesFallback: 'Ao assinar, você reconhece os documentos regentes, regras e restrições da associação.',
    agreeLine: 'Li e concordo em cumprir as regras e restrições da associação, e certifico que os documentos e informações que forneci são verdadeiros e completos.',
    signNameL: 'Digite seu nome completo para assinar', drawSig: 'Desenhe sua assinatura',
    noSignNote: 'Você não precisa assinar — apenas envie seus documentos. Somente inquilinos/compradores e proprietários assinam o reconhecimento.',
    signDisclaimer: 'Esta tradução é fornecida apenas para ajudar você a entender. A versão em inglês deste formulário é o documento oficial. Por favor, peça a um tradutor de confiança que a explique antes de assinar.',
    submitMyPart: 'Enviar minha parte', submittingBtn: 'Enviando…',
    doneH: 'Sua parte está concluída', doneP: 'Obrigado. Continuamos a partir daqui e entraremos em contato se algo mais for necessário.',
    doneSubmittedH: 'Inscrição enviada', doneSubmittedP: 'Obrigado. A PMI Top Florida Properties revisará os documentos e entrará em contato. Você não precisa fazer mais nada agora.',
    questions: 'Dúvidas? PMI Top Florida Properties · (305) 900-5077',
    peopleH: 'Pessoas nesta inscrição', addSomeone: '+ Adicionar alguém',
    statusInvited: 'Convidado', statusActive: 'Em andamento', statusStarted: 'Em andamento', statusCompleted: 'Concluído', youBadge: 'Você', signsBadge: 'assina',
  },
  fr: {
    personaEye: 'Qui êtes-vous ?', personaH2: 'Indiquez votre rôle',
    personaP: 'Cela permet à MAIA de montrer les bons documents à chaque personne et d’enregistrer qui a fourni quoi. Seuls les locataires/acheteurs et les propriétaires signent — les agents ne font que téléverser.',
    roleApplicant: 'Locataire / Acheteur', roleApplicantD: 'Je souhaite louer ou acheter',
    roleOwner: 'Propriétaire', roleOwnerD: 'Je suis propriétaire de l’unité (bailleur / vendeur)',
    roleListingAgent: 'Agent du propriétaire', roleListingAgentD: 'Je représente le propriétaire / vendeur',
    roleTenantAgent: 'Agent du locataire / acheteur', roleTenantAgentD: 'Je représente le locataire ou l’acheteur',
    confirmUnitEye: 'Confirmez votre unité', confirmUnitH2: 'Est-ce la bonne unité ?',
    confirmUnitFound: '✓ Nous avons cette unité dans nos dossiers.',
    confirmUnitNotFound: 'Nous n’avons pas encore cette unité dans nos dossiers — ce n’est pas grave, vérifiez simplement que le numéro est correct avant de continuer.',
    confirmUnitChecking: 'Vérification…',
    confirmUnitYes: 'Oui, c’est correct →', confirmUnitEdit: '← Modifier le numéro d’unité',
    contactEmailOrPhoneNote: 'Veuillez fournir au moins l’un des deux — e-mail ou téléphone mobile. Pas d’e-mail ? Ce n’est pas grave, nous pouvons vous envoyer un SMS ou un message WhatsApp.',
    contactEmailRequiredNote: '⚠ Un e-mail est requis spécifiquement pour vous — le lien de consentement de vérification des antécédents ne peut être envoyé que par e-mail (pas par SMS ni WhatsApp). Pas d’e-mail à vous ? Vous pouvez utiliser celui d’une autre personne, comme votre agent, pour le recevoir.',
    inviteEye: 'Collaborez', inviteH2: 'Ajoutez toutes les personnes concernées',
    inviteP: 'Ajoutez les autres personnes de cette demande — colocataires, le propriétaire, l’agent. MAIA envoie à chacun son propre lien sécurisé pour que tout le monde remplisse sa partie en même temps. Vous pouvez aussi le faire plus tard.',
    invNameL: 'Nom complet', invEmailL: 'E-mail (ou téléphone ci-dessous)', invPhoneL: 'Téléphone mobile (si pas d’e-mail)', invRoleL: 'Rôle', invRolePick: 'Choisissez un rôle…',
    invAdd: '+ Ajouter une autre personne', invSend: 'Envoyer les invitations', invSending: 'Envoi…',
    invSkip: 'Passer — c’est juste moi pour l’instant', invContinue: 'Continuer vers mes documents →',
    invSent: 'Invitations envoyées — chacun a reçu son propre lien.',
    verifyH1: 'Vérifiez votre e-mail', verifyP: 'Nous vous enverrons un code pour confirmer que c’est bien vous avant le téléversement.',
    sendCode: 'Envoyez-moi un code', resendCode: 'Renvoyer le code', codePlaceholder: 'Code à 6 chiffres', verifyBtn: 'Vérifier', codeSentTo: 'Code envoyé à',
    docsH1: 'Vos documents', docsP: 'Téléversez chaque document dans sa propre case.',
    yourDocsH: 'Vos documents', otherDocsH: 'Autres documents (si vous les avez)',
    otherDocsHAgent: 'Documents de {name}', otherDocsPAgent: 'Vous pouvez téléverser ces documents au nom de {name} — utile si cette personne n’est pas à l’aise pour le faire en ligne elle-même.',
    noDocsForYouAgent: 'Rien n’est requis directement de vous — mais vous pouvez téléverser les documents de {name} ci-dessous, en son nom, si c’est plus simple pour elle.',
    otherDocsP: 'Généralement fournis par une autre personne de la demande — téléversez seulement si vous les avez.',
    noDocsForYou: 'Aucun document n’est requis de votre part — merci.',
    optional: 'facultatif', uploadedTag: 'Téléversé', uploadBtn: 'Téléverser', replaceBtn: 'Remplacer', uploadingBtn: 'Téléversement…',
    uploadAllNote: 'Téléversez tous les documents requis avant d’envoyer.',
    rulesH: 'Règlement de l’association — veuillez lire et accepter',
    rulesFallback: 'En signant, vous reconnaissez les documents constitutifs, règles et restrictions de l’association.',
    agreeLine: 'J’ai lu et j’accepte de respecter les règles et restrictions de l’association, et je certifie que les documents et informations fournis sont exacts et complets.',
    signNameL: 'Saisissez votre nom complet pour signer', drawSig: 'Dessinez votre signature',
    noSignNote: 'Vous n’avez pas besoin de signer — téléversez simplement vos documents. Seuls les locataires/acheteurs et les propriétaires signent l’accusé de réception.',
    signDisclaimer: 'Cette traduction est fournie uniquement pour vous aider à comprendre. La version anglaise de ce formulaire est le document officiel. Veuillez faire appel à un traducteur de confiance pour vous l’expliquer avant de signer.',
    submitMyPart: 'Envoyer ma partie', submittingBtn: 'Envoi…',
    doneH: 'Votre partie est terminée', doneP: 'Merci. Nous prenons le relais et vous recontacterons si besoin.',
    doneSubmittedH: 'Demande envoyée', doneSubmittedP: 'Merci. PMI Top Florida Properties examinera les documents et vous recontactera. Vous n’avez rien d’autre à faire pour le moment.',
    questions: 'Des questions ? PMI Top Florida Properties · (305) 900-5077',
    peopleH: 'Personnes sur cette demande', addSomeone: '+ Ajouter quelqu’un',
    statusInvited: 'Invité', statusActive: 'En cours', statusStarted: 'En cours', statusCompleted: 'Terminé', youBadge: 'Vous', signsBadge: 'signe',
  },
  ht: {
    personaEye: 'Kiyès ou ye?', personaH2: 'Di nou wòl ou',
    personaP: 'Sa pèmèt MAIA montre bon dokiman yo bay chak moun epi anrejistre kiyès ki bay kisa. Se sèlman lokatè/achtè ak pwopriyetè ki siyen — ajan yo jis telechaje.',
    roleApplicant: 'Lokatè / Achtè', roleApplicantD: 'M ap aplike pou lwe oswa achte',
    roleOwner: 'Pwopriyetè', roleOwnerD: 'Se mwen ki mèt inite a (mèt kay / vandè)',
    roleListingAgent: 'Ajan pwopriyetè a', roleListingAgentD: 'M reprezante pwopriyetè / vandè a',
    roleTenantAgent: 'Ajan lokatè / achtè', roleTenantAgentD: 'M reprezante lokatè oswa achtè a',
    confirmUnitEye: 'Konfime inite w', confirmUnitH2: 'Èske se bon inite a?',
    confirmUnitFound: '✓ Nou gen inite sa a nan dosye nou.',
    confirmUnitNotFound: 'Nou poko gen inite sa a nan dosye nou — pa gen pwoblèm, jis verifye nimewo a kòrèk anvan w kontinye.',
    confirmUnitChecking: 'K ap verifye…',
    confirmUnitYes: 'Wi, li kòrèk →', confirmUnitEdit: '← Modifye nimewo inite a',
    contactEmailOrPhoneNote: 'Tanpri bay omwen youn — imèl oswa telefòn mobil. Ou pa gen imèl? Pa gen pwoblèm, nou ka voye tèks oswa WhatsApp ba ou.',
    contactEmailRequiredNote: '⚠ Nou bezwen yon imèl spesyalman pou ou — lyen konsantman verifikasyon background la ka voye sèlman pa imèl (pa tèks ni WhatsApp). Ou pa gen pwòp imèl ou? Ou ka itilize pa yon lòt moun, tankou ajan ou, pou resevwa li.',
    inviteEye: 'Travay ansanm', inviteH2: 'Ajoute tout moun ki enplike',
    inviteP: 'Ajoute lòt moun nan aplikasyon sa a — ko-aplikan, pwopriyetè a, ajan an. MAIA voye pou chak youn pwòp lyen sekirize yo pou tout moun ranpli pati yo an menm tan. Ou ka fè sa pita tou.',
    invNameL: 'Non konplè', invEmailL: 'Imèl (oswa telefòn anba a)', invPhoneL: 'Telefòn mobil (si w pa gen imèl)', invRoleL: 'Wòl', invRolePick: 'Chwazi yon wòl…',
    invAdd: '+ Ajoute yon lòt moun', invSend: 'Voye envitasyon yo', invSending: 'Y ap voye…',
    invSkip: 'Sote — se jis mwen pou kounye a', invContinue: 'Kontinye ak dokiman mwen yo →',
    invSent: 'Envitasyon voye — chak moun jwenn pwòp lyen yo.',
    verifyH1: 'Verifye imèl ou', verifyP: 'N ap voye yon kòd pou konfime se ou anvan w telechaje dokiman.',
    sendCode: 'Voye m yon kòd', resendCode: 'Voye kòd ankò', codePlaceholder: 'Kòd 6 chif', verifyBtn: 'Verifye', codeSentTo: 'Kòd voye bay',
    docsH1: 'Dokiman ou yo', docsP: 'Telechaje chak dokiman nan pwòp bwat li.',
    yourDocsH: 'Dokiman ou yo', otherDocsH: 'Lòt dokiman (si w genyen yo)',
    otherDocsHAgent: 'Dokiman {name}', otherDocsPAgent: 'Ou ka telechaje dokiman sa yo nan non {name} — itil si moun sa a pa alèz fè sa sou entènèt pou tèt li.',
    noDocsForYouAgent: 'Pa gen anyen ki obligatwa dirèkteman nan men ou — men ou ka telechaje dokiman {name} anba a, nan non li, si sa pi fasil pou li.',
    otherDocsP: 'Anjeneral se yon lòt moun nan aplikasyon an ki bay yo — telechaje sèlman si w genyen yo.',
    noDocsForYou: 'Pa gen dokiman ki obligatwa pou ou — mèsi.',
    optional: 'opsyonèl', uploadedTag: 'Telechaje', uploadBtn: 'Telechaje', replaceBtn: 'Ranplase', uploadingBtn: 'Y ap telechaje…',
    uploadAllNote: 'Telechaje tout dokiman obligatwa yo anvan w soumèt.',
    rulesH: 'Règ asosyasyon an — tanpri li epi rekonèt',
    rulesFallback: 'Lè w siyen, ou rekonèt dokiman ki dirije, règ ak restriksyon asosyasyon an.',
    agreeLine: 'Mwen li epi mwen dakò respekte règ ak restriksyon asosyasyon an, epi mwen sètifye dokiman ak enfòmasyon mwen bay yo se verite e yo konplè.',
    signNameL: 'Tape non konplè w pou siyen', drawSig: 'Desine siyati w',
    noSignNote: 'Ou pa bezwen siyen — jis telechaje dokiman ou yo. Se sèlman lokatè/achtè ak pwopriyetè ki siyen rekonesans lan.',
    signDisclaimer: 'Tradiksyon sa a se sèlman pou ede w konprann. Vèsyon anglè fòm sa a se dokiman ofisyèl la. Tanpri jwenn yon tradiktè ou fè konfyans pou esplike w li anvan w siyen.',
    submitMyPart: 'Soumèt pati mwen an', submittingBtn: 'Y ap soumèt…',
    doneH: 'Pati ou a fini', doneP: 'Mèsi. N ap kontinye apati la epi n ap kontakte w si nou bezwen lòt bagay.',
    doneSubmittedH: 'Aplikasyon soumèt', doneSubmittedP: 'Mèsi. PMI Top Florida Properties ap revize dokiman yo epi kontakte w. Ou pa bezwen fè anyen lòt kounye a.',
    questions: 'Kesyon? PMI Top Florida Properties · (305) 900-5077',
    peopleH: 'Moun nan aplikasyon sa a', addSomeone: '+ Ajoute yon moun',
    statusInvited: 'Envite', statusActive: 'K ap fèt', statusStarted: 'K ap fèt', statusCompleted: 'Fini', youBadge: 'Ou', signsBadge: 'siyen',
  },
  he: {
    personaEye: 'מי אתם?', personaH2: 'ספרו לנו את התפקיד שלכם',
    personaP: 'זה מאפשר ל-MAIA להציג את המסמכים הנכונים לכל אדם ולתעד מי סיפק מה. רק שוכרים/קונים ובעלים חותמים — סוכנים רק מעלים מסמכים.',
    roleApplicant: 'שוכר / קונה', roleApplicantD: 'אני מבקש לשכור או לקנות',
    roleOwner: 'בעלים', roleOwnerD: 'אני בעל היחידה (משכיר / מוכר)',
    roleListingAgent: 'סוכן הבעלים', roleListingAgentD: 'אני מייצג את הבעלים / המוכר',
    roleTenantAgent: 'סוכן השוכר / הקונה', roleTenantAgentD: 'אני מייצג את השוכר או הקונה',
    confirmUnitEye: 'אשרו את היחידה שלכם', confirmUnitH2: 'האם זו היחידה הנכונה?',
    confirmUnitFound: '✓ יש לנו את היחידה הזו במערכת.',
    confirmUnitNotFound: 'עדיין אין לנו את היחידה הזו במערכת — זה בסדר, רק ודאו שהמספר נכון לפני שממשיכים.',
    confirmUnitChecking: 'בודק…',
    confirmUnitYes: 'כן, זה נכון →', confirmUnitEdit: '→ עריכת מספר יחידה',
    contactEmailOrPhoneNote: 'אנא ספקו לפחות אחד מהם — אימייל או טלפון נייד. אין לכם אימייל? זה בסדר, נוכל לשלוח לכם הודעת טקסט או וואטסאפ.',
    contactEmailRequiredNote: '⚠ נדרש אימייל במיוחד עבורכם — קישור ההסכמה לבדיקת רקע יכול להישלח רק באימייל (לא בהודעת טקסט או וואטסאפ). אין לכם אימייל משלכם? תוכלו להשתמש באימייל של מישהו אחר, כמו הסוכן שלכם, כדי לקבל אותו.',
    inviteEye: 'עבדו יחד', inviteH2: 'הוסיפו את כל המעורבים',
    inviteP: 'הוסיפו את שאר האנשים בבקשה זו — שותפים, הבעלים, הסוכן. MAIA שולחת לכל אחד קישור מאובטח משלו כדי שכולם ימלאו את חלקם בו-זמנית. אפשר גם לעשות זאת מאוחר יותר.',
    invNameL: 'שם מלא', invEmailL: 'אימייל (או טלפון למטה)', invPhoneL: 'טלפון נייד (אם אין אימייל)', invRoleL: 'תפקיד', invRolePick: 'בחרו תפקיד…',
    invAdd: '+ הוסף אדם נוסף', invSend: 'שלח הזמנות', invSending: 'שולח…',
    invSkip: 'דלג — בינתיים רק אני', invContinue: 'המשך למסמכים שלי →',
    invSent: 'ההזמנות נשלחו — כל אחד קיבל קישור משלו.',
    verifyH1: 'אמתו את האימייל שלכם', verifyP: 'נשלח קוד כדי לוודא שזה אתם לפני העלאת מסמכים.',
    sendCode: 'שלחו לי קוד', resendCode: 'שלחו קוד שוב', codePlaceholder: 'קוד בן 6 ספרות', verifyBtn: 'אימות', codeSentTo: 'קוד נשלח אל',
    docsH1: 'המסמכים שלכם', docsP: 'העלו כל מסמך בתיבה משלו.',
    yourDocsH: 'המסמכים שלכם', otherDocsH: 'מסמכים נוספים (אם יש לכם)',
    otherDocsHAgent: 'המסמכים של {name}', otherDocsPAgent: 'תוכלו להעלות את המסמכים האלה בשם {name} — שימושי אם אותו אדם לא נוח לו לעשות זאת אונליין בעצמו.',
    noDocsForYouAgent: 'שום דבר לא נדרש ישירות מכם — אבל תוכלו להעלות למטה את המסמכים של {name}, בשמו, אם זה נוח יותר עבורו.',
    otherDocsP: 'בדרך כלל מסופקים על ידי מישהו אחר בבקשה — העלו רק אם יש לכם אותם.',
    noDocsForYou: 'לא נדרשים מכם מסמכים — תודה.',
    optional: 'לא חובה', uploadedTag: 'הועלה', uploadBtn: 'העלאה', replaceBtn: 'החלפה', uploadingBtn: 'מעלה…',
    uploadAllNote: 'העלו את כל המסמכים הנדרשים לפני השליחה.',
    rulesH: 'תקנון האגודה — אנא קראו ואשרו',
    rulesFallback: 'בחתימתכם אתם מאשרים את מסמכי היסוד, התקנון וההגבלות של האגודה.',
    agreeLine: 'קראתי ואני מסכים לציית לתקנון ולהגבלות של האגודה, ואני מאשר שהמסמכים והמידע שסיפקתי נכונים ומלאים.',
    signNameL: 'הקלידו את שמכם המלא לחתימה', drawSig: 'ציירו את חתימתכם',
    noSignNote: 'אינכם צריכים לחתום — פשוט העלו את המסמכים שלכם. רק שוכרים/קונים ובעלים חותמים על האישור.',
    signDisclaimer: 'תרגום זה ניתן רק כדי לעזור לכם להבין. הגרסה האנגלית של טופס זה היא המסמך הרשמי. אנא היעזרו במתרגם מהימן שיסביר לכם אותו לפני החתימה.',
    submitMyPart: 'שליחת החלק שלי', submittingBtn: 'שולח…',
    doneH: 'החלק שלכם הושלם', doneP: 'תודה. אנו ממשיכים מכאן וניצור קשר אם יידרש משהו נוסף.',
    doneSubmittedH: 'הבקשה נשלחה', doneSubmittedP: 'תודה. PMI Top Florida Properties תבדוק את המסמכים ותיצור קשר. אינכם צריכים לעשות דבר נוסף כרגע.',
    questions: 'שאלות? PMI Top Florida Properties · (305) 900-5077',
    peopleH: 'אנשים בבקשה זו', addSomeone: '+ הוספת מישהו',
    statusInvited: 'הוזמן', statusActive: 'בתהליך', statusStarted: 'בתהליך', statusCompleted: 'הושלם', youBadge: 'אתם', signsBadge: 'חותם',
  },
  ru: {
    personaEye: 'Кто вы?', personaH2: 'Укажите вашу роль',
    personaP: 'Это позволяет MAIA показать нужные документы каждому человеку и записать, кто что предоставил. Подписывают только арендаторы/покупатели и владельцы — агенты только загружают.',
    roleApplicant: 'Арендатор / Покупатель', roleApplicantD: 'Я подаю заявку на аренду или покупку',
    roleOwner: 'Владелец', roleOwnerD: 'Я владею квартирой (арендодатель / продавец)',
    roleListingAgent: 'Агент владельца', roleListingAgentD: 'Я представляю владельца / продавца',
    roleTenantAgent: 'Агент арендатора / покупателя', roleTenantAgentD: 'Я представляю арендатора или покупателя',
    confirmUnitEye: 'Подтвердите вашу квартиру', confirmUnitH2: 'Это правильная квартира?',
    confirmUnitFound: '✓ Эта квартира есть в нашей базе.',
    confirmUnitNotFound: 'Этой квартиры пока нет в нашей базе — это нормально, просто убедитесь, что номер указан верно, прежде чем продолжить.',
    confirmUnitChecking: 'Проверка…',
    confirmUnitYes: 'Да, всё верно →', confirmUnitEdit: '← Изменить номер квартиры',
    contactEmailOrPhoneNote: 'Укажите хотя бы одно — эл. почту или мобильный телефон. Нет эл. почты? Ничего страшного, мы можем отправить вам SMS или сообщение в WhatsApp.',
    contactEmailRequiredNote: '⚠ Эл. почта обязательна именно для вас — ссылка для согласия на проверку данных может быть отправлена только по эл. почте (не по SMS и не через WhatsApp). Нет своей эл. почты? Вы можете использовать чужую, например вашего агента, чтобы получить её.',
    inviteEye: 'Работайте вместе', inviteH2: 'Добавьте всех участников',
    inviteP: 'Добавьте остальных участников этой заявки — созаявителей, владельца, агента. MAIA отправит каждому его собственную защищённую ссылку, чтобы все заполнили свою часть одновременно. Это также можно сделать позже.',
    invNameL: 'Полное имя', invEmailL: 'Эл. почта (или телефон ниже)', invPhoneL: 'Мобильный телефон (если нет эл. почты)', invRoleL: 'Роль', invRolePick: 'Выберите роль…',
    invAdd: '+ Добавить ещё человека', invSend: 'Отправить приглашения', invSending: 'Отправка…',
    invSkip: 'Пропустить — пока только я', invContinue: 'Перейти к моим документам →',
    invSent: 'Приглашения отправлены — каждый получил свою ссылку.',
    verifyH1: 'Подтвердите вашу почту', verifyP: 'Мы отправим код, чтобы подтвердить, что это вы, перед загрузкой документов.',
    sendCode: 'Отправьте мне код', resendCode: 'Отправить код повторно', codePlaceholder: '6-значный код', verifyBtn: 'Подтвердить', codeSentTo: 'Код отправлен на',
    docsH1: 'Ваши документы', docsP: 'Загрузите каждый документ в свою ячейку.',
    yourDocsH: 'Ваши документы', otherDocsH: 'Другие документы (если они у вас есть)',
    otherDocsHAgent: 'Документы {name}', otherDocsPAgent: 'Вы можете загрузить эти документы от имени {name} — это удобно, если этому человеку неудобно делать это онлайн самостоятельно.',
    noDocsForYouAgent: 'От вас лично ничего не требуется — но вы можете загрузить документы {name} ниже, от его/её имени, если так удобнее.',
    otherDocsP: 'Обычно их предоставляет другой участник заявки — загрузите, только если они у вас есть.',
    noDocsForYou: 'От вас документы не требуются — спасибо.',
    optional: 'необязательно', uploadedTag: 'Загружено', uploadBtn: 'Загрузить', replaceBtn: 'Заменить', uploadingBtn: 'Загрузка…',
    uploadAllNote: 'Загрузите все обязательные документы перед отправкой.',
    rulesH: 'Правила ассоциации — прочитайте и подтвердите',
    rulesFallback: 'Подписывая, вы подтверждаете ознакомление с учредительными документами, правилами и ограничениями ассоциации.',
    agreeLine: 'Я прочитал(а) и согласен(на) соблюдать правила и ограничения ассоциации и подтверждаю, что предоставленные документы и сведения верны и полны.',
    signNameL: 'Введите ваше полное имя для подписи', drawSig: 'Нарисуйте вашу подпись',
    noSignNote: 'Вам не нужно подписывать — просто загрузите документы. Подтверждение подписывают только арендаторы/покупатели и владельцы.',
    signDisclaimer: 'Этот перевод предоставлен только для того, чтобы помочь вам понять. Официальным документом является английская версия этой формы. Пожалуйста, попросите надёжного переводчика объяснить её вам перед подписанием.',
    submitMyPart: 'Отправить мою часть', submittingBtn: 'Отправка…',
    doneH: 'Ваша часть завершена', doneP: 'Спасибо. Мы продолжим дальше и свяжемся с вами, если потребуется что-то ещё.',
    doneSubmittedH: 'Заявка отправлена', doneSubmittedP: 'Спасибо. PMI Top Florida Properties проверит документы и свяжется с вами. Сейчас больше ничего делать не нужно.',
    questions: 'Вопросы? PMI Top Florida Properties · (305) 900-5077',
    peopleH: 'Участники этой заявки', addSomeone: '+ Добавить человека',
    statusInvited: 'Приглашён', statusActive: 'В процессе', statusStarted: 'В процессе', statusCompleted: 'Готово', youBadge: 'Вы', signsBadge: 'подписывает',
  },
}

export function preApplyFlow(lang: PortalLang): PreApplyFlowStrings {
  return { ...flowEn, ...(FLOW[lang] ?? {}) }
}
