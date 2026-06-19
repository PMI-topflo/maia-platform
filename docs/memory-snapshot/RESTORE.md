# Memory snapshot — restore on another machine

Claude Code's file-based memory lives in `~/.claude/projects/<project-key>/memory/`,
which is **local to each machine** (not in iCloud, not in this git repo by default).
This folder is a committed snapshot so a new machine (e.g. laptop) can restore it.

Snapshot taken: 2026-06-19 (after PRs #399–#406).

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
