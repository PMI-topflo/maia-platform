// =====================================================================
// lib/rules-ack-pdf.ts
//
// Assembles the Rules Knowledge Acknowledgment:
//
//   [1] MAIA cover page  — instructions, key-rules summary, statutory notices
//   [2] the ASSOCIATION'S OWN Rules and Regulations pages, verbatim
//   [3] MAIA acknowledgment + verified electronic signatures
//
// The board asked to keep their original pages, and they were right to: the
// Rules and Regulations are a governing document. Retyping nine pages of them
// into a renderer would introduce a transcription risk into the exact text an
// owner is bound by, and any drift between the signed copy and the recorded
// document is the kind of thing that surfaces in a dispute. So the middle is
// the board's real PDF, byte-for-byte, and MAIA only wraps it.
// =====================================================================

import { PDFDocument } from 'pdf-lib'
import { supabaseAdmin } from '@/lib/supabase-admin'

/** Where an association's Rules & Regulations PDF lives. */
export const RULES_BUCKET = 'association-docs'

/** Splice the association's Rules pages between MAIA's cover and signature
 *  pages. `wrapper` is the 2-page render from the esign form. */
export async function mergeRulesIntoWrapper(wrapper: Buffer, rulesPdf: Buffer | null): Promise<Buffer> {
  const out = await PDFDocument.create()
  const wrap = await PDFDocument.load(wrapper)
  const total = wrap.getPageCount()
  if (total < 2) throw new Error(`rules-ack wrapper needs a cover and a signature page, got ${total}`)

  // Everything EXCEPT the last page is the cover section, and the last page is
  // the signatures. Do NOT assume the cover is exactly one page: the rules
  // summary and statutory notices overflow onto a second page as soon as an
  // association carries a few more rules, and hard-coding index 1 as "the
  // signature page" silently drops the signatures — which is exactly what an
  // earlier version of this did.
  const coverIdx = Array.from({ length: total - 1 }, (_, i) => i)
  for (const p of await out.copyPages(wrap, coverIdx)) out.addPage(p)

  // The board's own pages, verbatim. A missing/unreadable rules PDF must not
  // silently produce a document that claims the rules "follow this page" — the
  // caller decides, but we surface it rather than quietly dropping them.
  if (rulesPdf) {
    const rules = await PDFDocument.load(rulesPdf)
    const pages = await out.copyPages(rules, rules.getPageIndices())
    for (const p of pages) out.addPage(p)
  }

  // Acknowledgment + signatures, last.
  const [sig] = await out.copyPages(wrap, [total - 1])
  out.addPage(sig)

  return Buffer.from(await out.save())
}

/** Fetch an association's stored Rules & Regulations PDF, or null. */
export async function loadAssociationRulesPdf(associationCode: string): Promise<Buffer | null> {
  const { data: assoc } = await supabaseAdmin.from('associations')
    .select('rules_pdf_path').eq('association_code', associationCode.toUpperCase()).maybeSingle()
  const path = (assoc?.rules_pdf_path as string | null) ?? null
  if (!path) return null
  const { data } = await supabaseAdmin.storage.from(RULES_BUCKET).download(path)
  if (!data) return null
  return Buffer.from(await data.arrayBuffer())
}

/** Whether an association can produce a complete acknowledgment yet. */
export async function hasRulesPdf(associationCode: string): Promise<boolean> {
  return (await loadAssociationRulesPdf(associationCode)) !== null
}
