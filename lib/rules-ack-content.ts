// =====================================================================
// lib/rules-ack-content.ts
//
// Per-association content for the Rules Knowledge Acknowledgment, and the ONE
// place that assembles its PDF (MAIA cover → the board's own Rules pages →
// acknowledgment + signatures).
//
// Every path that produces this document goes through assembleRulesAckPdf():
// the signer's preview link, the staff preview, and the copy auto-filed onto
// the application when it completes. A signer must not be shown one document
// and have a different one filed against their name.
// =====================================================================

import type { EsignDoc } from '@/lib/esign'
import { VPCI_INSTRUCTIONS, VPCI_RULES, VPCI_STATUTORY_NOTICES, VPCI_RULES_REVISION } from '@/lib/vpci-rules-ack'
import { MANXI_INSTRUCTIONS, MANXI_RULES, MANXI_STATUTORY_NOTICES, MANXI_RULES_REVISION } from '@/lib/manxi-rules-ack'
import { loadAssociationRulesPdf, mergeRulesIntoWrapper } from '@/lib/rules-ack-pdf'

export interface RulesAckContent {
  instructions: string[]
  rules: string[]
  statutoryNotices: { title: string; body: string }[]
  rulesRevision: string | null
}

/** The acknowledgment content for an association, or null if it has none yet.
 *  Returning null rather than a generic default is deliberate: an
 *  acknowledgment listing the wrong association's rules is worse than no
 *  acknowledgment, because somebody signs it. */
export function rulesAckContentFor(associationCode: string): RulesAckContent | null {
  switch (associationCode.trim().toUpperCase()) {
    case 'VPCI':
      return {
        instructions: VPCI_INSTRUCTIONS,
        rules: VPCI_RULES,
        statutoryNotices: VPCI_STATUTORY_NOTICES,
        rulesRevision: VPCI_RULES_REVISION,
      }
    case 'MANXI':
      return {
        instructions: MANXI_INSTRUCTIONS,
        rules: MANXI_RULES,
        statutoryNotices: MANXI_STATUTORY_NOTICES,
        rulesRevision: MANXI_RULES_REVISION,
      }
    default:
      return null
  }
}

/** Render + assemble the full acknowledgment. Falls back to the wrapper alone
 *  if the association has no Rules PDF stored — the cover then shouldn't claim
 *  the rules follow, so callers should check hasRulesPdf() before sending. */
export async function assembleRulesAckPdf(doc: EsignDoc): Promise<Buffer> {
  const { renderToBuffer } = await import('@react-pdf/renderer')
  const { renderFormPdf } = await import('@/lib/esign-forms')
  const el = renderFormPdf(doc)
  if (!el) throw new Error('rules_knowledge_ack renderer not available')
  const wrapper = Buffer.from(await renderToBuffer(el))
  const rules = await loadAssociationRulesPdf(doc.association_code)
  return mergeRulesIntoWrapper(wrapper, rules)
}
