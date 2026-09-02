import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { sendEmail } from "@/lib/gmail";
import { logEmail } from "@/lib/email-logger";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2023-10-16" });

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature")!;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[stripe-webhook] Signature failed:", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;

    // The $150 re-screening charge (docs/ROADMAP.md's "Re-screening charge"
    // section, app/rescreen/[token]) is a distinct payment purpose from the
    // original application fee below -- own metadata shape, own follow-up
    // (a fresh Checkr order via the same /api/trigger-screening endpoint,
    // not the applications-table update the rest of this handler does).
    // Branches BEFORE the applicationId check below since this purpose
    // never carries one.
    if (session.metadata?.purpose === "rescreening") {
      await handleRescreeningPayment(session);
      return NextResponse.json({ received: true });
    }

    const { applicationId, lang } = session.metadata || {};

    if (!applicationId) {
      console.error("[stripe-webhook] No applicationId in metadata");
      return NextResponse.json({ received: true });
    }

    try {
      const { data: app, error } = await supabase
        .from("applications")
        .update({
          stripe_session_id: session.id,
          stripe_payment_status: "paid",
          stripe_amount_paid: session.amount_total,
        })
        .eq("id", applicationId)
        .select()
        .single();

      if (error) throw new Error("Supabase update failed: " + error.message);

      await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/trigger-screening`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": process.env.INTERNAL_API_SECRET || "",
        },
        body: JSON.stringify({ applicationId }),
      });

      await sendApplicantEmail(app, session, lang || "en");
      await sendTeamEmail(app, session);

      console.log(`[stripe-webhook] Processed: ${applicationId}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[stripe-webhook] Error:", message);
    }
  }

  return NextResponse.json({ received: true });
}

// The exact required legal framing (user-provided, Florida condo
// §718.112(2)(k) context) -- copy this string verbatim everywhere the
// re-screening charge is mentioned. Never paraphrase it.
const RESCREENING_NOT_AN_APPLICATION_FEE_NOTICE =
  "This is not an association application fee. It reimburses the actual cost of " +
  "obtaining a new third-party background/credit report and processing it in the " +
  "system, required because your prior screening expired 45+ days ago without your " +
  "application being completed.";

async function handleRescreeningPayment(session: Stripe.Checkout.Session) {
  const { rescreeningPaymentId, listingApplicationId } = session.metadata || {};
  if (!rescreeningPaymentId || !listingApplicationId) {
    console.error("[stripe-webhook] rescreening: missing metadata");
    return;
  }
  try {
    await supabase.from("rescreening_payments")
      .update({ status: "paid", paid_at: new Date().toISOString(), stripe_session_id: session.id })
      .eq("id", rescreeningPaymentId);

    const { data: listingApp } = await supabase.from("listing_applications")
      .select("detailed_application_id, association_code, unit_label")
      .eq("id", listingApplicationId).maybeSingle();
    const detailedId = listingApp?.detailed_application_id as string | null;

    // A fresh Checkr order for every subject on the application -- same
    // endpoint the original screening used, so there's exactly one place
    // that knows how to build a Checkr order from an application's roster.
    if (detailedId) {
      await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/trigger-screening`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-secret": process.env.INTERNAL_API_SECRET || "" },
        body: JSON.stringify({ applicationId: detailedId }),
      });
    } else {
      console.error(`[stripe-webhook] rescreening: no detailed_application_id for listing_application ${listingApplicationId}`);
    }

    const { data: primary } = await supabase.from("application_stakeholders")
      .select("name, email").eq("application_id", listingApplicationId).eq("role", "applicant").eq("is_primary", true).maybeSingle();
    const to = primary?.email as string | null;
    if (to) {
      const unit = (listingApp?.unit_label as string | null) ?? "—";
      const subject = `Payment received — new background screening started, Unit ${unit}`;
      const text = `Dear ${(primary?.name as string | null) || "Applicant"},\n\nYour $150 payment was received and a new background screening has started for Unit ${unit}.\n\n${RESCREENING_NOT_AN_APPLICATION_FEE_NOTICE}\n\nPMI Top Florida Properties | (305) 900-5077`;
      try {
        const { messageId } = await sendEmail({ to, subject, text });
        void logEmail({ toEmail: to, subject, fullBody: text, persona: "buyer", resendMessageId: messageId });
      } catch (err) { console.error("[stripe-webhook] rescreening applicant email failed:", err); }
    }

    const staffTo = "support@topfloridaproperties.com";
    const staffSubject = `[Re-screening paid] ${listingApp?.association_code ?? "—"} · Unit ${listingApp?.unit_label ?? "—"}`;
    const staffText = `Re-screening payment received.\nAssociation: ${listingApp?.association_code}\nUnit: ${listingApp?.unit_label}\nPaid: $${((session.amount_total || 0) / 100).toFixed(2)}\nlisting_applications.id: ${listingApplicationId}`;
    try {
      const { messageId } = await sendEmail({ to: staffTo, subject: staffSubject, text: staffText });
      void logEmail({ toEmail: staffTo, subject: staffSubject, fullBody: staffText, persona: "buyer", resendMessageId: messageId });
    } catch (err) { console.error("[stripe-webhook] rescreening team email failed:", err); }

    console.log(`[stripe-webhook] Rescreening processed: ${listingApplicationId}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[stripe-webhook] Rescreening error:", message);
  }
}

async function sendApplicantEmail(app: Record<string, unknown>, session: Stripe.Checkout.Session, lang: string) {
  const applicants = app.applicants as Array<Record<string, string>> | null;
  const to = applicants?.[0]?.email;
  if (!to) return;
  const refNum = "PMI-" + (app.id as string).slice(0, 8).toUpperCase();
  const subject = `Application Received — ${app.association} · ${refNum}`;
  const text = `Dear Applicant,\n\nYour application for ${app.association} has been received.\n\nReference: ${refNum}\nAmount Paid: $${((session.amount_total || 0) / 100).toFixed(2)}\n\nThe board will review within 7-10 business days.\n\nPMI Top Florida Properties | (305) 900-5077 · WhatsApp (786) 686-3223`;
  try {
    const { messageId } = await sendEmail({ to, subject, text });
    void logEmail({ toEmail: to, subject, fullBody: text, persona: 'buyer', resendMessageId: messageId });
  } catch (err) { console.error("[stripe-webhook] Applicant email failed:", err); }
}

async function sendTeamEmail(app: Record<string, unknown>, session: Stripe.Checkout.Session) {
  const refNum = "PMI-" + (app.id as string).slice(0, 8).toUpperCase();
  const applicants = app.applicants as Array<Record<string, string>> | null;
  const principals = app.principals as Array<Record<string, string>> | null;
  const list = app.app_type === "commercial"
    ? (principals || []).map((p, i) => `Principal ${i + 1}: ${p.name}`).join("\n")
    : (applicants || []).map((a, i) => `Applicant ${i + 1}: ${a.firstName} ${a.lastName} · ${a.email}`).join("\n");
  const subject = `[New Application] ${app.association} · ${refNum}`;
  const text = `NEW APPLICATION — ${refNum}\nAssociation: ${app.association}\nType: ${app.app_type}\nPaid: $${((session.amount_total || 0) / 100).toFixed(2)}\n\n${list}\n\nSupabase ID: ${app.id}`;
  try {
    const { messageId } = await sendEmail({ to: "support@topfloridaproperties.com", subject, text });
    void logEmail({ toEmail: "support@topfloridaproperties.com", subject, fullBody: text, persona: 'buyer', resendMessageId: messageId });
  } catch (err) { console.error("[stripe-webhook] Team email failed:", err); }
}
