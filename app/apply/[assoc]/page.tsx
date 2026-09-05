// /apply/[assoc]  (assoc = association_code, e.g. /apply/MANXI)
//
// The per-association link for the OLD /apply wizard: the applicant lands
// with their association already locked in (ApplicationForm's existing
// preselectedAssociation prop hides the search field and starts one step
// in) and only picks their own unit. Resolved server-side so there's no
// flash of a raw code before the friendly name loads.
//
// This is the link staff should send real applicants going forward,
// instead of the bare, fully-generic /apply.

import { supabaseAdmin } from "@/lib/supabase-admin";
import ApplicationForm from "@/components/ApplicationForm";

export const dynamic = "force-dynamic";

export default async function ApplyForAssociationPage({
  params,
}: {
  params: Promise<{ assoc: string }>;
}) {
  const { assoc } = await params;
  const code = assoc.trim().toUpperCase();

  const { data } = await supabaseAdmin
    .from("associations")
    .select("association_name, active")
    .eq("association_code", code)
    .maybeSingle();

  if (!data || data.active === false) {
    return (
      <div style={{ minHeight: "100vh", background: "#000", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ background: "#fff", borderRadius: 8, maxWidth: 480, padding: "40px 36px", textAlign: "center" }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: "#f26a1b", textTransform: "uppercase", letterSpacing: ".08em", margin: "0 0 12px" }}>
            PMI Top Florida Properties
          </p>
          <p style={{ fontSize: 14, color: "#3a3f4a", margin: 0 }}>
            This application link isn&apos;t valid, or this association isn&apos;t accepting online applications right now.
            Please contact <a href="mailto:support@topfloridaproperties.com" style={{ color: "#f26a1b", fontWeight: 600 }}>support@topfloridaproperties.com</a>.
          </p>
        </div>
      </div>
    );
  }

  return <ApplicationForm preselectedAssociation={data.association_name as string} />;
}
