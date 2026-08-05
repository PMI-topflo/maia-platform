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
