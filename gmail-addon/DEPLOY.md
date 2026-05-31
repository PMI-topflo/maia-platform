# Maia Gmail Add-on — deploy guide

A Google Workspace Add-on that puts a **Maia panel in Gmail's right sidebar**:
homepage = "my open tickets/work orders"; on an open email = the matched ticket,
recent history, a guided **Create ticket / work order** form, quick status
changes, and an **AI Draft reply** button. It talks to Maia's `/api/addon/*`
endpoints with a per-staff bearer token.

This code is **not deployed by Vercel** — it runs on Google Apps Script. Deploy
it once to your Workspace; each staffer then pastes their token.

---

## What's here
- `appsscript.json` — manifest (scopes, homepage + contextual + compose triggers)
- `Code.gs` — all the card UI + backend calls

## Prereqs
- A **Google Workspace** account with admin rights (consumer Gmail can't install domain add-ons).
- The Maia backend deployed with the `/api/addon/*` routes (PR: add-on API surface) and `MAIA_SESSION_SECRET` set in Vercel (already used by sessions).

---

## Option A — deploy with `clasp` (recommended)

```bash
npm install -g @google/clasp
clasp login

# from repo root:
cd gmail-addon
clasp create --type standalone --title "Maia"   # creates a new Apps Script project + .clasp.json
clasp push                                        # uploads appsscript.json + Code.gs
clasp open                                        # opens the Apps Script editor
```

In the Apps Script editor:
1. **Deploy ▸ Test deployments ▸ Install** to try it in your own Gmail immediately.
2. When happy: **Deploy ▸ New deployment ▸ Add-on**, then publish to your org (below).

## Option B — paste manually
1. <https://script.google.com> ▸ **New project**.
2. Replace `Code.gs` with this file's contents; add a file `appsscript.json`
   (Project Settings ▸ "Show appsscript.json") and paste the manifest.
3. Save. **Deploy ▸ Test deployments ▸ Install**.

---

## Publish to your team (private, no public review)
1. In the Apps Script project: **Deploy ▸ New deployment ▸ type: Add-on**.
2. Google Cloud console (same project) ▸ **Google Workspace Marketplace SDK** ▸
   configure the store listing as **Private** (visible only to your domain).
3. Workspace **Admin console ▸ Apps ▸ Marketplace apps** ▸ install for the org
   (or specific OUs). Staff get the Maia icon in Gmail's right rail automatically.

> Private domain-wide install does **not** require Google's public app review.

---

## Connect each staffer (one time)
1. Staffer opens **Maia ▸ `/admin/addon`** in their browser (must be signed in as staff).
2. Copy the **API base URL** and **add-on token** shown there.
3. In Gmail, open the **Maia** panel ▸ **Settings** ▸ paste both ▸ **Save**.

The token authenticates the add-on as that staff member (1-year validity; re-mint
on `/admin/addon` anytime).

---

## Scopes used (and why)
| Scope | Why |
|---|---|
| `gmail.addons.execute` | run the add-on |
| `gmail.addons.current.message.metadata` | read the open email's sender/subject/thread |
| `gmail.addons.current.action.compose` | insert the AI draft into a reply |
| `script.external_request` | call Maia's `/api/addon/*` |
| `userinfo.email` | identify the signed-in user |

## Notes / limits
- UI is Google **CardService** (cards/widgets), not custom HTML — it looks like a native Gmail add-on panel.
- The add-on never sends mail itself. Staff send natively from Gmail; the backend's **SENT-capture** records the reply back onto the ticket.
- "Insert Maia draft" pulls the most recently generated draft for the open thread (cached ~30 min).
- If you rotate `MAIA_SESSION_SECRET`, every staffer must re-copy their token from `/admin/addon`.
