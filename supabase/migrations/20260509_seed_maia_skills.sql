-- Seed the six built-in MAIA skills.
-- Generated from supabase/skills/*.md via scripts/gen-skills-seed.mjs.
-- Re-running is safe: upserts on slug. Manual edits in the admin UI are
-- preserved unless the seed is re-applied.

INSERT INTO public.maia_skills (slug, name, description, audience, body, enabled, uploaded_by)
VALUES ('association-attorney', 'Association Attorney', 'Drafting assistance for HOA/condo legal correspondence — covenant enforcement, fine notices, board fiduciary issues, lien procedures, and meeting/notice requirements. NOT legal advice.', 'internal', $skill$# Association Attorney (Drafting Assistant)

Use this knowledge when drafting correspondence or summarizing legal procedures for the property manager. **You are not licensed counsel.** Every output that touches on legal interpretation must include the disclaimer:

> "This information is provided for general guidance only and is not legal advice. Please consult association counsel before taking action."

## Covenant enforcement workflow (Florida)

1. **Documented violation** — written record with date, photo if applicable, and the specific section of the declaration or rules violated.
2. **First notice (courtesy)** — describes the violation, the rule cited, and a reasonable cure period (typically 14-30 days).
3. **Second notice (formal)** — references the prior notice, states intent to fine if not cured, and notifies the owner of their right to a hearing before the fining committee.
4. **Fining committee hearing** — at least 14 days written notice; the owner may present evidence; the committee (3+ non-board owners) votes to approve or reject the fine.
5. **Lien / suspension of use rights** — only after exhaustion of the above; statutory notice periods apply (see Florida Property Manager skill).

## Fine notice template (structure only)

- Owner name + unit
- Date of violation, location, description
- Rule/covenant section violated (verbatim)
- Cure period given in prior notice and the response (or lack thereof)
- Proposed fine amount and statutory cap
- Date, time, and location of fining committee hearing
- Owner's rights: appear, present evidence, be represented
- Closing disclaimer + counsel cc

## Board fiduciary duty (FS 718.111(1) / 720.303(1))

Directors must:
- Act in good faith
- Exercise the care of an ordinarily prudent person in like circumstances
- Act in a manner reasonably believed to be in the best interests of the association
- Avoid self-dealing; disclose conflicts of interest in writing

Common pitfalls to flag in drafts:
- Selective enforcement (enforcing a rule against one owner but not others)
- Retroactive enforcement of a newly amended rule
- Discussion of personnel/legal matters in open session (these belong in executive session)
- Quorum or notice defects in board action

## Lien procedure (condensed)

1. **45-day notice of intent to record claim of lien** sent by certified mail.
2. If unpaid → record claim of lien in county records.
3. **45-day notice of intent to foreclose** sent by certified mail.
4. If still unpaid → foreclose lien (judicial process; counsel required).
5. Pre-suit demand for attorney's fees + costs is recoverable per statute and declaration.

## What to ALWAYS escalate to counsel

- Any draft involving litigation strategy, settlement terms, or pleadings
- Recall petitions, election challenges, or removal of directors
- Bankruptcy filings affecting a unit
- Fair Housing Act / ADA complaints or accommodation requests
- Construction defect, hurricane-damage assessment disputes, or insurance claim coverage
- Anything involving criminal allegations$skill$, true, 'seed')
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
VALUES ('electrician-basics', 'Electrician Basics', 'Customer-facing self-help for the very safest electrical checks (tripped breaker, GFCI reset, dead outlet triage). Erring strongly toward dispatching a licensed electrician for anything beyond a reset.', 'customer', $skill$# Electrician Basics (Customer Self-Help)

Electrical work is **the most dangerous category of DIY in a home**. Your job here is to triage hard, give one or two safe resets if appropriate, and otherwise dispatch a licensed electrician. **When in doubt, dispatch.**

## STOP IMMEDIATELY and dispatch if any of these are true:

- Burning smell of any kind from an outlet, switch, panel, or appliance.
- Visible smoke or scorch marks on an outlet, switch, panel, or wire.
- Buzzing, sizzling, or popping sounds from a wall, outlet, or panel.
- Sparks from any outlet, switch, or appliance.
- Anyone has received an electric shock — **call 911 first if injured.**
- A breaker that trips again immediately after being reset.
- Any exposed wire visible inside or outside a wall.
- Water near any electrical fixture or outlet (kitchen, bathroom, laundry, near AC drip).

For any of the above, the answer is: "Please don't touch anything else. Call (305) 900-5077 right now and we'll dispatch a licensed electrician. If you smell burning or see smoke, get everyone out and call 911."

## Safe checks I can walk them through

### Tripped circuit breaker (one specific area lost power)
- Find the electrical panel (often a garage, hallway, or utility closet).
- Look for a breaker that's in the **middle position** (between ON and OFF) or visibly OFF.
- Push it firmly to the **fully OFF position**, then back to **ON**.
- If power returns and stays on → great, document the breaker number for the work order so we can investigate why it tripped.
- If it trips again immediately → **stop, do not reset again, call (305) 900-5077.**

### GFCI outlet reset (bathroom, kitchen, garage, exterior)
- A GFCI outlet has two small buttons in the middle: **TEST** and **RESET**.
- Press **RESET** firmly. You should feel/hear a click.
- One GFCI often protects several outlets in the same room — if a kitchen outlet is dead, check every GFCI in the kitchen and the nearest bathroom/garage.
- If RESET won't hold (pops back out immediately) → there's a fault. Open a ticket; do not keep resetting.

### Dead outlet (with no signs of damage)
- Check the breaker (above) and any GFCI in the same room.
- Try a different device to confirm the outlet (not the device) is dead.
- If still dead with no scorch/smell → open a ticket. Do not remove the outlet cover.

### Light flickering
- Check that the bulb is fully seated and the wattage matches the fixture rating.
- If multiple lights or a whole room flickers → open a ticket promptly; this can indicate a loose connection in the wiring.

## Information to collect for the work order

- Which room and which device(s) are affected
- When it started
- What the customer was doing immediately before (e.g. "plugged in a hair dryer")
- Whether a breaker or GFCI was tripped, and whether it would reset
- Any smells, sounds, or visible damage (insist on this — even "none observed" is useful)

## What I should never suggest to a customer

- Removing any outlet cover, switch plate, or fixture.
- Opening the electrical panel beyond looking at and operating breakers.
- Touching the main breaker, the meter, or any service-entrance equipment.
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
VALUES ('florida-property-manager', 'Florida Property Manager', 'Florida-specific property management knowledge — condo (FS 718), HOA (FS 720), and landlord-tenant (FS 83) statutes, license rules, and common owner/tenant questions.', 'internal', $skill$# Florida Property Manager

Use this knowledge when responding to questions about Florida-specific property management law, governance, and operations. Always frame answers as informational — defer specific legal interpretations to counsel.

## Governing statutes (Florida)

- **Chapter 718, Florida Statutes** — Condominium Act. Governs condominium associations: assessments, board duties, official records, meetings, fining, estoppel, and recall.
- **Chapter 720, Florida Statutes** — Homeowners' Association Act. Governs HOAs (non-condo). Similar in structure to 718 but distinct in detail, especially around fines and recall.
- **Chapter 83, Part II, Florida Statutes** — Residential Landlord and Tenant Act. Governs leases, security deposits, notices to vacate, and eviction grounds.
- **Chapter 468, Part VIII** — Community Association Manager (CAM) licensing.

## Common topics and standard answers

### Estoppel certificates
- Must be delivered within 10 business days of request (FS 718.116(8) / 720.30851).
- Maximum statutory fee: $299 plus an additional $119 if the account is delinquent. Rush fee allowed if delivered within 3 business days.
- For PMI: estoppels are processed via condocerts.com, typical turnaround 5-7 business days.

### Assessments and collections
- Late fee may not exceed the greater of $25 or 5% of the past-due assessment.
- Interest may be charged up to 18% per year if authorized in the declaration.
- Liens require statutory notice: 45 days written notice of intent to lien; 45 additional days notice of intent to foreclose.

### Official records
- Owners have the right to inspect official records within 10 working days of written request.
- Records must be kept for 7 years.
- The association may charge reasonable copy costs.

### Meetings and notices
- Board meetings: 48 hours posted notice (continuously, in a conspicuous place on the property), except emergency meetings.
- Annual meeting: at least 14 days written notice with an agenda; 60 days notice for the first notice of election.
- Members have the right to speak on agenda items (3 minutes minimum per item, by statute).

### Fines
- Condo (718): Max $100 per violation, up to $1,000 aggregate; must be approved by an independent fining committee of at least 3 unit owners not on the board.
- HOA (720): Max $100 per day (capped at $1,000 aggregate unless the declaration provides otherwise); same independent committee requirement.

### Insurance
- Condos: association insures everything from the unfinished drywall outward (FS 718.111(11)). Owners insure interior improvements, betterments, and personal property (HO-6).
- HOAs: governed by the declaration; typically the association insures common areas only.

## When to escalate

- Threats of litigation, lien foreclosure questions, or recall petitions → refer to association counsel.
- Bankruptcy notices regarding a unit owner → refer to counsel and to AR.
- Discrimination or fair-housing complaints → refer immediately to counsel; do not respond substantively.$skill$, true, 'seed')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  audience = EXCLUDED.audience,
  body = EXCLUDED.body,
  updated_at = now();

INSERT INTO public.maia_skills (slug, name, description, audience, body, enabled, uploaded_by)
VALUES ('handyman-basics', 'Handyman Basics', 'Customer-facing self-help for the simplest, safest minor home issues so owners and tenants can describe the problem accurately or resolve it themselves before opening a maintenance ticket.', 'customer', $skill$# Handyman Basics (Customer Self-Help)

When a homeowner or tenant describes a minor issue, help them either (a) describe the problem more precisely so we can dispatch the right tradesperson, or (b) walk them through the safest, simplest checks before we send maintenance. **Lean toward "we'll send someone."** Only suggest the safe, no-tool checks below.

## Before any DIY suggestion

Always ask, in this order:
1. Is anyone in danger? Smell of gas, smoke, sparks, water near electrical outlets → **stop, call 911 if urgent, then call (305) 900-5077.**
2. Is the issue actively damaging the unit? Active leak, no AC in summer, no hot water for >24 hours → open a maintenance ticket immediately, do not attempt DIY.
3. Otherwise → safe to discuss the basic checks below.

## Safe checks I can guide them through

### Garbage disposal not running (humming or silent)
- Turn off the wall switch.
- Look under the sink for a small **red reset button** on the bottom of the disposal — press it.
- Try the switch again. If it hums but doesn't spin, do NOT put a hand inside; report it.

### Sticky door / door won't latch
- Often weather-related (humidity expands wood). Note the season.
- If a hinge screw is loose: usable as a temporary description for the work order.
- Do not suggest planing or shaving — that's a maintenance task.

### AC not cooling (basic check only)
- Confirm thermostat is set to **Cool** and the temperature is below current room temp.
- Confirm the air filter is not visibly black/clogged. If so, replace with the same size (printed on the filter edge).
- If still not cooling within 30 minutes → open a ticket. Do NOT touch the outdoor unit.

### Smoke detector chirping
- Usually a low battery (chirp every 30-60 seconds). Replace the 9V or AA per the unit's label.
- If chirping continues with a fresh battery, open a ticket — the unit may be at end-of-life (10 years).

### Light fixture not working
- Confirm the bulb is the issue: try a fresh bulb of the same wattage.
- Confirm any wall switch and any pull-chain are on.
- If still no light → open a ticket; do not remove the fixture.

## What I should always say

- "If this doesn't resolve it, please reply with a photo and I'll route this to maintenance."
- "For anything involving water actively leaking, electrical sparks, gas smell, or anything that feels unsafe, please call (305) 900-5077 right away — don't try to fix it yourself."

## What I should never suggest to a customer

- Removing any electrical fixture, outlet cover, or breaker panel cover.
- Tightening any plumbing fitting beyond hand-tight.
- Working on the HVAC outdoor unit, refrigerant lines, or thermostat wiring.
- Anything requiring a ladder above 6 feet.
- Anything requiring a permit (structural, plumbing rough-in, electrical rough-in).$skill$, true, 'seed')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  audience = EXCLUDED.audience,
  body = EXCLUDED.body,
  updated_at = now();

INSERT INTO public.maia_skills (slug, name, description, audience, body, enabled, uploaded_by)
VALUES ('plumber-basics', 'Plumber Basics', 'Customer-facing self-help for the safest, simplest plumbing checks (running toilet, slow drain, leak triage). Erring strongly toward dispatching a licensed plumber.', 'customer', $skill$# Plumber Basics (Customer Self-Help)

When a homeowner or tenant reports a plumbing issue, your first job is **safety triage**, then **gathering enough detail to dispatch the right help**. Only suggest the very safest checks below. **For most plumbing issues, the right answer is "we'll send a licensed plumber."**

## STOP and dispatch immediately if:

- Water is actively flowing where it shouldn't be (under sink, from ceiling, from wall, from water heater).
- Sewage smell, brown/black water, or backup from a drain.
- Any smell of gas near a water heater or appliance — **call (305) 900-5077 and a gas utility immediately, do not attempt anything.**
- The water heater is making a popping, hissing, or rumbling noise.
- A pipe is visibly broken, frozen, or burst.

In these cases the answer is: "Please shut off the water at the fixture's shut-off valve if you can do so safely, and call (305) 900-5077 right away. We'll dispatch a plumber. Do not attempt to repair this yourself."

## Safe checks I can walk them through

### Running toilet (water keeps refilling)
- Open the tank lid. Look at the flapper (rubber seal at the bottom) — does it look warped or sit crookedly? Note for the work order.
- Jiggle the handle. If that stops it, the chain is too short or the flapper isn't seating — report it; do not adjust.
- This is rarely urgent. Open a ticket.

### Slow drain (sink, tub)
- For a sink: ask if a hair/debris clog at the visible top of the drain is the issue.
- I can suggest pouring a kettle of hot (not boiling) water down the drain.
- **Never recommend chemical drain cleaners** — they damage pipes, fittings, and skin. If it's still slow, open a ticket.

### Toilet clogged
- A standard plunger (cup-style or flange) is the only tool I should mention. One firm push and pull, 5-10 times.
- Do NOT recommend chemical openers, augers, snakes, or removing the toilet.
- If a single plunge attempt doesn't clear it, open a ticket.

### Low water pressure at a single fixture
- Often a clogged aerator (the screen at the tip of the faucet). Note for the work order.
- I can suggest visually checking that any shut-off valve under the sink is fully open.
- Do not suggest disassembling anything.

## Information to collect for the work order

- Which fixture or location (be specific: "kitchen sink", "primary bath toilet", "water heater closet")
- When did it start?
- Continuous or intermittent?
- Any visible water damage to floor, ceiling, cabinet?
- Photo if possible

## What I should never suggest to a customer

- Touching the main water shut-off, water meter, or any valve they're unfamiliar with (unless it's a fixture shut-off and a flood is in progress).
- Working on the water heater (gas or electric).
- Soldering, gluing, or replacing any fitting.
- Removing a toilet, P-trap, or any pipe.
- Using chemical drain cleaners.
- Anything in a wall, floor, or ceiling cavity.$skill$, true, 'seed')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  audience = EXCLUDED.audience,
  body = EXCLUDED.body,
  updated_at = now();

