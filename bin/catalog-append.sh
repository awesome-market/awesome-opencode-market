#!/bin/bash
# Append one line to a file on the catalog branch and push, retrying across
# remote races. Used by concern.yml / submit.yml — replaces three copies of a
# rebase-push loop that shared two bugs: `git commit || success` treated ANY
# commit failure as landed, and a retry after a falsely-failed push appended
# the same line twice.
#
# Runs inside a throwaway worktree so the caller's checkout (main: pipeline
# code + node_modules) is untouched.
#
#   FILE=<path-in-branch> LINE='<line>' MSG='<commit msg>' \
#   [KEY=<dedupe-key>] [APPLY_INDEX=1] ./bin/catalog-append.sh
#
# Default dedupe: skip when the exact LINE already exists anywhere in FILE —
# a push that succeeded but reported failure must not duplicate it.
# KEY mode (submissions.txt): skip when "name":"KEY", or "repo":"KEY", is
# already present (comma anchor prevents substring false-positives).
# APPLY_INDEX=1: run pipeline/release.ts to fold verdicts into index.json in
# the same commit — a human brake lands in minutes instead of at the next
# scheduled catalog generate. Apply failure degrades to verdict-line-only:
# the append-only audit log must never lose a judgment.
set -uo pipefail
: "${FILE:?}" "${LINE:?}" "${MSG:?}"
git config user.email "market-bot@users.noreply.github.com"
git config user.name "market-bot"
WT=${WT:-/tmp/cat}
for i in 1 2 3; do
  git fetch origin catalog || { echo "attempt $i: fetch failed"; sleep 3; continue; }
  git worktree remove "$WT" --force 2>/dev/null || true
  git worktree add "$WT" origin/catalog --detach || { echo "attempt $i: no origin/catalog"; sleep 3; continue; }
  touch "$WT/$FILE"
  if [ -n "${KEY:-}" ]; then
    grep -qF "\"name\":\"$KEY\"," "$WT/$FILE" || grep -qF "\"repo\":\"$KEY\"," "$WT/$FILE" \
      || printf '%s\n' "$LINE" >> "$WT/$FILE"
  else
    grep -qxF "$LINE" "$WT/$FILE" || printf '%s\n' "$LINE" >> "$WT/$FILE"
  fi
  git -C "$WT" add "$FILE"
  if [ "${APPLY_INDEX:-}" = 1 ] && [ -f "$WT/index.json" ]; then
    if npx tsx pipeline/release.ts "$WT/index.json" "$WT/ai-verdicts.jsonl" "$WT/digest-state.json" > "$WT/index.new.json"; then
      mv "$WT/index.new.json" "$WT/index.json"
      git -C "$WT" add index.json
    else
      rm -f "$WT/index.new.json"
      echo "verdict apply failed — landing verdict line only (applies at next catalog run)"
    fi
  fi
  # empty staged diff = the line is already on origin/catalog (an earlier push
  # succeeded but reported failure) — landed, not "nothing to do"
  if git -C "$WT" diff --cached --quiet; then
    echo "already on origin/catalog — nothing to push"
    git worktree remove "$WT" --force 2>/dev/null || true
    exit 0
  fi
  git -C "$WT" commit -qm "$MSG" || { echo "attempt $i: commit failed"; sleep 3; continue; }
  git -C "$WT" push -q origin HEAD:catalog && { git worktree remove "$WT" --force 2>/dev/null || true; exit 0; }
  echo "push rejected (attempt $i) — retrying"
  sleep 3
done
git worktree remove "$WT" --force 2>/dev/null || true
echo "failed to land on catalog after 3 attempts"
exit 1
