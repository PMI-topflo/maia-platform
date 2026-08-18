# Applications — email playbook & FAQ

**Living document.** Built case-by-case from real applicant/owner/agent emails, verified against the actual code each time — not written from assumption. Every entry below was checked against the pipeline as it exists on `main`, not guessed.

For the underlying rules the pipeline itself follows (the 30-day window, document states, checklist semantics), see `docs/SESSION-HANDOFF.md`. This file is about the human procedure around it: what a person on the team should *do* when a real email arrives.

---

## Ground truth: what MAIA does and does not do with email, today

Confirmed by reading the code, not assumed.

### `@maia upapp CODE###` (e.g. `@maia upapp MANXI103`)
- **Staff-only.** Sender must be `@topfloridaproperties.com`, `@pmitop.com`, or `@mypmitop.com`. An applicant or agent emailing this trigger does nothing — it's not even seen as a command for them.
- Logs the email's **subject + body text + attachment *filenames*** into that application's Communication history, with the original email's date.
- **Does NOT file the attachment content anywhere.** `attachment_names` is stored as a text field for the record — the PDF itself is not copied, not filed onto a checklist item, not touched. If you forward a signed lease with this trigger, the history will say "attachment: lease.pdf" and the lease itself goes nowhere.
- Replies to the sender confirming what was logged (or why it wasn't — no matching application, empty body, etc).

### An applicant or agent emailing `maia@` directly
- Sender is external → routed to the generic freeform AI conversation handler (Sonnet, `general_conversations` table).
- **This handler has no awareness of applications, checklists, or Drive folders.** It will hold a plausible conversation and knows nothing about what's actually outstanding on their unit.
- Any attachment they send is not processed by this path at all.

### The only three ways a document actually lands on a checklist
1. **Staff uploads it directly** on `/admin/pre-apply/[id]` — mirrors to Drive and files the row in one step. The Drive-mirror half can fail silently (best-effort, no error logged) even when the MAIA save succeeds — seen for real on MANXI 613, 2026-08-18: 5 documents saved and visible on the checklist, `drive_folder_id` still null, nothing in the Drive folder. If a document you know is filed in MAIA isn't showing up in Drive, open the application page — a **"📤 Send these documents to Drive"** button appears automatically whenever documents exist but no Drive folder is set yet (`/api/admin/pre-apply/[id]/mirror-drive`, safe to re-run).
2. **It's already sitting in the unit's Drive folder** → staff runs **🔎 Scan Drive folder & save to MAIA**, which reads every file, classifies it by *content* (not filename), matches it to a checklist item, and can also pull the applicant roster off a lease it finds.
3. **Staff picks it from Drive on one specific checklist row** ("From Drive" on that row) — same page-range extraction used for pulling one document out of a larger PDF (background-check report, etc).

**There is no path today where forwarding an email with an attachment results in MAIA filing that attachment.** This is the largest gap between "what the team might assume MAIA does" and what it actually does. Flag every real case where this gap bites — it's the strongest build signal we'll get.

### "Bring into MAIA" (on the audit queue's Drive-folder list)
- Creates a **bare shell application** — status already `submitted`, empty roster, Drive folder linked. Nothing in the folder is read.
- **Defaults `application_type` to `'lease'` unconditionally** — the button passes no type. If the real application is a renewal, a purchase, or an additional occupant, the checklist shown will be wrong until someone corrects it.
- **Correct procedure:** Bring into MAIA → **immediately** open it and fix the type via ✎ edit → **then** run Scan Drive folder & save to MAIA. Skipping the type-fix means staff are auditing against the wrong checklist for the application's whole life.

### Persona detection (agent vs. owner vs. tenant)
- **No automated tool exists.** Manual judgment: sender domain, language in the email ("on behalf of my client" vs "I live at"), cross-check against `owners.emails` / `unit_tenant_contacts.tenant_email` for that unit if known.
- **When genuinely unclear, ask before creating any stakeholder record.** Misidentifying who someone is has already caused a real incident: MANXI 1003's additional-occupant paperwork carried the sponsoring tenant's email instead of the occupant's own — which is why the sponsorship flow (`/sponsorship/[token]`) exists at all. Guessing wrong on identity is the expensive mistake here, not the slow one.

---

## The master procedure (read this before every email)

```
1. WHO is this? (sender domain + content + cross-check against records)
   Unclear → ask before doing anything else.

2. Is there ALREADY an application for this unit?
   Check /admin/pre-apply. If it exists → work on that record, don't create a second.
   If it's Drive-only (not in MAIA) → Bring into MAIA, fix the type, then Scan Drive folder.

3. Did they send a FILE?
   → Does the application/unit exist in MAIA yet?
     No  → get it into MAIA first (see step 2). An attachment cannot be
           self-served until the application exists to attach it to.
     Yes → DEFAULT: don't file it by hand. Use the Gmail add-on's
           "📨 Draft: ask them to upload" — it reads live checklist state,
           creates a scoped self-serve upload link, and drafts the standard
           reply (thank-you + link + everything still outstanding) into
           Gmail's own reply box. Review it, delete the staff-only note at
           the bottom if one is there, send it yourself.
           Manual upload on the checklist row still exists and is right for
           documents that did NOT arrive from the resident by email — a
           Drive-scan import, a lease from the association's own files, a
           board-generated letter. It is no longer the default for "a tenant
           emailed me a PDF".
   → NEVER rely on @maia upapp to file the actual document. It only logs that
     an email arrived; it does not touch the attachment content.

4. Did they ASK something (status, what's missing, how to sign)?
   → Answer directly, OR point them to the link that lets them do it themselves
     (application link, request-docs upload link, e-sign link) — see the FAQ
     below for which is right for which situation.

5. Log the correspondence.
   → @maia upapp CODE### from a staff account, so there is a record —
     understanding that this logs the TEXT, not any file. If a document
     was attached, step 3 is still required separately.
```

---

## FAQ

*(Seeded from process rules confirmed this session. Each new real case adds an entry — question, the right channel, why, and the reply template.)*

### Q: An applicant's agent emails a signed lease. What do I do?
Check whether the unit's application exists in MAIA (step 2 above). If it does, use the add-on's **"📨 Draft: ask them to upload"** rather than filing the lease yourself — it drafts the standard reply with a self-serve link scoped to whatever's still missing. If no application exists yet, bring the unit in / create it, fix the type, *then* the self-serve link has something to attach to.

### Q: Why draft-and-review instead of just auto-sending the standard reply?
Because "in the future an agent replies automatically" is a *later* step (user's own framing, 2026-08-18), not this one. The reply text is fully mechanical today — same shape every time, built from live checklist state — which is exactly what makes it safe to hand to an agent eventually. Until then a human reads it before it goes, the same caution applied to every other outbound decision this pipeline makes. The three form-backed items (Rules Ack / Pet Registration / Emergency Contact) are the one exception: those still send immediately on click, unchanged since v1 — that was never the "a human should judge this" concern, only the upload redirect was.

### Q: The drafted reply has a line starting "[Staff note — remove before sending]". What is that?
A form-backed item (Rules Ack, Pet Registration, Emergency Contact) that's still outstanding but **failed to send automatically** — most often because a co-applicant has no email on file yet ("every adult signs their own block"). Read the reason, fix what's blocking it (usually: add the missing person's email via the Applicants card), then send that form separately. Delete the note before the reply goes out — it's for staff, not the resident.

### Q: A tenant replies "yes I have a car" / "no pets" in the email body — do I mark that down somewhere?
No — don't transcribe it, and the standard reply no longer asks the question in prose at all. The vehicle/animal yes-or-no are real Yes/No controls on the SAME self-serve `/request/[token]` link the standard reply already sends (`app/api/request/[token]/declare/route.ts`), so the resident answers there directly and it writes straight into `listing_applications.declarations` — no reply to read, nothing for staff to key in. Answering "yes" auto-reveals whatever that unlocks (e.g. Car Registration) on that same page immediately, or sends the Pet Registration form right away, without a second link. (User correction, 2026-08-18: "why is he replying to the questions by email? Why the card link don't make these questions and save in Maia?" — this replaced an earlier version that asked inline and made staff record the reply by hand.) The admin page's Declarations card still exists and is still editable — treat it as a fallback for an answer that arrived some other way, not the normal path.

### Q: A tenant asks "what documents am I still missing?"
Don't retype the checklist by hand. If they already have a live application, the request-docs email or the applicant's own token link (`/request/[token]` or `/apply` resume link) shows them exactly what's outstanding and lets them upload straight to it — that's the self-serve path, and it's the one that actually files things onto the checklist without staff re-keying anything.

### Q: I don't know if the sender is the tenant or the owner's agent.
See "Persona detection" above. Ask rather than guess — see the MANXI 1003 precedent.

### Q: Someone emails asking to sign the Rules Acknowledgment / Pet Registration / Emergency Contact List again, or says they never got the link.
These are the three checklist items that are **forms MAIA generates**, not uploads (`lib/application-esign-forms.ts`). Use the dedicated sender for that form on the application page, or tick it in the request panel (which now correctly routes those three to "sent for signature" rather than an upload link, since #700). Don't ask them to upload a document for these — there's nothing for them to upload.

### Q: A renewing tenant emails 4 attachments and lists their emergency contacts / vehicle info as plain text in the body, "for your records."
Worked case, lease-renewal, four real attachments plus text answers to two form-backed items. The general shape:

- **Read every attachment before trusting its filename.** One labelled "Renters Insurance" was actually the *landlord's* HO-6 policy — correct and useful, just mislabeled, and MANXI has no tenant-liability doc_key to begin with, so it filed under `property_insurance` instead. Verify what a file actually is before filing it under what the sender called it.
- **A tenant-and-landlord affidavit covering two occupants is two notarized pages, one per person** — split it and file each page under `tenant_affidavit` scoped to that stakeholder's own row, not as one shared upload.
- **A co-tenant named in the lease but not yet a stakeholder** doesn't get pulled in automatically — `autoRosterFromLease` only fires when the roster is *empty*. If a primary applicant already exists, add the second person by hand (their name is right there on the signed lease).
- **Text in an email body never satisfies a form-backed item.** "Here are my emergency contacts: three names and numbers" does not complete `emergency_contact` — that item is now a signed form (`lib/esign-forms.tsx`), and there is no field to type someone's answer into after the fact. The fix: prefill the form with what they already told you (`EsignPrefill` on `sendEsignFormsForItems`) and send it to be confirmed and signed, rather than asking them to retype it from scratch.
- **Text answers to an upload-only item (`car_registration`) have nowhere to go at all** — there's no form and no field. Log what was said into Communication history via `logApplicationCommunication` so it isn't lost, and ask explicitly for the actual document (a photo of the registration card, not a description of the car).
- **A claim of "already submitted, staff confirmed"** (here: pet documents) is not verification. Check the actual checklist state before repeating the claim back as fact.

**Real bugs this case found and fixed:** the Emergency Contact List form's `contacts` field never read a server-supplied prefill at all (always rendered blank regardless of payload), and was hard-capped at exactly two contacts with no way to add a third — so a resident naming three people to call would have silently lost the third. Both fixed in the same pass as building the prefill capability; see `app/esign/[token]/EmergencyContactFill.tsx`.

### Q: Two application records exist for the same unit and neither has any documents.
`/api/pre-apply/start` resumes an existing `started` application when the same email opens the same unit's link twice (#684, merged 2026-08-12) — but it only matches on **exact email**, and only against applications still in `started` status. A duplicate you find today is most likely older than that fix and was never cleaned up; check the creation timestamps against when `#684` merged before assuming it's a live bug.

**Before deleting anything**, confirm the "loser" is actually empty: zero rows in `application_documents`, `application_stakeholders` (beyond the one caused the duplicate), `application_communications`, `application_document_reviews`, `document_requests`, and no `drive_folder_id`. If all zero, it's a bare shell — delete the stakeholder row, the application row, then its `unit_listings` row, in that order. If it has *any* uploaded documents, that's a real merge (move `application_documents` rows to the surviving application — the three e-sign forms are keyed by `unit_ref`, not `application_id`, so they never need moving), not a delete — stop and think it through rather than deleting.

**Known gap, not yet fixed:** the resume logic doesn't cover a genuinely different real person (e.g. a co-tenant) opening the same unit's link with their own email — they get a second, separate application rather than joining the existing one as a co-applicant. `addStakeholders()` already exists and could be called instead of `createIntake()` when a `started` application already exists for that unit+type, regardless of whose email opened it.

---

## Open build signals

*(Real cases that exposed something MAIA should do automatically but doesn't yet — tracked here, promoted to `docs/ROADMAP.md` once there's a pattern.)*

- Attachments on inbound email are never auto-filed — see "Ground truth" above. Every case where this causes rework is a data point for whether to build it.
