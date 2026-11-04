#!/bin/bash
# publish-digest 定时入口(手动兜底) — 日常 digest 已搬到 Actions(digest.yml),
# 本脚本留作本机手动/launchd 兜底。
# 写 digest/YYYY-MM-DD.md + digest-state.json 到 catalog 分支并推送。
# digest-state 更新后,日报窗口内的 pass verdict 才成熟 → 下一次 catalog
# pipeline 运行时可放行。脚本顺序因此负载:先 digest 落地,pipeline 再消费。
# 推送循环内重渲染:与 ai-diagnose 共享本 worktree,远端并发推进时
# (catalog/verify/verdict 写回)reset 后必须按新远端重新生成,不能推陈旧产物。
set -uo pipefail

REPO=/Volumes/2t/code/opencode-market
CAT=$HOME/.local/share/opencode-market-catalog
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
# digest rows link to per-item [review] issues — phone: tap link → tap a label
export MARKET_REPO_URL="${MARKET_REPO_URL:-https://github.com/terry2010/awesome-opencode-market}"

mkdir -p "$(dirname "$CAT")"
if [ ! -d "$CAT/.git" ]; then
  git clone --single-branch --branch catalog "$REPO" "$CAT" 2>/dev/null \
    || git clone --single-branch --branch catalog "$(git -C "$REPO" remote get-url origin)" "$CAT" \
    || { echo "[digest] catalog branch not found"; exit 1; }
fi
cd "$CAT"
touch ai-verdicts.jsonl

for i in 1 2 3 4; do
  # fetch+reset at the TOP of every iteration: a previous failed commit is
  # discarded and the digest re-renders against the freshest remote state
  git fetch origin catalog -q || { echo "[digest] fetch attempt $i failed (offline?)"; sleep 3; continue; }
  git reset --hard origin/catalog -q
  (cd "$REPO" && npx tsx pipeline/ai/digest.ts \
    --index "$CAT/index.json" --verdicts "$CAT/ai-verdicts.jsonl" \
    --state "$CAT/digest-state.json" --out-dir "$CAT") || exit $?
  git add digest/ digest-state.json
  git diff --cached --quiet && { echo "[digest] nothing changed vs origin"; exit 0; }
  git commit -qm "digest: $(date +%F)" || { echo "[digest] commit attempt $i failed"; sleep 3; continue; }
  git push -q origin catalog && exit 0
  echo "[digest] push attempt $i failed — re-fetching remote head and re-rendering"; sleep 3
done
exit 1
