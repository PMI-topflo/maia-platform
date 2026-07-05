"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
import CheckrConsentEmbed from "@/components/CheckrConsentEmbed";

interface ScreeningSubject { id: string; name: string | null; status: string; candidateId: string | null }

const copy: Record<string, Record<string, string>> = {
  en: {
    heading: "Application Submitted",
    body: "Your application has been received and payment confirmed. The board will review and you will receive a decision by email.",
    ref: "Reference Number",
    next: "What happens next",
    s1: "Your documents are forwarded to the association board.",
    s2: "Complete the background check authorization below.",
    s3: "The board will review and vote — typically within 7–10 business days.",
    s4: "You will receive written notice of the board's decision.",
    support: "Questions? Email us at",
    newApp: "Start a new application",
  },
  es: {
    heading: "Solicitud Enviada",
    body: "Su solicitud ha sido recibida y el pago confirmado. La junta revisará y recibirá una decisión por correo.",
    ref: "Número de Referencia",
    next: "¿Qué sigue?",
    s1: "Sus documentos son enviados a la junta de la asociación.",
    s2: "Complete la autorización de verificación de antecedentes a continuación.",
    s3: "La junta revisará y votará — normalmente en 7–10 días hábiles.",
    s4: "Recibirá notificación escrita de la decisión.",
    support: "¿Preguntas? Escríbanos a",
    newApp: "Iniciar nueva solicitud",
  },
  pt: {
    heading: "Solicitação Enviada",
    body: "Sua solicitação foi recebida e o pagamento confirmado. O conselho revisará e você receberá uma decisão por e-mail.",
    ref: "Número de Referência",
    next: "O que acontece agora",
    s1: "Seus documentos são encaminhados ao conselho da associação.",
    s2: "Complete a autorização de verificação de antecedentes abaixo.",
    s3: "O conselho revisará e votará — geralmente em 7–10 dias úteis.",
    s4: "Você receberá notificação escrita da decisão.",
    support: "Dúvidas? Envie e-mail para",
    newApp: "Iniciar nova solicitação",
  },
  fr: {
    heading: "Demande Soumise",
    body: "Votre demande a été reçue et le paiement confirmé. Le conseil examinera et vous recevrez une décision par e-mail.",
    ref: "Numéro de Référence",
    next: "Prochaines étapes",
    s1: "Vos documents sont transmis au conseil de l'association.",
    s2: "Complétez l'autorisation de vérification des antécédents ci-dessous.",
    s3: "Le conseil examinera et votera — généralement sous 7 à 10 jours ouvrables.",
    s4: "Vous recevrez une notification écrite de la décision.",
    support: "Questions ? Écrivez-nous à",
    newApp: "Nouvelle demande",
  },
  he: {
    heading: "הבקשה נשלחה",
    body: "בקשתך התקבלה והתשלום אושר. הוועד יסקור ותקבל החלטה בדוא״ל.",
    ref: "מספר אסמכתא",
    next: "מה קורה עכשיו",
    s1: "המסמכים שלך יועברו לוועד העמותה.",
    s2: "השלם את אישור בדיקת הרקע למטה.",
    s3: "הוועד יסקור ויצביע — בדרך כלל תוך 7–10 ימי עסקים.",
    s4: "תקבל הודעה בכתב על החלטת הוועד.",
    support: "שאלות? שלח לנו אימייל",
    newApp: "התחל בקשה חדשה",
  },
  ru: {
    heading: "Заявка отправлена",
    body: "Ваша заявка получена и оплата подтверждена. Совет рассмотрит её и вышлет решение по электронной почте.",
    ref: "Номер заявки",
    next: "Дальнейшие шаги",
    s1: "Ваши документы переданы в совет ассоциации.",
    s2: "Заполните авторизацию проверки биографии ниже.",
    s3: "Совет рассмотрит и проголосует — как правило, в течение 7–10 рабочих дней.",
    s4: "Вы получите письменное уведомление о решении совета.",
    support: "Вопросы? Напишите нам по адресу",
    newApp: "Подать новую заявку",
  },
};

function SuccessContent() {
  const params = useSearchParams();
  const router = useRouter();
  const lang = (params.get("lang") || "en") as string;
  const t = copy[lang] || copy.en;
  const [refNum, setRefNum] = useState("");
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const [subjects, setSubjects] = useState<ScreeningSubject[] | null>(null);
  const [screeningError, setScreeningError] = useState<string | null>(null);

  useEffect(() => {
    const ref = params.get("ref");
    const sessionId = params.get("session_id");
    if (ref) setRefNum(ref);
    else if (sessionId) setRefNum("PMI-" + sessionId.slice(-8).toUpperCase());
    else setRefNum("PMI-" + Date.now().toString().slice(-6));
  }, [params]);

  // Candidate creation runs async (Stripe webhook → trigger-screening) right
  // after payment, so the screening_subjects rows may not exist the instant
  // this page loads — poll briefly rather than erroring out immediately.
  useEffect(() => {
    const sessionId = params.get("session_id");
    if (!sessionId) return;
    let cancelled = false;
    let attempts = 0;
    const poll = async () => {
      attempts++;
      try {
        const res = await fetch(`/api/apply/by-session/${sessionId}`);
        const j = await res.json();
        if (cancelled) return;
        if (res.ok && j.ready) {
          setApplicationId(j.applicationId);
          setSubjects(j.subjects ?? []);
          return;
        }
      } catch { /* keep polling */ }
      if (!cancelled && attempts < 10) setTimeout(poll, 2000);
      else if (!cancelled) setScreeningError("Could not load your background-check authorization — we'll email you a link shortly.");
    };
    void poll();
    return () => { cancelled = true; };
  }, [params]);

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-6">
      <div className="bg-white rounded max-w-lg w-full p-12 text-center shadow-2xl">
        <div className="w-16 h-16 rounded-full bg-green-50 border-2 border-green-300 flex items-center justify-center mx-auto mb-5">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <path d="M6 14l5.5 5.5L22 9" stroke="#1a6b3c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <p className="text-xs font-semibold text-orange-500 uppercase tracking-widest font-mono mb-3">
          PMI Top Florida Properties
        </p>
        <h1 className="text-2xl font-light text-black mb-3" style={{ fontFamily: "Georgia, serif" }}>
          {t.heading}
        </h1>
        <p className="text-sm text-gray-500 leading-relaxed mb-6">{t.body}</p>
        <div className="bg-gray-50 border border-gray-200 rounded p-4 mb-6">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest font-mono mb-1">{t.ref}</p>
          <p className="text-xl font-bold text-orange-500 font-mono tracking-wide">{refNum}</p>
          <p className="text-xs text-gray-400 mt-1">Save this number for your records</p>
        </div>
        <div className="text-left mb-6">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest font-mono mb-3">{t.next}</p>
          {[t.s1, t.s2, t.s3, t.s4].map((step, i) => (
            <div key={i} className="flex gap-3 mb-3 items-start">
              <div className="w-6 h-6 rounded-full bg-orange-50 border border-orange-200 flex items-center justify-center text-xs font-bold text-orange-500 font-mono flex-shrink-0 mt-0.5">
                {i + 1}
              </div>
              <p className="text-sm text-gray-600 leading-relaxed">{step}</p>
            </div>
          ))}
        </div>
        {applicationId && subjects && subjects.length > 0 && (
          <div className="text-left mb-6 border border-gray-200 rounded p-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest font-mono mb-3">Background check authorization</p>
            {subjects.map(s => (
              <div key={s.id} className="mb-4 last:mb-0">
                <p className="text-sm font-medium text-gray-700 mb-1">{s.name}</p>
                {s.status === "awaiting_consent" && s.candidateId ? (
                  <CheckrConsentEmbed applicationId={applicationId} subjectId={s.id} candidateId={s.candidateId} />
                ) : s.status === "error" ? (
                  <p className="text-sm text-red-600">⚠ We couldn&apos;t start this background check — our team will follow up by email.</p>
                ) : (
                  <p className="text-sm text-emerald-700">✓ Submitted — status: {s.status}</p>
                )}
              </div>
            ))}
          </div>
        )}
        {screeningError && <p className="text-xs text-gray-400 mb-6">{screeningError}</p>}
        <p className="text-xs text-gray-400 mb-6">
          {t.support}{" "}
          <a href="mailto:support@topfloridaproperties.com" className="text-orange-500 font-semibold">
            support@topfloridaproperties.com
          </a>
        </p>
        <button
          onClick={() => router.push("/apply")}
          className="px-8 py-3 bg-black text-white text-sm font-semibold rounded cursor-pointer hover:bg-gray-800 transition-colors"
        >
          {t.newApp}
        </button>
      </div>
    </div>
  );
}

export default function SuccessPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <SuccessContent />
    </Suspense>
  );
}
