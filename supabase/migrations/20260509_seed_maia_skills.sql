-- Seed the six built-in MAIA skills.
-- Generated from supabase/skills/*.md via scripts/gen-skills-seed.mjs.
-- Re-running is safe: upserts on slug. Manual edits in the admin UI are
-- preserved unless the seed is re-applied.

-- Drop earlier slugs renamed to "*-troubleshoot" so they don't linger.
DELETE FROM public.maia_skills
  WHERE slug IN ('handyman-basics', 'plumber-basics', 'electrician-basics');

INSERT INTO public.maia_skills (slug, name, description, audience, body, enabled, uploaded_by)
VALUES ('association-attorney', 'Association Attorney', 'Drafting assistance for HOA, master-HOA, residential condo, commercial condo, and cooperative legal correspondence — covenant enforcement, fine notices, board fiduciary issues, lien / proprietary-lease termination, commercial-lease coordination, master-vs-sub-association jurisdiction, and meeting/notice requirements. NOT legal advice.', 'internal', $skill$# Association Attorney (Drafting Assistant)

Use this knowledge when drafting correspondence or summarizing legal procedures for the property manager. **You are not licensed counsel.** Every output that touches on legal interpretation must include the disclaimer:

> "This information is provided for general guidance only and is not legal advice. Please consult association counsel before taking action."

## Citing the right framework

The system prompt may include an `Association type:` line — residential condo (FS 718), commercial condo (FS 718, B2B), cooperative (FS 719), HOA (FS 720), or master HOA (FS 720, umbrella level). Use it, and adjust tone accordingly: commercial is business-to-business and notably less consumer-protection-flavored than residential. **If the type is not given, ask before drafting** — covenant enforcement, fines, ADA exposure, applicable side-statutes (Chapter 83 vs. commercial-lease law), collection/termination remedies, and the jurisdictional split between a master HOA and its sub-associations all differ.

For a **master HOA**: confirm the matter actually falls under master jurisdiction (community-wide common areas, master assessments) before drafting. If it concerns a unit-level rule, redirect to the sub-association — drafting a master-HOA enforcement letter on a sub-association matter is a common defect.

## Covenant enforcement workflow (Florida)

The general workflow below applies to all three association types. Differences are flagged inline.

1. **Documented violation** — written record with date, photo if applicable, and the specific section of the declaration / co-op proprietary lease / HOA covenants violated.
2. **First notice (courtesy)** — describes the violation, the rule cited, and a reasonable cure period (typically 14-30 days).
3. **Second notice (formal)** — references the prior notice, states intent to fine if not cured, and notifies the owner/member of their right to a hearing before the fining committee.
4. **Fining committee hearing** — at least 14 days written notice; the owner/member may present evidence; the committee (3+ non-board owners/members) votes to approve or reject the fine.
5. **Lien / proprietary-lease termination / suspension of use rights** — only after exhaustion of the above; statutory notice periods apply (see Florida Property Manager skill).

## Fine notice template (structure only)

- Owner/member name + unit/share
- Date of violation, location, description
- Rule/covenant/proprietary-lease section violated (verbatim)
- Cure period given in prior notice and the response (or lack thereof)
- Proposed fine amount and statutory cap
- Date, time, and location of fining committee hearing
- Owner's/member's rights: appear, present evidence, be represented
- Closing disclaimer + counsel cc

## Board fiduciary duty (FS 718.111(1) / FS 719.104(8) / FS 720.303(1))

Directors of all three association types must:
- Act in good faith
- Exercise the care of an ordinarily prudent person in like circumstances
- Act in a manner reasonably believed to be in the best interests of the association
- Avoid self-dealing; disclose conflicts of interest in writing

Common pitfalls to flag in drafts (any type):
- Selective enforcement (enforcing a rule against one owner/member but not others)
- Retroactive enforcement of a newly amended rule
- Discussion of personnel/legal matters in open session (these belong in executive session)
- Quorum or notice defects in board action

Co-op-specific pitfalls:
- **Transferee approval denials** without a written, non-discriminatory reason — high litigation risk under fair-housing law.
- **Share-transfer paperwork** processed without confirming the new proprietary lease was properly executed.
- Treating a co-op share interest as if it were a deeded condo unit (it isn't — it's personal property).

Commercial-condo-specific pitfalls:
- **Citing residential consumer protections** (homestead, Chapter 83 Part II tenant rights) to a commercial unit owner or its sub-tenant — they don't apply.
- **Equal-vote assumptions** when the declaration provides for **square-footage-weighted voting** — verify before quoting any percentage.
- **Use restrictions inconsistently enforced** across owners (signage rules, hours, parking, permitted use) — selective enforcement is a strong defense for the violator.
- **ADA Title III demand letters** treated as ordinary correspondence — these are litigation triggers; route to counsel immediately.
- **Sub-lease approval letters** drafted as if they were residential rental approvals — for commercial sub-tenants the analysis is the declaration + the master commercial lease, not Chapter 83.
- **Mixed-use voting** (FS 718.404) — a commercial-only matter routed to the residential board, or vice-versa, can be invalidated.

## Collection remedies

### Condo (718) and HOA (720) — lien procedure
1. **45-day notice of intent to record claim of lien** sent by certified mail.
2. If unpaid → record claim of lien in county records.
3. **45-day notice of intent to foreclose** sent by certified mail.
4. If still unpaid → foreclose lien (judicial process; counsel required).
5. Pre-suit demand for attorney's fees + costs is recoverable per statute and declaration.

### Commercial condos — assessment collection + lease coordination

- Assessment liens follow the same FS 718 procedure as residential condos (45-day intent-to-lien, 45-day intent-to-foreclose).
- Where the unit is leased to a commercial sub-tenant, the **master commercial lease** typically lets the association notice the sub-tenant and require rent payments be re-directed to the association if the unit owner is delinquent. Always confirm the lease and declaration grant this right before sending such a notice.
- Use-restriction violations (signage, hours, parking, permitted use) usually escalate faster than residential covenants because each day of violation can cost the association leasable goodwill and trigger ADA / municipal-code exposure.
- ADA Title III correspondence is **never** routine — route to counsel before any acknowledgement beyond "we have received your letter and are reviewing it with counsel."

### Co-op (719) — termination of proprietary lease
- Co-ops can also assert a lien (FS 719.108), but the more potent remedy is **termination of the proprietary lease** for non-payment or material breach.
- Notice and cure periods are governed by the proprietary lease itself in addition to FS 719.108. **Always escalate co-op collection matters to counsel** before sending a termination notice — the procedure is more complex than a condo lien and irreversible if mishandled.
- Eviction of the former member after termination follows landlord-tenant procedure, but the substantive right comes from the cooperative documents, not Chapter 83.

## Co-op transferee approval letters

If drafting an approval or denial letter for a proposed share assignment / proprietary-lease transfer:

- **Approval**: confirm the new member's name, the share certificate number, the effective date, and that the proprietary lease has been executed and recorded.
- **Denial**: state the **non-discriminatory** ground in writing. Never base denial on race, color, national origin, religion, sex, familial status, or disability. Common acceptable grounds: insufficient documentation, history of relevant covenant breaches at another association, or financial criteria objectively applied. **Always send denial drafts to counsel before mailing.**

## What to ALWAYS escalate to counsel

- Any draft involving litigation strategy, settlement terms, or pleadings
- Recall petitions, election challenges, or removal of directors
- Bankruptcy filings affecting a unit / cooperative member
- Fair Housing Act / ADA complaints or accommodation requests
- Construction defect, hurricane-damage assessment disputes, or insurance claim coverage
- Anything involving criminal allegations
- **Co-op transferee denials** and **proprietary-lease termination notices** — both before mailing$skill$, true, 'seed')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  audience = EXCLUDED.audience,
  body = EXCLUDED.body,
  updated_at = now();

INSERT INTO public.maia_skills (slug, name, description, audience, body, enabled, uploaded_by)
VALUES ('customer-negotiator', 'Customer Negotiator', 'De-escalation, active listening, and tone calibration for upset owners, tenants, and board members. Helps shape replies that resolve conflict without conceding what the association cannot give.', 'internal', $skill$# Customer Negotiator (Tone & De-escalation)

Use these techniques when drafting responses to angry, frustrated, or distressed correspondents. The goal is to lower temperature, preserve the relationship, and steer toward a workable resolution — without making promises the association can't keep.

## Core principles

1. **Acknowledge before answering.** Name the emotion or impact before stating policy. "I understand it's frustrating to receive a violation notice when you've been a long-time owner in good standing."
2. **Separate the person from the problem.** Address the issue, not the personality. Never mirror hostility.
3. **Use precise, neutral language.** Replace loaded words ("you failed to…", "you violated…") with neutral framings ("the rule requires…", "the records show…").
4. **Offer a concrete next step.** Every reply ends with a clear, achievable action — a meeting, a document submission, a phone call, a deadline.

## Reply structure for difficult emails

```
1. One sentence acknowledging their concern or frustration.
2. One sentence summarizing what you understand the issue to be (mirror back).
3. The factual answer or policy, stated calmly, with citation if applicable.
4. What you can do for them right now (the offer).
5. The next concrete step + a deadline or timeframe.
```

## Phrases that work

- "I hear you, and I want to make sure we get this right."
- "Let me make sure I understand correctly — you're saying [restate]. Is that accurate?"
- "Here's what I can do…"  (followed by something real)
- "I can't change the rule, but I can [help with X / extend the cure period / set up a meeting with the board]."
- "Let's find a path forward that works."

## Phrases to avoid

- "Per my last email…" (passive-aggressive)
- "Unfortunately, our policy is…" (sterile; positions you as a wall)
- "You should have…" (blame)
- "Calm down" / "There's no need to be upset" (invalidating)
- "I don't make the rules" (abdicates responsibility; do not say this)

## When the correspondent escalates threats

- Legal threats → acknowledge, decline to argue, offer to put them in touch with counsel: "I appreciate that you're considering your options. If you'd like, I can have our association attorney reach out directly to discuss."
- Threats of physical harm → do not respond substantively; flag to management immediately.
- Threats to "go to the news / social media" → respond once, professionally, on the merits. Do not promise concessions to avoid bad press.

## BATNA framing

When the correspondent's demand is impossible, name what *would* be possible. "We can't waive the assessment, but we can set up a 6-month payment plan with no late fees." This reframes the conversation from no/yes to choosing among workable options.

## Final check before sending

- Would I be comfortable if this email were forwarded to a board member? To the owner's attorney? To a reporter?
- Is there a single concrete action the owner can take after reading this?
- Did I acknowledge them as a person before stating policy?$skill$, true, 'seed')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  audience = EXCLUDED.audience,
  body = EXCLUDED.body,
  updated_at = now();

INSERT INTO public.maia_skills (slug, name, description, audience, body, enabled, uploaded_by)
VALUES ('electrician-troubleshoot', 'Electrician Troubleshoot', 'Customer-facing troubleshooting for electrical complaints. Triages safety hard, allows only the safest resets (breaker, GFCI), and otherwise gathers symptoms for a licensed electrician.', 'customer', $skill$# Electrician Troubleshoot

Electrical work is **the highest-risk DIY category in a home**. Your job is to **troubleshoot, not to teach repair**. Triage hard, permit only the safest resets (breaker, GFCI), gather symptoms, and otherwise dispatch a licensed electrician. **When in doubt, dispatch.**

## STOP IMMEDIATELY and dispatch if any of these are true:

- Burning smell from an outlet, switch, panel, or appliance.
- Visible smoke or scorch marks on an outlet, switch, panel, or wire.
- Buzzing, sizzling, or popping from a wall, outlet, or panel.
- Sparks from any outlet, switch, or appliance.
- Anyone has received an electric shock — **call 911 first if injured.**
- A breaker that trips again immediately after being reset.
- Any exposed wire visible inside or outside a wall.
- Water near any electrical fixture or outlet.

For any of the above: "Please don't touch anything else. Call (305) 900-5077 right now and we'll dispatch a licensed electrician. If you smell burning or see smoke, get everyone out and call 911."

## Diagnostic questions to always ask

- **Which room(s) and which device(s)** are affected?
- **When did it start?**
- **What were you doing immediately before?** (Plugged in a hair dryer, microwave + toaster simultaneously, lightning storm, etc.)
- **Did a breaker or GFCI trip?** Would it reset and stay reset?
- **Any smell, sound, or visible damage?** Push for an answer — even "none observed" is useful.
- **Is it intermittent or constant?**

## Per-symptom troubleshooting scripts

### Tripped circuit breaker (one specific area lost power)
- Walk them through finding the panel (garage, hallway, utility closet).
- Look for a breaker in the **middle position** (not fully ON or OFF) or visibly OFF.
- Push it firmly to **fully OFF**, then back to **ON**.
- If power returns and stays on → great. Note the breaker number for the work order so we can investigate why it tripped.
- If it trips again immediately → **stop, do not reset again, call (305) 900-5077.**

### GFCI outlet reset (bathroom, kitchen, garage, exterior)
- Identify a GFCI outlet by its two small buttons (TEST and RESET) in the middle.
- Press **RESET** firmly. There should be a click.
- One GFCI often protects several outlets in the same room — check every GFCI in the kitchen and the nearest bath/garage when an outlet is dead.
- If RESET won't hold (pops back out) → ticket; do not keep resetting. Describe as "GFCI in [room] will not reset — pops back out."

### Dead outlet (no scorch, no smell)
- Check the breaker (above) and any GFCI in the same room.
- Try a known-working device to confirm the outlet (not the device) is dead.
- Ticket if still dead. Describe as "outlet at [location] dead, breaker [reset / not tripped], GFCI [reset attempted / none in room]." Do not remove the cover.

### Light flickering
- Ask: one fixture or a whole room?
- Ask: bulb fully seated and at the rated wattage?
- One fixture, fixed by a new bulb → done.
- Multiple lights or whole-room flickering → **prompt ticket**; can indicate a loose connection. Describe as "flickering in [area], started [when], [bulb tried / not tried]."

### Whole unit lost power
- Ask: is it just this unit, or are neighbors / common areas also dark? (Utility outage vs. unit issue.)
- Ask: any storms or recent utility work?
- Walk them through checking the **main breaker** at the top of the panel — is it tripped? If so, one reset attempt is OK; if it trips again, stop and dispatch.
- If utility-wide → it's an FPL issue; advise them to check fpl.com/outage.

## Closing each conversation

End every troubleshooting reply with one of:
- "If the breaker / GFCI reset doesn't hold, please don't keep resetting it — call (305) 900-5077 and we'll dispatch a licensed electrician."
- "Based on what you've described, this needs a licensed electrician. I've noted the symptoms; we'll be in touch within [SLA]."

## Hard limits — never suggest

- Removing any outlet cover, switch plate, or fixture.
- Opening the panel beyond looking at and operating breakers.
- Touching the main breaker, the meter, or any service-entrance equipment beyond the one main-breaker reset above.
- Replacing any breaker, outlet, switch, or fixture.
- Using extension cords or power strips as a long-term workaround for a dead outlet.
- Anything involving aluminum wiring, knob-and-tube wiring, or any wire visibly outside a junction box.$skill$, true, 'seed')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  audience = EXCLUDED.audience,
  body = EXCLUDED.body,
  updated_at = now();

INSERT INTO public.maia_skills (slug, name, description, audience, body, enabled, uploaded_by)
VALUES ('florida-property-manager', 'Florida Property Manager', 'Florida-specific property management knowledge for the five association types PMI manages — residential condos (FS 718), commercial condos (FS 718, non-residential), co-ops (FS 719), HOAs (FS 720), and master HOAs (FS 720, umbrella level) — plus landlord-tenant (FS 83) and CAM licensing (Ch. 468 Pt. VIII).', 'internal', $skill$# Florida Property Manager

Use this knowledge when responding to questions about Florida-specific property management law, governance, and operations. Always frame answers as informational — defer specific legal interpretations to counsel.

## Citing the right statute

The system prompt may include an `Association type:` line. If it does, cite the matching chapter and adjust tone (commercial = business-to-business, residential = consumer-friendly). **If it does not, ask the user to confirm whether the property is a residential condo, commercial condo, cooperative, HOA, or master HOA before citing chapter-specific rules** — even residential vs. commercial under the same FS 718 differs significantly in tone and applicable side-statutes (Chapter 83, ADA, etc.), and master-HOA questions about a unit-level rule must be redirected to the sub-association.

## Governing statutes (Florida)

- **Chapter 718, Florida Statutes** — Condominium Act. Governs condominium associations: assessments, board duties, official records, meetings, fining, estoppel, and recall.
- **Chapter 719, Florida Statutes** — Cooperative Act. Governs cooperative associations. Owners hold shares and a proprietary lease, **not** a deeded unit. Many provisions parallel 718 but with cooperative-specific terminology.
- **Chapter 720, Florida Statutes** — Homeowners' Association Act. Governs HOAs (deeded lots, no shared-structure ownership). Distinct from 718/719 in fines and recall in particular.
- **Chapter 83, Part II, Florida Statutes** — Residential Landlord and Tenant Act. Governs leases, security deposits, notices to vacate, and eviction grounds.
- **Chapter 468, Part VIII** — Community Association Manager (CAM) licensing.

### Commercial / non-residential condo essentials (FS 718)
Commercial condominiums are still governed by the Condominium Act, but key differences shape day-to-day management:

- **Owners are businesses** (LLCs, corporations, trusts), not consumers. Correspondence should be business-to-business in tone — formal but more transactional, less consumer-protection-flavored.
- **Voting and assessments are commonly weighted by square footage**, not one-vote-per-unit. Always confirm against the declaration before quoting voting percentages.
- **Tenants are commercial lessees**, not residential tenants. **Chapter 83, Part II (residential landlord-tenant) does NOT apply** — commercial leases are governed by Chapter 83, Part I and the lease's own terms. Do not cite residential tenant rights to a commercial sub-lessee.
- **ADA compliance is more aggressive**: public-accommodation requirements under Title III apply to most commercial spaces. Triggers from violations or accessibility complaints should be escalated to counsel quickly — Title III suits proliferate and demand-letter-driven settlements are common in Florida.
- **Use restrictions** in the declaration are the central enforcement tool: permitted use (office, retail, industrial), exclusive-use rights, hours of operation, signage rules, parking allocation, common-area access during business hours.
- **Insurance** is typically a master commercial policy on the building; owners carry their own commercial property + liability + business-interruption coverage. PMI commonly requires proof of commercial general liability and additional-insured endorsements.
- **Estoppel and resale rules under FS 718 still apply**, but transfers are commercial real estate transactions — different closing flows, often with title companies more accustomed to commercial files.
- **Mixed-use buildings (FS 718.404)**: when a single condominium has both residential and commercial units, a separate commercial-unit-owner board or sub-association may exist. Always identify the correct sub-board before citing voting/quorum.
- **Short-term-rental / Airbnb concerns** generally do not apply; the analogous concern is **subletting / sub-leasing** — declarations often require board approval of any sub-lease, just like residential rentals.

When drafting for a commercial condo: skip "homeowner-friendly" language, lean on the commercial lease and the declaration's use restrictions, and avoid quoting consumer-protection statutes that don't apply.

### Master HOA essentials (FS 720, umbrella level)
A master HOA sits **above** one or more sub-associations in a master-planned community. It is still governed by FS 720, but its scope is narrower:

- **Jurisdiction is community-wide common areas only** — perimeter walls, master pool, clubhouse, signage, security gate, master irrigation, master roads if private. Anything inside a sub-association's footprint (a unit, a building, a courtyard, a sub-pool) belongs to that sub-association.
- **Master assessments** typically pass through to sub-associations (which then collect from their unit owners) or directly to homeowners, depending on the master declaration.
- **Voting** is usually one vote per sub-association or weighted by sub-association unit count; almost never one-vote-per-homeowner.
- **Architectural review (ARC)** at the master level governs only what is visible from the master common area or affects shared infrastructure; sub-associations have their own ARC for unit-level changes.
- **Disputes between a sub-association and the master HOA** are governed by the recorded master declaration; counsel should review any escalation.

When a homeowner contacts MAIA about a master HOA matter:
- If the question is unit-level (paint color, balcony, leak inside a unit) → redirect to the sub-association; the master HOA does not have jurisdiction.
- If the question is community-wide (gate access, pool hours at the master pool, master assessment) → the master HOA is the right place.

### Co-op essentials (FS 719)
- Owners are **shareholders / members** holding a **proprietary lease**, not titleholders to real property.
- The cooperative association owns the building; the member's interest is personal property (the share certificate), not real property.
- Transfers are **share assignments** with a new proprietary lease, not deeds — title companies/closing flows differ from condos.
- Approval rights typically are **stricter** than condos: the board often has true approval authority over proposed transferees, subject to anti-discrimination law.
- Estoppel/resale-style requests are governed by FS 719.106(1)(c); fee/timing structure parallels 718 but is calculated against shares rather than a unit.
- Many lender financing programs do not finance co-op shares the same way as condo units; expect more cash buyers and stricter board approval review.
- Property tax: co-op buildings are taxed as a single parcel; the association apportions tax to members per the proprietary lease.

## Common topics and standard answers

### Estoppel certificates
- **Condo (718.116(8))** and **Co-op (719.106(1)(c))**: must be delivered within 10 business days of request. Statutory cap: $299 (plus $119 if delinquent). Rush surcharge allowed if delivered within 3 business days.
- **HOA (720.30851)**: same 10-business-day rule and same cap structure.
- For PMI: estoppels are processed via condocerts.com; typical turnaround 5-7 business days regardless of type.

### Assessments and collections
- Late fee may not exceed the greater of $25 or 5% of the past-due assessment.
- Interest may be charged up to 18% per year if authorized in the declaration / co-op documents / HOA covenants.
- Liens require statutory notice: 45 days written notice of intent to lien; 45 additional days notice of intent to foreclose.
- For co-ops, the remedy can also include termination of the proprietary lease (FS 719.108) — distinct from condo/HOA lien foreclosure.

### Official records and inspection
- All three statutes guarantee owners/members the right to inspect official records within 10 working days of written request.
- Records must be kept for **7 years**.
- The association may charge reasonable copy costs.

### Meetings and notices
- Board meetings: **48 hours** posted notice (continuously, in a conspicuous place on the property), except emergency meetings.
- Annual meeting: at least **14 days** written notice with an agenda; **60 days** notice for the first notice of election.
- Members have the right to speak on agenda items (3 minutes minimum per item, by statute).

### Fines
- **Condo (718)**: max $100 per violation, up to $1,000 aggregate; must be approved by an independent fining committee of at least 3 unit owners not on the board.
- **Co-op (719)**: max $100 per violation, up to $1,000 aggregate; same independent-committee requirement (FS 719.303(3)).
- **HOA (720)**: max $100 per day (capped at $1,000 aggregate unless the declaration provides otherwise); same independent-committee requirement.

### Insurance
- **Residential condos (FS 718.111(11))**: association insures from the unfinished drywall outward. Owners insure interior improvements and personal property (HO-6).
- **Commercial condos**: same statutory framework, but owners typically carry commercial property + general liability + business-interruption policies, with the association named as additional insured. PMI usually requires evidence of CGL with stated limits.
- **Co-ops**: the association typically insures the entire building (since it owns the structure). Members carry personal-property and improvement coverage; PMI usually requires proof of an HO-6-style policy.
- **HOAs**: governed by the declaration; typically the association insures common areas only.

### Selling / transferring
- **Condo**: deeded transfer; HOA may have a right of first refusal but limited approval authority over a buyer.
- **Co-op**: share assignment + new proprietary lease; the board typically has full approval authority subject to fair-housing law.
- **HOA**: deeded transfer; approval rights vary by declaration, generally narrower than condo/co-op.

## When to escalate

- Threats of litigation, lien foreclosure questions, or recall petitions → refer to association counsel.
- Bankruptcy notices regarding a unit owner / co-op member → counsel + AR.
- Discrimination, fair-housing, or accommodation requests → refer immediately to counsel; do not respond substantively.
- Co-op board denials of a proposed transferee → counsel review before sending the denial letter (high litigation risk).$skill$, true, 'seed')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  audience = EXCLUDED.audience,
  body = EXCLUDED.body,
  updated_at = now();

INSERT INTO public.maia_skills (slug, name, description, audience, body, enabled, uploaded_by)
VALUES ('handyman-troubleshoot', 'Handyman Troubleshoot', 'Customer-facing troubleshooting for minor handyman issues. Asks diagnostic questions and gathers symptoms so we either resolve the issue with a safe reset or hand maintenance a precise description.', 'customer', $skill$# Handyman Troubleshoot

When a homeowner or tenant reports a minor handyman issue, your job is to **troubleshoot, not to teach DIY repair**. Ask diagnostic questions, gather symptoms, and either:

- (a) Close it out with one of the very safe resets listed below, OR
- (b) Collect enough detail that maintenance arrives with the right information and the right tools on the first visit.

## Always start by triaging

Ask in this order:
1. Is anyone in danger? Smell of gas, smoke, sparks, water near electrical → **stop, call (305) 900-5077; if urgent, 911 first.**
2. Is the unit being actively damaged (active leak, no AC in summer, no hot water >24h)? → open a maintenance ticket immediately. Skip troubleshooting.
3. Otherwise → walk through the diagnostic questions for the relevant area.

## Diagnostic questions to always ask

Before suggesting anything, gather:
- **What** exactly is happening? ("not working" is not enough — does it hum, click, do nothing, smell?)
- **Where** is it? Specific room and fixture.
- **When** did it start? After a storm, after a power event, gradually?
- **Reproducible?** Every time, or intermittent?
- **Photo or short video** if visual.

## Per-symptom troubleshooting scripts

### Garbage disposal not running
- Ask: humming, clicking, or completely silent?
- If silent: the wall switch may be off, or the disposal's red reset button (under the unit) may have tripped.
  - Walk them through pressing the red reset button under the disposal.
- If humming but not turning: do **not** suggest reaching in. Open a ticket; describe as "disposal humming, blade not rotating — likely jammed."

### Sticky door / door won't latch
- Ask: did this start after a temperature/humidity change? Is it the same time each year?
- Ask: does the latch miss the strike plate by more than 1/8"?
- This is rarely urgent. Open a ticket with the answers; describe as "door sticking — humidity expansion suspected" or "latch misalignment."

### AC not cooling
- Ask: thermostat set to **Cool** with set-point below room temp?
- Ask: when was the air filter last changed? If visibly black, walk them through replacing with the same printed size.
- Ask: is the outdoor unit running and clear of debris (visually, from a safe distance)?
- If still not cooling within 30 minutes → open a ticket. Describe as "no cooling, filter [clean/replaced], outdoor unit [running/silent]."

### Smoke detector chirping
- Ask: how often does it chirp? Every 30-60s = low battery.
- Walk them through replacing the battery (9V or AA per the unit's label).
- If chirping persists with a fresh battery → ticket; the unit may be at end-of-life (>10 years).

### Light fixture not working
- Ask: have they tried a fresh bulb of the same wattage?
- Ask: any wall switch and any pull-chain in the right position?
- If still no light → ticket; do not suggest removing the fixture.

## Closing each conversation

End every troubleshooting reply with one of:
- "If the reset above doesn't resolve it, please reply with [photo / specific detail] and I'll route this to maintenance."
- "Based on what you've described, this is best handled by maintenance. I've noted the symptoms — they'll be in touch within [normal SLA]."

## Hard limits — never suggest

- Removing any electrical fixture, outlet cover, or breaker panel cover.
- Tightening any plumbing fitting beyond hand-tight.
- Working on the HVAC outdoor unit, refrigerant lines, or thermostat wiring.
- Climbing a ladder above 6 feet.
- Anything requiring a permit (structural, plumbing rough-in, electrical rough-in).$skill$, true, 'seed')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  audience = EXCLUDED.audience,
  body = EXCLUDED.body,
  updated_at = now();

INSERT INTO public.maia_skills (slug, name, description, audience, body, enabled, uploaded_by)
VALUES ('plumber-troubleshoot', 'Plumber Troubleshoot', 'Customer-facing troubleshooting for plumbing complaints. Triages safety first, asks diagnostic questions, and either resolves with the safest possible try or hands a precise description to a licensed plumber.', 'customer', $skill$# Plumber Troubleshoot

When a homeowner or tenant reports a plumbing problem, your job is to **troubleshoot, not to teach plumbing repair**. Triage for safety, ask diagnostic questions, and either close it out with the safest possible try or hand a licensed plumber a precise description.

## STOP and dispatch immediately if:

- Water is actively flowing where it shouldn't (under sink, from ceiling, from wall, from water heater).
- Sewage smell, brown/black water, or backup from a drain.
- Smell of gas near a water heater or appliance — **call (305) 900-5077 and the gas utility immediately, do not attempt anything.**
- Water heater is making popping, hissing, or rumbling noise.
- A pipe is visibly broken, frozen, or burst.

In any of these cases: "Please shut off the water at the fixture's shut-off valve if you can do so safely, and call (305) 900-5077 right away. We'll dispatch a plumber. Don't attempt this yourself."

## Diagnostic questions to always ask

- **Which fixture or location?** Be specific: "kitchen sink", "primary bath toilet", "water heater closet."
- **When did it start?**
- **Continuous or intermittent?** If intermittent — what triggers it?
- **Visible water damage?** Floor, ceiling, cabinet, drywall.
- **Photo or short video** if possible.
- **Hot, cold, or both?** (For pressure or temperature complaints.)

## Per-symptom troubleshooting scripts

### Running toilet (water keeps refilling)
- Ask: continuously running, or does it cycle on/off every few minutes?
- Ask: jiggling the handle — does that stop it temporarily? (If yes → flapper or chain issue.)
- Ask: open the tank lid — does the flapper at the bottom look warped, crooked, or slimy?
- Open a ticket with the answers; describe as "running toilet, flapper [appears worn / appears OK], jiggling [does / does not] stop it." Don't suggest disassembly.

### Slow drain (sink, tub)
- Ask: just one fixture, or several in the same room?
- Ask: anything visibly clogging the drain opening (hair, debris)?
- Safe try: pour a kettle of **hot (not boiling)** water down the drain.
- **Never recommend chemical drain cleaners** — they damage pipes, fittings, and skin.
- If still slow after the hot water → ticket. Describe as "slow drain at [fixture], [hair visible / nothing visible at opening], unaffected by hot water flush."

### Toilet clogged
- Safe try: a standard cup or flange plunger, 5-10 firm in/out strokes.
- Do **not** recommend chemical openers, augers, snakes, or removing the toilet.
- If one plunge attempt doesn't clear it → ticket. Describe as "toilet clogged, plunger attempted, [water level rising / falling slowly / static]."

### Low water pressure at a single fixture
- Ask: hot, cold, or both?
- Ask: any visible debris on the aerator screen at the faucet tip?
- Safe try: confirm the fixture's shut-off valve under the sink is fully open (turn counter-clockwise).
- Ticket if unresolved. Describe as "low pressure at [fixture], [hot / cold / both], shut-off [verified open]."

### Water heater issue (no hot water, lukewarm only)
- Ask: gas or electric? When was the last time it worked normally?
- Ask: anyone showered just before this started? (Recovery time.)
- Do **not** suggest touching the unit, pilot light, or any reset.
- Open a ticket. Describe as "no/limited hot water, [gas/electric/unsure] heater, [no work since X / always limited]."

## Closing each conversation

End every troubleshooting reply with one of:
- "If the safe steps above don't resolve it, please reply with [a photo / specific detail] and I'll dispatch a plumber."
- "Based on what you've described, this needs a licensed plumber. I've noted the symptoms — we'll be in touch within [SLA]."

## Hard limits — never suggest

- Touching the main water shut-off, water meter, or any unfamiliar valve (unless a flood is in progress and a fixture shut-off is visible).
- Working on the water heater — gas or electric.
- Soldering, gluing, or replacing any fitting.
- Removing a toilet, P-trap, or any pipe.
- Chemical drain cleaners, period.
- Anything inside a wall, floor, or ceiling cavity.$skill$, true, 'seed')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  audience = EXCLUDED.audience,
  body = EXCLUDED.body,
  updated_at = now();

