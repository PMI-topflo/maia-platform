// =====================================================================
// lib/intl-applicant-docs-content.ts
// Shared translated copy for the international-applicant supporting
// documents (foreign police clearance, CPA Financial Certification,
// notarized translation) -- single source of truth consumed by both the
// in-app disclosure in components/ApplicationForm.tsx AND the
// downloadable CPA-requirements PDF (lib/intl-cpa-guide-pdf.tsx), so the
// two never drift out of sync.
// =====================================================================

export type IntlDocsLang = 'en' | 'es' | 'pt' | 'fr' | 'ht' | 'he' | 'ru'

export interface IntlDocsContent {
  sectionTitle: string
  hint: string
  policeClearanceLabel: string
  cpaCertLabel: string
  cpaDetailsToggle: string
  cpaHeading: string
  cpaIntroParagraphs: string[]
  cpaBullets: string[]
  translationLabel: string
  downloadCpaGuide: string
  progressAllSet: string
  progressMissing: string
  progressLabel: (uploaded: number, total: number) => string
  pdfTitle: string
  pdfFooter: string
}

export const INTL_DOCS_CONTENT: Record<IntlDocsLang, IntlDocsContent> = {
  en: {
    sectionTitle: 'Additional documents for international applicants',
    hint: 'Upload as they become available — you can continue and finish your application before all of these are ready; PMI may follow up if anything’s still missing.',
    policeClearanceLabel: 'Foreign police clearance certificate / criminal record',
    cpaCertLabel: 'CPA Financial Certification',
    cpaDetailsToggle: 'What must the CPA Financial Certification include?',
    cpaHeading: 'Financial Certification Requirement for International Applicants',
    cpaIntroParagraphs: [
      'The mandatory online background check is required for all applicants. However, when a U.S. credit report, financial report, or tax returns are unavailable or incomplete because the applicant resides outside the United States, the applicant must submit a Financial Certification prepared by a Certified Public Accountant (CPA), Chartered Accountant (CA), or other licensed accounting professional authorized to practice in the applicant’s country of residence.',
      'The Financial Certification must provide a comprehensive summary of the applicant’s financial condition and demonstrate the applicant’s financial capacity to satisfy the obligations associated with the proposed purchase or lease. At a minimum, the report must include the following:',
    ],
    cpaBullets: [
      'Be prepared on the accountant’s official letterhead.',
      'Include the accountant’s full name, professional license number, issuing authority, business address, phone, email, signature, and official seal (if applicable).',
      'Certify that the accountant has reviewed the applicant’s financial records and tax filings.',
      'Summarize the applicant’s financial information for the two (2) most recent tax years.',
      'Present all figures in both the original local currency and their USD equivalent, identifying the exchange rate and date used.',
      'Include at minimum: gross annual income, net taxable income, estimated annual recurring income, total assets, total liabilities, net worth, and outstanding loans or significant financial obligations.',
      'Confirm that all taxes have been filed and are in good standing, if applicable.',
      'State whether, based on the records reviewed, the applicant appears financially capable of meeting the proposed housing obligations.',
      'Include a statement that the information was prepared from official financial records and is true and accurate to the best of the accountant’s knowledge.',
    ],
    translationLabel: 'Notarized English translation (if any document above is in a foreign language)',
    downloadCpaGuide: 'Download CPA requirements (PDF) — send this to your accountant',
    progressAllSet: 'All set — thank you.',
    progressMissing: 'Missing any? You can still submit — go back to the Documents step to add them, or PMI may follow up after you submit.',
    progressLabel: (n, total) => `International documents: ${n} of ${total} uploaded`,
    pdfTitle: 'CPA Financial Certification — Requirements',
    pdfFooter: 'PMI Top Florida Properties · Give this document to your accountant',
  },
  es: {
    sectionTitle: 'Documentos adicionales para solicitantes internacionales',
    hint: 'Suba los documentos a medida que estén disponibles — puede continuar y finalizar su solicitud antes de tener todos listos; PMI podría dar seguimiento si falta alguno.',
    policeClearanceLabel: 'Certificado de antecedentes penales / policiales del país de origen',
    cpaCertLabel: 'Certificación Financiera de Contador Público (CPA)',
    cpaDetailsToggle: '¿Qué debe incluir la Certificación Financiera del CPA?',
    cpaHeading: 'Requisito de Certificación Financiera para Solicitantes Internacionales',
    cpaIntroParagraphs: [
      'La verificación de antecedentes en línea es obligatoria para todos los solicitantes. Sin embargo, cuando un reporte de crédito, reporte financiero o declaración de impuestos de EE. UU. no esté disponible o esté incompleto porque el solicitante reside fuera de los Estados Unidos, el solicitante deberá presentar una Certificación Financiera preparada por un Contador Público Certificado (CPA), Contador Colegiado (CA), u otro profesional contable autorizado para ejercer en el país de residencia del solicitante.',
      'La Certificación Financiera debe proporcionar un resumen integral de la condición financiera del solicitante y demostrar su capacidad financiera para cumplir con las obligaciones asociadas a la compra o arrendamiento propuesto. Como mínimo, el informe debe incluir lo siguiente:',
    ],
    cpaBullets: [
      'Estar preparado en el membrete oficial del contador.',
      'Incluir el nombre completo del contador, número de licencia profesional, autoridad emisora, dirección comercial, teléfono, correo electrónico, firma y sello oficial (si aplica).',
      'Certificar que el contador revisó los registros financieros y declaraciones de impuestos del solicitante.',
      'Resumir la información financiera del solicitante de los dos (2) años fiscales más recientes.',
      'Presentar todas las cifras en la moneda local original y su equivalente en dólares estadounidenses (USD), indicando el tipo de cambio y la fecha utilizados.',
      'Incluir como mínimo: ingreso bruto anual, ingreso neto imponible, ingreso recurrente anual estimado, activos totales, pasivos totales, patrimonio neto, y préstamos u obligaciones financieras significativas pendientes.',
      'Confirmar que todos los impuestos han sido declarados y están al día, si corresponde.',
      'Indicar si, según los registros revisados, el solicitante parece financieramente capaz de cumplir con las obligaciones de vivienda propuestas.',
      'Incluir una declaración de que la información fue preparada a partir de registros financieros oficiales y es verdadera y precisa según el mejor conocimiento del contador.',
    ],
    translationLabel: 'Traducción al inglés notariada (si alguno de los documentos anteriores está en un idioma extranjero)',
    downloadCpaGuide: 'Descargar los requisitos para el CPA (PDF) — envíelo a su contador',
    progressAllSet: 'Todo listo — gracias.',
    progressMissing: '¿Falta alguno? Puede enviar la solicitud igualmente — regrese al paso de Documentos para agregarlos, o PMI podría dar seguimiento después de que envíe la solicitud.',
    progressLabel: (n, total) => `Documentos internacionales: ${n} de ${total} subidos`,
    pdfTitle: 'Certificación Financiera de CPA — Requisitos',
    pdfFooter: 'PMI Top Florida Properties · Entregue este documento a su contador',
  },
  pt: {
    sectionTitle: 'Documentos adicionais para candidatos internacionais',
    hint: 'Envie os documentos conforme forem ficando disponíveis — você pode continuar e finalizar sua solicitação antes que todos estejam prontos; a PMI pode entrar em contato caso falte algum.',
    policeClearanceLabel: 'Certidão de antecedentes criminais / policiais do país de origem',
    cpaCertLabel: 'Certificação Financeira de Contador (CPA)',
    cpaDetailsToggle: 'O que a Certificação Financeira do CPA deve incluir?',
    cpaHeading: 'Requisito de Certificação Financeira para Candidatos Internacionais',
    cpaIntroParagraphs: [
      'A verificação de antecedentes on-line é obrigatória para todos os candidatos. No entanto, quando um relatório de crédito, relatório financeiro ou declaração de imposto de renda dos EUA não estiver disponível ou estiver incompleto porque o candidato reside fora dos Estados Unidos, o candidato deverá apresentar uma Certificação Financeira preparada por um Contador Público Certificado (CPA), Contador Registrado (CA), ou outro profissional contábil licenciado autorizado a atuar no país de residência do candidato.',
      'A Certificação Financeira deve fornecer um resumo abrangente da condição financeira do candidato e demonstrar sua capacidade financeira de cumprir as obrigações associadas à compra ou locação proposta. No mínimo, o relatório deve incluir o seguinte:',
    ],
    cpaBullets: [
      'Ser preparado em papel timbrado oficial do contador.',
      'Incluir o nome completo do contador, número de licença profissional, órgão emissor, endereço comercial, telefone, e-mail, assinatura e selo oficial (se aplicável).',
      'Certificar que o contador revisou os registros financeiros e as declarações fiscais do candidato.',
      'Resumir as informações financeiras do candidato referentes aos dois (2) anos fiscais mais recentes.',
      'Apresentar todos os valores na moeda local original e seu equivalente em dólares americanos (USD), indicando a taxa de câmbio e a data utilizadas.',
      'Incluir, no mínimo: renda bruta anual, renda líquida tributável, renda recorrente anual estimada, ativos totais, passivos totais, patrimônio líquido e empréstimos ou obrigações financeiras significativas pendentes.',
      'Confirmar que todos os impostos foram declarados e estão em situação regular, quando aplicável.',
      'Declarar se, com base nos registros analisados, o candidato parece financeiramente capaz de cumprir as obrigações de moradia propostas.',
      'Incluir uma declaração de que as informações foram preparadas a partir de registros financeiros oficiais e são verdadeiras e precisas, segundo o melhor conhecimento do contador.',
    ],
    translationLabel: 'Tradução juramentada para o inglês (caso algum documento acima esteja em idioma estrangeiro)',
    downloadCpaGuide: 'Baixar os requisitos para o contador (PDF) — envie ao seu contador',
    progressAllSet: 'Tudo certo — obrigado.',
    progressMissing: 'Falta algum? Você ainda pode enviar a solicitação — volte à etapa de Documentos para adicioná-los, ou a PMI pode entrar em contato após o envio.',
    progressLabel: (n, total) => `Documentos internacionais: ${n} de ${total} enviados`,
    pdfTitle: 'Certificação Financeira de CPA — Requisitos',
    pdfFooter: 'PMI Top Florida Properties · Entregue este documento ao seu contador',
  },
  fr: {
    sectionTitle: 'Documents supplémentaires pour les candidats internationaux',
    hint: 'Téléchargez-les au fur et à mesure qu’ils sont disponibles — vous pouvez continuer et terminer votre demande avant que tous soient prêts; PMI pourra faire un suivi si un document manque encore.',
    policeClearanceLabel: 'Certificat de casier judiciaire / extrait de police du pays d’origine',
    cpaCertLabel: 'Certification Financière d’un Expert-Comptable (CPA)',
    cpaDetailsToggle: 'Que doit contenir la Certification Financière du CPA ?',
    cpaHeading: 'Exigence de Certification Financière pour les Candidats Internationaux',
    cpaIntroParagraphs: [
      'La vérification des antécédents en ligne est obligatoire pour tous les candidats. Toutefois, lorsqu’un rapport de crédit, un rapport financier ou une déclaration fiscale américaine n’est pas disponible ou est incomplet parce que le candidat réside en dehors des États-Unis, le candidat doit soumettre une Certification Financière préparée par un Certified Public Accountant (CPA), un Chartered Accountant (CA), ou un autre professionnel comptable agréé autorisé à exercer dans le pays de résidence du candidat.',
      'La Certification Financière doit fournir un résumé complet de la situation financière du candidat et démontrer sa capacité financière à honorer les obligations liées à l’achat ou à la location proposée. Le rapport doit inclure, au minimum, les éléments suivants :',
    ],
    cpaBullets: [
      'Être rédigé sur le papier à en-tête officiel du comptable.',
      'Inclure le nom complet du comptable, son numéro de licence professionnelle, l’autorité de délivrance, l’adresse professionnelle, le téléphone, l’e-mail, la signature et le sceau officiel (le cas échéant).',
      'Certifier que le comptable a examiné les dossiers financiers et les déclarations fiscales du candidat.',
      'Résumer la situation financière du candidat pour les deux (2) années fiscales les plus récentes.',
      'Présenter tous les montants dans la devise locale d’origine et leur équivalent en dollars américains (USD), en indiquant le taux de change et la date utilisés.',
      'Inclure au minimum : revenu brut annuel, revenu net imposable, revenu récurrent annuel estimé, actif total, passif total, valeur nette, et prêts ou obligations financières importantes en cours.',
      'Confirmer que tous les impôts ont été déclarés et sont à jour, le cas échéant.',
      'Indiquer si, sur la base des dossiers examinés, le candidat semble financièrement capable de faire face aux obligations de logement proposées.',
      'Inclure une déclaration attestant que les informations ont été préparées à partir de dossiers financiers officiels et sont exactes au meilleur de la connaissance du comptable.',
    ],
    translationLabel: 'Traduction anglaise certifiée (si l’un des documents ci-dessus est dans une langue étrangère)',
    downloadCpaGuide: 'Télécharger les exigences pour le comptable (PDF) — à transmettre à votre comptable',
    progressAllSet: 'Tout est prêt — merci.',
    progressMissing: 'Il en manque ? Vous pouvez quand même soumettre votre demande — retournez à l’étape Documents pour les ajouter, ou PMI pourra faire un suivi après votre soumission.',
    progressLabel: (n, total) => `Documents internationaux : ${n} sur ${total} téléchargés`,
    pdfTitle: 'Certification Financière du CPA — Exigences',
    pdfFooter: 'PMI Top Florida Properties · Remettez ce document à votre comptable',
  },
  ht: {
    sectionTitle: 'Dokiman adisyonèl pou aplikan entènasyonal',
    hint: 'Telechaje yo kòm yo vin disponib — ou ka kontinye epi fini aplikasyon ou anvan tout yo pare; PMI ka swiv ak ou si gen nan yo ki poko rive.',
    policeClearanceLabel: 'Sètifika lapolis oswa kazye jidisyè nan peyi orijin ou',
    cpaCertLabel: 'Sètifikasyon Finansye yon Kontab Sètifye (CPA)',
    cpaDetailsToggle: 'Kisa Sètifikasyon Finansye CPA a dwe genyen ladan l?',
    cpaHeading: 'Kondisyon Sètifikasyon Finansye pou Aplikan Entènasyonal',
    cpaIntroParagraphs: [
      'Verifikasyon istwa an liy lan obligatwa pou tout aplikan. Sepandan, lè yon rapò kredi, rapò finansye, oswa deklarasyon taks Ozetazini pa disponib oswa enkonplè paske aplikan an rezide andeyò Etazini, aplikan an dwe soumèt yon Sètifikasyon Finansye yon Kontab Piblik Sètifye (CPA), yon Kontab Agreye (CA), oswa yon lòt pwofesyonèl kontablite lisansye ki otorize pratike nan peyi kote aplikan an rezide a prepare.',
      'Sètifikasyon Finansye a dwe bay yon rezime konplè sou sitiyasyon finansye aplikan an epi demontre kapasite finansye aplikan an pou satisfè obligasyon ki asosye ak acha oswa lokasyon yo pwopoze a. Omwen, rapò a dwe enkli sa ki annapre yo:',
    ],
    cpaBullets: [
      'Prepare sou papye ofisyèl kontab la.',
      'Enkli non konplè kontab la, nimewo lisans pwofesyonèl li, otorite ki bay lisans lan, adrès biznis li, telefòn, imèl, siyati, ak so ofisyèl (si sa aplikab).',
      'Sètifye kontab la te egzamine dosye finansye ak deklarasyon taks aplikan an.',
      'Rezime enfòmasyon finansye aplikan an pou de (2) dènye ane fiskal yo.',
      'Prezante tout chif yo nan lajan lokal orijinal la ansanm ak ekivalan yo an dola Ameriken (USD), ak endike to echanj ak dat ki te itilize.',
      'Enkli omwen: revni brit anyèl, revni net taksab, revni rekiran anyèl estime, total byen, total dèt, valè nèt, ak prè oswa obligasyon finansye enpòtan ki poko peye.',
      'Konfime tout taks yo te deklare e yo an règ, si sa aplikab.',
      'Deklare si, dapre dosye yo te egzamine yo, aplikan an sanble kapab finansyèman satisfè obligasyon lojman yo pwopoze yo.',
      'Enkli yon deklarasyon ki di enfòmasyon yo te prepare apati dosye finansye ofisyèl e yo vre e egzat dapre pi bon konesans kontab la.',
    ],
    translationLabel: 'Tradiksyon angle notarye (si youn nan dokiman anwo yo nan yon lang etranje)',
    downloadCpaGuide: 'Telechaje egzijans pou kontab la (PDF) — voye l bay kontab ou',
    progressAllSet: 'Tout bagay pare — mèsi.',
    progressMissing: 'Gen ki manke? Ou kapab soumèt aplikasyon an kanmenm — retounen nan etap Dokiman yo pou ajoute yo, oswa PMI ka swiv ak ou apre ou soumèt li.',
    progressLabel: (n, total) => `Dokiman entènasyonal: ${n} sou ${total} telechaje`,
    pdfTitle: 'Sètifikasyon Finansye CPA — Egzijans',
    pdfFooter: 'PMI Top Florida Properties · Bay kontab ou dokiman sa a',
  },
  he: {
    sectionTitle: 'מסמכים נוספים למגישי בקשה בינלאומיים',
    hint: 'העלה את המסמכים ככל שהם זמינים — ניתן להמשיך ולסיים את הבקשה גם אם לא כולם מוכנים עדיין; PMI עשויה לפנות אליך אם משהו עדיין חסר.',
    policeClearanceLabel: 'תעודת יושר משטרתית / מרשם פלילי ממדינת המוצא',
    cpaCertLabel: 'אישור פיננסי מרואה חשבון (CPA)',
    cpaDetailsToggle: 'מה חייב לכלול האישור הפיננסי מרואה החשבון?',
    cpaHeading: 'דרישת אישור פיננסי למגישי בקשה בינלאומיים',
    cpaIntroParagraphs: [
      'בדיקת הרקע המקוונת היא חובה עבור כל המבקשים. עם זאת, כאשר דוח אשראי, דוח פיננסי או דוחות מס אמריקאים אינם זמינים או שאינם שלמים משום שהמבקש מתגורר מחוץ לארצות הברית, על המבקש להגיש אישור פיננסי שהוכן על ידי רואה חשבון מוסמך (CPA), רואה חשבון מורשה (CA), או בעל מקצוע חשבונאי מורשה אחר המוסמך לעסוק במקצוע במדינת מגוריו של המבקש.',
      'האישור הפיננסי חייב לספק סיכום מקיף של מצבו הפיננסי של המבקש ולהוכיח את יכולתו הפיננסית לעמוד בהתחייבויות הקשורות לרכישה או לשכירות המוצעת. לכל הפחות, הדוח חייב לכלול את הפרטים הבאים:',
    ],
    cpaBullets: [
      'להיות ערוך על נייר מכתבים רשמי של רואה החשבון.',
      'לכלול את שמו המלא של רואה החשבון, מספר רישיון מקצועי, הרשות המנפיקה, כתובת העסק, טלפון, דוא"ל, חתימה וחותמת רשמית (אם רלוונטי).',
      'לאשר שרואה החשבון בדק את הרשומות הפיננסיות ואת דוחות המס של המבקש.',
      'לסכם את המידע הפיננסי של המבקש עבור שנות המס האחרונות (2).',
      'להציג את כל הנתונים הן במטבע המקומי המקורי והן בשווי ערך בדולר אמריקאי (USD), תוך ציון שער החליפין והתאריך ששימשו לכך.',
      'לכלול לכל הפחות: הכנסה שנתית ברוטו, הכנסה חייבת נטו, הכנסה שנתית חוזרת משוערת, סך הנכסים, סך ההתחייבויות, שווי נקי, והלוואות או התחייבויות פיננסיות משמעותיות שטרם נפרעו.',
      'לאשר שכל המסים הוגשו והם תקינים, אם רלוונטי.',
      'לציין האם, בהתבסס על הרשומות שנבדקו, נראה שהמבקש מסוגל מבחינה כלכלית לעמוד בהתחייבויות הדיור המוצעות.',
      'לכלול הצהרה כי המידע הוכן מתוך רשומות פיננסיות רשמיות והוא נכון ומדויק למיטב ידיעתו של רואה החשבון.',
    ],
    translationLabel: 'תרגום לאנגלית מאושר נוטריונית (אם מסמך כלשהו לעיל אינו באנגלית)',
    downloadCpaGuide: 'הורד את הדרישות עבור רואה החשבון (PDF) — שלח זאת לרואה החשבון שלך',
    progressAllSet: 'הכול מוכן — תודה.',
    progressMissing: 'חסר משהו? עדיין ניתן להגיש את הבקשה — חזור לשלב המסמכים כדי להוסיף אותם, או ש-PMI עשויה לפנות אליך לאחר ההגשה.',
    progressLabel: (n, total) => `מסמכים בינלאומיים: ${n} מתוך ${total} הועלו`,
    pdfTitle: 'אישור פיננסי מרואה חשבון — דרישות',
    pdfFooter: 'PMI Top Florida Properties · מסור מסמך זה לרואה החשבון שלך',
  },
  ru: {
    sectionTitle: 'Дополнительные документы для иностранных заявителей',
    hint: 'Загружайте документы по мере готовности — вы можете продолжить и завершить заявку, даже если не все документы готовы; PMI может связаться с вами, если чего-то не хватает.',
    policeClearanceLabel: 'Справка об отсутствии судимости / полицейский сертификат из страны проживания или гражданства',
    cpaCertLabel: 'Финансовое заключение сертифицированного бухгалтера (CPA)',
    cpaDetailsToggle: 'Что должно быть включено в Финансовое заключение CPA?',
    cpaHeading: 'Требование о финансовом заключении для иностранных заявителей',
    cpaIntroParagraphs: [
      'Онлайн-проверка биографических данных обязательна для всех заявителей. Однако, если американский кредитный отчёт, финансовый отчёт или налоговые декларации недоступны или неполны из-за того, что заявитель проживает за пределами США, заявитель обязан предоставить Финансовое заключение, подготовленное сертифицированным бухгалтером (CPA), присяжным бухгалтером (CA) или другим лицензированным специалистом по бухгалтерскому учёту, имеющим право практиковать в стране проживания заявителя.',
      'Финансовое заключение должно содержать всесторонний обзор финансового положения заявителя и подтверждать его финансовую способность выполнять обязательства, связанные с предполагаемой покупкой или арендой. Как минимум, отчёт должен включать следующее:',
    ],
    cpaBullets: [
      'Быть подготовлен на официальном бланке бухгалтера.',
      'Содержать полное имя бухгалтера, номер профессиональной лицензии, выдавший орган, адрес организации, телефон, email, подпись и официальную печать (если применимо).',
      'Подтверждать, что бухгалтер проверил финансовые записи и налоговые декларации заявителя.',
      'Обобщать финансовую информацию заявителя за последние два (2) налоговых года.',
      'Представлять все суммы как в местной валюте, так и в эквиваленте в долларах США (USD), с указанием использованного обменного курса и даты.',
      'Включать как минимум: валовой годовой доход, чистый налогооблагаемый доход, оценочный годовой регулярный доход, общие активы, общие обязательства, чистую стоимость активов, а также непогашенные кредиты или значительные финансовые обязательства.',
      'Подтверждать, что все налоги поданы и не имеют задолженностей, если применимо.',
      'Указывать, способен ли заявитель, по данным проверенных документов, финансово выполнять предлагаемые обязательства по оплате жилья.',
      'Содержать заявление о том, что информация подготовлена на основе официальных финансовых документов и является достоверной и точной, насколько это известно бухгалтеру.',
    ],
    translationLabel: 'Нотариально заверенный перевод на английский (если какой-либо из документов выше составлен на иностранном языке)',
    downloadCpaGuide: 'Скачать требования для бухгалтера (PDF) — отправьте их своему бухгалтеру',
    progressAllSet: 'Всё готово — спасибо.',
    progressMissing: 'Чего-то не хватает? Вы всё равно можете отправить заявку — вернитесь к шагу «Документы», чтобы добавить их, или PMI свяжется с вами после подачи заявки.',
    progressLabel: (n, total) => `Международные документы: ${n} из ${total} загружено`,
    pdfTitle: 'Финансовое заключение CPA — Требования',
    pdfFooter: 'PMI Top Florida Properties · Передайте этот документ своему бухгалтеру',
  },
}
