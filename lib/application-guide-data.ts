// =====================================================================
// lib/application-guide-data.ts
//
// Assembles one association's Application Guide from LIVE data —
// association_application_rules and association_intake_documents, the same
// tables the staff Required Documents panel (app/admin/pre-apply) already
// reads — plus that association's narrative content module (currently only
// lib/manxi-application-guide.ts). Nothing about the rules or the document
// checklist is duplicated as static text: edit a rule or a checklist row in
// the admin UI and the next guide generated reflects it immediately.
//
// buildApplicationGuideData() returns null for any association without a
// content module registered in GUIDE_CONTENT — callers (the PDF route, the
// landing page, the email/WhatsApp triggers) all treat null the same way:
// "not available for this association yet," never a broken/empty guide.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { getIntakeChecklistAll, APPLICATION_TYPES, type ApplicationType, type IntakeDoc } from '@/lib/intake-documents'
import {
  MANXI_GUIDE_MASTHEAD, MANXI_RULE_GROUPS, MANXI_GUIDE_NOTES, MANXI_GUIDE_STEPS,
  MANXI_GUIDE_RENEWAL_NOTE, MANXI_GUIDE_AFTER_APPROVAL, MANXI_GUIDE_FOOTER,
  type GuideMasthead, type GuideNote, type GuideStep, type GuideRegistration,
} from '@/lib/manxi-application-guide'

export interface GuideRuleGroup {
  key: 'all' | 'lease' | 'purchase' | 'other'
  label: string
  rules: { text: string; enforcement: 'block' | 'warn' }[]
  notes: string[]
}

export interface GuideChecklistRow {
  docKey: string
  label: string
  from: string
  cells: Record<ApplicationType, string>
}

export interface ApplicationGuideData {
  associationCode: string
  masthead: GuideMasthead
  ruleGroups: GuideRuleGroup[]
  steps: GuideStep[]
  renewalNote: string
  checklist: GuideChecklistRow[]
  afterApproval: GuideRegistration[]
  footer: string
  generatedAt: string
}

interface GuideContent {
  masthead: GuideMasthead
  ruleGroups: Record<string, 'all' | 'lease' | 'purchase'>
  notes: GuideNote[]
  steps: GuideStep[]
  renewalNote: string
  afterApproval: GuideRegistration[]
  footer: string
}

const GUIDE_CONTENT: Record<string, GuideContent> = {
  MANXI: {
    masthead: MANXI_GUIDE_MASTHEAD, ruleGroups: MANXI_RULE_GROUPS, notes: MANXI_GUIDE_NOTES,
    steps: MANXI_GUIDE_STEPS, renewalNote: MANXI_GUIDE_RENEWAL_NOTE,
    afterApproval: MANXI_GUIDE_AFTER_APPROVAL, footer: MANXI_GUIDE_FOOTER,
  },
}

export function guideAvailable(associationCode: string): boolean {
  return associationCode.toUpperCase() in GUIDE_CONTENT
}

const GROUP_LABEL: Record<GuideRuleGroup['key'], string> = {
  all: 'For all applicants', lease: 'For leases & lease renewals', purchase: 'For purchases', other: 'Other',
}

const FROM_LABEL: Record<string, string> = { applicant: 'Applicant', landlord: 'Owner', agent: 'Agent', both: 'Both', staff: 'Staff' }

const CONDITION_LABEL: Record<string, string> = { vehicle: 'if applic.', pet: 'if pet', assistance_animal: 'if ESA' }

function cellFor(doc: IntakeDoc | undefined): string {
  if (!doc) return '—'
  if (doc.condition_key) return CONDITION_LABEL[doc.condition_key] ?? 'if applic.'
  return doc.required ? 'Req' : 'Optional'
}

/** Build the full guide for one association, or null if none has been
 *  authored for it yet (see GUIDE_CONTENT). */
export async function buildApplicationGuideData(associationCodeRaw: string): Promise<ApplicationGuideData | null> {
  const associationCode = associationCodeRaw.trim().toUpperCase()
  const content = GUIDE_CONTENT[associationCode]
  if (!content) return null

  const [{ data: rules }, checklistByType] = await Promise.all([
    supabaseAdmin.from('association_application_rules')
      .select('rule_key, label, enforcement, active').eq('association_code', associationCode).eq('active', true).order('rule_key'),
    getIntakeChecklistAll(associationCode),
  ])

  const groups: Record<GuideRuleGroup['key'], GuideRuleGroup> = {
    all: { key: 'all', label: GROUP_LABEL.all, rules: [], notes: [] },
    lease: { key: 'lease', label: GROUP_LABEL.lease, rules: [], notes: [] },
    purchase: { key: 'purchase', label: GROUP_LABEL.purchase, rules: [], notes: [] },
    other: { key: 'other', label: GROUP_LABEL.other, rules: [], notes: [] },
  }
  for (const r of rules ?? []) {
    const key = content.ruleGroups[String(r.rule_key)] ?? 'other'
    groups[key].rules.push({ text: String(r.label ?? r.rule_key), enforcement: r.enforcement === 'block' ? 'block' : 'warn' })
  }
  for (const n of content.notes) groups[n.group].notes.push(n.text)
  const ruleGroups = (['all', 'lease', 'purchase', 'other'] as const)
    .map(k => groups[k]).filter(g => g.rules.length > 0 || g.notes.length > 0)

  // One matrix row per doc_key — representative label/from taken from
  // whichever type carries it first (lease, then renewal, purchase,
  // additional occupant), the same doc_key can genuinely differ in wording
  // across types but the guide shows one readable row, not four.
  const order: ApplicationType[] = ['lease', 'lease_renewal', 'purchase', 'additional_occupant']
  const byDocKey = new Map<string, Partial<Record<ApplicationType, IntakeDoc>>>()
  for (const type of order) {
    for (const doc of checklistByType[type]) {
      const entry = byDocKey.get(doc.doc_key) ?? {}
      entry[type] = doc
      byDocKey.set(doc.doc_key, entry)
    }
  }
  const sorted = [...byDocKey.entries()].sort((a, b) => {
    const da = order.map(t => a[1][t]).find(Boolean), db = order.map(t => b[1][t]).find(Boolean)
    return (da?.sort_order ?? 0) - (db?.sort_order ?? 0)
  })
  const checklist: GuideChecklistRow[] = sorted.map(([, byType]) => {
    const rep = order.map(t => byType[t]).find(Boolean)!
    // requires_notarization is deliberately NOT appended here — every
    // checklist row that carries it already says so in its own label text
    // (e.g. "Tenant Affidavit (signed & notarized by tenant and landlord)"),
    // confirmed by generating a real PDF and seeing "(Notarized) (Notarized)".
    return {
      docKey: rep.doc_key,
      label: rep.label, from: FROM_LABEL[rep.provided_by] ?? rep.provided_by,
      cells: {
        lease: cellFor(byType.lease), lease_renewal: cellFor(byType.lease_renewal),
        purchase: cellFor(byType.purchase), additional_occupant: cellFor(byType.additional_occupant),
      },
    }
  })

  return {
    associationCode, masthead: content.masthead, ruleGroups, steps: content.steps,
    renewalNote: content.renewalNote, checklist, afterApproval: content.afterApproval,
    footer: content.footer, generatedAt: new Date().toISOString(),
  }
}

export { APPLICATION_TYPES }
