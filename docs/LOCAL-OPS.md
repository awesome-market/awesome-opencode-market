# 本地运维手册

> AI 审核链在本机的全部用法：跑什么、怎么配、怎么手动补跑、坏了怎么看。
> 设计依据见 [AI-DIAGNOSIS.md](AI-DIAGNOSIS.md) §11；本文只管「怎么用」。

## 1. 分工边界

```
本地 = 只读外部 + 写自己的账本（判词/预读 → catalog 分支）
CI   = 干脏活（下载 tarball、解包、扫描、真装包）+ 发 issue/站点
```

本地**不装包、不执行包代码**——`fetchTarball` 只下载阅读。verify（真装
冒烟）永远在 GitHub Actions 跑，本地没有也不需要。

## 2. 组件清单

### 常驻服务（1 个）

| 服务 | 端口 | 作用 |
|---|---|---|
| omlx-server | `localhost:8001` | 判官 LLM，OpenAI 兼容 `/v1/chat/completions`。所有 AI 判词（diagnose / flag-delta / flag-context / reconcile）的推理都走它 |

### 按需批处理（每轮 diagnose 内嵌，不是常驻）

| 组件 | 依赖 | 作用 |
|---|---|---|
| L0.5 注入分类器 | `python3` + torch + tokenizers + safetensors + Galvanize-2 模型（~1.1GB，`GALVANIZE_DIR` 指定） | 批量给审查素材打分，超阈值的条目转人工。单批最多 6000 个 512-token 窗口，CPU 上约 2-3 分钟，超时 300s |

Galvanize-2 当前路径：`/Volumes/2t/huggingface_tmp/hub/models--usezn--Galvanize-2/snapshots/8ddc0ff…`
（`HF_HOME=/Volumes/2t/huggingface_tmp` 由脚本在卷存在时自动 export；
`TRANSFORMERS_CACHE` 会被脚本主动 unset——transformers v5 对它有告警）。

### 守护进程（1 个，手动启动）

`bin/ai-diagnose-agent.sh` —— 自愈编排器：循环跑 `ai-diagnose.sh`，
失败按 RETRY 重试；stall-watchdog 监测 catalog/docket/verify 三个
workflow，静默超 2.25h 自动补 dispatch。**机器上没有 launchd/cron 项，
重启后不会自拉起，要手动重开。**

### 手动运维工具（不在守护循环里）

| 脚本 | 用途 |
|---|---|
| `bin/catalog-append.sh` | 向 catalog 分支某文件追加一行并推送（concern.yml / submit.yml 在用；`FILE=… LINE=… MSG=…`） |
| `bin/catalog-withdraw.sh` | 按 issue 号撤回投稿：删 submissions.txt 里该 issue 的种子行，pending 条目顺带 tombstone（`ISSUE=<n> MSG=…`） |
| `bin/publish-digest.sh` | 日报兜底——日常 digest 已在 Actions(digest.yml) 跑，本脚本留作手动/launchd 兜底；写 `digest/YYYY-MM-DD.md` + `digest-state.json` 到 catalog 分支 |

## 3. 配置

### `~/.config/opencode-market/ai.env`（必需，权限 600，key 永不进 repo）

```bash
AI_BASE_URL=http://localhost:8001/v1   # 判官 endpoint，缺省值同左
AI_API_KEY=<omlx key>                  # Bearer token
AI_MODEL=Ornith-1.5-35B-A3B-BigBang-MTP-mlx-4bit
GALVANIZE_DIR=<L0.5 模型目录>           # REQUIRED——缺了 diagnose 直接挂
# 可选：
# AI_BACKEND=devin                    # 判官换 devin CLI（见下）
# DEVIN_REVIEW_MODEL=swe-2-flash-high
# MARKET_PROXY=socks5://127.0.0.1:1080
# MARKET_GIT_URL / MARKET_REPO_URL    # git 走代理/镜像时用
```

注意 `source ai.env` 不会自动 export——脚本里都用 `set -a; . ai.env; set +a`。
手动跑命令时同样要 `set -a`，否则子进程看不到变量（判官会报
`no judge`，全部记录 `ai:null`）。

### 环境变量旋钮

| 变量 | 默认 | 作用 |
|---|---|---|
| `DIAGNOSE_TICK` | 1800 | agent 正常节拍（秒）= 30min |
| `DIAGNOSE_RETRY` | 300 | agent 失败重试间隔（秒） |
| `DIAGNOSE_LIMIT` | 150 | 每轮 diagnose 审几件 |
| `DIAGNOSE_BUDGET` | 45 | 每轮 LLM 时间预算（分钟） |
| `FLAG_DELTA_LIMIT` | 30 | 每轮 flag-delta 判几条 |
| `FLAG_CONTEXT_LIMIT` | 20 | 每轮 flag-context 预读几条 |
| `MARKET_PROXY` | 无 | 出站代理：`1080`/`ip:port`/`socks5://`/`http(s)://`。**刻意不读 `HTTP(S)_PROXY`**——本机死代理不能悄悄接管，未配置=纯直连 |
| `MARKET_REPO` | 脚本所在 repo | 源码 checkout 路径 |
| `DIAGNOSE_LEGACY` | 关 | 已无作用（v3.5 起 legacy 默认入队） |

### 判官选择（diagnose / flag-delta / flag-context / reconcile 共用）

- 默认：本地 omlx，`AI_MODEL` 指定模型
- `AI_BACKEND=devin`：判官换成 `devin -p` 一次性会话（`DEVIN_REVIEW_MODEL`，默认 `swe-2-flash-high`）
- CLI 覆盖：`-m devin` / `-m devin:<model>` / `-m <本地模型名>`

## 4. 启动

```bash
# 常规：守护进程（每 30min 一轮，全自动）
./bin/ai-diagnose-agent.sh                 # 直连
./bin/ai-diagnose-agent.sh -p 1080         # 走 ssh -D SOCKS5 隧道
./bin/ai-diagnose-agent.sh devin -m devin:swe-2-flash-high   # 换判官

# 手动跑一轮（不经过 agent，调试/补跑用）
cd <repo> && set -a && . ~/.config/opencode-market/ai.env && set +a
./bin/ai-diagnose.sh                       # 效果等同 agent 里的一轮

# 日报兜底（平时不需要，digest.yml 已在 CI 跑）
./bin/publish-digest.sh
```

## 5. 每轮 sweep 做什么

`ai-diagnose.sh` 一轮内顺序执行：

1. **diagnose.ts**（`--limit 150 --budget 45`）：拉 pending 条目 +
   pendingUpdate → verify-failed 终态短路 → L0.5 分类器批量打分 →
   全量审 → 写 ai-verdicts.jsonl → 入 `$STATED/pending-verdicts.jsonl` spool
2. **flag-delta.ts**（`--limit 30`）：`sec:*` 身份漂移（repo-moved 等）的
   差异初筛 → `$STATED/flag-assessments.jsonl`
3. **flag-context.ts**（`--limit 20`）：扫描红旗行级预读——抓 flag 所在
   文件 ±35 行发判官；lifecycle/pack/prepare 类 flag 还会顺命令抓被调
   脚本的入口区（`script` 字段记录解析到的叶子路径）→
   `$STATED/flag-contexts.jsonl`
4. health 戳 → `diagnose-health.json` 推 catalog（CI watchdog 和日报读它）
5. spool → catalog 分支推送（verdicts + flag-assessments + flag-contexts +
   material-rm.list 一次 payload）

所有 spool 都是「emit→落盘→推送成功才清」的持久化模型——推送失败下轮
自动重放，不会丢判词也不会重复烧判官。

## 6. 状态与日志位置

| 路径 | 内容 |
|---|---|
| `~/.local/share/opencode-market/` | STATED：`pending-verdicts.jsonl` / `flag-assessments.jsonl` / `flag-contexts.jsonl`（未推送 spool）、`diagnose-attempts.json`、`diagnose-sweep.stamp`、`diagnose-health.json`、`material-rm.list`、`diagnose.lock` |
| `~/.local/share/opencode-market-catalog/` | CAT：catalog 分支专属 worktree（判词/预读/health 的落点） |
| `~/.local/share/opencode-market-code/` | CODE：钉在 origin/main 的代码 checkout（跑 pipeline 用，不碰开发工作区） |
| `~/.local/share/opencode-market-catalog-digest/` + `-code-digest/` | publish-digest.sh 专属（不与 diagnose 共享 worktree，可并发） |
| `~/.local/share/opencode-market/digest.lock` | digest 单实例锁 |
| `~/Library/Logs/opencode-market/` | LOGD：`ai-diagnose.log` / `ai-diagnose.err.log`（launchd 追加，脚本自动在 >5MB 时裁尾留 1MB） |

## 7. 网络出口

判官走 localhost 不吃代理；**吃代理的是拉代码**（unpkg /
raw.githubusercontent.com，每 flag 一个文件窗口）。三选一，谁通走谁：

- 直连（默认，`MARKET_PROXY` 未设时）
- Clash Verge `http://127.0.0.1:7890`
- `ssh -D 1080` SOCKS5 隧道 → `MARKET_PROXY=socks5://127.0.0.1:1080`
  （`scripts/ssh-proxy.sh` 是带自动重连的守护循环包装）

判断方法：`curl -sI --max-time 10 https://unpkg.com/ -o /dev/null -w '%{http_code}'`
直连不通再挂代理。**注意 diagnose/flag-context 的 fetch 是 Node undici，
不认 `HTTP(S)_PROXY`**——只认 `MARKET_PROXY`（或 CLI `-p`）。

## 8. 手动补跑 / 回填

### 单包重审

```bash
npx tsx pipeline/ai/diagnose.ts --index $CAT/index.json \
  --verdicts <合并视图>.jsonl --out /tmp/v.jsonl \
  --name <包名> --force --limit 5
```

`--force` 跳过已有判词；不带 `--force` 时已判版本永不重审（sha-drift
重标除外），且仍要等 48h unverified defer——急用就带 `--force`。

### flag-context / flag-delta / reconcile 手动跑

三个预读/对账 CLI 参数同构：

```bash
npx tsx pipeline/ai/<tool>.ts \
  --index  ~/.local/share/opencode-market-catalog/index.json \
  --verdicts <verdicts 视图>.jsonl \
  --contexts|--assessments <对应账本视图>.jsonl \
  --spool /tmp/out.jsonl --limit N [--dry] [-m model] [-p proxy]
```

- `--dry` 只打印不落盘（但**照样烧 fetch + 判官调用**，别拿来数队列）
- 判官不可用时照常写 `ai:null` 记录（`aiNote: judge-unavailable`），
  下轮自动重试——`judge-unavailable` 不计入重试预算

### 回填（给老判词补跑新逻辑）

判词是 append-only、按 `at` 最新者生效。当预读/判官逻辑升级后要重判
历史记录：

```bash
# 1. 剥离目标 rule 族的历史记录，得到「视图」（系统忘掉这些判过了）
python3 - <<'PY'
import json
RULES = {'lifecycle-script','pack-script','prepare-script'}   # 按需改
out = open('/tmp/ctx-view.jsonl','w')
for l in open('$HOME/.local/share/opencode-market-catalog/flag-contexts.jsonl'):
    if not l.strip(): continue
    if json.loads(l).get('rule') in RULES: continue
    out.write(l)
out.close()
PY

# 2. verdicts 视图 = catalog ∪ 本地未推送 spool（sort -u）
{ cat $CAT/ai-verdicts.jsonl; cat $STATED/pending-verdicts.jsonl; } | sort -u > /tmp/verdicts-view.jsonl

# 3. 跑（set -a!），输出到独立 spool
set -a && . ~/.config/opencode-market/ai.env && set +a
env -u HTTP_PROXY -u HTTPS_PROXY \
  npx tsx pipeline/ai/flag-context.ts \
    --index $CAT/index.json --verdicts /tmp/verdicts-view.jsonl \
    --contexts /tmp/ctx-view.jsonl --spool /tmp/backfill.jsonl --limit 800

# 4. 合并：spool 里本次新判的记录 append 到 catalog flag-contexts.jsonl
#    （at 更新者自动覆盖旧判词；ai:null 记录也要带上——它们计重试次数）
# 5. catalog 提交推送 → dispatch review-docket 刷 issue
```

要点：
- **断点续跑**：把已产出的 spool 记录 merge 进 `--contexts` 视图再跑，
  已判的会自动跳过（`judged` 按 name+version+flag 去重）
- **网络中断**：`context-fetch-failed` 是 `ai:null`+`aiNote`，不算判过，
  重试预算 5 次内自动重排；直连断了就换 `MARKET_PROXY` 重启
- **跑完别忘 reconcile**：行级判词翻 pass 的 concern 槽位要再过一轮
  `pipeline/ai/reconcile.ts` 才能翻版本判词

## 9. 故障手册

| 症状 | 原因 | 处理 |
|---|---|---|
| 全部 `ai:null` + `no judge` | ai.env 没 export（漏 `set -a`）或 omlx 没起 | `set -a; . ai.env; set +a`；`curl localhost:8001/v1/models` 验证判官 |
| `context-fetch-failed` 成片 | 出口断流（直连挂/代理没量） | 换 `MARKET_PROXY` 重启；已判的在 spool 里，重跑自动跳过 |
| diagnose 卡住不动 | L0.5 python 加载 wedged（300s 超时前 launchd 锁会挂住后续 tick） | 看 `ai-diagnose.err.log`；确认 `/Volumes/2t/huggingface_tmp` 卷挂着（HF_HOME 指错会静默降级成 LLM-only，health 戳是唯一可见处） |
| agent 不在跑 | 没有 launchd/cron，重启机器后不会自拉起 | 手动 `./bin/ai-diagnose-agent.sh` |
| 判词推了但 issue 没变 | review-docket 是 cron/dispatch 驱动 | `gh workflow run review-docket` 或等 :40 档 |
| catalog 推送非快进 | 远端有新提交 | `git -C $CAT pull --rebase` 后重推（catalog-append.sh 已内置重试） |

## 10. 与 CI 的接口

本地产物全部经 **catalog 分支**交给 CI 消费：

- `ai-verdicts.jsonl` / `flag-assessments.jsonl` / `flag-contexts.jsonl` →
  docket issue 渲染（`↳ AI 初筛` / `↳ 预读脚本` 行）
- `diagnose-health.json` → CI watchdog leg5 + digest §⑤（区分
  「worker 活着但降级」vs「worker 死了」）
- digest 的 `digest-state.json` → run.ts 判 verdict 成熟度（放行窗口）

反向：CI 的 catalog run 产出新 index/扫描结果 → 本地下一轮 sweep 自动
消费。两边靠 git 分支异步对接，本地不需要轮询 GitHub。

---

维护：本手册随 `bin/` 脚本和 `pipeline/ai/` 变化同步更新；参数默认值
以脚本内 `:-` 兜底值为准。
