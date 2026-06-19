---
name: maia-platform-project-location
description: Where the MAIA platform repo lives on disk and the home-directory gotcha when a session opens in the wrong place.
metadata: 
  node_type: memory
  type: reference
  originSessionId: 8adbd7f3-7269-4587-81dd-102d03628424
---

## Where the MAIA repo lives

Remote is `PMI-topflo/maia-platform.git`. The local clone path depends on the machine:

- **Desktop (user `fabio`):** canonical clone is now `/Users/fabio/maia-platform` (home root, moved out of iCloud per the gotcha below — confirmed 2026-06-02 as the most-recent repo). Sessions open in home `/Users/fabio`, NOT the project — `cd ~/maia-platform` at session start. STALE copies still exist at `/Users/fabio/Documents/GitHub/maia-platform` (no remote/empty) and `/Users/fabio/Downloads/maia-platform` — ignore both.
- **Laptop / MacBook Air (user `set`):** `/Users/set/maia-platform` (home root, deliberately NOT in Documents). Memory copy lives at `~/.claude/projects/-Users-set/memory/`; the project-keyed dir `-Users-set-maia-platform` is empty, so on the laptop point Claude at the `-Users-set` path if backlog doesn't auto-load.

## ⚠️ iCloud gotcha (2026-05-31, learned the hard way on the laptop)

Do NOT keep the repo under `~/Documents` or `~/Desktop` — those are iCloud-synced. iCloud tries to sync `.next`/`node_modules` (thousands of churning files), which **freezes the dev server and even `mv`/`rm`** (files get evicted to iCloud and must re-download to move). Symptom: `next dev` hangs forever with no `✓ Ready`; `" 2.ts"` collision-duplicate files appear. Fix: keep the project at home root (`~/maia-platform`) and re-CLONE fresh rather than `mv` out of iCloud (mv hangs on evicted files; a fresh `git clone` to a non-synced dir is instant).

## Gotchas

- Ignore the stale copies under `/Users/fabio/Documents/Documents - Fabio's MacBook Air/GitHub/` — those are Mac-migration backups (`maia-platform` and the old `hoa-sticker-app` name). Not canonical.
- The GitHub repo was renamed `hoa-sticker-app` → `maia-platform`; old URLs still redirect.
- The local clone can lag GitHub badly (it was 79 commits behind at the 2026-05-20 session start). Run `git fetch` + check the gap before doing work; the user mostly ships via cloud `claude/...` branch PRs, so the local checkout drifts.
- A stray `.git` repo that had been sitting in `/Users/fabio` (home) was removed on 2026-05-20 — it caused a false "hundreds of deleted files" alarm at session start. If that alarm reappears, the home folder is a git repo again; the real project is unaffected.

See [[next_session_priorities]] for current work status.
