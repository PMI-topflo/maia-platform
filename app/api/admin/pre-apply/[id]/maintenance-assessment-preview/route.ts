// GET /api/admin/pre-apply/[id]/maintenance-assessment-preview
//
// Staff-only read of exactly what the Maintenance Assessment Acknowledgment
// would say right now — same builder createAndSend() actually uses
// (lib/application-esign-forms.ts's previewMaintenanceAssessmentAck), so
// this can never drift from what gets sent. Creates and sends nothing.
//
// User direction, 2026-09-01 (after the special-assessment mixup on MANXI
// 303, Wilner Florestan — the ledger lookup picked a Special Assessment
// charge instead of the recurring quarterly one): "place a button for me to
// preview before sending so I can see it before pushing the request."

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { previewMaintenanceAssessmentAck } from '@/lib/application-esign-forms'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const preview = await previewMaintenanceAssessmentAck(id)
  if ('error' in preview) return NextResponse.json(preview, { status: 400 })
  return NextResponse.json(preview)
}
