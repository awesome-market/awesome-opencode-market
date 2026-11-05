#!/bin/bash
# ai-diagnose 定时入口 — launchd 每小时调用。
# 流程:同步 catalog 分支 worktree → diagnose 写临时 verdict 文件 → 重放式推送。
# 推送循环每轮 fetch+reset 后重新 append 同一批 verdict——任何远端并发变更
# (catalog/verify/digest/人工 verdict)都不会丢本地裁决,也不会撞 append-only
# 文件尾冲突。失败=退出非零,launchd 日志可查;断网=静默下轮补跑。
#
# 运行环境约束:
# - 管线代码跑在 $CODE —— 一个钉在 origin/main 的独立 checkout,绝不是当前
#   开发工作区(脏树/切了分支/未提交 WIP 都不会被定时任务执行)。lockfile
#   变化才跑 npm ci。
# - $CAT 是独立的 catalog 分支 checkout,与 REPO/CODE/其他 writer 互不共享。
# - 远端 URL 优先取 MARKET_GIT_URL —— launchd 的 TCC 可能读不到外置卷上的
#   REPO,而克隆目标都在系统卷,整个任务可完全不依赖开发 checkout。
# - 每轮写 $HEALTHF(机器可读健康戳),digest §⑤ 用来看"本机诊断活着没有"——
#   ai-verdicts.jsonl 有多个写入者,文件新鲜度证明不了 diagnose 在跑。
set -uo pipefail

REPO=${MARKET_REPO:-/Volumes/2t/code/opencode-market}
CAT=$HOME/.local/share/opencode-market-catalog   # dedicated catalog-branch checkout
CODE=$HOME/.local/share/opencode-market-code     # pinned origin/main code checkout
LOGD=$HOME/Library/Logs/opencode-market
STATED=$HOME/.local/share/opencode-market
STATEF=$STATED/diagnose-attempts.json
SWEEPF=$STATED/diagnose-sweep.stamp
HEALTHF=$STATED/diagnose-health.json
# verdicts whose push never landed — replayed into the next run's payload and
# fed back as evidence so the same keys aren't re-reviewed at LLM cost
SPOOL=$STATED/pending-verdicts.jsonl
mkdir -p "$LOGD" "$STATED"

log() { printf '%s [diagnose] %s\n' "$(date '+%F %T')" "$*"; }

# merge a field into the health stamp — advisory, runs from $CODE so npx
# resolves tsx against the pinned checkout's node_modules
stamp_health() {
  (cd "$CODE" 2>/dev/null && HF="$HEALTHF" K="$1" V="$2" npx tsx -e '
import { readFileSync, writeFileSync } from "node:fs"
let h: Record<string, unknown> = {}
try { h = JSON.parse(readFileSync(process.env.HF!, "utf8")) } catch {}
h[process.env.K!] = process.env.V!
writeFileSync(process.env.HF!, JSON.stringify(h) + "\n")
' 2>/dev/null) || true
}

# single-instance guard — launchd stacks runs when a slow tick overruns the
# hour; two runners double-burn the LLM and rebase-race on push. mkdir is
# atomic on macOS (no flock shipped). A SIGKILL'd/wedged run leaves the dir —
# without an age check every future tick skips forever (D-11). Runs are
# bounded (~45min LLM budget + prep), so a lock older than 2h is reclaimed.
LOCK=$STATED/diagnose.lock
if ! mkdir "$LOCK" 2>/dev/null; then
  AGE=$(( $(date +%s) - $(stat -f%m "$LOCK" 2>/dev/null || echo 0) ))
  if [ "$AGE" -gt 7200 ] && rmdir "$LOCK" 2>/dev/null && mkdir "$LOCK" 2>/dev/null; then
    log "reclaimed stale lock (${AGE}s old)"
  else
    log "another run in progress — skipping"; exit 0
  fi
fi
# release on EVERY exit — the plain EXIT trap misses signals; explicit TERM/
# INT handlers exit with the conventional status so cleanup still runs and a
# normal kill never waits 2h for the stale-lock reclaimer
trap 'rm -f "${TMPV:-}" "${PAY:-}" "${VVIEW:-}"; rmdir "$LOCK" 2>/dev/null' EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

# launchd appends to fixed files forever — trim past 5MB, keep the tail
for f in "$LOGD/ai-diagnose.log" "$LOGD/ai-diagnose.err.log"; do
  [ -f "$f" ] && [ "$(stat -f%z "$f" 2>/dev/null || echo 0)" -gt 5242880 ] \
    && { tail -c 1048576 "$f" > "$f.t"; mv "$f.t" "$f"; }
done

ENVF=$HOME/.config/opencode-market/ai.env
[ -f "$ENVF" ] || { log "$ENVF missing — no LLM config, nothing to run"; exit 1; }
# a malformed env file can kill sourcing mid-run — syntax-check first so the
# failure names the file instead of dying on a bare '.'
bash -n "$ENVF" 2>/dev/null || { log "$ENVF has shell syntax errors — refusing to source it"; exit 1; }
set -a; . "$ENVF"; set +a
# HF_HOME only when the dir actually exists — pointing at a missing/external
# path makes the L0.5 model load fail silently inside the python subprocess
[ -d /Volumes/2t/huggingface_tmp ] && export HF_HOME=/Volumes/2t/huggingface_tmp
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# clone/push 只用远端 URL —— 本地路径 clone 的 origin 指向本地 repo,
# push 退出码 0 但远端永远收不到(假成功)。MARKET_GIT_URL 优先:launchd 的
# TCC 可能读不到外置卷上的开发 checkout,但远端 URL 不该因此拿不到。
URL=${MARKET_GIT_URL:-$(git -C "$REPO" remote get-url origin 2>/dev/null || true)}
if [ -z "$URL" ]; then
  log "no remote URL — set MARKET_GIT_URL in $ENVF (dev checkout $REPO unreadable from this context)"
  exit 1
fi

# pinned code checkout — the pipeline runs whatever origin/main has, never a
# dirty dev worktree. Separate dir from $REPO and $CAT. Deps re-install only
# when package-lock.json moved (.deps-stamp lives outside git's reach).
if ! git -C "$CODE" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git clone --single-branch --branch main "$URL" "$CODE" \
    || { log "code checkout clone failed ($URL) — check auth/network"; exit 1; }
fi
git -C "$CODE" remote get-url origin >/dev/null 2>&1 || git -C "$CODE" remote add origin "$URL"
[ "$(git -C "$CODE" remote get-url origin)" = "$URL" ] || git -C "$CODE" remote set-url origin "$URL"
git -C "$CODE" fetch -q origin main || { log "code fetch failed (offline?) — silent, retry next tick"; exit 0; }
git -C "$CODE" reset -q --hard origin/main || { log "code checkout reset failed"; exit 1; }
LOCKHASH=$(shasum -a 256 "$CODE/package-lock.json" | cut -d' ' -f1)
if [ "$(cat "$CODE/.deps-stamp" 2>/dev/null)" != "$LOCKHASH" ]; then
  (cd "$CODE" && npm ci --no-audit --no-fund) >/dev/null \
    || { log "npm ci failed in $CODE — cannot run pinned pipeline"; exit 1; }
  echo "$LOCKHASH" > "$CODE/.deps-stamp"
fi

# dedicated catalog-branch checkout — separate from $REPO and $CODE so the
# branch's other writers (verify/digest/human) never share a worktree
if ! git -C "$CAT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  # classify BEFORE cloning: "remote unreachable" (auth/network → silent
  # retry) vs "branch genuinely absent" (pre-first-catalog → nothing to
  # review). The old code reported every failure as branch-not-found.
  if ! git ls-remote --exit-code --heads "$URL" refs/heads/catalog >/dev/null 2>&1; then
    git ls-remote "$URL" >/dev/null 2>&1 \
      || { log "cannot reach remote $URL (auth/network) — silent, retry next tick"; exit 0; }
    log "catalog branch not found on remote — nothing to review"; exit 0
  fi
  git clone --single-branch --branch catalog "$URL" "$CAT" \
    || { log "catalog clone failed ($URL) — check auth/network/disk"; exit 1; }
fi
git -C "$CAT" remote get-url origin >/dev/null 2>&1 || git -C "$CAT" remote add origin "$URL"
[ "$(git -C "$CAT" remote get-url origin)" = "$URL" ] || git -C "$CAT" remote set-url origin "$URL"
# repo-local identity — no global ~/.gitconfig is guaranteed in this context;
# without it every commit dies on "please tell me who you are" and verdicts
# spool forever. A fixed bot name also makes diagnose commits greppable for
# the watchdog probe (digest.yml looks for the '^ai-diagnose:' prefix).
git -C "$CAT" config user.name "market-bot"
git -C "$CAT" config user.email "market-bot@users.noreply.github.com"
cd "$CAT"
# 拿不到远端状态就不审:离线跑完 push 必败,verdict 只会被下一轮 reset 丢弃
git fetch origin catalog || { log "fetch failed (offline?) — silent, retry next tick"; exit 0; }
# reset 失败必须退出——没有 -e,失败会拿陈旧 index 审一遍,产出错配 verdict
git reset --hard origin/catalog -q || { log "reset failed — refusing to review stale state"; exit 1; }
touch ai-verdicts.jsonl

cd "$CODE"
# bounded per run — the queue drains over many hours, one launchd tick must not
# monopolise the LLM (3300 pending × ~1-2min each would run for days)
DIAGNOSE_LIMIT=${DIAGNOSE_LIMIT:-50}
DIAGNOSE_BUDGET=${DIAGNOSE_BUDGET:-45}   # minutes of LLM time per run
TMPV=$(mktemp -t ai-verdicts)
PAY=$(mktemp -t ai-payload)
VVIEW=$(mktemp -t verdicts-view)

# diagnose must see spooled (un-pushed) verdicts as already-decided — else a
# push that failed last run triggers a second LLM review of the same keys
sort -u "$CAT/ai-verdicts.jsonl" "$SPOOL" > "$VVIEW" 2>/dev/null \
  || cp "$CAT/ai-verdicts.jsonl" "$VVIEW"   # no spool yet → view = branch file

# DIAGNOSE_FORCE: only truthy values pass --force ("0"/"false" must not count)
FARG=
case ${DIAGNOSE_FORCE:-} in ''|0|false|no) ;; *) FARG=--force ;; esac

npx tsx pipeline/ai/diagnose.ts \
  --index "$CAT/index.json" --verdicts "$VVIEW" --out "$TMPV" \
  --limit "$DIAGNOSE_LIMIT" --budget "$DIAGNOSE_BUDGET" --state "$STATEF" \
  --sweep-state "$SWEEPF" --health "$HEALTHF" \
  ${DIAGNOSE_NAME:+--name "$DIAGNOSE_NAME"} $FARG \
  || exit $?

# push payload = this run's verdicts ∪ unreplayed spool — an empty TMPV no
# longer short-circuits when the spool still has lines waiting to land
sort -u "$TMPV" "$SPOOL" > "$PAY" 2>/dev/null || cp "$TMPV" "$PAY"

# schema-gate the payload before it reaches the append-only audit file — a
# hand-edited or disk-corrupted spool line would otherwise land verbatim on
# the branch (downstream parsers skip it, but the file stays dirty forever).
# Validation failure ≠ push failure: proceed unfiltered rather than drop.
PAY="$PAY" npx tsx -e '
import { AiVerdict } from "./src/schema.ts"
import { readFileSync, writeFileSync } from "node:fs"
const p = process.env.PAY!
const lines = readFileSync(p, "utf8").split("\n").filter(Boolean)
let bad = 0
const ok = lines.filter(l => { try { AiVerdict.parse(JSON.parse(l)); return true } catch { bad++; return false } })
if (bad) { console.error(`dropped ${bad} malformed payload line(s)`); writeFileSync(p, ok.join("\n") + (ok.length ? "\n" : "")) }
' || log "payload schema check failed — pushing unfiltered"

[ -s "$PAY" ] || { log "no new verdicts"; exit 0; }

# Replay push: verdicts live in $PAY, not the worktree — a failed push just
# means re-append onto the newest origin/catalog next attempt.
cd "$CAT"
for i in 1 2 3 4; do
  git fetch origin catalog -q || { log "fetch attempt $i failed"; sleep 3; continue; }
  git reset --hard origin/catalog -q || { log "reset attempt $i failed"; sleep 3; continue; }
  touch ai-verdicts.jsonl
  # append only lines not already on the branch — a push that succeeded but
  # reported failure must not produce duplicate verdict lines next attempt
  comm -13 <(sort -u ai-verdicts.jsonl) <(sort -u "$PAY") >> ai-verdicts.jsonl
  git add ai-verdicts.jsonl
  # staged diff empty = the exact lines are already on origin/catalog
  # (an earlier push succeeded but reported failure) — treat as landed
  git diff --cached --quiet && { log "verdicts already on origin/catalog"; : > "$SPOOL"; stamp_health pushed already-landed; exit 0; }
  git commit -qm "ai-diagnose: $(date '+%F %H:%M')" \
    || { log "commit attempt $i failed"; sleep 3; continue; }
  git push -q origin catalog && { : > "$SPOOL"; stamp_health pushed ok; exit 0; }
  log "push attempt $i failed"; sleep 3
done
# push never landed — keep the payload for the next run instead of burning
# the LLM again; diagnose reads it via VVIEW so the keys stay decided
cp "$PAY" "$SPOOL"
stamp_health pushed spooled
log "verdicts NOT pushed — spooled $(wc -l < "$SPOOL" | tr -d ' ') lines for next run's replay (fail-closed, no LLM waste)"
exit 1
