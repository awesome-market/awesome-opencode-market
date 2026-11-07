#!/bin/bash
# Withdraw a submission: remove every submissions.txt seed row carrying
# "issue":N on the catalog branch and push, retrying across remote races.
# Issue-scoped — a same-package seed from a DIFFERENT issue is untouched.
#
#   ISSUE=<n> MSG='<commit msg>' [ENTRY='<key> [more keys…]'] ./bin/catalog-withdraw.sh
#
# ENTRY (optional, best-effort): the submitted package/repo — a space-joined
# key list is accepted; entries match on name OR source.repo so a name+repo
# submission's repo twin is covered too. When the entry is
# still approval:'pending' AND every discoveredVia source is 'submission',
# withdrawal also tombstones the queued catalog entry — a retracted
# submission should stop consuming scan/verify/AI budget and must not
# auto-release later. Published (approved/legacy) entries and entries with
# organic discovery sources are NOT removed — organic rediscovery stands on
# its own and a live package needs a maintainer verdict.
#
# Exit 0 = withdrawal landed OR nothing existed to withdraw (idempotent).
# Exit 1 = push failed after retries; the caller should tell the user to retry.
set -uo pipefail
: "${ISSUE:?}" "${MSG:?}"
git config user.email "market-bot@users.noreply.github.com"
git config user.name "market-bot"
WT=${WT:-/tmp/catw}
for i in 1 2 3; do
  # --depth=1 + forced tracking refspec — same rationale as catalog-append.sh
  # (tip-only reads, non-FF remote must not wedge the retry loop)
  git fetch --depth=1 origin '+refs/heads/catalog:refs/remotes/origin/catalog' || { echo "attempt $i: fetch failed"; sleep 3; continue; }
  git worktree remove "$WT" --force 2>/dev/null || true
  # a stray NON-worktree dir at WT (killed run, pruned registration) breaks
  # `worktree add` on every retry — same guard catalog-append.sh carries
  rm -rf "$WT"
  # ...and a registration WITHOUT a dir wedges add the same way ('missing but
  # registered worktree') — prune clears it so the retry loop can recover
  git worktree prune
  git worktree add "$WT" origin/catalog --detach || { echo "attempt $i: no origin/catalog"; sleep 3; continue; }
  touch "$WT/submissions.txt"
  # ENTRY ground truth = the seed rows actually removed, not the caller's
  # re-parse of the CURRENT issue body — an author who edited the form after
  # ingest would otherwise tombstone the wrong name (or none at all). Env
  # ENTRY remains the fallback for re-runs where no rows are left.
  # Keys = EVERY name/repo the removed rows carried (space-joined): a
  # name+repo seed can own TWO pending entries (the rejected npm name's twin
  # AND the repo twin's github-kind entry) — the last row's `name ?? repo`
  # alone can't see the second one.
  DERIVED=$(node -e '
    const fs=require("fs"),f=process.argv[1],issue=Number(process.argv[2])
    const rows=fs.readFileSync(f,"utf8").split("\n").filter(l=>l.trim())
    const keep=[],removed=[]
    for(const l of rows){
      let drop=false
      try{const s=JSON.parse(l);if(s.issue===issue){removed.push(s);drop=true}}catch{}
      if(!drop)keep.push(l)
    }
    fs.writeFileSync(f,keep.length?keep.join("\n")+"\n":"")
    const keys=new Set()
    for(const s of removed){if(s.name)keys.add(s.name);if(s.repo)keys.add(s.repo)}
    console.log([...keys].join(" "))
  ' "$WT/submissions.txt" "$ISSUE")
  ENTRY="${DERIVED:-${ENTRY:-}}"
  git -C "$WT" add submissions.txt
  if [ -n "${ENTRY:-}" ] && [ -f "$WT/index.json" ]; then
    node -e '
      const fs=require("fs"),f=process.argv[1]
      // every derived key (names AND repos) — the pending entry is matched by
      // name OR source.repo: a github-kind entry named "owner/repo" never
      // equals the npm name a name+repo seed derived first
      const keys=new Set(process.argv[2].toLowerCase().split(/\s+/).filter(Boolean))
      const i=JSON.parse(fs.readFileSync(f,"utf8"))
      let wrote=false
      for(let x=i.plugins.length-1;x>=0;x--){
        const e=i.plugins[x]
        if(!keys.has(e.name.toLowerCase())&&!keys.has((e.source?.repo??"").toLowerCase()))continue
        if(e.approval!=="pending"||!(e.discoveredVia??[]).every(v=>v==="submission")){
          console.log(`entry ${e.name} kept — ${e.approval!=="pending"?"already "+e.approval:"has non-submission sources"} (maintainer call)`)
          continue
        }
        i.plugins.splice(x,1)
        i.removed=i.removed??[]
        i.removed.push({slug:e.slug,name:e.name,lastSource:e.source,
          ...(e.createdAt?{createdAt:e.createdAt}:{}),
          disappearedAt:new Date().toISOString(),reason:"manual"})
        console.log(`retracted pending submission-only entry ${e.name} → tombstone`)
        wrote=true
      }
      if(wrote)fs.writeFileSync(f,JSON.stringify(i,null,2)+"\n")
    ' "$WT/index.json" "$ENTRY"
    git -C "$WT" add index.json 2>/dev/null || true
  fi
  if git -C "$WT" diff --cached --quiet; then
    echo "nothing to withdraw for issue #$ISSUE"
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
