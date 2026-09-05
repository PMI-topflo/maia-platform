"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState, Suspense } from "react";

interface ScreeningSubject { id: string; name: string | null; status: string }

const copy: Record<string, Record<string, string>> = {
  en: {
    heading: "Payment Received",
    body: "Your payment has been confirmed. If you have more documents to add, use the button below — no need to start over.",
    ref: "Reference Number",
    next: "What happens next",
    s1: "Add more documents any time using the button below, if you have any.",
    s2: "Checkr will email each applicant a secure link to complete a quick background-check step.",
    s3: "Once your background check is complete, our team will review all your documents.",
    s4: "We'll notify you as soon as your application is complete.",
    support: "Questions? Email us at",
    continueDocs: "Continue — Upload More Documents",
    newApp: "Start a different application",
  },
  es: {
    heading: "Pago Recibido",
    body: "Su pago ha sido confirmado. Si tiene más documentos para agregar, use el botón de abajo — no es necesario comenzar de nuevo.",
    ref: "Número de Referencia",
    next: "¿Qué sigue?",
    s1: "Agregue más documentos cuando lo necesite usando el botón de abajo.",
    s2: "Checkr le enviará a cada solicitante un enlace seguro para completar un breve paso de verificación de antecedentes.",
    s3: "Una vez completada su verificación de antecedentes, nuestro equipo revisará todos sus documentos.",
    s4: "Le notificaremos en cuanto su solicitud esté completa.",
    support: "¿Preguntas? Escríbanos a",
    continueDocs: "Continuar — Subir Más Documentos",
    newApp: "Iniciar una solicitud diferente",
  },
  pt: {
    heading: "Pagamento Recebido",
    body: "Seu pagamento foi confirmado. Se tiver mais documentos para adicionar, use o botão abaixo — não é necessário começar de novo.",
    ref: "Número de Referência",
    next: "O que acontece agora",
    s1: "Adicione mais documentos quando quiser usando o botão abaixo.",
    s2: "A Checkr enviará a cada solicitante um link seguro para concluir uma breve etapa de verificação de antecedentes.",
    s3: "Assim que sua verificação de antecedentes for concluída, nossa equipe revisará todos os seus documentos.",
    s4: "Você será notificado assim que sua solicitação estiver completa.",
    support: "Dúvidas? Envie e-mail para",
    continueDocs: "Continuar — Enviar Mais Documentos",
    newApp: "Iniciar uma solicitação diferente",
  },
  fr: {
    heading: "Paiement Reçu",
    body: "Votre paiement a été confirmé. Si vous avez d'autres documents à ajouter, utilisez le bouton ci-dessous — pas besoin de recommencer.",
    ref: "Numéro de Référence",
    next: "Prochaines étapes",
    s1: "Ajoutez d'autres documents à tout moment à l'aide du bouton ci-dessous.",
    s2: "Checkr enverra à chaque demandeur un lien sécurisé pour compléter une brève étape de vérification des antécédents.",
    s3: "Une fois votre vérification des antécédents terminée, notre équipe examinera tous vos documents.",
    s4: "Nous vous informerons dès que votre demande sera complète.",
    support: "Questions ? Écrivez-nous à",
    continueDocs: "Continuer — Téléverser Plus de Documents",
    newApp: "Démarrer une autre demande",
  },
  he: {
    heading: "התשלום התקבל",
    body: "התשלום שלך אושר. אם יש לך מסמכים נוספים להוסיף, השתמש בכפתור למטה — אין צורך להתחיל מחדש.",
    ref: "מספר אסמכתא",
    next: "מה קורה עכשיו",
    s1: "הוסף מסמכים נוספים בכל עת באמצעות הכפתור למטה.",
    s2: "Checkr תשלח לכל מגיש בקשה קישור מאובטח להשלמת שלב קצר של בדיקת רקע.",
    s3: "לאחר השלמת בדיקת הרקע, הצוות שלנו יבדוק את כל המסמכים שלך.",
    s4: "נודיע לך ברגע שהבקשה שלך תושלם.",
    support: "שאלות? שלח לנו אימייל",
    continueDocs: "המשך — העלה מסמכים נוספים",
    newApp: "התחל בקשה אחרת",
  },
  ru: {
    heading: "Оплата получена",
    body: "Ваша оплата подтверждена. Если у вас есть дополнительные документы, используйте кнопку ниже — начинать заново не нужно.",
    ref: "Номер заявки",
    next: "Дальнейшие шаги",
    s1: "Добавляйте дополнительные документы в любое время с помощью кнопки ниже.",
    s2: "Checkr отправит каждому заявителю защищённую ссылку для завершения краткой проверки биографических данных.",
    s3: "После завершения проверки биографических данных наша команда рассмотрит все ваши документы.",
    s4: "Мы уведомим вас, как только ваша заявка будет завершена.",
    support: "Вопросы? Напишите нам по адресу",
    continueDocs: "Продолжить — Загрузить больше документов",
    newApp: "Начать другую заявку",
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
                {s.status === "awaiting_applicant" ? (
                  <p className="text-sm text-gray-600">Checkr has emailed {s.name} a secure link to complete a quick background-check step.</p>
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
        {applicationId ? (
          <button
            onClick={() => router.push(`/apply/documents/${applicationId}`)}
            className="px-8 py-3 bg-black text-white text-sm font-semibold rounded cursor-pointer hover:bg-gray-800 transition-colors"
          >
            {t.continueDocs}
          </button>
        ) : (
          <button
            onClick={() => router.push("/apply")}
            className="px-8 py-3 bg-black text-white text-sm font-semibold rounded cursor-pointer hover:bg-gray-800 transition-colors"
          >
            {t.newApp}
          </button>
        )}
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
