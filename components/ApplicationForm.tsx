"use client";

import { useState, useEffect, useCallback } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { createClient } from "@supabase/supabase-js";

// ── Supabase client (public/read-only anon key) ──────────────────────────────
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
    steps: ["Type", "Applicants", "Documents", "Payment"],
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
    moveInDate: "Desired Move-In Date",
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
  },
  es: {
    title: "Solicitud de Residente",
    subtitle: "PMI Top Florida Properties",
    steps: ["Tipo", "Solicitantes", "Documentos", "Pago"],
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
    moveInDate: "Fecha Deseada de Entrada",
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
  },
  pt: {
    title: "Solicitação de Residente",
    subtitle: "PMI Top Florida Properties",
    steps: ["Tipo", "Solicitantes", "Documentos", "Pagamento"],
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
    moveInDate: "Data Desejada de Entrada",
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
  },
  fr: {
    title: "Demande de Résidence",
    subtitle: "PMI Top Florida Properties",
    steps: ["Type", "Demandeurs", "Documents", "Paiement"],
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
    moveInDate: "Date d'Emménagement Souhaitée",
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
  },
};

const flags    = { en: "🇺🇸", es: "🇪🇸", pt: "🇧🇷", fr: "🇫🇷" };
const langNames = { en: "English", es: "Español", pt: "Português", fr: "Français" };

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
};
function ApplicantFields({ index, t, data, onChange }: ApplicantFieldsProps) {
  const fields = [
    { key: "firstName",      label: t.firstName,      type: "text"  },
    { key: "lastName",       label: t.lastName,       type: "text"  },
    { key: "dob",            label: t.dob,            type: "date"  },
    { key: "email",          label: t.email,          type: "email" },
    { key: "phone",          label: t.phone,          type: "tel"   },
    { key: "ssn",            label: t.ssn,            type: "text"  },
    { key: "currentAddress", label: t.currentAddress, type: "text"  },
    { key: "unitApplying",   label: t.unitApplying,   type: "text"  },
    { key: "moveInDate",     label: t.moveInDate,     type: "date"  },
  ];
  const full = new Set(["currentAddress", "ssn"]);
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
              style={{ width: "100%", boxSizing: "border-box", padding: "9px 11px", borderRadius: 3, border: "1px solid #e5e7eb", fontSize: 14, color: "#0d0d0d", background: "#fff", outline: "none", fontFamily: "inherit", transition: "border-color 0.15s" }}
              onFocus={(e) => (e.target.style.borderColor = "#f26a1b")}
              onBlur={(e)  => (e.target.style.borderColor = "#e5e7eb")}
            />
          </div>
        ))}
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
  const [associations, setAssociations] = useState<{ name: string; code: string }[]>([]);
  const [assocLoading, setAssocLoading] = useState(true);
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

  const isCouple     = appType === "couple";
  const hasCert      = coupleOption === "yes";
  const isCommercial = appType === "commercial";

  // ── Load associations from Supabase ────────────────────────────────────────
  useEffect(() => {
    async function fetchAssociations() {
      setAssocLoading(true);
      const { data, error: err } = await supabase
        .from("homeowners")
        .select("association_name, association_code")
        .order("association_name");
      if (!err && data) {
        // Deduplicate by association_name
        const seen = new Set();
        const unique = data
          .filter((r) => { if (seen.has(r.association_name)) return false; seen.add(r.association_name); return true; })
          .map((r) => ({ name: r.association_name, code: r.association_code }));
        setAssociations(unique);
      }
      setAssocLoading(false);
    }
    fetchAssociations();
  }, []);

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
      if (!association)              { setError(t.selectAssocPlaceholder); return; }
      if (!appType)                  { setError(t.selectType);             return; }
      if (isCouple && !coupleOption) { setError(t.selectType);             return; }
    }
    if (step === 2 && !agreed) { setError(t.consentRequired); return; }
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
        language:         lang,
        stripe_payment_status: "pending",
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

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: "#0d0d0d", fontFamily: "'DM Sans', system-ui, sans-serif", padding: "24px 16px" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500&family=DM+Mono:wght@400;500&family=Fraunces:ital,wght@0,300;0,600;1,300&display=swap');
        * { box-sizing: border-box; }
        input[type=date]::-webkit-calendar-picker-indicator { opacity: 0.5; cursor: pointer; }
      `}</style>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <div style={{ marginBottom: 14 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/pmi-icon.jpg" alt="PMI Top Florida Properties" style={{ height: 44, width: "auto", objectFit: "contain" }} />
        </div>
        <h1 style={{ color: "#fff", fontFamily: "'Fraunces', Georgia, serif", fontSize: 28, fontWeight: 300, margin: 0, letterSpacing: "-0.01em" }}>
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

          {/* ══ STEP 0: Type + Association ══════════════════════════════════ */}
          {step === 0 && (
            <div>
              {/* Association selector — from Supabase */}
              <div style={{ marginBottom: 24 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 7, fontFamily: "monospace" }}>
                  {t.selectAssociation}
                </label>
                {assocLoading ? (
                  <div style={{ padding: "12px 14px", borderRadius: 3, border: "1px solid #e5e7eb", fontSize: 13, color: "#9ca3af", background: "#fafaf9" }}>
                    {t.loadingAssociations}
                  </div>
                ) : (
                  <select
                    value={association}
                    onChange={(e) => setAssociation(e.target.value)}
                    disabled={!!preselectedAssociation}
                    style={{ ...inp, color: association ? "#0d0d0d" : "#9ca3af", cursor: preselectedAssociation ? "default" : "pointer" }}
                  >
                    <option value="">{t.associationPlaceholder}</option>
                    {associations.map((a) => (
                      <option key={a.code} value={a.name}>{a.name}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Application type */}
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
                      setApplicants(key === "couple" ? [{}, {}] : [{}]);
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

              {/* Couple cert option */}
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

          {/* ══ STEP 1: Applicant Info ══════════════════════════════════════ */}
          {step === 1 && (
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
                applicants.map((a, idx) => (
                  <ApplicantFields key={idx} index={idx} t={t} data={a} onChange={updateApplicant} />
                ))
              )}
            </div>
          )}

          {/* ══ STEP 2: Documents + Consent ════════════════════════════════ */}
          {step === 2 && (
            <div>
              <UploadBox label={t.govId}       t={t} uploaded={docs.govId}       uploading={uploading.govId}       onUpload={(f) => uploadDoc(f, "govId")} />
              <UploadBox label={t.proofIncome}  t={t} uploaded={docs.proofIncome} uploading={uploading.proofIncome} onUpload={(f) => uploadDoc(f, "proofIncome")} />
              {isCouple && hasCert && (
                <UploadBox label={t.marriageCert} t={t} uploaded={docs.marriageCert} uploading={uploading.marriageCert} onUpload={(f) => uploadDoc(f, "marriageCert")} />
              )}
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

          {/* ══ STEP 3: Payment ════════════════════════════════════════════ */}
          {step === 3 && (
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
          {step < 3 && (
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
  );
}
