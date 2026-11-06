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
# - 每轮写 $HEALTHF(机器可读健康戳 {at,wrote,l05,omlx,pushed}),状态翻转或
#   每 24h 经 publish_health 落到 catalog 分支 diagnose-health.json——CI 的
#   watchdog 第五腿与 digest §⑤ 消费它,区分"活着且健康"与"活着但 L0.5/LLM
#   降级"(ai-verdicts.jsonl 有多个写入者,文件新鲜度证明不了 diagnose 在跑,
#   verdict commit 年龄也看不见"活着但通道受损")。
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

# publish the health stamp to the catalog branch — the local $HEALTHF is
# invisible to CI, so without this the watchdog/digest can never tell
# "worker alive + L0.5/LLM degraded" apart from "worker alive + healthy"
# (verdict commits prove a run happened; only this stamp carries l05/omlx).
# Publishes on signal change (l05/omlx/pushed/wrote-nonzero) or as a 24h
# heartbeat so the stamp's freshness check keeps working. Advisory: any
# failure retries on the next transition — a dead push path is already
# covered by the verdict-spool leg. Uses `git -C` everywhere so the caller's
# cwd ($CODE for the schema gate) is never disturbed.
HEALTH_PUB=$STATED/diagnose-health.published.json
publish_health() {
  [ -f "$HEALTHF" ] || return 0
  # freshness guard: only stamps from a run in the last 2h may publish —
  # a dead worker's stale file must not keep masquerading as live state
  python3 - "$HEALTHF" >/dev/null 2>&1 <<'PY' || return 0
import json,sys,datetime
h=json.load(open(sys.argv[1]))
at=datetime.datetime.fromisoformat(str(h.get('at','')).replace('Z','+00:00'))
sys.exit(0 if (datetime.datetime.now(datetime.timezone.utc)-at).total_seconds()<7200 else 1)
PY
  DECIDE=$(python3 - "$HEALTHF" "$HEALTH_PUB" 2>/dev/null <<'PY' || echo 0
import json,sys,datetime
try:
    h=json.load(open(sys.argv[1]))
    sig={'l05':h.get('l05'),'omlx':h.get('omlx'),'pushed':h.get('pushed'),'wrote':int(h.get('wrote',0))>0}
    try:
        p=json.load(open(sys.argv[2]))
        same=all(p.get(k)==v for k,v in sig.items())
        age=(datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(str(p.get('publishedAt','')).replace('Z','+00:00'))).total_seconds()
        print(0 if (same and age<86400) else 1)
    except Exception:
        print(1)
except Exception:
    print(0)
PY
)
  [ "$DECIDE" = 1 ] || return 0
  local ok=0
  for i in 1 2 3; do
    git -C "$CAT" fetch -q --depth=1 origin +refs/heads/catalog:refs/remotes/origin/catalog \
      && git -C "$CAT" reset --hard origin/catalog -q || { sleep 3; continue; }
    # write the stamp AFTER reset — the file is tracked once published, so
    # reset --hard restores the OLD version and would wipe a pre-loop write
    # (first publish escaped this only because the file was still untracked)
    python3 - "$HEALTHF" "$CAT/diagnose-health.json" >/dev/null 2>&1 <<'PY' || { sleep 3; continue; }
import json,sys,datetime
h=json.load(open(sys.argv[1]))
h['publishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z')
json.dump(h,open(sys.argv[2],'w'))
PY
    git -C "$CAT" add diagnose-health.json
    # identical stamp already on the branch → nothing to do but record it
    git -C "$CAT" diff --cached --quiet && { ok=1; break; }
    git -C "$CAT" commit -qm "diagnose: health $(date -u +%FT%TZ)" \
      && git -C "$CAT" push -q origin catalog && { ok=1; break; }
    sleep 3
  done
  [ "$ok" = 1 ] && cp "$CAT/diagnose-health.json" "$HEALTH_PUB" 2>/dev/null || true
}

# pause|resume —— 先处理开关再进正常流程:翻转"声明暂停"只需要 git,不该
# 等正在跑的诊断锁(最长 45min),也不需要 ai.env/LLM(恰恰是 LLM 挂了才
# 要声明暂停)。标志是 catalog 分支的 diagnose.paused——数据面开关,一次
# push 全局生效。消费端:watchdog 停摆腿跳过、docket 'none' 目标聚合成
# 积压总单、digest §⑤ 标注、本脚本每轮自跳过(见下)。
# 提交前缀故意用 'diagnose:' 而非 'ai-diagnose:'——watchdog 拿
# '--grep=^ai-diagnose:' 量"上次真实诊断落地",开关翻转不算 worker 活动。
case "${1:-}" in
  pause|resume)
    URL=${MARKET_GIT_URL:-$(git -C "$REPO" remote get-url origin 2>/dev/null || true)}
    [ -n "$URL" ] || { log "no remote URL — set MARKET_GIT_URL"; exit 1; }
    git -C "$CAT" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
      || git clone --depth=1 --single-branch --branch catalog "$URL" "$CAT" \
      || { log "catalog clone failed ($URL) — check auth/network"; exit 1; }
    git -C "$CAT" config user.name "market-bot"
    git -C "$CAT" config user.email "market-bot@users.noreply.github.com"
    FLAG=diagnose.paused
    for i in 1 2 3 4; do
      (cd "$CAT" && git fetch -q --depth=1 origin +refs/heads/catalog:refs/remotes/origin/catalog \
        && git reset --hard origin/catalog -q) \
        || { log "sync attempt $i failed"; sleep 3; continue; }
      # ask the REMOTE tip, not the worktree file: reset --hard never touches
      # untracked files, so a stray flag left by a crashed pause (written but
      # never committed) would report "already paused" while origin never
      # paused — and every diagnose run would self-skip on it forever.
      if [ "$1" = pause ]; then
        git -C "$CAT" cat-file -e "origin/catalog:$FLAG" 2>/dev/null && { log "already paused"; exit 0; }
        printf 'diagnose paused at %s%s\n' "$(date -u +%FT%TZ)" "${2:+ — $2}" > "$CAT/$FLAG"
      else
        git -C "$CAT" cat-file -e "origin/catalog:$FLAG" 2>/dev/null || { log "not paused"; exit 0; }
        rm -f "$CAT/$FLAG"
      fi
      (cd "$CAT" && git add -A "$FLAG" && ! git diff --cached --quiet) \
        || { log "flag already in desired state"; exit 0; }
      (cd "$CAT" && git commit -qm "diagnose: $1 ($(date -u +%FT%TZ))" && git push -q origin catalog) \
        && { log "$1 recorded on catalog branch"; exit 0; }
      log "push attempt $i failed"; sleep 3
    done
    log "$1 push failed after retries"; exit 1
    ;;
esac

# single-instance guard — launchd stacks runs when a slow tick overruns the
# hour; two runners double-burn the LLM and rebase-race on push. mkdir is
# atomic on macOS (no flock shipped). A SIGKILL'd/wedged run leaves the dir —
# without an age check every future tick skips forever (D-11). Runs are
# bounded (~45min LLM budget + prep), so a lock older than 2h is reclaimed —
# but ONLY when the recorded owner pid is actually gone: age alone can't tell
# a wedged-but-alive run (stuck in an uninterruptible wait) from a dead one,
# and stealing a live run's lock lets its EXIT trap rmdir the NEW owner's
# lock below → a third run starts → double LLM burn + push races.
LOCK=$STATED/diagnose.lock
if ! mkdir "$LOCK" 2>/dev/null; then
  AGE=$(( $(date +%s) - $(stat -f%m "$LOCK" 2>/dev/null || echo 0) ))
  OLD_PID=$(cat "$LOCK/pid" 2>/dev/null || true)
  OWNER_DEAD=0
  case $OLD_PID in
    '') OWNER_DEAD=1 ;;                          # pre-pid-era lock, or crash before the write
    *[!0-9]*) OWNER_DEAD=1 ;;                    # corrupt pid file — treat as dead
    *) kill -0 "$OLD_PID" 2>/dev/null || OWNER_DEAD=1 ;;
  esac
  # stale reclaim must be atomic: rmdir+mkdir lets a second reclaimer delete
  # the fresh lock the first just made (double-run + its trap later rmdir's
  # the winner's lock). mv IS atomic — the first rename takes the stale dir;
  # a loser's mv hits ENOENT after the winner's rename and falls through to
  # the skip branch like any live lock. The fresh mkdir is re-verified too:
  # a new contender can slip in between mv and mkdir and legitimately win.
  RECLAIMED=0
  if [ "$AGE" -gt 7200 ] && [ "$OWNER_DEAD" = 1 ] \
     && mv "$LOCK" "$LOCK.stale.$$" 2>/dev/null && mkdir "$LOCK" 2>/dev/null; then
    RECLAIMED=1
    log "reclaimed stale lock (${AGE}s old${OLD_PID:+, owner pid $OLD_PID gone})"
  fi
  rm -rf "$LOCK.stale.$$" 2>/dev/null   # the dir now holds a pid file — rmdir can't
  [ "$RECLAIMED" = 1 ] || { log "another run in progress — skipping"; exit 0; }
fi
echo $$ > "$LOCK/pid" 2>/dev/null || true
# release on EVERY exit — the plain EXIT trap misses signals; explicit TERM/
# INT handlers exit with the conventional status so cleanup still runs and a
# normal kill never waits 2h for the stale-lock reclaimer. The rmdir is
# ownership-checked: after a stale reclaim the dir at $LOCK belongs to the
# NEW owner — an old run's late exit must not delete it.
trap 'rm -f "${TMPV:-}" "${PAY:-}" "${VVIEW:-}"; [ "$(cat "$LOCK/pid" 2>/dev/null)" = "$$" ] && { rm -f "$LOCK/pid"; rmdir "$LOCK"; }' EXIT
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
# path makes the L0.5 model load fail silently inside the python subprocess.
# Say so loudly: an unmounted cache volume silently downgrades every run to
# LLM-only review and the health stamp is the only place that shows it.
if [ -d /Volumes/2t/huggingface_tmp ]; then
  export HF_HOME=/Volumes/2t/huggingface_tmp
else
  log "HF cache /Volumes/2t/huggingface_tmp missing (volume unmounted?) — L0.5 injection screen will fail this run"
fi
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
  git clone --depth=1 --single-branch --branch main "$URL" "$CODE" \
    || { log "code checkout clone failed ($URL) — check auth/network"; exit 1; }
fi
git -C "$CODE" remote get-url origin >/dev/null 2>&1 || git -C "$CODE" remote add origin "$URL"
[ "$(git -C "$CODE" remote get-url origin)" = "$URL" ] || git -C "$CODE" remote set-url origin "$URL"
# 浅抓取即可——两个 checkout 只读 tip,持久克隆全历史会无限膨胀(catalog
# 每次提交 ~14MB)。forced refspec 也让压缩/重写过的远端历史不会把同步卡死。
git -C "$CODE" fetch -q --depth=1 origin +refs/heads/main:refs/remotes/origin/main \
  || { log "code fetch failed (offline?) — silent, retry next tick"; exit 0; }
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
  git clone --depth=1 --single-branch --branch catalog "$URL" "$CAT" \
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
git fetch -q --depth=1 origin +refs/heads/catalog:refs/remotes/origin/catalog \
  || { log "fetch failed (offline?) — silent, retry next tick"; exit 0; }
# reset 失败必须退出——没有 -e,失败会拿陈旧 index 审一遍,产出错配 verdict
git reset --hard origin/catalog -q || { log "reset failed — refusing to review stale state"; exit 1; }
# 声明暂停在数据面生效——本机也认它(防止"pause 了但忘了 launchd 还在跑"
# 继续空烧 LLM)。判 origin/catalog 上的真 flag 而非 worktree 文件:reset --hard
# 不清未跟踪文件,crash 残留的 stray diagnose.paused 会让本机永远自跳过
# (远端从未暂停)。翻转开关:`$0 pause|resume`(在脚本开头处理,不等诊断锁、
# 不需要 ai.env)。手动想强制跑:直接跑 pipeline/ai/diagnose.ts。
git cat-file -e origin/catalog:diagnose.paused 2>/dev/null \
  && { log "declared pause (catalog:diagnose.paused) — skipping; resume: $0 resume"; exit 0; }
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
# build the args in an array — ${DIAGNOSE_NAME:+--name "$v"} word-splits a
# value containing whitespace into a stray positional ('a, b' → only 'a'
# reviewed, 'b' silently dropped)
ARGS=()
if [ -n "${DIAGNOSE_NAME:-}" ]; then ARGS+=(--name "$DIAGNOSE_NAME"); fi
case ${DIAGNOSE_FORCE:-} in ''|0|false|no) ;; *) ARGS+=(--force) ;; esac

npx tsx pipeline/ai/diagnose.ts \
  --index "$CAT/index.json" --verdicts "$VVIEW" --out "$TMPV" \
  --limit "$DIAGNOSE_LIMIT" --budget "$DIAGNOSE_BUDGET" --state "$STATEF" \
  --sweep-state "$SWEEPF" --health "$HEALTHF" \
  "${ARGS[@]}" \
  || exit $?

# health stamp → catalog branch (transition/24h gated, advisory). CI's
# watchdog leg 5 and digest §⑤ read it there — the local file alone is
# invisible to them, and verdict commits can't express "alive but degraded"
publish_health

# push payload = this run's verdicts ∪ unreplayed spool — an empty TMPV no
# longer short-circuits when the spool still has lines waiting to land
sort -u "$TMPV" "$SPOOL" > "$PAY" 2>/dev/null || cp "$TMPV" "$PAY"

# schema-gate the payload before it reaches the append-only audit file — a
# hand-edited or disk-corrupted spool line would otherwise land verbatim on
# the branch (downstream parsers skip it, but the file stays dirty forever).
# Malformed LINES are dropped inside the gate; a nonzero exit means the gate
# itself crashed (tsx/schema import) — either way we proceed unfiltered
# rather than drop the whole payload: validation failure ≠ push failure.
PAY="$PAY" npx tsx -e '
import { AiVerdict } from "./src/schema.ts"
import { readFileSync, writeFileSync } from "node:fs"
const p = process.env.PAY!
const lines = readFileSync(p, "utf8").split("\n").filter(Boolean)
let bad = 0
const ok = lines.filter(l => { try { AiVerdict.parse(JSON.parse(l)); return true } catch { bad++; return false } })
if (bad) { console.error(`dropped ${bad} malformed payload line(s)`); writeFileSync(p, ok.join("\n") + (ok.length ? "\n" : "")) }
' || log "payload schema gate failed to run — pushing unfiltered"
# spool := the FILTERED pending payload — a malformed spool line would
# otherwise re-enter PAY every run, be dropped every run, and never land
# nor clear. Syncing also persists this run's verdicts BEFORE the push
# loop, so a SIGKILL mid-push replays them instead of re-burning the LLM.
cp "$PAY" "$SPOOL" 2>/dev/null \
  || log "WARN: spool sync failed ($SPOOL) — a failed push would lose this run's verdicts and re-burn the LLM next run"

[ -s "$PAY" ] || { log "no new verdicts"; exit 0; }

# Replay push: verdicts live in $PAY, not the worktree — a failed push just
# means re-append onto the newest origin/catalog next attempt.
cd "$CAT"
for i in 1 2 3 4; do
  git fetch -q --depth=1 origin +refs/heads/catalog:refs/remotes/origin/catalog \
    || { log "fetch attempt $i failed"; sleep 3; continue; }
  git reset --hard origin/catalog -q || { log "reset attempt $i failed"; sleep 3; continue; }
  # "already landed" must be decided from the REMOTE file, not the local
  # staged diff: pause/resume shares this worktree WITHOUT the diagnose lock,
  # and its `reset --hard` can wipe a staged append — an empty diff then
  # masquerades as 'already pushed' and the whole payload (new verdicts +
  # spool) is silently dropped while the spool is cleared. Compute the
  # missing set once against origin/catalog, append exactly it, and let
  # push success/failure — never local git state — clear the spool.
  comm -13 <(git show origin/catalog:ai-verdicts.jsonl 2>/dev/null | sort -u) \
           <(sort -u "$PAY") > "$VVIEW"
  [ -s "$VVIEW" ] || { log "verdicts already on origin/catalog"; : > "$SPOOL"; stamp_health pushed already-landed; exit 0; }
  touch ai-verdicts.jsonl
  # a remote file whose last byte isn't '\n' would fuse its last line with the
  # first appended line — two verdicts lost inside one malformed blob that the
  # append-only gate never re-checks. Normalize before appending.
  [ -s ai-verdicts.jsonl ] && [ -n "$(tail -c1 ai-verdicts.jsonl)" ] && printf '\n' >> ai-verdicts.jsonl
  # append only lines the remote still lacks — a push that succeeded but
  # reported failure must not produce duplicate verdict lines next attempt
  cat "$VVIEW" >> ai-verdicts.jsonl
  git add ai-verdicts.jsonl
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
