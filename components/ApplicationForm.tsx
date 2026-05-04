"use client";

import { useState, useEffect, useCallback } from "react";
import SiteHeader from "@/components/SiteHeader";
import { loadStripe } from "@stripe/stripe-js";
import { createClient } from "@supabase/supabase-js";

// ── Supabase client — used only for Storage uploads (anon key) ────────────────
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ── Brand tokens — PMI Top Florida Properties ─────────────────────────────────
// primary black : #0d0d0d   orange : #f26a1b   surface : #fafaf9
// border        : #e5e7eb   muted  : #6b7280   green   : #1a6b3c

// ════════════════════════════════════════════════════════════════
// TRANSLATIONS  (EN · ES · PT · FR)
// ════════════════════════════════════════════════════════════════
const translations = {
  en: {
    title: "Resident Application",
    subtitle: "PMI Top Florida Properties",
    steps: ["Document", "Type", "Applicants", "Documents", "Payment"],
    selectAssociation: "Select Association",
    associationPlaceholder: "Choose your association…",
    loadingAssociations: "Loading associations…",
    applicantType: "Application Type",
    individual: "Individual",
    individualDesc: "Single applicant",
    couple: "Married Couple",
    coupleDesc: "Joint application with spouse",
    additionalResident: "Additional Resident",
    additionalResidentDesc: "Extra occupant on existing application",
    commercial: "Commercial Entity",
    commercialDesc: "Business / corporate applicant",
    marriageCertUpload: "Marriage Certificate",
    marriageCertNote: "Upload to qualify for couple rate ($150). Without it, each applicant is charged $100.",
    hasCert: "Yes — upload certificate",
    noCert: "No certificate — charge separately ($100 each)",
    applicant: "Applicant",
    firstName: "First Name",
    lastName: "Last Name",
    dob: "Date of Birth",
    email: "Email Address",
    phone: "Phone Number",
    currentAddress: "Current Address",
    ssn: "SSN (or Passport # for international applicants)",
    unitApplying: "Unit Applying For",
    moveInDate: "Move-In / Closing Date",
    entityName: "Entity Name (as listed in Sunbiz)",
    sunbizId: "Sunbiz Registration Number",
    principals: "Listed Principals",
    addPrincipal: "+ Add Principal",
    principalName: "Principal Name",
    principalDOB: "Date of Birth",
    documents: "Required Documents",
    govId: "Government-Issued ID",
    proofIncome: "Proof of Income",
    marriageCert: "Marriage Certificate",
    uploadFile: "Click to upload or drag & drop",
    uploadFormats: "PDF, JPG, PNG · max 10 MB",
    uploaded: "Uploaded",
    paymentSummary: "Payment Summary",
    payTotal: "Total Due",
    payOnline: "Pay Securely with Card",
    signature: "Consent & Authorization",
    signatureConsent: "I authorize PMI Top Florida Properties to conduct a background, credit, and eviction check on all applicants listed above. I certify that all information provided is accurate and complete.",
    iAgree: "I agree to the terms above",
    next: "Continue",
    back: "Back",
    submit: "Submit Application",
    priceBreakdown: "Price Breakdown",
    perApplicant: "per applicant",
    coupleRate: "Couple rate (with certificate)",
    applicationFee: "Application Fee",
    backgroundCheck: "Background Check (Applycheck)",
    yourMargin: "Processing Fee",
    addlResident: "Additional Resident",
    chooseLanguage: "Language",
    consentRequired: "Please agree to the terms to continue.",
    allFieldsRequired: "Please fill in all required fields.",
    selectType: "Please select an application type.",
    selectAssocPlaceholder: "Please select an association.",
    payingNote: "Redirecting to secure checkout…",
    uploadError: "Upload failed — please try again.",
    uploadLease: "Upload Your Lease or Purchase Agreement",
    uploadLeaseHint: "We'll read it to identify your property automatically — no dropdown needed.",
    reading: "Reading your document…",
    docFound: "Property Identified",
    assocUnknown: "Association not recognized — please contact us before applying.",
    confirmDetails: "Confirm & Continue",
    uploadAgain: "Upload a different document",
    verifyNote: "Verify these details match your document before continuing.",
    leaseRequired: "Please upload your lease or purchase agreement to continue.",
    parseError: "We couldn't read your document clearly. Please upload a higher-quality scan or photo and try again.",
    areYouMarried: "Are the above co-applicants a married couple?",
    yes: "Yes",
    no: "No",
    marriedCertWillBeRequired: "A marriage certificate will be required in the Documents step.",
    otherOccupants: "Other Occupants",
    otherOccupantsHint: "List all other people who will reside in the unit. Adults 18+ will receive an invitation to complete their screening.",
    occupantName: "Full Name",
    occupantAge: "Age",
    occupantEmail: "Email (18+ only)",
    addOccupant: "+ Add Occupant",
    sendInvite: "Send invitation to co-applicant",
    inviteSentLabel: "Invitation sent ✓",
    sendingInvite: "Sending…",
    rulesTitle: "Rules & Regulations",
    rulesConsent: "I have read and agree to abide by the Rules and Regulations of",
    rulesSignaturePlaceholder: "Type your full legal name to sign",
    rulesSignatureLabel: "Electronic Signature",
    rulesSignatureNote: "By typing your name above you are electronically signing this agreement.",
    rulesRequired: "Please sign the Rules & Regulations acknowledgment to continue.",
  },
  es: {
    title: "Solicitud de Residente",
    subtitle: "PMI Top Florida Properties",
    steps: ["Documento", "Tipo", "Solicitantes", "Documentos", "Pago"],
    selectAssociation: "Seleccionar Asociación",
    associationPlaceholder: "Elija su asociación…",
    loadingAssociations: "Cargando asociaciones…",
    applicantType: "Tipo de Solicitud",
    individual: "Individual",
    individualDesc: "Solicitante único",
    couple: "Pareja Casada",
    coupleDesc: "Solicitud conjunta con cónyuge",
    additionalResident: "Residente Adicional",
    additionalResidentDesc: "Ocupante adicional en solicitud existente",
    commercial: "Entidad Comercial",
    commercialDesc: "Empresa / solicitante corporativo",
    marriageCertUpload: "Certificado de Matrimonio",
    marriageCertNote: "Suba el certificado para la tarifa de pareja ($150). Sin él, cada solicitante paga $100.",
    hasCert: "Sí — subir certificado",
    noCert: "Sin certificado — cobrar por separado ($100 c/u)",
    applicant: "Solicitante",
    firstName: "Nombre",
    lastName: "Apellido",
    dob: "Fecha de Nacimiento",
    email: "Correo Electrónico",
    phone: "Teléfono",
    currentAddress: "Dirección Actual",
    ssn: "SSN (o # de Pasaporte para internacionales)",
    unitApplying: "Unidad Solicitada",
    moveInDate: "Fecha de Entrada / Cierre",
    entityName: "Nombre de Entidad (según Sunbiz)",
    sunbizId: "Número de Registro Sunbiz",
    principals: "Principales Listados",
    addPrincipal: "+ Agregar Principal",
    principalName: "Nombre del Principal",
    principalDOB: "Fecha de Nacimiento",
    documents: "Documentos Requeridos",
    govId: "Identificación Oficial",
    proofIncome: "Comprobante de Ingresos",
    marriageCert: "Certificado de Matrimonio",
    uploadFile: "Haga clic para subir o arrastre el archivo",
    uploadFormats: "PDF, JPG, PNG hasta 10 MB",
    uploaded: "Subido",
    paymentSummary: "Resumen de Pago",
    payTotal: "Total a Pagar",
    payOnline: "Pagar con Tarjeta",
    signature: "Consentimiento y Autorización",
    signatureConsent: "Autorizo a PMI Top Florida Properties a realizar verificación de antecedentes, crédito y desalojo. Certifico que toda la información es correcta.",
    iAgree: "Acepto los términos anteriores",
    next: "Continuar",
    back: "Atrás",
    submit: "Enviar Solicitud",
    priceBreakdown: "Desglose de Precio",
    perApplicant: "por solicitante",
    coupleRate: "Tarifa de pareja (con certificado)",
    applicationFee: "Tarifa de Solicitud",
    backgroundCheck: "Verificación (Applycheck)",
    yourMargin: "Cargo de Procesamiento",
    addlResident: "Residente Adicional",
    chooseLanguage: "Idioma",
    consentRequired: "Por favor acepte los términos para continuar.",
    allFieldsRequired: "Por favor complete todos los campos requeridos.",
    selectType: "Por favor seleccione un tipo de solicitud.",
    selectAssocPlaceholder: "Por favor seleccione una asociación.",
    payingNote: "Redirigiendo al pago seguro…",
    uploadError: "Error al subir — inténtelo de nuevo.",
    uploadLease: "Suba su Contrato de Arrendamiento o Compraventa",
    uploadLeaseHint: "Leeremos el documento para identificar su propiedad automáticamente.",
    reading: "Leyendo su documento…",
    docFound: "Propiedad Identificada",
    assocUnknown: "Asociación no reconocida — contáctenos antes de aplicar.",
    confirmDetails: "Confirmar y Continuar",
    uploadAgain: "Subir un documento diferente",
    verifyNote: "Verifique que estos datos coincidan con su contrato antes de continuar.",
    leaseRequired: "Por favor suba su contrato para continuar.",
    parseError: "No pudimos leer su documento claramente. Por favor suba una copia más nítida e inténtelo de nuevo.",
    areYouMarried: "¿Los co-solicitantes anteriores son un matrimonio?",
    yes: "Sí",
    no: "No",
    marriedCertWillBeRequired: "Se requerirá un certificado de matrimonio en el paso de Documentos.",
    otherOccupants: "Otros Ocupantes",
    otherOccupantsHint: "Liste todas las demás personas que residirán en la unidad. Los adultos de 18+ recibirán una invitación para completar su verificación.",
    occupantName: "Nombre Completo",
    occupantAge: "Edad",
    occupantEmail: "Correo (solo mayores de 18)",
    addOccupant: "+ Agregar Ocupante",
    sendInvite: "Enviar invitación al co-solicitante",
    inviteSentLabel: "Invitación enviada ✓",
    sendingInvite: "Enviando…",
    rulesTitle: "Reglamento",
    rulesConsent: "He leído y acepto cumplir con el Reglamento de",
    rulesSignaturePlaceholder: "Escriba su nombre legal completo para firmar",
    rulesSignatureLabel: "Firma Electrónica",
    rulesSignatureNote: "Al escribir su nombre, está firmando electrónicamente este acuerdo.",
    rulesRequired: "Por favor confirme que acepta el Reglamento para continuar.",
  },
  pt: {
    title: "Solicitação de Residente",
    subtitle: "PMI Top Florida Properties",
    steps: ["Documento", "Tipo", "Solicitantes", "Documentos", "Pagamento"],
    selectAssociation: "Selecionar Associação",
    associationPlaceholder: "Escolha sua associação…",
    loadingAssociations: "Carregando associações…",
    applicantType: "Tipo de Solicitação",
    individual: "Individual",
    individualDesc: "Solicitante único",
    couple: "Casal Casado",
    coupleDesc: "Solicitação conjunta com cônjuge",
    additionalResident: "Residente Adicional",
    additionalResidentDesc: "Ocupante extra em solicitação existente",
    commercial: "Entidade Comercial",
    commercialDesc: "Empresa / solicitante corporativo",
    marriageCertUpload: "Certidão de Casamento",
    marriageCertNote: "Envie a certidão para a tarifa de casal ($150). Sem ela, cada solicitante paga $100.",
    hasCert: "Sim — enviar certidão",
    noCert: "Sem certidão — cobrar separadamente ($100 cada)",
    applicant: "Solicitante",
    firstName: "Nome",
    lastName: "Sobrenome",
    dob: "Data de Nascimento",
    email: "E-mail",
    phone: "Telefone",
    currentAddress: "Endereço Atual",
    ssn: "SSN (ou nº do Passaporte para internacionais)",
    unitApplying: "Unidade Solicitada",
    moveInDate: "Data de Entrada / Fechamento",
    entityName: "Nome da Entidade (conforme Sunbiz)",
    sunbizId: "Número de Registro Sunbiz",
    principals: "Sócios Listados",
    addPrincipal: "+ Adicionar Sócio",
    principalName: "Nome do Sócio",
    principalDOB: "Data de Nascimento",
    documents: "Documentos Necessários",
    govId: "Documento de Identidade",
    proofIncome: "Comprovante de Renda",
    marriageCert: "Certidão de Casamento",
    uploadFile: "Clique para enviar ou arraste o arquivo",
    uploadFormats: "PDF, JPG, PNG até 10 MB",
    uploaded: "Enviado",
    paymentSummary: "Resumo do Pagamento",
    payTotal: "Total a Pagar",
    payOnline: "Pagar com Cartão",
    signature: "Consentimento e Autorização",
    signatureConsent: "Autorizo a PMI Top Florida Properties a realizar verificação de antecedentes, crédito e despejo. Certifico que todas as informações são verdadeiras.",
    iAgree: "Concordo com os termos acima",
    next: "Continuar",
    back: "Voltar",
    submit: "Enviar Solicitação",
    priceBreakdown: "Detalhamento de Preço",
    perApplicant: "por solicitante",
    coupleRate: "Tarifa de casal (com certidão)",
    applicationFee: "Taxa de Solicitação",
    backgroundCheck: "Verificação (Applycheck)",
    yourMargin: "Taxa de Processamento",
    addlResident: "Residente Adicional",
    chooseLanguage: "Idioma",
    consentRequired: "Por favor concorde com os termos para continuar.",
    allFieldsRequired: "Por favor preencha todos os campos obrigatórios.",
    selectType: "Por favor selecione um tipo de solicitação.",
    selectAssocPlaceholder: "Por favor selecione uma associação.",
    payingNote: "Redirecionando para pagamento seguro…",
    uploadError: "Falha no envio — tente novamente.",
    uploadLease: "Envie seu Contrato de Aluguel ou de Compra",
    uploadLeaseHint: "Vamos ler o documento para identificar sua propriedade automaticamente.",
    reading: "Lendo seu documento…",
    docFound: "Imóvel Identificado",
    assocUnknown: "Associação não reconhecida — entre em contato antes de solicitar.",
    confirmDetails: "Confirmar e Continuar",
    uploadAgain: "Enviar documento diferente",
    verifyNote: "Verifique se estes dados correspondem ao seu contrato antes de continuar.",
    leaseRequired: "Por favor envie seu contrato para continuar.",
    parseError: "Não conseguimos ler seu documento claramente. Por favor envie uma cópia mais nítida e tente novamente.",
    areYouMarried: "Os co-solicitantes acima são um casal casado?",
    yes: "Sim",
    no: "Não",
    marriedCertWillBeRequired: "Uma certidão de casamento será exigida na etapa de Documentos.",
    otherOccupants: "Outros Ocupantes",
    otherOccupantsHint: "Liste todas as outras pessoas que residirão na unidade. Adultos de 18+ receberão um convite para concluir sua verificação.",
    occupantName: "Nome Completo",
    occupantAge: "Idade",
    occupantEmail: "E-mail (somente maiores de 18)",
    addOccupant: "+ Adicionar Ocupante",
    sendInvite: "Enviar convite ao co-solicitante",
    inviteSentLabel: "Convite enviado ✓",
    sendingInvite: "Enviando…",
    rulesTitle: "Regulamento",
    rulesConsent: "Eu li e concordo em cumprir o Regulamento de",
    rulesSignaturePlaceholder: "Digite seu nome legal completo para assinar",
    rulesSignatureLabel: "Assinatura Eletrônica",
    rulesSignatureNote: "Ao digitar seu nome, você está assinando eletronicamente este acordo.",
    rulesRequired: "Por favor confirme que concorda com o Regulamento para continuar.",
  },
  fr: {
    title: "Demande de Résidence",
    subtitle: "PMI Top Florida Properties",
    steps: ["Document", "Type", "Demandeurs", "Documents", "Paiement"],
    selectAssociation: "Sélectionner l'Association",
    associationPlaceholder: "Choisissez votre association…",
    loadingAssociations: "Chargement des associations…",
    applicantType: "Type de Demande",
    individual: "Individuel",
    individualDesc: "Demandeur unique",
    couple: "Couple Marié",
    coupleDesc: "Demande conjointe avec conjoint(e)",
    additionalResident: "Résident Supplémentaire",
    additionalResidentDesc: "Occupant supplémentaire sur demande existante",
    commercial: "Entité Commerciale",
    commercialDesc: "Entreprise / demandeur corporatif",
    marriageCertUpload: "Certificat de Mariage",
    marriageCertNote: "Téléchargez le certificat pour le tarif couple ($150). Sans lui, chaque demandeur paie $100.",
    hasCert: "Oui — télécharger le certificat",
    noCert: "Pas de certificat — facturer séparément ($100 chacun)",
    applicant: "Demandeur",
    firstName: "Prénom",
    lastName: "Nom de famille",
    dob: "Date de Naissance",
    email: "Adresse e-mail",
    phone: "Téléphone",
    currentAddress: "Adresse Actuelle",
    ssn: "SSN (ou # de Passeport pour internationaux)",
    unitApplying: "Unité Demandée",
    moveInDate: "Date d'Emménagement / Clôture",
    entityName: "Nom de l'Entité (selon Sunbiz)",
    sunbizId: "Numéro d'Enregistrement Sunbiz",
    principals: "Dirigeants Listés",
    addPrincipal: "+ Ajouter un Dirigeant",
    principalName: "Nom du Dirigeant",
    principalDOB: "Date de Naissance",
    documents: "Documents Requis",
    govId: "Pièce d'Identité Officielle",
    proofIncome: "Justificatif de Revenus",
    marriageCert: "Certificat de Mariage",
    uploadFile: "Cliquez pour télécharger ou glissez le fichier",
    uploadFormats: "PDF, JPG, PNG jusqu'à 10 Mo",
    uploaded: "Téléchargé",
    paymentSummary: "Récapitulatif du Paiement",
    payTotal: "Total à Payer",
    payOnline: "Payer par Carte",
    signature: "Consentement et Autorisation",
    signatureConsent: "J'autorise PMI Top Florida Properties à effectuer une vérification des antécédents, du crédit et des expulsions. Je certifie que toutes les informations fournies sont exactes.",
    iAgree: "J'accepte les conditions ci-dessus",
    next: "Continuer",
    back: "Retour",
    submit: "Soumettre la Demande",
    priceBreakdown: "Détail du Prix",
    perApplicant: "par demandeur",
    coupleRate: "Tarif couple (avec certificat)",
    applicationFee: "Frais de Dossier",
    backgroundCheck: "Vérification (Applycheck)",
    yourMargin: "Frais de Traitement",
    addlResident: "Résident Supplémentaire",
    chooseLanguage: "Langue",
    consentRequired: "Veuillez accepter les conditions pour continuer.",
    allFieldsRequired: "Veuillez remplir tous les champs obligatoires.",
    selectType: "Veuillez sélectionner un type de demande.",
    selectAssocPlaceholder: "Veuillez sélectionner une association.",
    payingNote: "Redirection vers le paiement sécurisé…",
    uploadError: "Échec du téléchargement — veuillez réessayer.",
    uploadLease: "Téléchargez votre Bail ou Acte de Vente",
    uploadLeaseHint: "Nous lirons le document pour identifier votre bien automatiquement.",
    reading: "Lecture de votre document…",
    docFound: "Bien Identifié",
    assocUnknown: "Association non reconnue — contactez-nous avant de postuler.",
    confirmDetails: "Confirmer et Continuer",
    uploadAgain: "Télécharger un autre document",
    verifyNote: "Vérifiez que ces informations correspondent à votre document avant de continuer.",
    leaseRequired: "Veuillez télécharger votre bail pour continuer.",
    parseError: "Nous n'avons pas pu lire votre document clairement. Veuillez télécharger une copie plus nette et réessayer.",
    areYouMarried: "Les co-demandeurs ci-dessus sont-ils un couple marié ?",
    yes: "Oui",
    no: "Non",
    marriedCertWillBeRequired: "Un certificat de mariage sera requis à l'étape Documents.",
    otherOccupants: "Autres Occupants",
    otherOccupantsHint: "Listez toutes les autres personnes qui résideront dans l'unité. Les adultes de 18+ recevront une invitation à compléter leur vérification.",
    occupantName: "Nom Complet",
    occupantAge: "Âge",
    occupantEmail: "E-mail (18+ seulement)",
    addOccupant: "+ Ajouter un Occupant",
    sendInvite: "Envoyer une invitation au co-demandeur",
    inviteSentLabel: "Invitation envoyée ✓",
    sendingInvite: "Envoi en cours…",
    rulesTitle: "Règlement Intérieur",
    rulesConsent: "J'ai lu et j'accepte de respecter le Règlement Intérieur de",
    rulesSignaturePlaceholder: "Tapez votre nom légal complet pour signer",
    rulesSignatureLabel: "Signature Électronique",
    rulesSignatureNote: "En tapant votre nom, vous signez électroniquement cet accord.",
    rulesRequired: "Veuillez confirmer votre accord avec le Règlement Intérieur pour continuer.",
  },
  he: {
    title: "בקשת מגורים",
    subtitle: "PMI Top Florida Properties",
    steps: ["מסמך", "סוג", "מגישים", "מסמכים", "תשלום"],
    selectAssociation: "בחר עמותה",
    associationPlaceholder: "בחר את העמותה שלך…",
    loadingAssociations: "טוען עמותות…",
    applicantType: "סוג בקשה",
    individual: "יחיד",
    individualDesc: "מגיש יחיד",
    couple: "זוג נשוי",
    coupleDesc: "בקשה משותפת עם בן/בת הזוג",
    additionalResident: "דייר נוסף",
    additionalResidentDesc: "דייר נוסף על בקשה קיימת",
    commercial: "ישות מסחרית",
    commercialDesc: "עסק / מגיש תאגידי",
    marriageCertUpload: "תעודת נישואין",
    marriageCertNote: "העלה תעודת נישואין לתעריף זוגי ($150). ללא תעודה, כל מגיש ישלם $100.",
    hasCert: "כן — העלה תעודה",
    noCert: "ללא תעודה — חיוב נפרד ($100 לכל אחד)",
    applicant: "מגיש",
    firstName: "שם פרטי",
    lastName: "שם משפחה",
    dob: "תאריך לידה",
    email: "כתובת אימייל",
    phone: "מספר טלפון",
    currentAddress: "כתובת נוכחית",
    ssn: "מספר ביטוח לאומי (או מספר דרכון למגישים בינלאומיים)",
    unitApplying: "יחידה מבוקשת",
    moveInDate: "תאריך כניסה / סגירה",
    entityName: "שם הישות (כפי שמופיע ב-Sunbiz)",
    sunbizId: "מספר רישום Sunbiz",
    principals: "בעלי עניין רשומים",
    addPrincipal: "+ הוסף בעל עניין",
    principalName: "שם בעל עניין",
    principalDOB: "תאריך לידה",
    documents: "מסמכים נדרשים",
    govId: "תעודת זהות ממשלתית",
    proofIncome: "אישור הכנסה",
    marriageCert: "תעודת נישואין",
    uploadFile: "לחץ להעלאה או גרור קובץ",
    uploadFormats: "PDF, JPG, PNG · עד 10 MB",
    uploaded: "הועלה",
    paymentSummary: "סיכום תשלום",
    payTotal: "סה״כ לתשלום",
    payOnline: "שלם בכרטיס אשראי",
    signature: "הסכמה והרשאה",
    signatureConsent: "אני מסמיך את PMI Top Florida Properties לבצע בדיקת רקע, אשראי ופינוי עבור כל המגישים הרשומים לעיל. אני מאשר שכל המידע שמסרתי מדויק ומלא.",
    iAgree: "אני מסכים לתנאים לעיל",
    next: "המשך",
    back: "חזרה",
    submit: "שלח בקשה",
    priceBreakdown: "פירוט מחיר",
    perApplicant: "למגיש",
    coupleRate: "תעריף זוגי (עם תעודה)",
    applicationFee: "דמי בקשה",
    backgroundCheck: "בדיקת רקע (Applycheck)",
    yourMargin: "דמי עיבוד",
    addlResident: "דייר נוסף",
    chooseLanguage: "שפה",
    consentRequired: "אנא הסכם לתנאים כדי להמשיך.",
    allFieldsRequired: "אנא מלא את כל השדות הנדרשים.",
    selectType: "אנא בחר סוג בקשה.",
    selectAssocPlaceholder: "אנא בחר עמותה.",
    payingNote: "מעביר לתשלום מאובטח…",
    uploadError: "ההעלאה נכשלה — נסה שוב.",
    uploadLease: "העלה חוזה שכירות או הסכם רכישה",
    uploadLeaseHint: "נקרא את המסמך ונזהה את הנכס שלך אוטומטית.",
    reading: "קורא את המסמך שלך…",
    docFound: "נכס זוהה",
    assocUnknown: "העמותה לא זוהתה — צור קשר לפני הגשת הבקשה.",
    confirmDetails: "אשר והמשך",
    uploadAgain: "העלה מסמך אחר",
    verifyNote: "ודא שפרטים אלה תואמים את המסמך שלך לפני המשך.",
    leaseRequired: "אנא העלה את החוזה כדי להמשיך.",
    parseError: "לא הצלחנו לקרוא את המסמך בבירור. אנא העלה עותק ברור יותר ונסה שוב.",
    areYouMarried: "האם המגישים המשותפים לעיל הם זוג נשוי?",
    yes: "כן",
    no: "לא",
    marriedCertWillBeRequired: "תעודת נישואין תידרש בשלב המסמכים.",
    otherOccupants: "דיירים נוספים",
    otherOccupantsHint: "רשום את כל שאר האנשים שיגורו ביחידה. מבוגרים מעל 18 יקבלו הזמנה להשלים את הבדיקה שלהם.",
    occupantName: "שם מלא",
    occupantAge: "גיל",
    occupantEmail: "אימייל (מעל 18 בלבד)",
    addOccupant: "+ הוסף דייר",
    sendInvite: "שלח הזמנה למגיש המשותף",
    inviteSentLabel: "הזמנה נשלחה ✓",
    sendingInvite: "שולח…",
    rulesTitle: "תקנון ותקנות",
    rulesConsent: "קראתי ואני מסכים לציית לתקנון ולתקנות של",
    rulesSignaturePlaceholder: "הקלד את שמך המשפטי המלא כדי לחתום",
    rulesSignatureLabel: "חתימה אלקטרונית",
    rulesSignatureNote: "על ידי הקלדת שמך, אתה חותם אלקטרונית על הסכם זה.",
    rulesRequired: "אנא אשר הסכמתך לתקנון כדי להמשיך.",
  },
  ru: {
    title: "Заявка на проживание",
    subtitle: "PMI Top Florida Properties",
    steps: ["Документ", "Тип", "Заявители", "Документы", "Оплата"],
    selectAssociation: "Выбрать ассоциацию",
    associationPlaceholder: "Выберите вашу ассоциацию…",
    loadingAssociations: "Загрузка ассоциаций…",
    applicantType: "Тип заявки",
    individual: "Индивидуальная",
    individualDesc: "Один заявитель",
    couple: "Семейная пара",
    coupleDesc: "Совместная заявка с супругом/супругой",
    additionalResident: "Дополнительный жилец",
    additionalResidentDesc: "Дополнительный жилец по существующей заявке",
    commercial: "Юридическое лицо",
    commercialDesc: "Компания / корпоративный заявитель",
    marriageCertUpload: "Свидетельство о браке",
    marriageCertNote: "Загрузите свидетельство для семейного тарифа ($150). Без него каждый заявитель платит $100.",
    hasCert: "Да — загрузить свидетельство",
    noCert: "Без свидетельства — оплата раздельно ($100 каждый)",
    applicant: "Заявитель",
    firstName: "Имя",
    lastName: "Фамилия",
    dob: "Дата рождения",
    email: "Электронная почта",
    phone: "Номер телефона",
    currentAddress: "Текущий адрес",
    ssn: "SSN (или номер паспорта для иностранных заявителей)",
    unitApplying: "Запрашиваемый юнит",
    moveInDate: "Дата въезда / закрытия",
    entityName: "Название организации (по данным Sunbiz)",
    sunbizId: "Регистрационный номер Sunbiz",
    principals: "Зарегистрированные руководители",
    addPrincipal: "+ Добавить руководителя",
    principalName: "Имя руководителя",
    principalDOB: "Дата рождения",
    documents: "Необходимые документы",
    govId: "Удостоверение личности",
    proofIncome: "Подтверждение дохода",
    marriageCert: "Свидетельство о браке",
    uploadFile: "Нажмите для загрузки или перетащите файл",
    uploadFormats: "PDF, JPG, PNG · до 10 МБ",
    uploaded: "Загружено",
    paymentSummary: "Итог по оплате",
    payTotal: "Итого к оплате",
    payOnline: "Оплатить картой",
    signature: "Согласие и авторизация",
    signatureConsent: "Я разрешаю PMI Top Florida Properties провести проверку биографии, кредитной истории и истории выселений для всех указанных заявителей. Я подтверждаю точность и полноту предоставленных данных.",
    iAgree: "Я согласен с указанными условиями",
    next: "Продолжить",
    back: "Назад",
    submit: "Отправить заявку",
    priceBreakdown: "Детализация стоимости",
    perApplicant: "за заявителя",
    coupleRate: "Семейный тариф (со свидетельством)",
    applicationFee: "Взнос за заявку",
    backgroundCheck: "Проверка биографии (Applycheck)",
    yourMargin: "Сбор за обработку",
    addlResident: "Дополнительный жилец",
    chooseLanguage: "Язык",
    consentRequired: "Пожалуйста, примите условия для продолжения.",
    allFieldsRequired: "Пожалуйста, заполните все обязательные поля.",
    selectType: "Пожалуйста, выберите тип заявки.",
    selectAssocPlaceholder: "Пожалуйста, выберите ассоциацию.",
    payingNote: "Переход к безопасной оплате…",
    uploadError: "Ошибка загрузки — попробуйте ещё раз.",
    uploadLease: "Загрузите договор аренды или купли-продажи",
    uploadLeaseHint: "Мы прочитаем документ и автоматически определим вашу недвижимость.",
    reading: "Читаем ваш документ…",
    docFound: "Объект найден",
    assocUnknown: "Ассоциация не распознана — свяжитесь с нами перед подачей заявки.",
    confirmDetails: "Подтвердить и продолжить",
    uploadAgain: "Загрузить другой документ",
    verifyNote: "Убедитесь, что эти данные соответствуют вашему документу, прежде чем продолжить.",
    leaseRequired: "Пожалуйста, загрузите договор для продолжения.",
    parseError: "Нам не удалось прочитать ваш документ. Пожалуйста, загрузите более чёткую копию и попробуйте снова.",
    areYouMarried: "Являются ли указанные со-заявители супружеской парой?",
    yes: "Да",
    no: "Нет",
    marriedCertWillBeRequired: "Свидетельство о браке потребуется на шаге Документы.",
    otherOccupants: "Другие жильцы",
    otherOccupantsHint: "Перечислите всех других людей, которые будут проживать в квартире. Взрослые 18+ получат приглашение пройти проверку.",
    occupantName: "Полное имя",
    occupantAge: "Возраст",
    occupantEmail: "Электронная почта (только для 18+)",
    addOccupant: "+ Добавить жильца",
    sendInvite: "Отправить приглашение со-заявителю",
    inviteSentLabel: "Приглашение отправлено ✓",
    sendingInvite: "Отправка…",
    rulesTitle: "Правила и нормы",
    rulesConsent: "Я прочитал и согласен соблюдать Правила и нормы",
    rulesSignaturePlaceholder: "Введите ваше полное юридическое имя для подписи",
    rulesSignatureLabel: "Электронная подпись",
    rulesSignatureNote: "Вводя своё имя, вы электронно подписываете это соглашение.",
    rulesRequired: "Пожалуйста, подтвердите согласие с Правилами и нормами для продолжения.",
  },
};

const flags     = { en: "🇺🇸", es: "🇪🇸", pt: "🇧🇷", fr: "🇫🇷", he: "🇮🇱", ru: "🇷🇺" };
const langNames = { en: "English", es: "Español", pt: "Português", fr: "Français", he: "עברית", ru: "Русский" };

// ── Stripe singleton ──────────────────────────────────────────────────────────
let stripePromise: ReturnType<typeof loadStripe> | null = null;
const getStripe = () => {
  if (!stripePromise)
    stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);
  return stripePromise;
};

// ════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ════════════════════════════════════════════════════════════════

type UploadBoxProps = {
  label: string;
  t: typeof translations.en;
  onUpload: (file: File) => void;
  uploaded: File | null;
  uploading: boolean;
};
function UploadBox({ label, t, onUpload, uploaded, uploading }: UploadBoxProps) {
  const [dragging, setDragging] = useState(false);
  const uid = `file-${label.replace(/\s+/g, "-")}`;
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#0d0d0d", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "var(--font-mono, monospace)" }}>
        {label}
      </div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files[0]) onUpload(e.dataTransfer.files[0]); }}
        onClick={() => (document.getElementById(uid) as HTMLInputElement | null)?.click()}
        style={{
          border: `1.5px dashed ${dragging ? "#f26a1b" : uploaded ? "#1a6b3c" : "#e5e7eb"}`,
          borderRadius: 4,
          padding: "20px 16px",
          textAlign: "center",
          cursor: uploading ? "wait" : "pointer",
          background: uploaded ? "#f0fdf4" : dragging ? "#fff7f0" : "#fafaf9",
          transition: "all 0.18s",
          opacity: uploading ? 0.7 : 1,
        }}
      >
        <input id={uid} type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: "none" }}
          onChange={(e) => { if (e.target.files?.[0]) onUpload(e.target.files[0]); }} />
        {uploading ? (
          <div style={{ color: "#f26a1b", fontSize: 13 }}>Uploading…</div>
        ) : uploaded ? (
          <div style={{ color: "#1a6b3c", fontWeight: 600, fontSize: 13 }}>
            ✓ {t.uploaded}: <span style={{ fontWeight: 400 }}>{uploaded.name}</span>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 26, marginBottom: 6 }}>📎</div>
            <div style={{ fontSize: 13, color: "#6b7280", fontWeight: 500 }}>{t.uploadFile}</div>
            <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>{t.uploadFormats}</div>
          </>
        )}
      </div>
    </div>
  );
}

type ApplicantFieldsProps = {
  index: number;
  t: typeof translations.en;
  data: Record<string, string>;
  onChange: (idx: number, key: string, val: string) => void;
  units: string[];
};
function ApplicantFields({ index, t, data, onChange, units }: ApplicantFieldsProps) {
  const [unitOpen, setUnitOpen] = useState(false);
  const fields = [
    { key: "firstName",      label: t.firstName,      type: "text"  },
    { key: "lastName",       label: t.lastName,       type: "text"  },
    { key: "dob",            label: t.dob,            type: "date"  },
    { key: "email",          label: t.email,          type: "email" },
    { key: "phone",          label: t.phone,          type: "tel"   },
    { key: "ssn",            label: t.ssn,            type: "text"  },
    { key: "currentAddress", label: t.currentAddress, type: "text"  },
    { key: "moveInDate",     label: t.moveInDate,     type: "date"  },
  ];
  const full = new Set(["currentAddress", "ssn"]);
  const inp = { width: "100%", boxSizing: "border-box" as const, padding: "9px 11px", borderRadius: 3, border: "1px solid #e5e7eb", fontSize: 14, color: "#0d0d0d", background: "#fff", outline: "none", fontFamily: "inherit", transition: "border-color 0.15s" };
  const unitVal = data.unitApplying || "";
  const filteredUnits = unitVal.trim().length === 0
    ? units
    : units.filter((u) => u.toLowerCase().includes(unitVal.toLowerCase()));

  return (
    <div style={{ background: "#fafaf9", borderRadius: 4, padding: 20, marginBottom: 14, border: "1px solid #e5e7eb" }}>
      {index > 0 && (
        <div style={{ fontSize: 11, fontWeight: 600, color: "#f26a1b", marginBottom: 14, textTransform: "uppercase", letterSpacing: "0.12em", fontFamily: "monospace" }}>
          {t.applicant} {index + 1}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 16px" }}>
        {fields.map(({ key, label, type }) => (
          <div key={key} style={{ gridColumn: full.has(key) ? "1 / -1" : "auto" }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label} *</label>
            <input
              type={type}
              value={data[key] || ""}
              onChange={(e) => onChange(index, key, e.target.value)}
              style={inp}
              onFocus={(e) => (e.target.style.borderColor = "#f26a1b")}
              onBlur={(e)  => (e.target.style.borderColor = "#e5e7eb")}
            />
          </div>
        ))}

        {/* Unit number — combobox against known units if available */}
        <div style={{ gridColumn: "auto" }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {t.unitApplying} *
          </label>
          <div style={{ position: "relative" }}>
            <input
              type="text"
              value={unitVal}
              autoComplete="off"
              onChange={(e) => { onChange(index, "unitApplying", e.target.value); setUnitOpen(true); }}
              onFocus={(e) => { setUnitOpen(true); e.target.style.borderColor = "#f26a1b"; }}
              onBlur={(e) => { setTimeout(() => setUnitOpen(false), 160); e.target.style.borderColor = unitVal && units.includes(unitVal) ? "#1a6b3c" : "#e5e7eb"; }}
              style={{ ...inp, borderColor: unitVal && units.length > 0 && units.includes(unitVal) ? "#1a6b3c" : "#e5e7eb" }}
            />
            {/* Confirmed indicator */}
            {unitVal && units.length > 0 && units.includes(unitVal) && (
              <span style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", color: "#1a6b3c", fontSize: 13 }}>✓</span>
            )}
            {/* Dropdown — only shown when units are known */}
            {unitOpen && units.length > 0 && filteredUnits.length > 0 && (
              <div style={{ position: "absolute", top: "calc(100% + 3px)", left: 0, right: 0, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 4, boxShadow: "0 6px 20px rgba(0,0,0,0.1)", zIndex: 50, maxHeight: 180, overflowY: "auto" }}>
                {filteredUnits.map((u) => (
                  <div
                    key={u}
                    onMouseDown={() => { onChange(index, "unitApplying", u); setUnitOpen(false); }}
                    style={{ padding: "8px 12px", fontSize: 13, cursor: "pointer", color: "#0d0d0d" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#fff7f0")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    Unit {u}
                  </div>
                ))}
              </div>
            )}
            {/* Warn if value typed doesn't match any known unit */}
            {unitVal && units.length > 0 && !units.includes(unitVal) && (
              <div style={{ marginTop: 4, fontSize: 11, color: "#d97706" }}>
                ⚠ Unit not found in this association — double-check the number
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ════════════════════════════════════════════════════════════════
export default function ApplicationForm({ preselectedAssociation = null }) {
  const [lang, setLang]               = useState("en");
  const t                             = translations[lang as keyof typeof translations];
  const [step, setStep]               = useState(0);
  const [association, setAssociation] = useState(preselectedAssociation || "");
  const [assocCode, setAssocCode]     = useState("");
  const [assocUnits, setAssocUnits]   = useState<string[]>([]);
  // Lease upload state
  type LeaseData = {
    extracted: { association: string | null; address: string | null; unit: string | null; moveIn: string | null; tenants: string[] };
    matched: { code: string; name: string; address: string } | null;
    storagePath: string;
  };
  const [leaseUploading, setLeaseUploading] = useState(false);
  const [leaseData, setLeaseData]     = useState<LeaseData | null>(null);
  const [leaseConfirmed, setLeaseConfirmed] = useState(!!preselectedAssociation);
  const [leaseParseError, setLeaseParseError] = useState("");
  const [rulesSections, setRulesSections] = useState<string[]>([]);
  const [appType, setAppType]         = useState("");
  const [coupleOption, setCoupleOption] = useState("");
  const [applicants, setApplicants]   = useState<Record<string, string>[]>([{}]);
  const [principals, setPrincipals]   = useState([{ name: "", dob: "" }]);
  const [sunbizId, setSunbizId]       = useState("");
  const [entityName, setEntityName]   = useState("");
  const [docs, setDocs]               = useState({ govId: null, proofIncome: null, marriageCert: null });
  const [docUrls, setDocUrls]         = useState({ govId: null, proofIncome: null, marriageCert: null });
  const [uploading, setUploading]     = useState({ govId: false, proofIncome: false, marriageCert: false });
  const [agreed, setAgreed]           = useState(false);
  const [error, setError]             = useState("");
  const [paying, setPaying]           = useState(false);
  const [langOpen, setLangOpen]       = useState(false);
  const [applicationId, setApplicationId] = useState(null);
  const [isMarriedCouple, setIsMarriedCouple] = useState<boolean | null>(null);
  const [occupants, setOccupants] = useState<{name: string; age: string; email: string}[]>([]);
  const [rulesAgreed, setRulesAgreed] = useState(false);
  const [rulesSignature, setRulesSignature] = useState("");
  const [inviteSent, setInviteSent] = useState(false);
  const [inviteSending, setInviteSending] = useState(false);

  const isCouple     = appType === "couple";
  const hasCert      = coupleOption === "yes";
  const isCommercial = appType === "commercial";

  // ── Upload lease to parse-lease API ──────────────────────────────────────
  const handleLeaseUpload = async (file: File) => {
    setLeaseParseError("");
    setLeaseData(null);
    setLeaseUploading(true);
    try {
      const fd = new FormData();
      fd.append("lease", file);
      const res = await fetch("/api/apply/parse-lease", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) {
        setLeaseParseError(json.error ?? t.parseError);
        return;
      }
      setLeaseData(json as LeaseData);
    } catch {
      setLeaseParseError(t.parseError);
    } finally {
      setLeaseUploading(false);
    }
  };

  // ── Confirm lease data and pre-populate form ──────────────────────────────
  const confirmLease = () => {
    if (!leaseData) return;
    const name = leaseData.matched?.name ?? leaseData.extracted.association ?? "";
    const code = leaseData.matched?.code ?? "";
    setAssociation(name);
    setAssocCode(code);
    setLeaseConfirmed(true);
    // Pre-populate unit + move-in on first applicant
    const unit    = leaseData.extracted.unit ?? "";
    const moveIn  = leaseData.extracted.moveIn ?? "";
    setApplicants((prev) => {
      const n = [...prev];
      n[0] = { ...n[0], unitApplying: unit, moveInDate: moveIn };
      // Pre-populate tenant names if available
      if (leaseData.extracted.tenants.length > 0) {
        const parts = leaseData.extracted.tenants[0].trim().split(/\s+/);
        n[0] = { ...n[0], firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
        if (leaseData.extracted.tenants[1]) {
          const p2 = leaseData.extracted.tenants[1].trim().split(/\s+/);
          n[1] = { ...(n[1] ?? {}), firstName: p2[0] ?? "", lastName: p2.slice(1).join(" ") };
        }
      }
      return n;
    });
    // Fetch units for the selected association for validation
    if (code) {
      fetch(`/api/associations/units?code=${encodeURIComponent(code)}`)
        .then((r) => r.json())
        .then((units: string[]) => setAssocUnits(units))
        .catch(() => setAssocUnits([]));
      fetch(`/api/apply/association-rules?code=${encodeURIComponent(code)}`)
        .then((r) => r.json())
        .then(({ sections }: { sections: string[] }) => setRulesSections(sections))
        .catch(() => setRulesSections([]));
    }
    // Auto-select application type based on number of tenants on lease
    if (leaseData.extracted.tenants.length >= 2) {
      setAppType("couple");
      setApplicants((prev) => prev.length < 2 ? [...prev, {}] : prev);
    } else if (leaseData.extracted.tenants.length === 1 && !appType) {
      setAppType("individual");
    }
    setStep(1);
  };

  // ── Pricing ────────────────────────────────────────────────────────────────
  const calcTotal = () => {
    if (appType === "individual")       return 100;
    if (appType === "couple")           return hasCert ? 150 : 200;
    if (appType === "additionalResident") return 100;
    if (appType === "commercial")       return principals.length * 100;
    return 0;
  };
  const total = calcTotal();

  const updateApplicant = (idx: number, key: string, val: string) =>
    setApplicants((prev) => { const n = [...prev]; n[idx] = { ...n[idx], [key]: val }; return n; });

  const updatePrincipal = (idx: number, key: string, val: string) =>
    setPrincipals((prev) => { const n = [...prev]; n[idx] = { ...n[idx], [key]: val }; return n; });

  const updateOccupant = (idx: number, key: string, val: string) =>
    setOccupants((prev) => { const n = [...prev]; n[idx] = { ...n[idx], [key]: val }; return n; });

  const sendCoApplicantInvite = async () => {
    if (!applicants[1]?.email) return;
    setInviteSending(true);
    try {
      await fetch("/api/apply/invite-coapplicant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          primaryName: `${applicants[0]?.firstName ?? ""} ${applicants[0]?.lastName ?? ""}`.trim(),
          coApplicantName: `${applicants[1]?.firstName ?? ""} ${applicants[1]?.lastName ?? ""}`.trim(),
          coApplicantEmail: applicants[1].email,
          association: leaseData?.matched?.name ?? association,
          applicationId,
        }),
      });
      setInviteSent(true);
    } catch { /* non-fatal */ } finally {
      setInviteSending(false);
    }
  };

  // ── Document upload to Supabase Storage ────────────────────────────────────
  const uploadDoc = useCallback(async (file: File, docType: string) => {
    if (!file) return;
    const MAX = 10 * 1024 * 1024;
    if (file.size > MAX) { setError("File too large — max 10 MB."); return; }

    setUploading((u) => ({ ...u, [docType]: true }));
    setError("");

    try {
      // Create a placeholder application row to get an ID if we don't have one yet
      let appId = applicationId;
      if (!appId) {
        const { data: row, error: insertErr } = await supabase
          .from("applications")
          .insert({ association: association || "pending", app_type: appType || "pending", total_charged: 0, stripe_payment_status: "pending" })
          .select("id")
          .single();
        if (insertErr) throw insertErr;
        appId = row.id;
        setApplicationId(appId);
      }

      const ext  = file.name.split(".").pop();
      const path = `${appId}/${docType}.${ext}`;
      const { error: upErr } = await supabase.storage.from("application-docs").upload(path, file, { upsert: true });
      if (upErr) throw upErr;

      const { data: { publicUrl } } = supabase.storage.from("application-docs").getPublicUrl(path);
      setDocUrls((u) => ({ ...u, [docType]: publicUrl }));
      setDocs((d) => ({ ...d, [docType]: file }));
    } catch (err) {
      console.error("Upload error:", err);
      setError(t.uploadError);
    } finally {
      setUploading((u) => ({ ...u, [docType]: false }));
    }
  }, [applicationId, association, appType, t.uploadError]);

  // ── Validation ─────────────────────────────────────────────────────────────
  const handleNext = () => {
    setError("");
    if (step === 0) {
      if (!leaseConfirmed) { setError(t.leaseRequired); return; }
    }
    if (step === 1) {
      if (!appType)                  { setError(t.selectType); return; }
      if (isCouple && !coupleOption) { setError(t.selectType); return; }
    }
    if (step === 3 && !rulesSignature.trim()) { setError(t.rulesRequired); return; }
    if (step === 3 && !agreed) { setError(t.consentRequired); return; }
    setStep((s) => s + 1);
  };

  // ── Stripe checkout ────────────────────────────────────────────────────────
  const handlePay = async () => {
    setPaying(true);
    setError("");
    try {
      // Upsert final application record
      const payload = {
        association,
        app_type:         appType,
        couple_has_cert:  isCouple ? hasCert : null,
        applicants:       isCommercial ? null : applicants,
        principals:       isCommercial ? principals : null,
        entity_name:      isCommercial ? entityName : null,
        sunbiz_id:        isCommercial ? sunbizId : null,
        total_charged:    total,
        docs_gov_id_url:        docUrls.govId,
        docs_proof_income_url:  docUrls.proofIncome,
        docs_marriage_cert_url: docUrls.marriageCert,
        docs_lease_url:         leaseData?.storagePath ?? null,
        language:         lang,
        stripe_payment_status: "pending",
        is_married_couple: isMarriedCouple,
        occupants: occupants.length > 0 ? occupants : null,
        rules_agreed_at: rulesSignature.trim() ? new Date().toISOString() : null,
        rules_signature: rulesSignature.trim() || null,
      };

      let appId = applicationId;
      if (appId) {
        await supabase.from("applications").update(payload).eq("id", appId);
      } else {
        const { data: row, error: insertErr } = await supabase
          .from("applications").insert(payload).select("id").single();
        if (insertErr) throw insertErr;
        appId = row.id;
        setApplicationId(appId);
      }

      // Primary applicant email
      const applicantEmail = applicants[0]?.email ?? "";

      // Send invites to 18+ occupants who have emails
      const adultOccupants = occupants.filter(o => parseInt(o.age) >= 18 && o.email);
      for (const occ of adultOccupants) {
        fetch("/api/apply/invite-coapplicant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            primaryName: `${applicants[0]?.firstName ?? ""} ${applicants[0]?.lastName ?? ""}`.trim(),
            coApplicantName: occ.name,
            coApplicantEmail: occ.email,
            association: leaseData?.matched?.name ?? association,
            applicationId: appId,
          }),
        }).catch(() => {});
      }

      const res = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount:         total,
          applicantEmail,
          applicationType: appType,
          association,
          applicationId:  appId,
          lang,
        }),
      });

      if (!res.ok) throw new Error("Checkout session failed");
      const { sessionId } = await res.json();
      const stripe = await getStripe();
      if (!stripe) throw new Error("Failed to initialize Stripe");
      await stripe.redirectToCheckout({ sessionId });
    } catch (err) {
      console.error("Payment error:", err);
      setError("Payment could not be initiated. Please try again.");
      setPaying(false);
    }
  };

  // ── Type card config ───────────────────────────────────────────────────────
  const typeCards = [
    { key: "individual",        label: t.individual,        desc: t.individualDesc,        icon: "👤", price: "$100"           },
    { key: "couple",            label: t.couple,            desc: t.coupleDesc,            icon: "💑", price: "$150"           },
    { key: "additionalResident",label: t.additionalResident,desc: t.additionalResidentDesc,icon: "➕", price: "$100"           },
    { key: "commercial",        label: t.commercial,        desc: t.commercialDesc,        icon: "🏢", price: "$100/principal" },
  ];

  // ── Shared input style ─────────────────────────────────────────────────────
  const inp = {
    width: "100%", boxSizing: "border-box" as const, padding: "10px 12px",
    borderRadius: 3, border: "1px solid #e5e7eb", fontSize: 14,
    color: "#0d0d0d", background: "#fff", outline: "none",
    fontFamily: "inherit", transition: "border-color 0.15s",
  };

  const isRTL = lang === "he";

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
    <SiteHeader subtitle="TENANT APPLICATION PORTAL" />
    <div style={{ minHeight: "100vh", background: "#0d0d0d", fontFamily: "'DM Sans', system-ui, sans-serif", padding: "24px 16px" }} dir={isRTL ? "rtl" : undefined}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500&family=DM+Mono:wght@400;500&family=Fraunces:ital,wght@0,300;0,600;1,300&display=swap');
        * { box-sizing: border-box; }
        input[type=date]::-webkit-calendar-picker-indicator { opacity: 0.5; cursor: pointer; }
      `}</style>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <h1 style={{ color: "#fff", fontFamily: "'Fraunces', Georgia, serif", fontSize: 28, fontWeight: 300, margin: "0 0 14px", letterSpacing: "-0.01em" }}>
          {t.title}
        </h1>

        {/* Language switcher */}
        <div style={{ position: "relative", display: "inline-block", marginTop: 14 }}>
          <button
            onClick={() => setLangOpen(!langOpen)}
            style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 20, padding: "5px 14px", color: "rgba(255,255,255,0.7)", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
          >
            {flags[lang as keyof typeof flags]} {langNames[lang as keyof typeof langNames]} ▾
          </button>
          {langOpen && (
            <div style={{ position: "absolute", top: "110%", left: "50%", transform: "translateX(-50%)", background: "#fff", borderRadius: 4, boxShadow: "0 8px 32px rgba(0,0,0,0.3)", overflow: "hidden", zIndex: 100, minWidth: 150 }}>
              {Object.keys(translations).map((l) => (
                <div
                  key={l}
                  onClick={() => { setLang(l); setLangOpen(false); }}
                  style={{ padding: "10px 16px", cursor: "pointer", fontSize: 13, color: l === lang ? "#f26a1b" : "#0d0d0d", fontWeight: l === lang ? 600 : 400, background: l === lang ? "#fff7f0" : "transparent", display: "flex", gap: 8, alignItems: "center" }}
                >
                  {flags[l as keyof typeof flags]} {langNames[l as keyof typeof langNames]}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Progress steps ──────────────────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", maxWidth: 480, margin: "0 auto 28px" }}>
        {t.steps.map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", flex: 1 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
              <div style={{ width: 30, height: 30, borderRadius: "50%", background: i <= step ? "#f26a1b" : "rgba(255,255,255,0.1)", border: `2px solid ${i <= step ? "#f26a1b" : "rgba(255,255,255,0.15)"}`, display: "flex", alignItems: "center", justifyContent: "center", color: i <= step ? "#fff" : "rgba(255,255,255,0.3)", fontSize: 12, fontWeight: 600, transition: "all 0.25s" }}>
                {i < step ? "✓" : i + 1}
              </div>
              <div style={{ fontSize: 10, color: i <= step ? "#f26a1b" : "rgba(255,255,255,0.3)", marginTop: 4, fontWeight: i === step ? 600 : 400, letterSpacing: "0.05em", textTransform: "uppercase", fontFamily: "monospace" }}>{s}</div>
            </div>
            {i < t.steps.length - 1 && (
              <div style={{ height: 2, flex: 1, background: i < step ? "#f26a1b" : "rgba(255,255,255,0.1)", marginBottom: 18, transition: "all 0.25s" }} />
            )}
          </div>
        ))}
      </div>

      {/* ── Card ────────────────────────────────────────────────────────────── */}
      <div style={{ maxWidth: 600, margin: "0 auto", background: "#fff", borderRadius: 4, boxShadow: "0 24px 80px rgba(0,0,0,0.5)", overflow: "hidden" }}>
        {/* Orange top bar */}
        <div style={{ height: 3, background: "#f26a1b" }} />

        <div style={{ padding: "32px 36px 28px" }}>

          {/* ══ STEP 0: Upload Lease / Purchase Agreement ═══════════════════ */}
          {step === 0 && (
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6, fontFamily: "monospace" }}>
                {t.uploadLease}
              </label>
              <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 18, lineHeight: 1.55 }}>{t.uploadLeaseHint}</p>

              {/* Parse error — prominent, actionable */}
              {leaseParseError && (
                <div style={{ marginBottom: 18, padding: "14px 16px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 4 }}>
                  <div style={{ fontWeight: 700, color: "#dc2626", fontSize: 13, marginBottom: 4 }}>⚠ Could not read your document</div>
                  <div style={{ fontSize: 13, color: "#7f1d1d", lineHeight: 1.55 }}>{leaseParseError}</div>
                  <div style={{ marginTop: 8, fontSize: 12, color: "#dc2626", fontWeight: 600 }}>Please upload a clearer, higher-resolution scan or photo and try again.</div>
                </div>
              )}

              {/* Upload drop zone */}
              {!leaseData && (
                <div
                  onClick={() => { const el = document.getElementById("lease-upload") as HTMLInputElement | null; if (el) { el.value = ""; el.click(); } }}
                  onDragOver={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).style.borderColor = "#f26a1b"; (e.currentTarget as HTMLElement).style.background = "#fff7f0"; }}
                  onDragLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = leaseParseError ? "#fca5a5" : "#e5e7eb"; (e.currentTarget as HTMLElement).style.background = leaseParseError ? "#fef2f2" : "#fafaf9"; }}
                  onDrop={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).style.borderColor = "#e5e7eb"; (e.currentTarget as HTMLElement).style.background = "#fafaf9"; if (e.dataTransfer.files[0]) handleLeaseUpload(e.dataTransfer.files[0]); }}
                  style={{ border: `1.5px dashed ${leaseParseError ? "#fca5a5" : "#e5e7eb"}`, borderRadius: 4, padding: "32px 20px", textAlign: "center", cursor: leaseUploading ? "wait" : "pointer", background: leaseParseError ? "#fef2f2" : "#fafaf9", transition: "all 0.18s", opacity: leaseUploading ? 0.7 : 1 }}
                >
                  <input id="lease-upload" type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: "none" }}
                    onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) handleLeaseUpload(f); }} />
                  {leaseUploading ? (
                    <div>
                      <div style={{ fontSize: 22, marginBottom: 10 }}>⏳</div>
                      <div style={{ fontSize: 14, color: "#f26a1b", fontWeight: 600 }}>{t.reading}</div>
                      <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>This may take a few seconds…</div>
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontSize: 28, marginBottom: 10 }}>📄</div>
                      <div style={{ fontSize: 14, color: "#0d0d0d", fontWeight: 500 }}>{leaseParseError ? "Upload a different document" : "Click to upload or drag & drop"}</div>
                      <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 6 }}>PDF, JPG, PNG · max 10 MB</div>
                    </div>
                  )}
                </div>
              )}

              {/* Confirmation card after successful parse */}
              {leaseData && (
                <div>
                  <div style={{ padding: "16px 18px", background: leaseData.matched ? "#f0fdf4" : "#fffbeb", border: `1px solid ${leaseData.matched ? "#bbf7d0" : "#fde68a"}`, borderRadius: 4, marginBottom: 16 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: leaseData.matched ? "#1a6b3c" : "#b45309", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "monospace", marginBottom: 10 }}>
                      {leaseData.matched ? `✓ ${t.docFound}` : `⚠ ${t.assocUnknown}`}
                    </div>

                    {leaseData.matched ? (
                      <div style={{ display: "grid", gap: 6 }}>
                        <div>
                          <div style={{ fontSize: 10, color: "#6b7280", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.07em" }}>Association</div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: "#0d0d0d" }}>{leaseData.matched.name}</div>
                        </div>
                        {leaseData.matched.address && (
                          <div>
                            <div style={{ fontSize: 10, color: "#6b7280", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.07em" }}>Property Address</div>
                            <div style={{ fontSize: 13, color: "#374151" }}>{leaseData.matched.address}</div>
                          </div>
                        )}
                        {leaseData.extracted.unit && (
                          <div>
                            <div style={{ fontSize: 10, color: "#6b7280", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.07em" }}>Unit</div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "#0d0d0d" }}>{leaseData.extracted.unit}</div>
                          </div>
                        )}
                        {leaseData.extracted.tenants.length > 0 && (
                          <div>
                            <div style={{ fontSize: 10, color: "#6b7280", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.07em" }}>Applicant(s) on document</div>
                            <div style={{ fontSize: 13, color: "#374151" }}>{leaseData.extracted.tenants.join(", ")}</div>
                          </div>
                        )}
                        {leaseData.extracted.moveIn && (
                          <div>
                            <div style={{ fontSize: 10, color: "#6b7280", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.07em" }}>Move-in / Closing Date</div>
                            <div style={{ fontSize: 13, color: "#374151" }}>{leaseData.extracted.moveIn}</div>
                          </div>
                        )}
                        <div style={{ marginTop: 4, fontSize: 11, color: "#6b7280", fontStyle: "italic" }}>{t.verifyNote}</div>
                      </div>
                    ) : (
                      <div>
                        {leaseData.extracted.association && (
                          <div style={{ fontSize: 13, color: "#92400e", marginBottom: 6 }}>Document says: <strong>{leaseData.extracted.association}</strong></div>
                        )}
                        <div style={{ fontSize: 13, color: "#92400e", lineHeight: 1.55 }}>
                          Please contact us at{" "}
                          <a href="mailto:support@topfloridaproperties.com" style={{ color: "#f26a1b", fontWeight: 600 }}>support@topfloridaproperties.com</a>{" "}
                          before applying so we can verify your association.
                        </div>
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {leaseData.matched && (
                      <button
                        onClick={confirmLease}
                        style={{ flex: 1, padding: "12px 20px", background: "#f26a1b", color: "#fff", border: "none", borderRadius: 3, fontSize: 13, fontWeight: 700, cursor: "pointer", letterSpacing: "0.03em" }}
                      >
                        {t.confirmDetails} →
                      </button>
                    )}
                    <button
                      onClick={() => { setLeaseData(null); setLeaseParseError(""); }}
                      style={{ padding: "12px 16px", background: "#f3f4f6", color: "#6b7280", border: "none", borderRadius: 3, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                    >
                      {t.uploadAgain}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ══ STEP 1: Application Type ════════════════════════════════════ */}
          {step === 1 && (
            <div>
              {/* Confirmed property context strip */}
              {leaseData?.matched && (
                <div style={{ marginBottom: 20, padding: "10px 14px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 4, display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span style={{ color: "#1a6b3c", fontSize: 15, flexShrink: 0 }}>✓</span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#1a6b3c" }}>{leaseData.matched.name}</div>
                    {leaseData.extracted.unit && <div style={{ fontSize: 11, color: "#374151" }}>Unit {leaseData.extracted.unit} · {leaseData.matched.address}</div>}
                  </div>
                </div>
              )}
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12, fontFamily: "monospace" }}>
                {t.applicantType}
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
                {typeCards.map(({ key, label, desc, icon, price }) => (
                  <div
                    key={key}
                    onClick={() => {
                      setAppType(key);
                      if (key !== "couple")     setCoupleOption("");
                      if (key !== "commercial") setPrincipals([{ name: "", dob: "" }]);
                      setApplicants((prev) => key === "couple" ? [{ ...prev[0] }, {}] : [{ ...prev[0] }]);
                    }}
                    style={{ border: `2px solid ${appType === key ? "#f26a1b" : "#e5e7eb"}`, borderRadius: 4, padding: "14px 12px", cursor: "pointer", background: appType === key ? "#fff7f0" : "#fafaf9", transition: "all 0.18s" }}
                  >
                    <div style={{ fontSize: 20, marginBottom: 6 }}>{icon}</div>
                    <div style={{ fontFamily: "'Fraunces', serif", fontSize: 14, fontWeight: 600, color: "#0d0d0d" }}>{label}</div>
                    <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2, lineHeight: 1.4 }}>{desc}</div>
                    <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: "#f26a1b", fontFamily: "monospace" }}>{price}</div>
                  </div>
                ))}
              </div>
              {isCouple && (
                <div style={{ background: "#fafaf9", borderRadius: 4, padding: 18, border: "1px solid #e5e7eb", marginBottom: 4 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#0d0d0d", marginBottom: 6, fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>{t.marriageCertUpload}</div>
                  <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 14, lineHeight: 1.5 }}>{t.marriageCertNote}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {[{ val: "yes", label: t.hasCert }, { val: "no", label: t.noCert }].map(({ val, label }) => (
                      <div key={val} onClick={() => setCoupleOption(val)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 13px", borderRadius: 3, border: `1.5px solid ${coupleOption === val ? "#f26a1b" : "#e5e7eb"}`, background: coupleOption === val ? "#fff7f0" : "#fff", cursor: "pointer" }}>
                        <div style={{ width: 16, height: 16, borderRadius: "50%", border: `2px solid ${coupleOption === val ? "#f26a1b" : "#d1d5db"}`, background: coupleOption === val ? "#f26a1b" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          {coupleOption === val && <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#fff" }} />}
                        </div>
                        <span style={{ fontSize: 13, fontWeight: coupleOption === val ? 600 : 400, color: "#0d0d0d" }}>{label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ══ STEP 2: Applicant Info ══════════════════════════════════════ */}
          {step === 2 && (
            <div>
              {isCommercial ? (
                <div>
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: "monospace" }}>{t.entityName} *</label>
                    <input type="text" value={entityName} onChange={(e) => setEntityName(e.target.value)} style={inp} onFocus={(e) => (e.target.style.borderColor = "#f26a1b")} onBlur={(e) => (e.target.style.borderColor = "#e5e7eb")} />
                  </div>
                  <div style={{ marginBottom: 20 }}>
                    <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: "monospace" }}>{t.sunbizId} *</label>
                    <input type="text" value={sunbizId} onChange={(e) => setSunbizId(e.target.value)} style={inp} onFocus={(e) => (e.target.style.borderColor = "#f26a1b")} onBlur={(e) => (e.target.style.borderColor = "#e5e7eb")} />
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#0d0d0d", marginBottom: 12, fontFamily: "monospace" }}>{t.principals} <span style={{ color: "#f26a1b" }}>($100 each)</span></div>
                  {principals.map((p, idx) => (
                    <div key={idx} style={{ background: "#fafaf9", borderRadius: 4, padding: 16, marginBottom: 10, border: "1px solid #e5e7eb" }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#f26a1b", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "monospace" }}>Principal {idx + 1}</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 14px" }}>
                        <div>
                          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 4, textTransform: "uppercase", fontFamily: "monospace" }}>{t.principalName} *</label>
                          <input type="text" value={p.name} onChange={(e) => updatePrincipal(idx, "name", e.target.value)} style={{ ...inp, padding: "8px 10px", fontSize: 13 }} onFocus={(e) => (e.target.style.borderColor = "#f26a1b")} onBlur={(e) => (e.target.style.borderColor = "#e5e7eb")} />
                        </div>
                        <div>
                          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 4, textTransform: "uppercase", fontFamily: "monospace" }}>{t.principalDOB} *</label>
                          <input type="date" value={p.dob} onChange={(e) => updatePrincipal(idx, "dob", e.target.value)} style={{ ...inp, padding: "8px 10px", fontSize: 13 }} onFocus={(e) => (e.target.style.borderColor = "#f26a1b")} onBlur={(e) => (e.target.style.borderColor = "#e5e7eb")} />
                        </div>
                      </div>
                      {principals.length > 1 && (
                        <button onClick={() => setPrincipals((prev) => prev.filter((_, i) => i !== idx))} style={{ marginTop: 10, fontSize: 12, color: "#ef4444", background: "none", border: "none", cursor: "pointer", padding: 0 }}>✕ Remove</button>
                      )}
                    </div>
                  ))}
                  <button onClick={() => setPrincipals((prev) => [...prev, { name: "", dob: "" }])} style={{ fontSize: 13, fontWeight: 600, color: "#f26a1b", background: "none", border: "1.5px dashed #f26a1b", borderRadius: 3, padding: "10px 18px", cursor: "pointer", width: "100%" }}>
                    {t.addPrincipal}
                  </button>
                </div>
              ) : (
                <>
                  {applicants.map((a, idx) => (
                    <ApplicantFields key={idx} index={idx} t={t} data={a} onChange={updateApplicant} units={assocUnits} />
                  ))}

                  {/* Married couple question — shown when 2+ applicants on the form */}
                  {applicants.length >= 2 && (
                    <div style={{ background: "#fafaf9", borderRadius: 4, padding: 18, border: "1px solid #e5e7eb", marginBottom: 14 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#0d0d0d", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "monospace" }}>
                        {t.areYouMarried}
                      </div>
                      <div style={{ display: "flex", gap: 10 }}>
                        {([{ val: true, label: t.yes }, { val: false, label: t.no }] as const).map(({ val, label }) => (
                          <button
                            key={String(val)}
                            onClick={() => setIsMarriedCouple(val)}
                            style={{ flex: 1, padding: "10px 16px", background: isMarriedCouple === val ? "#f26a1b" : "#fff", color: isMarriedCouple === val ? "#fff" : "#6b7280", border: `1.5px solid ${isMarriedCouple === val ? "#f26a1b" : "#e5e7eb"}`, borderRadius: 3, fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all 0.18s" }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      {isMarriedCouple === true && (
                        <div style={{ marginTop: 10, fontSize: 12, color: "#1a6b3c", fontWeight: 600 }}>✓ {t.marriedCertWillBeRequired}</div>
                      )}
                    </div>
                  )}

                  {/* Co-applicant invite — shown when 2nd applicant has an email */}
                  {applicants.length >= 2 && applicants[1]?.email && (
                    <div style={{ marginBottom: 14, padding: "12px 16px", background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 4 }}>
                      <div style={{ fontSize: 12, color: "#0369a1", marginBottom: 8 }}>
                        📧 {applicants[1].firstName || (t.applicant + " 2")} — {applicants[1].email}
                      </div>
                      <button
                        onClick={sendCoApplicantInvite}
                        disabled={inviteSent || inviteSending}
                        style={{ padding: "9px 16px", background: inviteSent ? "#1a6b3c" : "#0369a1", color: "#fff", border: "none", borderRadius: 3, fontSize: 12, fontWeight: 600, cursor: inviteSent ? "default" : "pointer", opacity: inviteSending ? 0.7 : 1 }}
                      >
                        {inviteSending ? t.sendingInvite : inviteSent ? t.inviteSentLabel : t.sendInvite}
                      </button>
                    </div>
                  )}

                  {/* Other Occupants */}
                  <div style={{ background: "#fafaf9", borderRadius: 4, padding: 18, border: "1px solid #e5e7eb", marginTop: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#0d0d0d", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "monospace" }}>{t.otherOccupants}</div>
                    <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 14, lineHeight: 1.5 }}>{t.otherOccupantsHint}</div>
                    {occupants.map((o, idx) => (
                      <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 70px 1fr auto", gap: 8, marginBottom: 8, alignItems: "center" }}>
                        <input type="text" placeholder={t.occupantName} value={o.name} onChange={(e) => updateOccupant(idx, "name", e.target.value)} style={{ ...inp, padding: "8px 10px" }} />
                        <input type="number" placeholder={t.occupantAge} value={o.age} min={0} max={120} onChange={(e) => updateOccupant(idx, "age", e.target.value)} style={{ ...inp, padding: "8px 10px" }} />
                        <input type="email" placeholder={t.occupantEmail} value={o.email} onChange={(e) => updateOccupant(idx, "email", e.target.value)} style={{ ...inp, padding: "8px 10px", opacity: parseInt(o.age) >= 18 ? 1 : 0.35 }} disabled={!!o.age && parseInt(o.age) < 18} />
                        <button onClick={() => setOccupants((prev) => prev.filter((_, i) => i !== idx))} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 18, padding: "0 4px" }}>✕</button>
                      </div>
                    ))}
                    <button onClick={() => setOccupants((prev) => [...prev, { name: "", age: "", email: "" }])} style={{ fontSize: 13, fontWeight: 600, color: "#f26a1b", background: "none", border: "1.5px dashed #f26a1b", borderRadius: 3, padding: "9px 18px", cursor: "pointer", width: "100%", marginTop: 4 }}>
                      {t.addOccupant}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ══ STEP 3: Documents + Consent ════════════════════════════════ */}
          {step === 3 && (
            <div>
              <UploadBox label={t.govId}       t={t} uploaded={docs.govId}       uploading={uploading.govId}       onUpload={(f) => uploadDoc(f, "govId")} />
              <UploadBox label={t.proofIncome}  t={t} uploaded={docs.proofIncome} uploading={uploading.proofIncome} onUpload={(f) => uploadDoc(f, "proofIncome")} />
              {(isCouple && hasCert || isMarriedCouple === true) && (
                <UploadBox label={t.marriageCert} t={t} uploaded={docs.marriageCert} uploading={uploading.marriageCert} onUpload={(f) => uploadDoc(f, "marriageCert")} />
              )}
              {/* Rules & Regulations — with e-signature */}
              <div style={{ background: "#fff7f0", borderRadius: 4, padding: 20, border: "2px solid #f26a1b", marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#f26a1b", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "monospace" }}>
                  ✍ {t.rulesTitle}
                </div>
                <p style={{ fontSize: 13, color: "#374151", lineHeight: 1.65, margin: "0 0 12px" }}>
                  {t.rulesConsent} <strong>{association || leaseData?.matched?.name || "your association"}</strong>.
                </p>
                {rulesSections.length > 0 && (
                  <div style={{ background: "#fff", border: "1px solid #fed7aa", borderRadius: 3, padding: "12px 14px", marginBottom: 16, maxHeight: 200, overflowY: "auto" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#9a3412", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "monospace", marginBottom: 8 }}>Topics covered</div>
                    {rulesSections.map((s, i) => (
                      <div key={i} style={{ fontSize: 12, color: "#374151", lineHeight: 1.7, borderLeft: "2px solid #fed7aa", marginBottom: 3, paddingLeft: 8 }}>
                        {s}
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ marginBottom: 6 }}>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "monospace" }}>
                    {t.rulesSignatureLabel} *
                  </label>
                  <input
                    type="text"
                    placeholder={t.rulesSignaturePlaceholder}
                    value={rulesSignature}
                    onChange={(e) => { setRulesSignature(e.target.value); setRulesAgreed(e.target.value.trim().length > 0); }}
                    style={{ width: "100%", boxSizing: "border-box" as const, padding: "11px 14px", borderRadius: 3, border: `1.5px solid ${rulesSignature.trim() ? "#f26a1b" : "#e5e7eb"}`, fontSize: 15, fontFamily: "'Fraunces', Georgia, serif", fontStyle: "italic", color: "#0d0d0d", background: "#fff", outline: "none", letterSpacing: "0.02em" }}
                    onFocus={(e) => (e.target.style.borderColor = "#f26a1b")}
                    onBlur={(e) => (e.target.style.borderColor = rulesSignature.trim() ? "#f26a1b" : "#e5e7eb")}
                  />
                </div>
                {rulesSignature.trim() && (
                  <div style={{ fontSize: 11, color: "#1a6b3c", fontWeight: 600, marginTop: 6 }}>
                    ✓ {t.rulesSignatureNote}
                  </div>
                )}
                {!rulesSignature.trim() && (
                  <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 6 }}>
                    {t.rulesSignatureNote}
                  </div>
                )}
              </div>
              <div style={{ background: "#fafaf9", borderRadius: 4, padding: 18, border: "1px solid #e5e7eb", marginTop: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#0d0d0d", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "monospace" }}>{t.signature}</div>
                <p style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.6, margin: "0 0 14px" }}>{t.signatureConsent}</p>
                <div onClick={() => setAgreed(!agreed)} style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
                  <div style={{ width: 18, height: 18, borderRadius: 2, border: `2px solid ${agreed ? "#f26a1b" : "#d1d5db"}`, background: agreed ? "#f26a1b" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1, transition: "all 0.15s" }}>
                    {agreed && <span style={{ color: "#fff", fontSize: 11, fontWeight: 700, lineHeight: 1 }}>✓</span>}
                  </div>
                  <span style={{ fontSize: 13, color: "#0d0d0d", fontWeight: agreed ? 600 : 400, lineHeight: 1.5 }}>{t.iAgree}</span>
                </div>
              </div>
            </div>
          )}

          {/* ══ STEP 4: Payment ════════════════════════════════════════════ */}
          {step === 4 && (
            <div>
              <div style={{ background: "#fafaf9", borderRadius: 4, padding: 22, border: "1px solid #e5e7eb", marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 16, fontFamily: "monospace" }}>{t.paymentSummary}</div>

                <div style={{ borderBottom: "1px solid #e5e7eb", paddingBottom: 14, marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#6b7280", marginBottom: 8 }}>
                    <span>{association}</span>
                    <span style={{ fontFamily: "monospace", fontSize: 11 }}>{appType}</span>
                  </div>

                  {appType === "individual" && (
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: "#0d0d0d" }}>
                      <span>1 × Individual</span><span style={{ fontWeight: 600 }}>$100</span>
                    </div>
                  )}
                  {appType === "couple" && (
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: "#0d0d0d" }}>
                      <span>{hasCert ? t.coupleRate : "2 × Individual"}</span>
                      <span style={{ fontWeight: 600 }}>{hasCert ? "$150" : "$200"}</span>
                    </div>
                  )}
                  {appType === "additionalResident" && (
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: "#0d0d0d" }}>
                      <span>1 × {t.addlResident}</span><span style={{ fontWeight: 600 }}>$100</span>
                    </div>
                  )}
                  {appType === "commercial" && principals.map((p, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: "#0d0d0d", marginBottom: 4 }}>
                      <span>{p.name || `Principal ${i + 1}`}</span><span style={{ fontWeight: 600 }}>$100</span>
                    </div>
                  ))}
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 18, fontWeight: 700, color: "#0d0d0d", fontFamily: "'Fraunces', serif" }}>
                  <span>{t.payTotal}</span>
                  <span style={{ color: "#f26a1b" }}>${total}</span>
                </div>
                <div style={{ marginTop: 8, fontSize: 11, color: "#9ca3af" }}>
                  Includes background check, credit &amp; eviction report (Applycheck)
                </div>
              </div>

              <button
                onClick={handlePay}
                disabled={paying}
                style={{ width: "100%", padding: 15, background: paying ? "#6b7280" : "#0d0d0d", color: "#fff", border: "none", borderRadius: 3, fontSize: 15, fontWeight: 600, cursor: paying ? "not-allowed" : "pointer", letterSpacing: "0.02em", fontFamily: "'Fraunces', serif", transition: "background 0.2s", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}
              >
                {paying ? (
                  <>{t.payingNote}</>
                ) : (
                  <>💳 {t.payOnline} — ${total}</>
                )}
              </button>

              <div style={{ marginTop: 12, textAlign: "center", fontSize: 11, color: "#9ca3af", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <span>🔒</span> Secured by Stripe · PCI DSS compliant
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{ marginTop: 14, padding: "10px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 3, fontSize: 13, color: "#dc2626", fontWeight: 500 }}>
              ⚠️ {error}
            </div>
          )}

          {/* Navigation */}
          {step < 4 && (
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 24, gap: 12 }}>
              {step > 0 ? (
                <button onClick={() => { setStep((s) => s - 1); setError(""); }} style={{ padding: "11px 22px", background: "#f3f4f6", color: "#6b7280", border: "none", borderRadius: 3, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                  ← {t.back}
                </button>
              ) : <div />}
              <button onClick={handleNext} style={{ padding: "11px 28px", background: "#f26a1b", color: "#fff", border: "none", borderRadius: 3, fontSize: 13, fontWeight: 600, cursor: "pointer", letterSpacing: "0.03em" }}>
                {t.next} →
              </button>
            </div>
          )}
        </div>
      </div>

      <div style={{ textAlign: "center", marginTop: 20, color: "rgba(255,255,255,0.2)", fontSize: 11 }}>
        © 2026 PMI Top Florida Properties · pmitop.com
      </div>
    </div>
    </>
  );
}
