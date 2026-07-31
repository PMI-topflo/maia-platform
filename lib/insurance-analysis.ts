// =====================================================================
// lib/insurance-analysis.ts
//
// Read a UNIT insurance document by its actual COVERAGES (not just its title/
// ACORD form) and decide what it really is:
//   • ho6            — condo UNIT-OWNER policy: dwelling/building (Cov A) +
//                      improvements & betterments, personal property, loss
//                      assessment, loss of use, water damage, liability.
//   • ho4            — RENTER/tenant policy: tenant named insured + personal
//                      property + loss of use + liability (NO building cover).
//   • liability_only — a "Comprehensive Personal Liability" / landlord CPL
//                      policy: ONLY personal liability + medical payments, no
//                      property/dwelling/contents. Common for an LLC/owner
//                      renting the unit — does NOT prove the unit is insured.
//   • other          — a different policy (flood, wind, master, etc.).
//
// Catches the case where a liability-only binder was mislabeled HO-6. Best-
// effort; never throws.
// =====================================================================

import Anthropic from '@anthropic-ai/sdk'
import { assertClaudeBudget } from '@/lib/anthropic-guard'

const HAIKU = 'claude-haiku-4-5-20251001'

export type PolicyType = 'ho6' | 'ho4' | 'liability_only' | 'other'

export interface InsuranceAnalysis {
  policyType: PolicyType
  namedInsured: string | null
  insuredIsEntity: boolean            // named insured is an LLC/Inc, not a person
  hasDwellingCoverage: boolean        // building / Coverage A / improvements & betterments
  hasPersonalProperty: boolean
  hasLossAssessment: boolean
  hasLiability: boolean
  effectiveDate: string | null
  expirationDate: string | null
  // Whether it's acceptable as proof the UNIT itself is insured (HO-6 owner or
  // HO-4 renter). A liability-only policy is NOT.
  adequateForUnit: boolean
  recommendation: string | null       // what to request when inadequate
  confidence: number
}

function isoDate(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}
function bool(v: unknown): boolean { return v === true || v === 'true' }
function mediaTypeFor(ct?: string | null): 'image/jpeg' | 'image/png' | 'image/webp' {
  const c = (ct ?? '').toLowerCase()
  if (c.includes('png')) return 'image/png'
  if (c.includes('webp')) return 'image/webp'
  return 'image/jpeg'
}

const PROMPT = `You are an insurance compliance reviewer for a Florida CONDOMINIUM. Read this policy/binder by its ACTUAL COVERAGES, not its title, and classify it.

Definitions:
- "ho6" = condo UNIT-OWNER policy: has building/dwelling coverage (Coverage A) or improvements & betterments, usually personal property, loss assessment, loss of use, water damage, and personal liability.
- "ho4" = RENTER/tenant policy: tenant is the named insured, has personal property (Coverage C), loss of use, personal liability — but NO building/dwelling coverage.
- "liability_only" = a "Comprehensive Personal Liability" / landlord CPL policy: ONLY personal liability and medical payments, NO property/dwelling/contents/loss-of-use. Often the named insured is a company (LLC/Inc) renting the unit. This does NOT prove the unit is physically insured.
- "other" = something else (flood, windstorm, master association policy, etc.).

Return ONLY minified JSON:
{"policy_type":"ho6"|"ho4"|"liability_only"|"other","named_insured":string|null,"insured_is_entity":bool,"has_dwelling_coverage":bool,"has_personal_property":bool,"has_loss_assessment":bool,"has_liability":bool,"effective_date":"YYYY-MM-DD"|null,"expiration_date":"YYYY-MM-DD"|null,"adequate_for_unit":bool,"recommendation":string|null,"confidence":0..1}
- adequate_for_unit: true only if it's a real ho6 (unit owner property) or ho4 (renter) policy. A liability_only policy is false.
- recommendation: if not adequate, say what to request (e.g. "Request the full HO-6 declarations page showing dwelling/building and loss-assessment coverage").`

export async function analyzeInsurance(buf: Buffer, contentType: string | null): Promise<InsuranceAnalysis> {
  const empty: InsuranceAnalysis = {
    policyType: 'other', namedInsured: null, insuredIsEntity: false,
    hasDwellingCoverage: false, hasPersonalProperty: false, hasLossAssessment: false, hasLiability: false,
    effectiveDate: null, expirationDate: null, adequateForUnit: false, recommendation: null, confidence: 0,
  }
  if (!process.env.ANTHROPIC_API_KEY) return empty
  try {
    const isPdf = buf.subarray(0, 5).toString('latin1') === '%PDF-' || (contentType ?? '').includes('pdf')
    const b64 = buf.toString('base64')
    const block = isPdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
      : { type: 'image', source: { type: 'base64', media_type: mediaTypeFor(contentType), data: b64 } }

    await assertClaudeBudget('insurance-analysis')
    const anthropic = new Anthropic()
    const msg = await anthropic.messages.create({
      model: HAIKU, max_tokens: 400,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: [{ role: 'user', content: [block as any, { type: 'text', text: PROMPT }] }],
    })
    const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('').trim()
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return empty
    const o = JSON.parse(m[0]) as Record<string, unknown>
    const pt = o.policy_type
    const policyType: PolicyType = pt === 'ho6' || pt === 'ho4' || pt === 'liability_only' ? pt : 'other'
    return {
      policyType,
      namedInsured: typeof o.named_insured === 'string' ? o.named_insured.trim() || null : null,
      insuredIsEntity: bool(o.insured_is_entity),
      hasDwellingCoverage: bool(o.has_dwelling_coverage),
      hasPersonalProperty: bool(o.has_personal_property),
      hasLossAssessment: bool(o.has_loss_assessment),
      hasLiability: bool(o.has_liability),
      effectiveDate: isoDate(o.effective_date),
      expirationDate: isoDate(o.expiration_date),
      adequateForUnit: bool(o.adequate_for_unit),
      recommendation: typeof o.recommendation === 'string' ? o.recommendation.trim() || null : null,
      confidence: typeof o.confidence === 'number' ? Math.max(0, Math.min(1, o.confidence)) : 0,
    }
  } catch { return empty }
}
