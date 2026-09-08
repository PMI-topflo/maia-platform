# Memory snapshot — restore on another machine

**Update, 2026-09-08 — read this first.** This directory is a ONE-TIME safety
export, added to the repo in a single commit and never refreshed since. It is
NOT how memory has actually been kept across sessions — that's been git itself,
via `docs/SESSION-HANDOFF.md` (one entry per session) and `docs/ROADMAP.md`
(living feature status), both committed and updated every session. This matters
more than it used to: sessions run today are frequently REMOTE/cloud containers
(Claude Code on the web), which are ephemeral — cloned fresh on start, reclaimed
after inactivity — so there is no `~/.claude/projects/.../memory/` folder that
persists between them at all. Only what's committed to git survives. If you're
restoring context, read `docs/SESSION-HANDOFF.md` + `docs/ROADMAP.md`, not this
directory.

The instructions below still apply if you're running Claude Code on your OWN
persistent local machine and want to carry over that machine's own live memory
folder — a genuinely different scenario from the remote/cloud case above.

Claude Code's file-based memory lives in `~/.claude/projects/<project-key>/memory/`,
which is **local to each machine** (not in iCloud, not in this git repo by default).
This folder is a committed snapshot so a new machine (e.g. laptop) can restore it.

Snapshot taken: 2026-06-19 (after PRs #399–#406). Committed to git 2026-08-24
(a single bulk-import commit, unrelated to its own commit message) — not
updated since.

## Restore on the laptop
From the repo root (`~/maia-platform`), after `git pull`:

```bash
# The project key is derived from the home dir Claude Code opens in.
# If your laptop username is also "fabio" and you open Claude in /Users/fabio:
mkdir -p ~/.claude/projects/-Users-fabio/memory
cp docs/memory-snapshot/*.md ~/.claude/projects/-Users-fabio/memory/
```

If your laptop username is **different** (say `john`), the key changes to
`-Users-john`. Find the right folder after starting Claude once, or just run:

```bash
KEY="-Users-$(whoami)"
mkdir -p ~/.claude/projects/$KEY/memory
cp docs/memory-snapshot/*.md ~/.claude/projects/$KEY/memory/
```

Then restart Claude Code — `MEMORY.md` (the index) loads automatically and the
rest is recalled on demand.

## If you just want the highlights without restoring
Read `docs/memory-snapshot/MEMORY.md` (the index) and
`docs/memory-snapshot/session_2026_06_18_personas_portals_docs.md` +
`docs/memory-snapshot/implementation_roadmap_2026_06.md`.
