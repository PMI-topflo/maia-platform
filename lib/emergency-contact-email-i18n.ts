// =====================================================================
// lib/emergency-contact-email-i18n.ts
//
// The unit survey email, in the seven languages MAIA speaks.
//
// Hand-maintained, per-surface, like every other dictionary in this app
// (lib/portal-i18n.ts, app/page.tsx COPY, VendorLangBar). There is no i18n
// framework here and no runtime translation service — a machine translation
// made at send time cannot be reviewed before 149 people receive it.
//
// English is the fallback for an unanswered preference. That is a fallback,
// not an assumption: `preferred_language` is nullable precisely so that
// "never asked" stays distinguishable from "asked for English".
// =====================================================================

import type { PortalLang } from '@/lib/portal-i18n'

export interface SurveyEmailStrings {
  subject: (unit: string) => string
  hello: (name: string | null) => string
  /** Why the Association is asking. */
  intro: (assoc: string, unit: string, address: string | null) => string
  /** What is on the form — the landlord and resident versions differ. */
  landlordBody: string
  residentBody: string
  cta: string
  noAccount: string
  signOff: string
}

const en: SurveyEmailStrings = {
  subject: u => `Your unit details — Unit ${u}`,
  hello: n => n ? `Hello ${n},` : 'Hello,',
  intro: (a, u, addr) =>
    `<strong>${a}</strong> is updating its records for every unit${addr ? ` at ${addr}` : ''}. It takes about a minute, and it is how we know who to call if something happens at <strong>Unit ${u}</strong> — a burst pipe, a fire, a storm — and we cannot reach the people who live there.`,
  landlordBody:
    'You will be asked whether the unit is rented, who rents it, what language you would like us to write to you in, and who to contact in an emergency. If it is rented, please give us your tenant’s email — that way we can ask them directly for the documents only they can provide, instead of everything coming through you.',
  residentBody:
    'You will be asked how the unit is used, what language you would like us to write to you in, who lives there, and one or two people we can call in an emergency.',
  cta: 'Update my unit details',
  noAccount: 'No account or password needed — this link is specific to you. You will get a signed copy by email.',
  signOff: 'PMI Top Florida Properties · MAIA keeps your association’s records up to date and reminds you when something is due.',
}

const es: SurveyEmailStrings = {
  subject: u => `Los datos de su unidad — Unidad ${u}`,
  hello: n => n ? `Hola ${n}:` : 'Hola:',
  intro: (a, u, addr) =>
    `<strong>${a}</strong> está actualizando sus registros de cada unidad${addr ? ` en ${addr}` : ''}. Toma alrededor de un minuto y es así como sabemos a quién llamar si ocurre algo en la <strong>Unidad ${u}</strong> — una tubería rota, un incendio, una tormenta — y no podemos comunicarnos con quienes viven allí.`,
  landlordBody:
    'Le preguntaremos si la unidad está alquilada, quién la alquila, en qué idioma prefiere que le escribamos y a quién contactar en caso de emergencia. Si está alquilada, indíquenos el correo electrónico de su inquilino: así podremos pedirle directamente los documentos que solo él puede entregar, en lugar de que todo pase por usted.',
  residentBody:
    'Le preguntaremos cómo se usa la unidad, en qué idioma prefiere que le escribamos, quién vive allí y una o dos personas a las que podamos llamar en caso de emergencia.',
  cta: 'Actualizar los datos de mi unidad',
  noAccount: 'No necesita cuenta ni contraseña: este enlace es solo para usted. Recibirá una copia firmada por correo electrónico.',
  signOff: 'PMI Top Florida Properties · MAIA mantiene al día los registros de su asociación y le avisa cuando algo vence.',
}

const pt: SurveyEmailStrings = {
  subject: u => `Os dados da sua unidade — Unidade ${u}`,
  hello: n => n ? `Olá ${n},` : 'Olá,',
  intro: (a, u, addr) =>
    `A <strong>${a}</strong> está a atualizar os registos de cada unidade${addr ? ` em ${addr}` : ''}. Demora cerca de um minuto e é assim que sabemos a quem ligar se acontecer algo na <strong>Unidade ${u}</strong> — um cano rebentado, um incêndio, uma tempestade — e não conseguirmos contactar quem lá vive.`,
  landlordBody:
    'Vamos perguntar se a unidade está arrendada, quem a arrenda, em que idioma prefere que lhe escrevamos e quem contactar numa emergência. Se estiver arrendada, indique-nos o e-mail do seu inquilino: assim podemos pedir-lhe diretamente os documentos que só ele pode fornecer, em vez de passar tudo por si.',
  residentBody:
    'Vamos perguntar como a unidade é utilizada, em que idioma prefere que lhe escrevamos, quem lá vive e uma ou duas pessoas a quem possamos ligar numa emergência.',
  cta: 'Atualizar os dados da minha unidade',
  noAccount: 'Não precisa de conta nem palavra-passe — esta ligação é só sua. Receberá uma cópia assinada por e-mail.',
  signOff: 'PMI Top Florida Properties · A MAIA mantém os registos da sua associação atualizados e avisa-o quando algo está a vencer.',
}

const fr: SurveyEmailStrings = {
  subject: u => `Les informations de votre logement — Logement ${u}`,
  hello: n => n ? `Bonjour ${n},` : 'Bonjour,',
  intro: (a, u, addr) =>
    `<strong>${a}</strong> met à jour ses dossiers pour chaque logement${addr ? ` au ${addr}` : ''}. Cela prend environ une minute, et c’est ainsi que nous savons qui appeler s’il arrive quelque chose au <strong>logement ${u}</strong> — une canalisation qui cède, un incendie, une tempête — et que nous ne pouvons pas joindre ceux qui y vivent.`,
  landlordBody:
    'Nous vous demanderons si le logement est loué, qui l’occupe, dans quelle langue vous souhaitez que nous vous écrivions, et qui contacter en cas d’urgence. S’il est loué, donnez-nous l’adresse e-mail de votre locataire : nous pourrons ainsi lui demander directement les documents que lui seul peut fournir, au lieu que tout passe par vous.',
  residentBody:
    'Nous vous demanderons comment le logement est utilisé, dans quelle langue vous souhaitez que nous vous écrivions, qui y habite, et une ou deux personnes que nous pouvons appeler en cas d’urgence.',
  cta: 'Mettre à jour mes informations',
  noAccount: 'Aucun compte ni mot de passe n’est nécessaire — ce lien vous est propre. Vous recevrez une copie signée par e-mail.',
  signOff: 'PMI Top Florida Properties · MAIA tient à jour les dossiers de votre association et vous prévient à l’approche des échéances.',
}

const ht: SurveyEmailStrings = {
  subject: u => `Enfòmasyon inite ou a — Inite ${u}`,
  hello: n => n ? `Bonjou ${n},` : 'Bonjou,',
  intro: (a, u, addr) =>
    `<strong>${a}</strong> ap mete dosye chak inite ajou${addr ? ` nan ${addr}` : ''}. Sa pran anviwon yon minit, e se konsa nou konnen ki moun pou nou rele si gen yon bagay ki rive nan <strong>Inite ${u}</strong> — yon tiyo ki pete, yon dife, yon tanpèt — epi nou pa ka jwenn moun k ap viv la yo.`,
  landlordBody:
    'N ap mande w si inite a lwe, ki moun ki lwe l, nan ki lang ou vle nou ekri w, epi ki moun pou nou kontakte nan yon ijans. Si li lwe, tanpri ban nou imel lokatè a — konsa nou ka mande l dirèkteman dokiman se sèlman li ki ka bay, olye pou tout bagay pase nan men w.',
  residentBody:
    'N ap mande w kijan yo itilize inite a, nan ki lang ou vle nou ekri w, ki moun k ap viv la, epi youn ou de moun nou ka rele nan yon ijans.',
  cta: 'Mete enfòmasyon inite m nan ajou',
  noAccount: 'Ou pa bezwen kont ni modpas — lyen sa a se pou ou sèlman. W ap resevwa yon kopi siyen pa imel.',
  signOff: 'PMI Top Florida Properties · MAIA kenbe dosye asosyasyon w lan ajou epi li fè w sonje lè yon bagay rive alekay.',
}

const he: SurveyEmailStrings = {
  subject: u => `פרטי היחידה שלך — יחידה ${u}`,
  hello: n => n ? `שלום ${n},` : 'שלום,',
  intro: (a, u, addr) =>
    `<strong>${a}</strong> מעדכנת את הרישומים של כל יחידה${addr ? ` ב-${addr}` : ''}. זה לוקח כדקה, וכך אנחנו יודעים למי להתקשר אם קורה משהו ב<strong>יחידה ${u}</strong> — נזילה, שריפה, סופה — ואיננו מצליחים להשיג את מי שגר בה.`,
  landlordBody:
    'נשאל אם היחידה מושכרת, מי שוכר אותה, באיזו שפה תעדיף שנכתוב אליך, ולמי לפנות במקרה חירום. אם היא מושכרת, אנא מסור לנו את כתובת האימייל של הדייר — כך נוכל לבקש ממנו ישירות את המסמכים שרק הוא יכול לספק, במקום שהכול יעבור דרכך.',
  residentBody:
    'נשאל כיצד היחידה משמשת, באיזו שפה תעדיף שנכתוב אליך, מי גר בה, ואחד או שני אנשים שנוכל להתקשר אליהם במקרה חירום.',
  cta: 'עדכון פרטי היחידה שלי',
  noAccount: 'אין צורך בחשבון או בסיסמה — הקישור הזה מיועד לך בלבד. תקבל עותק חתום באימייל.',
  signOff: 'PMI Top Florida Properties · MAIA שומרת על עדכניות הרישומים של האגודה שלך ומזכירה כשמשהו עומד לפוג.',
}

const ru: SurveyEmailStrings = {
  subject: u => `Сведения о вашей квартире — квартира ${u}`,
  hello: n => n ? `Здравствуйте, ${n}!` : 'Здравствуйте!',
  intro: (a, u, addr) =>
    `<strong>${a}</strong> обновляет сведения по каждой квартире${addr ? ` по адресу ${addr}` : ''}. Это займёт около минуты, и именно так мы знаем, кому звонить, если в <strong>квартире ${u}</strong> что-то случится — прорвёт трубу, начнётся пожар, придёт шторм — а связаться с теми, кто в ней живёт, не удаётся.`,
  landlordBody:
    'Мы спросим, сдаётся ли квартира, кто её снимает, на каком языке вам писать и с кем связаться в экстренном случае. Если она сдаётся, укажите электронную почту жильца — тогда мы сможем запрашивать у него напрямую документы, которые может предоставить только он, вместо того чтобы всё шло через вас.',
  residentBody:
    'Мы спросим, как используется квартира, на каком языке вам писать, кто в ней живёт и одного-двух человек, которым можно позвонить в экстренном случае.',
  cta: 'Обновить сведения о квартире',
  noAccount: 'Ни учётная запись, ни пароль не нужны — эта ссылка предназначена только вам. Подписанную копию вы получите по электронной почте.',
  signOff: 'PMI Top Florida Properties · MAIA поддерживает документы вашей ассоциации в актуальном состоянии и напоминает о приближающихся сроках.',
}

const DICT: Record<PortalLang, SurveyEmailStrings> = { en, es, pt, fr, ht, he, ru }

/** English is the FALLBACK for an unanswered preference, never an assumption
 *  about it — see the note at the top of this file. */
export function surveyEmailStrings(lang: string | null | undefined): SurveyEmailStrings {
  const v = (lang ?? '').toLowerCase()
  return DICT[v as PortalLang] ?? en
}
