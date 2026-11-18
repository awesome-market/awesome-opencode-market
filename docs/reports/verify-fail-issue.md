机械装测测量结果日报（2026-11-18 更新）——逐条 issue 已停用，全表见 https://github.com/awesome-market/awesome-opencode-market/blob/main/docs/reports/verify-fail.md

**当前 688 个装测失败条目** · **load** 563 · **install** 98 · **structure** 15 · **render** 10 · **interactive** 2
**481 个 AI 判过但装不上**（判词有效、字节装不上——不再逐条开单，翻案靠重测/上游修复）

这些条目是 verify 实测"装不上/加载失败"的测量回声，不是安全判定：重测翻 verified 或人工 verdict 后自动离开日报。历史 issue 见 label:concern:verify（已关闭）。

### 样本（前 20，全表见日报文件）
- `@arrislink/axon`@2.0.0 — install: Error: Plugin package has no server, GUI, or TUI entrypoint: @arrislink/axon@2.0
- `@chikage0o0/opencode-dcp`@3.1.14 — install: 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install @chikage0o
- `@cogbox/opencode`@0.190.5 — install: 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install @cogbox/op
- `@elixcode/elixcode-bun`@0.9.4 — install: Error: Plugin package has no server, GUI, or TUI entrypoint: @elixcode/elixcode-
- `@kykiles/opencode-mem`@13.10.5 — install: Error: Plugin package has no server, GUI, or TUI entrypoint: @kykiles/opencode-m
- `@opensploit/core`@0.2.0 — install: 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install @opensploi
- `@sanoma-ai/connector-opencode`@0.11.24 — install: [sandboxed egress is allow-listed — an install fetch failure can be network poli
- `@sergemso/opencode-plugin`@1.0.0 — install: 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install @sergemso/
- `@toolu/core`@7.11.0 — install: Error: Plugin package has no server, GUI, or TUI entrypoint: @toolu/core@7.11.0
- `@vibecontrols/vibe-plugin-ai-opencode`@2026.1115.1 — install: 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install @vibecontr
- `@wentaoyuan/opencode-worktree`@0.5.2 — install: Error: Plugin package has no server, GUI, or TUI entrypoint: @wentaoyuan/opencod
- `@xiaowei1906/opencode-beep`@0.1.0 — install: 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install @xiaowei19
- `0then0/agentkcal` — install: 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/op
- `521ox/OpenCode-V2-zh-CN` — install: 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install 521ox/Open
- `agiledon/openmole` — install: 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/op
- `aimeoa/hanshuang-codex` — install: 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install aimeoa/han
- `Akshat-2011/vibe-wise-opencode` — install: Error: Plugin package has no server, GUI, or TUI entrypoint: Akshat-2011/vibe-wi
- `Alaye-Dong/opencode-hud` — install: 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/op
- `aleks-spv/opencode_retrypush` — install: 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/op
- `alexandru/opencode-session-todo` — install: 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/op
