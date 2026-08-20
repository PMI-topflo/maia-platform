// =====================================================================
// lib/application-handoff.ts
//
// On approval, hand the completed + audited package to the association's
// screening provider. Hybrid rollout: MANXI = tenant_evaluation (email the
// package to staff to proceed on the current system); maia_checkr triggers
// MAIA's own Checkr order when a detailed application is linked (dormant
// until an association flips).
//
// Extracted out of app/api/admin/pre-apply/[id]/route.ts's PATCH 'approve'
// handler — that was the ONLY caller until now, so the manual board-approve
// button (app/api/admin/pre-apply/[id]/board-approve) and the fully
// automatic approval_sent -> approved transition (lib/esign.ts) both
// silently skipped this handoff. Both now call it explicitly.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'

const HANDOFF_NOTIFY = (process.env.UNIT_UPLOAD_NOTIFY_EMAILS ?? 'PMI@topfloridaproperties.com,ar@topfloridaproperties.com')
  .split(',').map(s => s.trim()).filter(Boolean)
const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))

export async function handoffOnApproval(applicationId: string, byRole: string): Promise<void> {
  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('association_code, application_type, unit_label, drive_folder_url, detailed_application_id').eq('id', applicationId).maybeSingle()
  if (!app) return
  const [{ data: assoc }, { data: sh }] = await Promise.all([
    supabaseAdmin.from('associations').select('screening_provider, association_name').eq('association_code', String(app.association_code)).maybeSingle(),
    supabaseAdmin.from('application_stakeholders').select('name, email, phone').eq('application_id', applicationId).eq('role', 'applicant').eq('is_primary', true).maybeSingle(),
  ])
  const provider = (assoc?.screening_provider as string | null) ?? 'tenant_evaluation'

  if (provider === 'maia_checkr') {
    // Trigger MAIA's Checkr pipeline only when a detailed application is linked.
    if (app.detailed_application_id && process.env.INTERNAL_API_SECRET) {
      await fetch(`${APP}/api/trigger-screening`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-secret': process.env.INTERNAL_API_SECRET },
        body: JSON.stringify({ applicationId: app.detailed_application_id }),
      }).catch(() => null)
    }
    return
  }

  // tenant_evaluation: email the audited package to staff to proceed on the
  // current screening system.
  if (HANDOFF_NOTIFY.length) {
    void sendEmail({
      to: HANDOFF_NOTIFY,
      subject: `Approved — proceed on Tenant Evaluation: ${app.association_code} ${app.unit_label ? `Unit ${app.unit_label}` : ''} (${app.application_type})`,
      html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.5">
        <p><strong>${esc(sh?.name ?? 'Applicant')}</strong>'s ${esc(String(app.application_type))} application for <strong>${esc(String(app.association_code))}</strong>${app.unit_label ? ` Unit ${esc(String(app.unit_label))}` : ''} passed compliance audit and was <strong>approved (${esc(byRole)})</strong>.</p>
        <p>Applicant: ${esc(sh?.email ?? '')}${sh?.phone ? ` · ${esc(String(sh.phone))}` : ''}</p>
        ${app.drive_folder_url ? `<p>📁 <a href="${app.drive_folder_url}">Documents in Drive →</a></p>` : ''}
        <p>Next step: proceed with the background check on the current Tenant Evaluation system.</p>
        <p><a href="${APP}/admin/pre-apply/${applicationId}">Open the application →</a></p>
      </div>`,
    }).catch(() => null)
  }
}
