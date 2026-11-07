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
#   [ISSUE=<n>] [APPLY_INDEX=1] ./bin/catalog-append.sh
#   APPLY_ONLY=1 [MSG='<commit msg>'] ./bin/catalog-append.sh
#
# Default dedupe: skip when the exact LINE already exists anywhere in FILE —
# a push that succeeded but reported failure must not duplicate it.
# ISSUE mode (submissions.txt ONLY): a seed line already carrying "issue":N is
# the SAME submission being re-reviewed — replace it in place so re-reviews
# update reviewedVersion/`at` instead of stacking duplicate rows (F-5). A
# second issue submitting the SAME package gets its own row on purpose: every
# submission issue needs a tracked seed, otherwise it or silently drops
# with no status comment, no notify, and no dead-seed lifecycle. Duplicate
# package rows are cheap — run.ts keys seedMeta by name (last wins) and
# markNotified comments on every issue that matches the landed entry.
# The gate is FILE-scoped on purpose: ai-verdicts.jsonl rows ALSO carry an
# `issue` field, but a verdict is an append-only judgment — replacing same-
# issue rows would erase earlier brakes/passes from the audit log AND from
# applyMatureVerdicts' only source of truth (submit.yml once leaked ISSUE
# into the verdict append this way). Verdict dedupe stays exact-line.
# APPLY_INDEX=1: run pipeline/release.ts to fold verdicts into index.json in
# the same commit — a human brake lands in minutes instead of at the next
# scheduled catalog generate. Apply failure degrades to verdict-line-only:
# the append-only audit log must never lose a judgment.
# APPLY_ONLY=1 (HV-3 heal): skip the append entirely and just fold verdicts —
# the degraded-apply recovery path. The workflow's SEMANTIC dedupe (dup=1)
# gates out the normal append step, so "re-trigger the same command" can
# never reach this script's line-level dedupe; an apply-only run lets a
# retried command actually heal a verdict that landed without its index fold.
# STATUS_FILE (optional): callers distinguish "verdict landed + index updated"
# from "verdict landed but the public index is still stale" — written as
#   ok       apply ran and index.json is in the commit (or already current)
#   degraded verdict landed but the index apply failed (or index.json missing)
#   skipped  no apply was requested
#   failed   push retry loop exhausted — the verdict may not have landed
# A re-run whose line dedupes still re-executes the apply: release.ts is
# idempotent, so a degraded landing is healed by re-triggering the command.
set -uo pipefail
if [ "${APPLY_ONLY:-}" = 1 ]; then
  : "${MSG:=release: apply mature verdicts (degraded-apply heal)}"
else
  : "${FILE:?}" "${LINE:?}" "${MSG:?}"
fi
git config user.email "market-bot@users.noreply.github.com"
git config user.name "market-bot"
WT=${WT:-/tmp/cat}
APPLY_RES=skipped
APPLY_WANT=0
[ "${APPLY_ONLY:-}" = 1 ] && APPLY_WANT=1
[ "${APPLY_INDEX:-}" = 1 ] && APPLY_WANT=1
mark() { [ -n "${STATUS_FILE:-}" ] && printf '%s\n' "$1" > "$STATUS_FILE"; return 0; }
for i in 1 2 3 4; do
  # --depth=1: the worktree only needs the tip (every index.json commit is
  # ~14MB and history was fetched in full on EVERY retry). The '+' forced
  # tracking refspec also survives a rewritten catalog branch — a non-FF
  # tracking update would otherwise fail the fetch and wedge the retry loop.
  git fetch --depth=1 origin '+refs/heads/catalog:refs/remotes/origin/catalog' || { echo "attempt $i: fetch failed"; sleep 3; continue; }
  git worktree remove "$WT" --force 2>/dev/null || true
  # a stray NON-worktree dir at WT (killed run, pruned registration) breaks
  # `worktree add` on every retry — WT is dedicated scratch, safe to clear
  rm -rf "$WT"
  # ...and a registration WITHOUT a dir wedges add the same way ('missing but
  # registered worktree') — prune clears it so the retry loop can recover
  git worktree prune
  git worktree add "$WT" origin/catalog --detach || { echo "attempt $i: no origin/catalog"; sleep 3; continue; }
  if [ "${APPLY_ONLY:-}" != 1 ]; then
    touch "$WT/$FILE"
    # ISSUE replacement is meaningful only for submissions.txt seed rows —
    # see the header note. Any other FILE (ai-verdicts.jsonl et al.) gets
    # exact-line dedupe even when ISSUE is set, so a stray env can never
    # delete same-issue history.
    if [ -n "${ISSUE:-}" ] && [ "${FILE##*/}" = "submissions.txt" ]; then
      # ISSUE mode: drop stale seed row(s) for this issue, append the fresh
      # line — one row per issue, newest review wins. JSON.parse detection, not
      # a comma-anchored grep (F-5). A row from a DIFFERENT issue is kept: that
      # issue has its own lifecycle to close out.
      R=$(node -e '
        const fs=require("fs"),f=process.argv[1],issue=Number(process.argv[2]),line=process.argv[3]
        const rows=fs.readFileSync(f,"utf8").split("\n").filter(l=>l.trim())
        const keep=rows.filter(l=>{try{return JSON.parse(l).issue!==issue}catch{return true}})
        const had=keep.length!==rows.length
        if(had){fs.writeFileSync(f,keep.length?keep.join("\n")+"\n":"");fs.appendFileSync(f,line+"\n")}
        process.stdout.write(had?"replaced":"absent")
      ' "$WT/$FILE" "$ISSUE" "$LINE")
      [ "$R" = "replaced" ] || printf '%s\n' "$LINE" >> "$WT/$FILE"
    else
      grep -qxF -- "$LINE" "$WT/$FILE" || printf '%s\n' "$LINE" >> "$WT/$FILE"
    fi
    git -C "$WT" add "$FILE"
  fi
  if [ "$APPLY_WANT" = 1 ] && [ -f "$WT/index.json" ]; then
    if npx tsx pipeline/release.ts "$WT/index.json" "$WT/ai-verdicts.jsonl" "$WT/digest-state.json" > "$WT/index.new.json"; then
      mv "$WT/index.new.json" "$WT/index.json"
      git -C "$WT" add index.json
      APPLY_RES=ok
    else
      rm -f "$WT/index.new.json"
      APPLY_RES=degraded
      echo "verdict apply failed — landing verdict line only (applies at next catalog run)"
    fi
  elif [ "$APPLY_WANT" = 1 ]; then
    # index.json missing on the branch → nothing to fold into — the verdict
    # still lands but the caller must know the index was NOT updated
    APPLY_RES=degraded
  fi
  # empty staged diff = the line is already on origin/catalog (an earlier push
  # succeeded but reported failure) — landed, not "nothing to do". For an
  # apply-only run it means the index is already current — also ok.
  if git -C "$WT" diff --cached --quiet; then
    echo "already on origin/catalog — nothing to push"
    mark "$APPLY_RES"
    git worktree remove "$WT" --force 2>/dev/null || true
    exit 0
  fi
  git -C "$WT" commit -qm "$MSG" || { echo "attempt $i: commit failed"; sleep 3; continue; }
  git -C "$WT" push -q origin HEAD:catalog && { mark "$APPLY_RES"; git worktree remove "$WT" --force 2>/dev/null || true; exit 0; }
  echo "push rejected (attempt $i) — retrying"
  sleep 3
done
git worktree remove "$WT" --force 2>/dev/null || true
mark failed
echo "failed to land on catalog after 4 attempts"
exit 1
