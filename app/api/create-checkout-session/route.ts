import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2023-10-16",
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { amount, applicantEmail, applicationType, association, applicationId, lang = "en" } = body;

    if (!amount || !applicationType || !applicationId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const origin = req.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

    let lineItems: Stripe.Checkout.SessionCreateParams.LineItem[];

    if (applicationType === "individual") {
      lineItems = [{ price: process.env.STRIPE_PRICE_INDIVIDUAL!, quantity: 1 }];
    } else if (applicationType === "additionalResident") {
      lineItems = [{ price: process.env.STRIPE_PRICE_ADDITIONAL!, quantity: 1 }];
    } else if (applicationType === "couple") {
      if (amount === 150) {
        lineItems = [{ price: process.env.STRIPE_PRICE_COUPLE!, quantity: 1 }];
      } else {
        lineItems = [{ price: process.env.STRIPE_PRICE_INDIVIDUAL!, quantity: 2 }];
      }
    } else if (applicationType === "commercial") {
      const numPrincipals = Math.round(amount / 150);
      lineItems = [{ price: process.env.STRIPE_PRICE_COMMERCIAL!, quantity: numPrincipals }];
    } else if (applicationType === "international") {
      lineItems = [{ price: process.env.STRIPE_PRICE_INTERNATIONAL!, quantity: 1 }];
    } else {
      return NextResponse.json({ error: `Unknown type: ${applicationType}` }, { status: 400 });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: applicantEmail || undefined,
      line_items: lineItems,
      metadata: { applicationId, applicationType, association, lang },
      success_url: `${origin}/apply/success?session_id={CHECKOUT_SESSION_ID}&lang=${lang}&ref=PMI-${applicationId.slice(0, 8).toUpperCase()}`,
      cancel_url: `${origin}/apply?cancelled=1`,
    });

    return NextResponse.json({ sessionId: session.id });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[create-checkout-session]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
