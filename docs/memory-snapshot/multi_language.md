---
name: multi_language
description: MAIA multi-language support — already BUILT (6 resident languages EN/ES/PT/FR/HE/RU); where each language set lives
metadata: 
  node_type: memory
  type: project
  originSessionId: 8d7a3329-593a-40ca-9d6d-b7eb81f4120a
---

**MAIA multi-language is ALREADY DEVELOPED — do NOT treat it as a backlog/missing item.** (Recorded 2026-06-12 after I wrongly claimed "only en/es exist" — the user corrected me: "all Maia system already have this developed, why you lost the memory??")

There are TWO distinct language sets in the codebase — don't conflate them:

1. **Resident / public-facing — the user's 6 languages: English, Spanish, Portuguese, French, Hebrew, Russian.**
   - `app/page.tsx`: `type Lang = 'en' | 'es' | 'pt' | 'fr' | 'he' | 'ru'` — full language picker, translated greeting + UI string maps for all 6 (e.g. `he:` עברית greeting, `ru:` Русский greeting).
   - `lib/association-documents.ts`: language options include `{ code: 'he', label: 'עברית' }`, `{ code: 'ru', label: 'Русский' }`.

2. **Vendor / crew-facing — the resident 6 PLUS Haitian Creole = 7-set: `en/es/pt/fr/he/ru/ht`** (Haitian Creole / Kreyòl serves South-FL crews; resident side does NOT carry ht). Per-vendor/employee `preferred_language` on `vendor_employees`; `office_language` on `recurring_services`.
   - `lib/recurring-services.ts`: `export const LANGUAGES = ['en','es','pt','fr','he','ru','ht']`.
   - `lib/translate.ts`: `LANG_NAMES` covers all 7 + `translateToEnglish()` (crew reports translated to English for storage).
   - Authored crew strings (all 7, switch-by-lang): agenda email `lib/recurring-agenda.ts` `agendaEmail()`; crew photo/report msg `lib/service-visits.ts` `crewMessage()`; vendor agenda page+form `app/vendor/agenda/[token]/`; vendor upload page+form `app/vendor/upload/[token]/`. Hebrew gets `dir="rtl"`.

**2026-06-12 — SHIPPED (both MERGED to main):** **PR #369** = language-set alignment (crew side was on `en/es/pt/ht/fr` with resolvers hard-collapsing to en/es; Kreyòl listed but silently fell back to English → unified to resident=6, crew=7 with authored Kreyòl). **PR #370** = the in-page switcher + save-as-default (stranded off #369's squash-merge, recovered via cherry-pick onto fresh main — the classic squash-strand again). ⚠️ existing crew rows tagged `ht` resolve fine; unknown langs fall back to en.

**Vendor in-page language switcher + save-as-default (same PR #369):** `components/VendorLangBar.tsx` on the vendor upload + agenda pages lets the viewer change language live (reloads `?lang=`) and "save as my default." Per-employee identity via `lib/crew-token.ts` (signs employee id, appended as `&e=` on upload links by `service-visits.ts`). Save endpoints: `POST /api/vendor/crew/[token]/language` → `vendor_employees.preferred_language`; `POST /api/vendor/agenda/[token]/office-language` → `recurring_services.office_language`.

**Why I "lost the memory":** I only looked at the vendor-crew slice and over-generalized to "only en/es exist" without grepping the resident-facing side. LESSON: grep the whole system before asserting a capability is missing. Related: [[session_2026_06_11_recon_estimates]].
