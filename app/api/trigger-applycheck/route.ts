import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-internal-secret");
  if (process.env.INTERNAL_API_SECRET && secret !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { applicationId } = await req.json();
  if (!applicationId) return NextResponse.json({ error: "applicationId required" }, { status: 400 });

  const apiKey = process.env.APPLYCHECK_API_KEY;
  const accountId = process.env.APPLYCHECK_ACCOUNT_ID;

  if (!apiKey || !accountId) {
    return NextResponse.json({ error: "Applycheck credentials not configured" }, { status: 503 });
  }

  const { data: app, error } = await supabase
    .from("applications")
    .select("*")
    .eq("id", applicationId)
    .single();

  if (error || !app) return NextResponse.json({ error: "Application not found" }, { status: 404 });
  if (app.stripe_payment_status !== "paid") {
    return NextResponse.json({ error: "Payment not confirmed" }, { status: 400 });
  }

  type Subject = { name: string; email?: string; dob?: string; package: string };
  const subjects: Subject[] = [];

  if (app.app_type === "commercial") {
    (app.principals || []).forEach((p: Record<string, string>) => {
      subjects.push({ name: p.name, dob: p.dob, package: "SmartMove" });
    });
  } else {
    (app.applicants || []).forEach((a: Record<string, string>) => {
      const hasSSN = a.ssn && /^\d{3}-?\d{2}-?\d{4}$/.test(a.ssn);
      subjects.push({
        name: `${a.firstName} ${a.lastName}`.trim(),
        email: a.email,
        dob: a.dob,
        package: hasSSN ? "SmartMove" : "International",
      });
    });
  }

  const results = await Promise.allSettled(
    subjects.map(async (s) => {
      const res = await fetch("https://api.applycheck.com/v1/screenings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "X-Account-ID": accountId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          applicant: { full_name: s.name, email: s.email, date_of_birth: s.dob },
          package: s.package,
          reference: applicationId,
          webhook_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/applycheck-webhook`,
        }),
      });
      if (!res.ok) throw new Error(`Applycheck ${res.status}`);
      return res.json();
    })
  );

  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;
  const status = failed === 0 ? "invited" : succeeded > 0 ? "partial" : "error";

  await supabase.from("applications").update({ applycheck_status: status }).eq("id", applicationId);

  return NextResponse.json({ ok: true, subjects: subjects.length, succeeded, failed, status });
}
