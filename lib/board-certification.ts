// =====================================================================
// lib/board-certification.ts
//
// Florida DBPR board-education / certification tracking. Computes, per
// board member, whether their state board-education certificate is on
// file, valid, expiring, or expired — and when their next annual
// continuing-education is due — from the uploaded documents plus the
// association's governance type.
//
// Rules (Fla. Stat., user-confirmed 2026-07-29):
//   Condo (Ch. 718) / co-op (719): initial certificate valid 7 years from
//     issuance if service is uninterrupted; 1 hour continuing ed annually,
//     first due one year after the initial certificate.
//   HOA (Ch. 720): initial certificate valid 4 years (repeat ≥ every 4
//     years); initial course within 90 days of election/appointment;
//     4 hrs/yr continuing ed under 2,500 parcels, 8 hrs/yr at 2,500+.
//
// Validity is DERIVED here (never stored) so it always reflects the
// association's current type. A service interruption resets the clock.
// =====================================================================

import { kindFromType } from '@/lib/association-audit'

export type CertKind = 'condo' | 'hoa'
export type CertDocType = 'education_certificate' | 'certification_form' | 'continuing_education'
export type BoardCertState = 'on_file' | 'expiring' | 'expired' | 'missing'

export interface BoardCertDoc {
  id: string
  doc_type: CertDocType
  certificate_date: string | null   // ISO date
  status: string                     // pending | approved | rejected
  filename: string | null
  created_at: string
}

export interface BoardMemberCertInput {
  service_start_date: string | null
  service_interrupted: boolean | null
}

export interface BoardCertSummary {
  state: BoardCertState
  /** 7 (condo/coop) or 4 (HOA) — the initial-certificate validity window. */
  validityYears: number
  /** Earliest approved education certificate's date, ISO or null. */
  initialCertDate: string | null
  /** initialCertDate + validityYears, ISO or null. */
  initialCertExpiration: string | null
  /** When the next annual continuing-education is due, ISO or null. */
  continuingEdDue: string | null
  /** A signed certification form (read-the-docs) is on file, approved. */
  hasCertificationForm: boolean
  /** Annual continuing-education hours required for this association type. */
  continuingEdHoursPerYear: number
  /** True when past due and the member should be nudged. */
  actionNeeded: boolean
}

/** Map the raw association_type to the two certification regimes. Condo,
 *  co-op, commercial condo → 7-year (Ch. 718/719). HOA / master HOA →
 *  4-year (Ch. 720). */
export function certKindFromType(associationType: string | null): CertKind {
  const k = kindFromType(associationType)          // condo | coop | commercial | hoa
  return k === 'hoa' ? 'hoa' : 'condo'
}

export function validityYears(kind: CertKind): number {
  return kind === 'hoa' ? 4 : 7
}

/** HOA continuing-ed hours scale with parcel count; condos are a flat 1 hr. */
export function continuingEdHours(kind: CertKind, parcelCount: number | null): number {
  if (kind !== 'hoa') return 1
  return (parcelCount ?? 0) >= 2500 ? 8 : 4
}

function addYears(iso: string, years: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCFullYear(d.getUTCFullYear() + years)
  return d.toISOString().slice(0, 10)
}

/** Compute a board member's certification standing. `today` is ISO (yyyy-mm-dd);
 *  defaults to now. `expiringWindowDays` marks how soon counts as "expiring". */
export function summarizeBoardMemberCert(
  member: BoardMemberCertInput,
  docs: BoardCertDoc[],
  kind: CertKind,
  parcelCount: number | null = null,
  today: string = new Date().toISOString().slice(0, 10),
  expiringWindowDays = 60,
): BoardCertSummary {
  const years = validityYears(kind)
  const hours = continuingEdHours(kind, parcelCount)

  const approved = docs.filter(d => d.status === 'approved')
  const hasCertificationForm = approved.some(d => d.doc_type === 'certification_form')
  const eduDocs = approved
    .filter(d => (d.doc_type === 'education_certificate' || d.doc_type === 'continuing_education') && d.certificate_date)
    .sort((a, b) => (a.certificate_date! < b.certificate_date! ? -1 : 1))

  const initialEdu = approved
    .filter(d => d.doc_type === 'education_certificate' && d.certificate_date)
    .sort((a, b) => (a.certificate_date! < b.certificate_date! ? -1 : 1))[0]

  const initialCertDate = initialEdu?.certificate_date ?? null
  const interrupted = !!member.service_interrupted

  // No education certificate → missing (the certification form alone does not
  // satisfy the education requirement, though we surface that it's on file).
  if (!initialCertDate) {
    return {
      state: 'missing', validityYears: years, initialCertDate: null,
      initialCertExpiration: null, continuingEdDue: null, hasCertificationForm,
      continuingEdHoursPerYear: hours, actionNeeded: true,
    }
  }

  const initialCertExpiration = addYears(initialCertDate, years)

  // Continuing ed: due one year after the most recent education/continuing-ed
  // certificate, annually thereafter.
  const latestEduDate = eduDocs[eduDocs.length - 1]!.certificate_date!
  const continuingEdDue = addYears(latestEduDate, 1)

  let state: BoardCertState
  if (interrupted || initialCertExpiration < today) {
    state = 'expired'
  } else {
    const daysToExp = Math.round((Date.parse(initialCertExpiration) - Date.parse(today)) / 86_400_000)
    const ceOverdue = continuingEdDue < today
    state = (daysToExp <= expiringWindowDays || ceOverdue) ? 'expiring' : 'on_file'
  }

  return {
    state, validityYears: years, initialCertDate, initialCertExpiration,
    continuingEdDue, hasCertificationForm, continuingEdHoursPerYear: hours,
    actionNeeded: state === 'expired',   // 'missing' already returned above
  }
}

export const CERT_DOC_LABELS: Record<CertDocType, string> = {
  education_certificate: 'Board education certificate',
  certification_form:    'Board member certification form',
  continuing_education:  'Continuing-education certificate',
}
