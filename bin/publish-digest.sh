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

# clone/push 只用远端 URL —— 绝不 clone 本地路径:本地 clone 的 origin 指向
# 本地 repo,push 退出码 0 但远端永远收不到(假成功,静默丢日报)
URL="$(git -C "$REPO" remote get-url origin 2>/dev/null || true)"
[ -n "$URL" ] || { echo "[digest] $REPO has no origin remote"; exit 1; }
# digest rows link to per-item [review] issues — phone: tap link → tap a label
export MARKET_REPO_URL="${MARKET_REPO_URL:-$(printf '%s' "$URL" | sed -E 's#^git@([^:]+):#https://\1/#; s#\.git$##')}"

alert() {
  # best-effort: 本地兜底失败也要有 issue 面,不能只在 launchd 日志里烂掉
  command -v gh >/dev/null 2>&1 || return 0
  local slug
  slug=$(printf '%s' "$URL" | sed -nE 's#.*github\.com[:/]([^/]+/[^/]+?)(\.git)?$#\1#p')
  [ -n "$slug" ] || return 0
  gh label create pipeline-alert -R "$slug" --force >/dev/null 2>&1
  gh issue list -R "$slug" --label pipeline-alert --state open --search "publish-digest" --json number --jq '.[0].number' 2>/dev/null | grep -q . && return 0
  gh issue create -R "$slug" --label pipeline-alert \
    --title "publish-digest failed on $(hostname -s 2>/dev/null || echo local)" \
    --body "本机兜底 publish-digest 连续失败。查 launchd 日志 ~/Library/Logs/opencode-market/,以及 worktree remote 是否与 $URL 一致: git -C $CAT remote -v" >/dev/null 2>&1
  return 0
}

mkdir -p "$(dirname "$CAT")"
if [ ! -d "$CAT/.git" ]; then
  git clone --single-branch --branch catalog "$URL" "$CAT" \
    || { echo "[digest] catalog branch not found"; exit 1; }
fi
# 远端改名/迁移自愈:worktree 的 origin 漂移时拉回正确 URL,防推错 repo
[ "$(git -C "$CAT" remote get-url origin 2>/dev/null)" = "$URL" ] || git -C "$CAT" remote set-url origin "$URL"
cd "$CAT" || exit 1

for i in 1 2 3 4; do
  # fetch+reset at the TOP of every iteration: a previous failed commit is
  # discarded and the digest re-renders against the freshest remote state
  git fetch origin catalog -q || { echo "[digest] fetch attempt $i failed (offline?)"; sleep 3; continue; }
  # reset 失败必须重试——没有 -e,失败会继续拿陈旧状态渲染并推失真日报
  git reset --hard origin/catalog -q || { echo "[digest] reset attempt $i failed"; sleep 3; continue; }
  # reset 不碰 untracked:上轮的残留渲染产物会混进 git add,先清掉
  git clean -fd digest/ >/dev/null 2>&1 || true
  (cd "$REPO" && npx tsx pipeline/ai/digest.ts \
    --index "$CAT/index.json" --verdicts "$CAT/ai-verdicts.jsonl" \
    --state "$CAT/digest-state.json" --out-dir "$CAT") || { echo "[digest] render attempt $i failed"; sleep 3; continue; }
  git add digest/ digest-state.json
  git diff --cached --quiet && { echo "[digest] nothing changed vs origin"; exit 0; }
  git commit -qm "digest: $(date +%F)" || { echo "[digest] commit attempt $i failed"; sleep 3; continue; }
  git push -q origin catalog && exit 0
  echo "[digest] push attempt $i failed — re-fetching remote head and re-rendering"; sleep 3
done
alert
exit 1
