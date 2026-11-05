#!/bin/bash
# Withdraw a submission: remove every submissions.txt seed row carrying
# "issue":N on the catalog branch and push, retrying across remote races.
# Issue-scoped — a same-package seed from a DIFFERENT issue is untouched.
# Already-published catalog entries are NOT removed (that takes a maintainer
# verdict); the caller comments accordingly.
#
#   ISSUE=<n> MSG='<commit msg>' ./bin/catalog-withdraw.sh
#
# Exit 0 = seeds removed OR none existed (idempotent — withdraw before ingest
# is a no-op, still a successful withdrawal). Exit 1 = push failed after
# retries; the caller should tell the user to retry.
set -uo pipefail
: "${ISSUE:?}" "${MSG:?}"
git config user.email "market-bot@users.noreply.github.com"
git config user.name "market-bot"
WT=${WT:-/tmp/catw}
for i in 1 2 3; do
  git fetch origin catalog || { echo "attempt $i: fetch failed"; sleep 3; continue; }
  git worktree remove "$WT" --force 2>/dev/null || true
  git worktree add "$WT" origin/catalog --detach || { echo "attempt $i: no origin/catalog"; sleep 3; continue; }
  touch "$WT/submissions.txt"
  # count rows for this issue first — none means nothing to withdraw
  HAVE=$(node -e '
    const fs=require("fs"),f=process.argv[1],issue=Number(process.argv[2])
    const n=fs.readFileSync(f,"utf8").split("\n").filter(l=>{
      if(!l.trim())return false
      try{return JSON.parse(l).issue===issue}catch{return false}
    }).length
    console.log(n)
  ' "$WT/submissions.txt" "$ISSUE")
  if [ "${HAVE:-0}" = 0 ]; then
    echo "no seed rows for issue #$ISSUE — nothing to withdraw"
    git worktree remove "$WT" --force 2>/dev/null || true
    exit 0
  fi
  node -e '
    const fs=require("fs"),f=process.argv[1],issue=Number(process.argv[2])
    const keep=fs.readFileSync(f,"utf8").split("\n").filter(l=>{
      if(!l.trim())return false
      try{return JSON.parse(l).issue!==issue}catch{return true}
    })
    fs.writeFileSync(f,keep.length?keep.join("\n")+"\n":"")
  ' "$WT/submissions.txt" "$ISSUE"
  git -C "$WT" add submissions.txt
  if git -C "$WT" diff --cached --quiet; then
    git worktree remove "$WT" --force 2>/dev/null || true
    exit 0
  fi
  git -C "$WT" commit -qm "$MSG" || { echo "attempt $i: commit failed"; sleep 3; continue; }
  git -C "$WT" push -q origin HEAD:catalog && { git worktree remove "$WT" --force 2>/dev/null || true; exit 0; }
  echo "push rejected (attempt $i) — retrying"
  sleep 3
done
git worktree remove "$WT" --force 2>/dev/null || true
echo "failed to withdraw on catalog after 3 attempts"
exit 1
