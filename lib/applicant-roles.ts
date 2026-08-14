// =====================================================================
// lib/applicant-roles.ts
//
// The roles a person can hold on an application. One list, because it is now
// shown in two places — staff editing the roster on /admin/pre-apply/[id], and
// the OWNER filling the roster in from their request link — and a second copy
// would drift into storing display labels where the rest of the system reads
// slugs (see lib/intake-naming.ts for the last time a duplicated map bit us).
// =====================================================================

export const APPLICANT_ROLES: { key: string; label: string }[] = [
  { key: 'primary_applicant', label: 'Primary Applicant' }, { key: 'co_applicant', label: 'Co-Applicant' },
  { key: 'owner', label: 'Owner' }, { key: 'tenant', label: 'Tenant' }, { key: 'spouse_partner', label: 'Spouse / Partner' },
  { key: 'adult_occupant', label: 'Adult Occupant' }, { key: 'minor_dependent', label: 'Minor / Dependent' }, { key: 'guarantor', label: 'Guarantor' },
]

export const applicantRoleLabel = (v: string | null | undefined) => APPLICANT_ROLES.find(r => r.key === v)?.label ?? ''

/** The subset an OWNER is asked to choose from for the people moving in —
 *  "Primary Applicant"/"Co-Applicant" are staff vocabulary, not theirs. */
export const OCCUPANT_ROLES = APPLICANT_ROLES.filter(r => ['tenant', 'spouse_partner', 'adult_occupant', 'minor_dependent', 'guarantor'].includes(r.key))

export const isApplicantRole = (v: string) => APPLICANT_ROLES.some(r => r.key === v)
