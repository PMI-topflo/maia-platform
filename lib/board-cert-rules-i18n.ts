// =====================================================================
// lib/board-cert-rules-i18n.ts
//
// Board-education certification rules, explained for board members to
// read when they see an "expired" / "CE overdue" flag. Separated by
// association regime — Condominium (Fla. Stat. Ch. 718, 7-year cert +
// 1 hr/yr continuing ed) vs HOA (Ch. 720, 4-year cert + 4–8 hr/yr) —
// and translated into all 7 portal languages (Hebrew is RTL).
//
// Content only; the <BoardCertWhyExpired> component renders it. Pick the
// kind with certKindFromType(association_type) (see lib/board-certification).
// =====================================================================

import type { PortalLang } from '@/lib/portal-i18n'
import type { CertKind } from '@/lib/board-certification'

export interface CertKindCopy {
  heading: string
  intro: string
  items: { label: string; text: string }[]
  ceHighlight: string
}

export interface CertRuleStrings {
  whyButton: string
  langLabel: string
  close: string
  suspend: string
  clearTitle: string
  clearText: string
  condo: CertKindCopy
  hoa: CertKindCopy
}

const en: CertRuleStrings = {
  whyButton: 'Why is it expired?',
  langLabel: 'Language',
  close: 'Close',
  suspend: 'If a director does not stay certified, Florida law suspends them from the board until they become compliant again.',
  clearTitle: 'How to clear it',
  clearText: "Upload your renewed certificate — or this year's continuing-education certificate — using the link in your email, or send it to PMI. Once we approve it, your status updates automatically.",
  condo: {
    heading: 'Condominium board certification (Fla. Stat. Ch. 718)',
    intro: 'Every condominium director must be certified. Here is how the certification and its yearly renewal work.',
    items: [
      { label: 'Initial education', text: 'Complete a DBPR-approved board-member education course of at least 4 hours.' },
      { label: 'Deadline', text: 'Within 1 year before, or 90 days after, your election or appointment.' },
      { label: 'Written certification', text: 'Instead of the course, a new director may sign the statutory written certification confirming they have read the governing documents and will uphold them.' },
      { label: 'Certification expires', text: '7 years — then the full course must be retaken (assuming uninterrupted service).' },
      { label: 'Continuing education', text: 'Beginning one year after you certify, at least 1 hour every year on Chapter 718 and DBPR rules.' },
    ],
    ceHighlight: "Most 'expired' notices are the annual continuing education — the 7-year certificate is usually still valid, but the 1-hour yearly course was not completed. Completing this year's continuing education clears it.",
  },
  hoa: {
    heading: 'HOA board certification (Fla. Stat. Ch. 720)',
    intro: "Every homeowners' association director must be certified. Here is how the certification and its yearly renewal work.",
    items: [
      { label: 'Initial education', text: 'Complete the DBPR-approved new-board-member education course.' },
      { label: 'Deadline', text: 'Within 90 days after your election or appointment.' },
      { label: 'Certification expires', text: '4 years — then the education course must be retaken.' },
      { label: 'Continuing education', text: 'Every year: 4 hours if your association has fewer than 2,500 parcels, or 8 hours if 2,500 or more.' },
    ],
    ceHighlight: "Most 'expired' notices are the annual continuing education — the 4-year certificate is usually still valid, but the yearly hours were not completed. Completing this year's continuing education clears it.",
  },
}

const es: CertRuleStrings = {
  whyButton: '¿Por qué está vencida?',
  langLabel: 'Idioma',
  close: 'Cerrar',
  suspend: 'Si un director no mantiene su certificación, la ley de Florida lo suspende de la junta hasta que vuelva a cumplir.',
  clearTitle: 'Cómo resolverlo',
  clearText: 'Suba su certificado renovado —o el certificado de educación continua de este año— con el enlace de su correo, o envíelo a PMI. Una vez que lo aprobemos, su estado se actualiza automáticamente.',
  condo: {
    heading: 'Certificación de junta de condominio (Estatutos de Florida, Cap. 718)',
    intro: 'Todo director de condominio debe estar certificado. Así funcionan la certificación y su renovación anual.',
    items: [
      { label: 'Educación inicial', text: 'Complete un curso de educación para miembros de junta aprobado por el DBPR de al menos 4 horas.' },
      { label: 'Plazo', text: 'Dentro de 1 año antes, o 90 días después, de su elección o nombramiento.' },
      { label: 'Certificación escrita', text: 'En lugar del curso, un director nuevo puede firmar la certificación escrita que confirma que leyó los documentos rectores y que los cumplirá.' },
      { label: 'La certificación vence', text: '7 años — luego se debe repetir el curso completo (con servicio ininterrumpido).' },
      { label: 'Educación continua', text: 'A partir de un año después de certificarse, al menos 1 hora cada año sobre el Capítulo 718 y las reglas del DBPR.' },
    ],
    ceHighlight: "La mayoría de los avisos de 'vencido' son la educación continua anual — el certificado de 7 años suele seguir vigente, pero no se completó el curso anual de 1 hora. Completar la educación continua de este año lo resuelve.",
  },
  hoa: {
    heading: 'Certificación de junta de HOA (Estatutos de Florida, Cap. 720)',
    intro: 'Todo director de una asociación de propietarios debe estar certificado. Así funcionan la certificación y su renovación anual.',
    items: [
      { label: 'Educación inicial', text: 'Complete el curso de educación para nuevos miembros de junta aprobado por el DBPR.' },
      { label: 'Plazo', text: 'Dentro de los 90 días posteriores a su elección o nombramiento.' },
      { label: 'La certificación vence', text: '4 años — luego se debe repetir el curso de educación.' },
      { label: 'Educación continua', text: 'Cada año: 4 horas si su asociación tiene menos de 2,500 parcelas, u 8 horas si tiene 2,500 o más.' },
    ],
    ceHighlight: "La mayoría de los avisos de 'vencido' son la educación continua anual — el certificado de 4 años suele seguir vigente, pero no se completaron las horas anuales. Completar la educación continua de este año lo resuelve.",
  },
}

const pt: CertRuleStrings = {
  whyButton: 'Por que está vencida?',
  langLabel: 'Idioma',
  close: 'Fechar',
  suspend: 'Se um diretor não mantiver a certificação, a lei da Flórida o suspende do conselho até que volte a cumprir as exigências.',
  clearTitle: 'Como resolver',
  clearText: 'Envie seu certificado renovado — ou o certificado de educação continuada deste ano — pelo link do seu e-mail, ou mande para a PMI. Assim que aprovarmos, seu status é atualizado automaticamente.',
  condo: {
    heading: 'Certificação do conselho de condomínio (Estatutos da Flórida, Cap. 718)',
    intro: 'Todo diretor de condomínio deve ser certificado. Veja como funcionam a certificação e sua renovação anual.',
    items: [
      { label: 'Educação inicial', text: 'Conclua um curso de educação para membros do conselho aprovado pelo DBPR, de no mínimo 4 horas.' },
      { label: 'Prazo', text: 'Dentro de 1 ano antes, ou 90 dias após, sua eleição ou nomeação.' },
      { label: 'Certificação por escrito', text: 'Em vez do curso, um novo diretor pode assinar a certificação por escrito confirmando que leu os documentos regentes e que os cumprirá.' },
      { label: 'A certificação expira', text: '7 anos — depois o curso completo deve ser refeito (com serviço ininterrupto).' },
      { label: 'Educação continuada', text: 'A partir de um ano após a certificação, pelo menos 1 hora por ano sobre o Capítulo 718 e as regras do DBPR.' },
    ],
    ceHighlight: "A maioria dos avisos de 'vencido' é a educação continuada anual — o certificado de 7 anos geralmente ainda é válido, mas o curso anual de 1 hora não foi concluído. Concluir a educação continuada deste ano resolve.",
  },
  hoa: {
    heading: 'Certificação do conselho de HOA (Estatutos da Flórida, Cap. 720)',
    intro: 'Todo diretor de associação de moradores deve ser certificado. Veja como funcionam a certificação e sua renovação anual.',
    items: [
      { label: 'Educação inicial', text: 'Conclua o curso de educação para novos membros do conselho aprovado pelo DBPR.' },
      { label: 'Prazo', text: 'Dentro de 90 dias após sua eleição ou nomeação.' },
      { label: 'A certificação expira', text: '4 anos — depois o curso de educação deve ser refeito.' },
      { label: 'Educação continuada', text: 'Todo ano: 4 horas se sua associação tiver menos de 2.500 lotes, ou 8 horas se tiver 2.500 ou mais.' },
    ],
    ceHighlight: "A maioria dos avisos de 'vencido' é a educação continuada anual — o certificado de 4 anos geralmente ainda é válido, mas as horas anuais não foram concluídas. Concluir a educação continuada deste ano resolve.",
  },
}

const fr: CertRuleStrings = {
  whyButton: 'Pourquoi est-elle expirée ?',
  langLabel: 'Langue',
  close: 'Fermer',
  suspend: "Si un administrateur ne maintient pas sa certification, la loi de Floride le suspend du conseil jusqu'à ce qu'il soit de nouveau en conformité.",
  clearTitle: 'Comment régulariser',
  clearText: "Téléversez votre certificat renouvelé — ou le certificat de formation continue de cette année — via le lien de votre e-mail, ou envoyez-le à PMI. Dès que nous l'approuvons, votre statut est mis à jour automatiquement.",
  condo: {
    heading: 'Certification du conseil de copropriété (Lois de Floride, chap. 718)',
    intro: 'Chaque administrateur de copropriété doit être certifié. Voici comment fonctionnent la certification et son renouvellement annuel.',
    items: [
      { label: 'Formation initiale', text: "Suivez un cours de formation pour membres du conseil approuvé par le DBPR, d'au moins 4 heures." },
      { label: 'Délai', text: "Dans l'année précédant, ou dans les 90 jours suivant, votre élection ou nomination." },
      { label: 'Certification écrite', text: "Au lieu du cours, un nouvel administrateur peut signer la certification écrite confirmant qu'il a lu les documents directeurs et qu'il les respectera." },
      { label: 'La certification expire', text: '7 ans — ensuite le cours complet doit être repris (service ininterrompu).' },
      { label: 'Formation continue', text: "À partir d'un an après la certification, au moins 1 heure chaque année sur le chapitre 718 et les règles du DBPR." },
    ],
    ceHighlight: "La plupart des avis « expiré » concernent la formation continue annuelle — le certificat de 7 ans est généralement encore valide, mais le cours annuel d'une heure n'a pas été suivi. Suivre la formation continue de cette année régularise la situation.",
  },
  hoa: {
    heading: "Certification du conseil d'HOA (Lois de Floride, chap. 720)",
    intro: "Chaque administrateur d'association de propriétaires doit être certifié. Voici comment fonctionnent la certification et son renouvellement annuel.",
    items: [
      { label: 'Formation initiale', text: 'Suivez le cours de formation pour nouveaux membres du conseil approuvé par le DBPR.' },
      { label: 'Délai', text: 'Dans les 90 jours suivant votre élection ou nomination.' },
      { label: 'La certification expire', text: '4 ans — ensuite le cours de formation doit être repris.' },
      { label: 'Formation continue', text: 'Chaque année : 4 heures si votre association compte moins de 2 500 parcelles, ou 8 heures si 2 500 ou plus.' },
    ],
    ceHighlight: "La plupart des avis « expiré » concernent la formation continue annuelle — le certificat de 4 ans est généralement encore valide, mais les heures annuelles n'ont pas été effectuées. Suivre la formation continue de cette année régularise la situation.",
  },
}

const ht: CertRuleStrings = {
  whyButton: 'Poukisa li ekspire ?',
  langLabel: 'Lang',
  close: 'Fèmen',
  suspend: 'Si yon direktè pa kenbe sètifikasyon li, lwa Florid la sispann li nan konsèy la jiskaske li konfòme ankò.',
  clearTitle: 'Kijan pou rezoud li',
  clearText: 'Telechaje sètifika renouvle ou a — oswa sètifika edikasyon kontinye ane sa a — ak lyen ki nan imèl ou a, oswa voye l bay PMI. Yon fwa nou apwouve l, estati ou ap mete ajou otomatikman.',
  condo: {
    heading: 'Sètifikasyon konsèy kondominyòm (Lwa Florid, Chapit 718)',
    intro: 'Chak direktè kondominyòm dwe sètifye. Men kijan sètifikasyon an ak renouvèlman anyèl li fonksyone.',
    items: [
      { label: 'Edikasyon inisyal', text: 'Fè yon kou edikasyon pou manm konsèy ki apwouve pa DBPR, omwen 4 èdtan.' },
      { label: 'Dat limit', text: 'Nan 1 an anvan, oswa 90 jou apre, eleksyon oswa nominasyon ou.' },
      { label: 'Sètifikasyon alekri', text: 'Olye kou a, yon nouvo direktè ka siyen sètifikasyon alekri a ki konfime li li dokiman ki dirije yo epi l ap respekte yo.' },
      { label: 'Sètifikasyon an ekspire', text: '7 an — apre sa fòk ou refè kou konplè a (si sèvis la pa entèwonp).' },
      { label: 'Edikasyon kontinye', text: 'Kòmanse yon an apre ou sètifye, omwen 1 èdtan chak ane sou Chapit 718 ak règ DBPR yo.' },
    ],
    ceHighlight: "Pifò avi 'ekspire' se edikasyon kontinye anyèl la — sètifika 7 an an anjeneral toujou valab, men kou 1 èdtan chak ane a pa t fèt. Fè edikasyon kontinye ane sa a rezoud li.",
  },
  hoa: {
    heading: 'Sètifikasyon konsèy HOA (Lwa Florid, Chapit 720)',
    intro: 'Chak direktè asosyasyon pwopriyetè dwe sètifye. Men kijan sètifikasyon an ak renouvèlman anyèl li fonksyone.',
    items: [
      { label: 'Edikasyon inisyal', text: 'Fè kou edikasyon pou nouvo manm konsèy ki apwouve pa DBPR a.' },
      { label: 'Dat limit', text: 'Nan 90 jou apre eleksyon oswa nominasyon ou.' },
      { label: 'Sètifikasyon an ekspire', text: '4 an — apre sa fòk ou refè kou edikasyon an.' },
      { label: 'Edikasyon kontinye', text: 'Chak ane: 4 èdtan si asosyasyon ou gen mwens pase 2,500 palsèl, oswa 8 èdtan si li gen 2,500 oswa plis.' },
    ],
    ceHighlight: "Pifò avi 'ekspire' se edikasyon kontinye anyèl la — sètifika 4 an an anjeneral toujou valab, men èdtan anyèl yo pa t fèt. Fè edikasyon kontinye ane sa a rezoud li.",
  },
}

const he: CertRuleStrings = {
  whyButton: 'למה זה פג תוקף?',
  langLabel: 'שפה',
  close: 'סגירה',
  suspend: 'אם חבר ועד אינו שומר על ההסמכה שלו, חוק פלורידה משעה אותו מהוועד עד שיחזור לעמוד בדרישות.',
  clearTitle: 'איך לתקן',
  clearText: 'העלו את התעודה המחודשת — או את תעודת ההשתלמות של השנה — דרך הקישור בדוא"ל שלכם, או שלחו אותה ל-PMI. לאחר האישור, הסטטוס שלכם יתעדכן אוטומטית.',
  condo: {
    heading: 'הסמכת ועד קונדומיניום (חוקי פלורידה, פרק 718)',
    intro: 'כל חבר ועד קונדומיניום חייב להיות מוסמך. כך פועלים ההסמכה והחידוש השנתי שלה.',
    items: [
      { label: 'השכלה ראשונית', text: 'השלימו קורס הכשרה לחברי ועד באישור DBPR, של 4 שעות לפחות.' },
      { label: 'מועד אחרון', text: 'בתוך שנה לפני, או 90 יום אחרי, הבחירה או המינוי שלכם.' },
      { label: 'הצהרה בכתב', text: 'במקום הקורס, חבר ועד חדש רשאי לחתום על ההצהרה בכתב המאשרת שקרא את מסמכי הניהול ויקיים אותם.' },
      { label: 'ההסמכה פגה', text: '7 שנים — לאחר מכן יש לחזור על הקורס המלא (בכהונה רציפה).' },
      { label: 'השתלמות מתמשכת', text: 'החל משנה לאחר ההסמכה, לפחות שעה אחת בכל שנה על פרק 718 וכללי DBPR.' },
    ],
    ceHighlight: "רוב הודעות 'פג תוקף' נוגעות להשתלמות השנתית — תעודת 7 השנים בדרך כלל עדיין בתוקף, אך קורס השעה השנתי לא הושלם. השלמת ההשתלמות של השנה מתקנת זאת.",
  },
  hoa: {
    heading: 'הסמכת ועד HOA (חוקי פלורידה, פרק 720)',
    intro: 'כל חבר ועד באיגוד בעלי בתים חייב להיות מוסמך. כך פועלים ההסמכה והחידוש השנתי שלה.',
    items: [
      { label: 'השכלה ראשונית', text: 'השלימו את קורס ההכשרה לחברי ועד חדשים באישור DBPR.' },
      { label: 'מועד אחרון', text: 'בתוך 90 יום מהבחירה או המינוי שלכם.' },
      { label: 'ההסמכה פגה', text: '4 שנים — לאחר מכן יש לחזור על קורס ההכשרה.' },
      { label: 'השתלמות מתמשכת', text: 'בכל שנה: 4 שעות אם באיגוד פחות מ-2,500 יחידות, או 8 שעות אם 2,500 ומעלה.' },
    ],
    ceHighlight: "רוב הודעות 'פג תוקף' נוגעות להשתלמות השנתית — תעודת 4 השנים בדרך כלל עדיין בתוקף, אך השעות השנתיות לא הושלמו. השלמת ההשתלמות של השנה מתקנת זאת.",
  },
}

const ru: CertRuleStrings = {
  whyButton: 'Почему истёк срок?',
  langLabel: 'Язык',
  close: 'Закрыть',
  suspend: 'Если директор не поддерживает сертификацию, закон Флориды отстраняет его от совета до восстановления соответствия.',
  clearTitle: 'Как исправить',
  clearText: 'Загрузите обновлённый сертификат — или сертификат о непрерывном обучении за этот год — по ссылке из письма или отправьте его в PMI. После одобрения ваш статус обновится автоматически.',
  condo: {
    heading: 'Сертификация совета кондоминиума (Законы Флориды, гл. 718)',
    intro: 'Каждый директор кондоминиума должен быть сертифицирован. Вот как работают сертификация и её ежегодное продление.',
    items: [
      { label: 'Начальное обучение', text: 'Пройдите одобренный DBPR курс для членов совета продолжительностью не менее 4 часов.' },
      { label: 'Срок', text: 'В течение 1 года до или 90 дней после вашего избрания или назначения.' },
      { label: 'Письменное подтверждение', text: 'Вместо курса новый директор может подписать письменное подтверждение того, что прочитал руководящие документы и будет их соблюдать.' },
      { label: 'Срок действия сертификации', text: '7 лет — затем нужно снова пройти полный курс (при непрерывной службе).' },
      { label: 'Непрерывное обучение', text: 'Начиная через год после сертификации — не менее 1 часа ежегодно по главе 718 и правилам DBPR.' },
    ],
    ceHighlight: 'Большинство уведомлений «истёк срок» относятся к ежегодному непрерывному обучению — 7-летний сертификат обычно ещё действителен, но ежегодный часовой курс не пройден. Прохождение обучения за этот год снимает отметку.',
  },
  hoa: {
    heading: 'Сертификация совета HOA (Законы Флориды, гл. 720)',
    intro: 'Каждый директор ассоциации домовладельцев должен быть сертифицирован. Вот как работают сертификация и её ежегодное продление.',
    items: [
      { label: 'Начальное обучение', text: 'Пройдите одобренный DBPR курс для новых членов совета.' },
      { label: 'Срок', text: 'В течение 90 дней после вашего избрания или назначения.' },
      { label: 'Срок действия сертификации', text: '4 года — затем нужно снова пройти курс обучения.' },
      { label: 'Непрерывное обучение', text: 'Ежегодно: 4 часа, если в ассоциации менее 2 500 участков, или 8 часов при 2 500 и более.' },
    ],
    ceHighlight: 'Большинство уведомлений «истёк срок» относятся к ежегодному непрерывному обучению — 4-летний сертификат обычно ещё действителен, но ежегодные часы не пройдены. Прохождение обучения за этот год снимает отметку.',
  },
}

const COPY: Record<PortalLang, CertRuleStrings> = { en, es, pt, fr, ht, he, ru }

export function certRuleStrings(lang: PortalLang): CertRuleStrings {
  return COPY[lang] ?? en
}

export function certRuleForKind(lang: PortalLang, kind: CertKind): CertKindCopy {
  return certRuleStrings(lang)[kind]
}
