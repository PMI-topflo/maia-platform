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

      await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/trigger-applycheck`, {
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
