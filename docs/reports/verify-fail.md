# 装测失败日报 — 2026-11-20

> 机械装测测量结果，**不是安全判定**：verify 管线实测"装不上/加载失败"的条目。
> 这些条目不再逐条开 issue——翻案靠重测转 verified 或人工 verdict；条目离开本表即翻案成功。

## 汇总
- 当前装测失败条目：**382**
- 按阶段：**load** 230 · **install** 114 · **structure** 22 · **render** 14 · **interactive** 2
- AI 判过但装不上：**266**（判词有效、字节装不上——同样等重测/上游修复翻案，见第二表）

## 明细
| 包 | 版本 | 阶段 | 原因摘要 |
|---|---|---|---|
| @elixcode/elixcode-bun | 0.9.4 | install | Error: Plugin package has no server, GUI, or TUI entrypoint: @elixcode/elixcode-bun@0.9.4 |
| @kykiles/opencode-mem | 13.10.5 | install | Error: Plugin package has no server, GUI, or TUI entrypoint: @kykiles/opencode-mem@13.10.5 |
| @opensploit/core | 0.2.0 | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install @opensploit/core@0.2.0: unable to resolve dependency tree |
| @sergemso/opencode-plugin | 1.0.0 | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install @sergemso/opencode-plugin@1.0.0: unable to resolve dependency tree |
| @zinn-dev/opencode | 0.5.0 | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install @zinn-dev/opencode@0.5.0: unable to resolve dependency tree |
| agiledon/openmole | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install agil |
| agirahman/righthand | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install agir |
| aideveloper1976-arch/agentic-sdlc | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install aide |
| aimeoa/hanshuang-codex | — | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install aimeoa/hanshuang-codex#cf9c1537c2bd4ed8577ed6509ee665a39709d7d4: git dep preparation faile |
| Akshat-2011/vibe-wise-opencode | — | install | Error: Plugin package has no server, GUI, or TUI entrypoint: Akshat-2011/vibe-wise-opencode#07154ac85cd7fad1f88ccdfb3d06ad04a45f22e0 |
| AltimateAI/altimate-code | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Alti |
| alvarolorentedev/opencode-mobile | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install alva |
| amadeus-ex-machina/christina | — | install | Error: Plugin package has no server, GUI, or TUI entrypoint: amadeus-ex-machina/christina#d6320bbb9d189c12814b3a83dc26cb74dfc8adf0 |
| AmethystLuna/embedded-workbench | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Amet |
| anandpant/opencode-palantir | — | install | Error: Plugin package has no server, GUI, or TUI entrypoint: anandpant/opencode-palantir#a8ffe2b9e8aac3b5380d3db3eec34ad3414f1f47 |
| anargia-pixels/opencode-automode-plugin | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install anar |
| AnotiaWang/opencode-web-plugin | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Anot |
| anti-ghostsec/AnonCode | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install anti |
| apelabs-dev/sur9e | — | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install apelabs-dev/sur9e#303edc6f14a7bdc3e8e377a8ec338f450d8b2e7a: git dep preparation failed |
| Ar5en1c/localqa | — | install | Error: Plugin package has no server, GUI, or TUI entrypoint: Ar5en1c/localqa#fe4891f61c8c16b9dc69e223bfa2d3228655933a |
| ArchAIHarness/agent-workflows | — | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install ArchAIHarness/agent-workflows#d9cef47f196410f6769a865924c0b469b4eea1b0: An unknown git err |
| ashutoshrathi0909-oss/everything-claude-code | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install ashu |
| ATLAS-DEV78423/AgentBridge | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install ATLA |
| atman-33/multi-agent-ff15 | — | install | Error: Plugin package has no server, GUI, or TUI entrypoint: atman-33/multi-agent-ff15#1d30afc6c5dfbf0734cba4f3b3a9b9de56909fa6 |
| AVIDS2/memorix | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install AVID |
| avinash-1707/Myrios | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install avin |
| aydemir/opencode-plugins | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install ayde |
| ayushnandi718-dev/opencode-chat | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install ayus |
| B-A-M-N/opencode-xgoal | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install B-A- |
| balatD/gorc | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install bala |
| bastian-seifert/armin | — | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install bastian-seifert/armin#ecb3b61fb3124ea238fd0e6d8558a18a528eecbf: Could not read package.jso |
| batuhansk/opencode-talk | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install batu |
| bbingz/polycli | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install bbin |
| benjaminshafii/digital-empire | — | install | [sandboxed egress is allow-listed — an install fetch failure can be network policy, not a broken package] |
| berenddeboer/ready-for-agent | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install bere |
| BernardYan2357/opencode-image-vision | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Bern |
| betterspec/opencode-betterspec | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install bett |
| beydemirfurkan/opencode-gladio | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install beyd |
| BharatCode-ai/bharatcode-desktop | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Bhar |
| BITRATE-Labs/vrchat-mcp | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install BITR |
| BlakeHastings/opencode-litellm | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Blak |
| Bouska/opencode-dcg-plugin | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Bous |
| br4zz4/opencode-smart-session-picker | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install br4z |
| BrainerVirus/workit | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Brai |
| bskim/opencode-azure-entra-auth | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install bski |
| buddy-hq/buddy | — | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install buddy-hq/buddy#88e972bb13d33d10dfad7bec0d81cb465ef3c4bc: git dep preparation failed |
| buffsystems/buff-code | — | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install buffsystems/buff-code#8441060b1ef6c4b67519d63c6cec22a202983c54: git dep preparation failed |
| bulga138/peso | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install bulg |
| cbartens/bkit | — | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install cbartens/bkit#56363678d784bc2615e1785a39f152b550bce67d: git dep preparation failed |
| chncaesar/opencode-plugin-memory | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install chnc |
| christiangalsterer/opencode-requesty-plugin | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install chri |
| codesensehq/codesense | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install code |
| DeadSno/opencode-windows-scheduler | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Dead |
| devshaydez/seira | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install devs |
| esafak/muninn | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install esaf |
| fro-bot/space-bus | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install fro- |
| gonzalezpazmonica/savia | — | install | [sandboxed egress is allow-listed — an install fetch failure can be network policy, not a broken package] |
| gotenksIN/opencode-websearch-addons | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install gote |
| hamzasoussi53/opencode-island | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install hamz |
| heyimteee/ensemble | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install heyi |
| IgorGanapolsky/ThumbGate | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Igor |
| joe-broadhead/opencode-affinity | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install joe- |
| joe-broadhead/opencode-boxd | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install joe- |
| joe-broadhead/opencode-browse | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install joe- |
| joe-broadhead/opencode-github | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install joe- |
| joe-broadhead/opencode-granola | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install joe- |
| joe-broadhead/opencode-gws | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install joe- |
| joe-broadhead/opencode-history | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install joe- |
| joe-broadhead/opencode-inference | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install joe- |
| joe-broadhead/opencode-jira | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install joe- |
| joe-broadhead/opencode-jobs | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install joe- |
| joe-broadhead/opencode-linear | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install joe- |
| joe-broadhead/opencode-notion | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install joe- |
| joe-broadhead/opencode-openrouter | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install joe- |
| joe-broadhead/opencode-plaud | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install joe- |
| joe-broadhead/opencode-slack | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install joe- |
| joe-broadhead/opencode-tavily | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install joe- |
| joe-broadhead/opencode-utilities | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install joe- |
| joe-broadhead/opencode-voice | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install joe- |
| joe-broadhead/opencode-x | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install joe- |
| kunickiaj/codemem | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install kuni |
| lazycodex-ai | 5.1.79 | install | Error: Plugin package has no server, GUI, or TUI entrypoint: lazycodex-ai@5.1.79 |
| lichenzhao060507/opencode-tavily-proxy-quota | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install lich |
| Looted/kibi | — | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install Looted/kibi#151293bb6e50ff3324d32513b5913a4a3080dc21: git dep preparation failed |
| marcusrbrown/opencode-copilot-delegate | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install marc |
| marcusrbrown/systematic | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install marc |
| MisonL/magpie-plugin-msmoli | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Miso |
| nah-ai | 0.0.1-beta.13 | install | Error: Plugin package has no server, GUI, or TUI entrypoint: nah-ai@0.0.1-beta.13 |
| opencode-raven | 2.4.0 | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install opencode-raven@2.4.0: unable to resolve dependency tree |
| oxdingzg/miao | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install oxdi |
| pythongiant/laya-drift | — | install | Error: Plugin package has no server, GUI, or TUI entrypoint: pythongiant/laya-drift#89ae9b28b60a47602247c785377512d8ca121a26 |
| rsshub | 1.0.0-master.501aa77 | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install rsshub@1.0.0-master.501aa77: An unknown git error occurred |
| rynfar/meridian | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install rynf |
| sblattj/agentic-coding-harness | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install sbla |
| seaweeduk/opencode-sleep-inhibit | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install seaw |
| ShaoRoy/site-selection-skill | — | install | Error: Plugin package has no server, GUI, or TUI entrypoint: ShaoRoy/site-selection-skill#5195ce8d052417bee11e7636fa87c8ec096d48c5 |
| slkiser/opencode-quota | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install slki |
| Sn0wo2/oc-keep-going | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Sn0w |
| SocialGouv/ultra11y | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Soci |
| stefanhoelzl/codehydra | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install stef |
| texugo7badger/OLYMPUS | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install texu |
| thejohnd0e/opencode-answer-date | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install thej |
| Thomashighbaugh/buchbinder | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Thom |
| tickernelz/opencode-mem | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install tick |
| Verbiflow/mako | — | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install Verbiflow/mako#69d2eb9d8523cc2fc820a588abac74579b352378: git dep preparation failed |
| WhiteHades/metldr | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Whit |
| YahyaHammad/Venastine-Research-Harness | — | install | Error: Plugin package has no server, GUI, or TUI entrypoint: YahyaHammad/Venastine-Research-Harness#ee15a52fe4a65f3549974dfe83111ba06c970604 |
| YKLovePython/halfsize | — | install | Error: Plugin package has no server, GUI, or TUI entrypoint: YKLovePython/halfsize#3024a56c44d81e94450026345267970b127a6064 |
| YonCZ/rich-opencode | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install YonC |
| yurgeno/saut | — | install | Error: Plugin package has no server, GUI, or TUI entrypoint: yurgeno/saut#a456c9620151fdb7dfceb5034790cf3f539cba73 |
| ZaxbyHub/opencode-swarm | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Zaxb |
| zhiwenC125/Cybertron-agents | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install zhiw |
| zufall-upon/Sortie-dogs | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install zufa |
| zyvo9/ZYVO-AI | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install zyvo |
| mii9000/opencode-auto-switch | — | interactive | 交互式启动检查未通过——TUI 阶段异常退出 — plugin half passed (interactive); skill payload failed: |
| yriveiro/spectre | — | interactive | tre-29e0431612329b85cef04d6f0a726b736e90fdb6/skills/definitions/pr-canvas/SKILL.md, spectre-29e0431612329b85cef04d6f0a726b736e90fdb6/skills/definitions/principl |
| @5x-ai/5x-cli | 1.3.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @aeterna-org/opencode-plugin | 0.7.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @alvarovfon/opencode-agent-monitor | 1.2.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @anis00723/opencode-debug | 1.6.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @ariane-emory/opencode-antigravity-auth | 1.2.1-b-fix-account-duplication | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @aryaminus/controlkeel-opencode | 0.4.21 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @austinthesing/magic-shell | 1.2.2 | load | --- stream tail --- timestamp=2026-11-18T10:48:42.270Z level=INFO run=44e50656 message="cli starting" version=2.3.1 channel=latest local=false args="[\"plugin\" |
| @bloodf/opencode-claude-mem | 1.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @chriscode/devmux | 1.10.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @codemcp/workflows-opencode | 6.24.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @crixue/opencode-voice-stt | 0.2.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(TypeError: storage.store is not a function. (In 'storage.store(\"state\", { |
| @curl.md/opencode | 0.1.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @d-ai/magpie | 0.1.7 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @dendaio/opencode-9router-plugin | 1.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @deveco-test/deveco-harness | 0.2.0-test.8 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @devtheops/opencode-plugin-mempalace | 1.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @dmmop/opencode-key-rotator | 2.2.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(TypeError: Schema.isStartsWith is not a function. (In 'Schema.isStartsWith( |
| @dorokuma/magpie-gemini-web | 0.18.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @doyzheng/ezllm-workbuddy-pool-auth | 0.1.6 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @dudousxd/nestjs-agent-opencode | 2.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @fastman/mcp-kaneo | 2.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @fox-js/pad-skills | 4.0.1-0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @fox-js/pc-skills | 4.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @gchamon/opencode-kiro-auth | 2.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @gfn-cis/opencode-temp-sanitize | 0.3.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: EACCES: permission denied, mkdir '/tmp/opencode/home-753855bc')]) |
| @ghilteras/opencode-model-fallback | 0.4.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @gitawego/opencode-vision | 0.2.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @gitgen/gitgen | 1.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @grandmaster451/kilo-superpowers | 2026.317.816 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @grant-vine/wunderkind | 0.28.12 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @happycastle/opencode-openmemory | 0.0.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @heretek-ai/godot-testkit | 1.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @hmos-library-adapter/rn | 0.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @hmos-library-adapter/sdk | 0.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @howaboua/opencode-planning-toolkit | 0.0.6 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @intisy-ai/antigravity-auth | 1.17.7 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @intisy-ai/opencode-loader | 1.13.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @intisy-ai/plugin-updater | 1.15.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @involvex/opencode-statusbar | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @iwahbi/opencode-claude-stack | 1.2.19 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @jack-yang/opencode-bark-notify | 1.3.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @jack-yang/opencode-tps-meter | 1.4.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(TypeError: undefined is not an object (evaluating 'ctx.data.on'))]) |
| @jannniiiii/opencode-claude-skill-sync | 1.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @jantcz/webai | 0.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @javargasm/opencode-kiro-auth | 8.3.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @jimmyyen/opencode-context-cache | 1.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @juristechllc/fireworks-serialized-provider | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @justmpm/ai-tool | 6.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(TypeError: Context.GenericTag is not a function. (In 'Context.GenericTag(\" |
| @kagan-sh/kagan | 0.4.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @leo.gimp/opencode-usage-bar | 3.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(TypeError: ctx.storage.store is not a function. (In 'ctx.storage.store(\"se |
| @leo000001/opencode-notify-native | 1.4.6 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @lyculs/opencode-firecrawl | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @macqueen1001/opencode-think-with-me | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mageyuki/opencode-subagent-statusline | 0.7.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(ResolveMessage: Cannot find package '@opentui/solid' imported from /tmp/ver |
| @malaclyde/knowledge-base | 0.1.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mazac-fox/opencode-conductor | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mingxy/cerebro | 2.3.8 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mixio-pro/mixiocode-plugin | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @moozie/opencode-voice | 0.0.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @n0c1ip/opencode-pohuy | 0.1.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @nano-step/skill-manager | 5.30.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @nest4869/argos | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @oh-harness/plugin | 0.2.0-test.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @openclient-ios/opencode-plugin | 0.5.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: Invalid OpenCode server port)]) |
| @opencode-qq/plugin-sdk | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @openpets/elevenlabs | 1.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(ResolveMessage: Cannot find module './src/tools/script-production' imported |
| @opentj/opencode-oauth2-plugin | 1.0.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @otsupeko_lee/work-work | 1.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @oxel40/opencode-model-groups | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @parallel-web/opencode-plugin | 1.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @pipellm/magpie-websearch | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @polygraph/opencode-plugin | 0.5.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @r4coder/magpie-plugin | 0.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @rafamacalaba/armada | 1.2.9 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @really-knows-ai/foundry | 3.15.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @rejacky/opencode-insights | 1.0.1 | load | --- stream tail --- :29:01.208Z level=INFO run=74225573 message="watcher stopped" path=/tmp/verify-luwUO3/u type=entries http.span=20444 role=server timestamp=2 |
| @renjfk/opencode-notify | 1.1.0 | load | --- stream tail --- :40:59.072Z level=INFO run=9a0a980e message="watcher stopped" path=/tmp/verify-I2F6tt/u type=entries http.span=20098 role=server timestamp=2 |
| @renjfk/opencode-secret-tools | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — serve reports the plugin failed to load |
| @rezarria/opencode-mcp-bridge | 1.2.5 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @riskihajar/opencode-omniroute-auth | 1.3.29 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @sentiolabs/opencode-arc | 0.3.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @sergemso/opencode-observability | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(ResolveMessage: Cannot find package '@opentui/solid' imported from /tmp/ver |
| @serviceme/devtools-core | 3.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @sffmc/utilities | 0.16.5 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(ResolveMessage: Cannot find package 'safe-regex' imported from /tmp/verify- |
| @shaogefenhao/overnight | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @skastr0/background-tasks-opencode | 0.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(TypeError: Schema.nonNegative is not a function. (In 'Schema.nonNegative()' |
| @sonic182/graphmem | 0.15.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @subadeepan_y/vi3ion-opencode | 0.1.7 | load | plugin half passed (load); skill payload failed: |
| @supanadit/morse-web | 0.30.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: Failed to load native module: pty.node, checked: build/Release, buil |
| @super-pocock-ai/memory-core | 2.3.30 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @syntax-syllogism/aloop | 0.12.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @talocode/skilllane | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @tder311/opencode-orchestrator | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @tengxiaohtx/connect | 1.2.7 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @thehugeman/opencode-anthropic-auth-community | 0.0.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @thesammykins/discord_opencode | 1.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @tkwf/opencode-shellfix | 2.3.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @until-dev/plugins | 0.2.9 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @vaur94/figma-rust | 0.4.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(TypeError: Schema.isStartsWith is not a function. (In 'Schema.isStartsWith( |
| @veedubin/boomerang-v2 | 4.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: \nSomething went wrong installing the \"sharp\" module\n\nCannot fin |
| @xeaser/opencode-obsidian-sync | 0.1.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @yaoguai_xh/opencode-goal-plugin | 0.10.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @yyg27/manbun | 4.10.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @z3z1ma/open-loom-playbooks | 0.3.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @zilliz/memsearch-opencode | 0.4.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: MemSearch CLI unavailable. Install with uv tool install 'memsearch[o |
| @zmide/opencode-codex-provider | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| 3294798852/magpie-musework-plus | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| acp2openai | 0.1.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| active-collab-agent | 0.12.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| agent-data/job-search | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| agent-memory-store | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| agent-sdk-kit | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(ResolveMessage: Cannot find package '@github/copilot-sdk' imported from /tm |
| agentic-remem | 0.2.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| ai-cli-hub | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| ailense | 0.1.5 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| akm-opencode | 0.10.261130 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| alchemylab | 3.6.0 | load | 2026-11-18T10:23:01.342Z [error]: Failed to start HTTP API server {"service":"mcp-http-server","error":"RangeError: options.port should be >= 0 and < 65536. Rec |
| alexmarco/opencode-skill-pulse | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| alkevintan/opencode-advisor | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| alkevintan/opencode-vision | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| amazingteam | 3.0.23 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| andyzasl/opencode-copilot | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(TypeError: undefined is not an object (evaluating 'context.data.on'))]) |
| anis-dr/opencode-mermaid-renderer | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| Ansh-Sonkusare/jev-compaction-harnesses | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| anytxt-opencode | 0.0.5 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| arch-governance-nfrega | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| arfoux/rs-guard-v1 | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| aryasaatvik/opencode-plugin-executor | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: Cannot load \"effect/dist/unstable/http/index.js\" from plugin node_ |
| Asno-dev/apex | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| auto-model-switcher | 1.3.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| autoaidev | 1.0.312 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(ResolveMessage: Cannot find module 'vscode'\nRequire stack:\n- /tmp/verify- |
| autosquid/omo-mem | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| avaritiachaos/qoder-proxy | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| bad-noodles/opencode-qwen-auth | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| Barathaner/paul-persistent-atlassian-undestanding-meeting-logger | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| bc1xxx/orchestrator-opencode | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| bdhwrsh/opencode-dreamina-auth | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| benskls/openstrat | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| better-opencode-openai-codex-auth | 0.1.5 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| bhumitschaudhry/Slopnought | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| bitbucket-agent | 1.3.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| bnc4vk/opencode-model-scorecard | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(SyntaxError: Export named 'jsxDEV' not found in module '/tmp/verify-4FT6s8/ |
| BowTiedSwan/opencode-video-gateway | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| bsosik1/opencode-arcana | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| ca-x/magpie-intern-ai | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| cache-timer | 1.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| clew-code | 0.11.0 | load | 插件入口疑似是 CLI 程序——宿主加载入口模块时顶层 program.parse() 吞掉宿主 argv（包把命令行工具当插件入口打包，真包缺陷） — error: unknown option '--port' |
| cliproxy-provider | 1.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| codex-plugin-oc | 1.0.6 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| cosa-opencode | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| deveco-harness | 0.2.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| deveco-model-plugin | 0.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| dyegolara/lnurl-auth-agents | — | load | --- stream tail --- " path=/tmp/verify-RVzIPz/u/.config/opencode type=directory backend=inotify ignores=6 http.span=100 role=server timestamp=2026-11-18T10:48:4 |
| firefox-mcp-marionette | 0.9.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| gitbot-ai | 0.0.3 | load | 插件入口疑似是 CLI 程序——宿主加载入口模块时顶层 program.parse() 吞掉宿主 argv（包把命令行工具当插件入口打包，真包缺陷） — error: unknown command 'serve' |
| goodtome/magpie-teleagent-login | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| grok-search-skill | 1.3.9 | load | --- stream tail --- --port\",\"0\"]" role=cli timestamp=2026-11-18T11:12:31.971Z level=INFO run=0e32b651 message="database schema bootstrap started" migrations= |
| gsd-opencode | 1.38.5 | load | 插件入口疑似是 CLI 程序——宿主加载入口模块时顶层 program.parse() 吞掉宿主 argv（包把命令行工具当插件入口打包，真包缺陷） — ✗ error: unknown command 'serve' |
| gyoshu | 0.4.33 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| halloweed-anthropic-auth | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| iron-horse-opencode | 1.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| jarvis-hq | 0.0.7 | load | 插件入口疑似是 CLI 程序——宿主加载入口模块时顶层 program.parse() 吞掉宿主 argv（包把命令行工具当插件入口打包，真包缺陷） — error: unknown command 'serve' |
| Jiao77/magpie-string-ai | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| jinyue806/Agnes-Code | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| kevincojean/opencode-supernudge | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| kilo-opencode-command-code | 1.2.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| kravchenski/switchyard | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| libclaw | 0.1.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| llisa | 1.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| local-knowledge-graph | 1.14.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| magpie-google-ai-studio | 0.1.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| magpie-kilo-auth | 0.5.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| magpie-nowcoding | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| magpie-plugin-loomy-auth | 0.1.27 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| mccode-plugin | 1.0.3 | load | disabled plugin after transform failure — Cause([Die(TypeError: draft.remove is not a function. (In 'draft.remove(\"new\")', 'draft.remove' is undefined))]) |
| mcpx-cli | 0.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| oc-blackbytes | 0.8.7 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| oc-codex-multi-account | 1.0.20 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| officeace-auth | 0.3.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| oh-my-china | 1.1.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opcode-pg-memory | 4.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencheese-session-stats | 1.3.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-ag-auth | 1.6.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-agentrouter-shim | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-agy | 0.16.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-antigravity-auth-tweaked | 1.9.7 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-antigravity-autopilot | 2.3.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-avatar | 0.3.21 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-browser-control | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-byte | 1.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(SyntaxError: Export named 'Plugin' not found in module '/tmp/verify-M9UehF/ |
| opencode-caffeinate | 0.1.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-cau-maas-auth | 0.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-chorus | 0.10.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-code-review | 1.0.9 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-codex-auth-rotation | 1.0.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-continual-learning | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-copy-picker | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-discuss | 0.7.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(ResolveMessage: Cannot find package '@opencode/ai' imported from /tmp/verif |
| opencode-fleetview | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-flema-engram-sidebar | 0.4.6 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: Environment variable \"OPENTUI_FORCE_UNICODE\" is already registered |
| opencode-format-lint | 0.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-gateway | 0.8.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-gbuild | 0.13.1 | load | plugin half passed (load); skill payload failed: |
| opencode-glm-clipboard | 2.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-google-search | 0.1.5 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-gpt-unlocked | 1.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-kimi-auth | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-local-provider | 0.1.8 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-memoir | 3.3.12 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-mirasim-auth | 0.9.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — serve reports the plugin failed to load |
| opencode-multi-llm | 0.1.9 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-muse | 1.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(MuseInvalidConfigError: muse does not advertise --contributor-mode; refusin |
| opencode-oauth | 0.4.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(SchemaError(Missing key\n at [\"provider\"]))]) |
| opencode-openai-sub-switcher | 1.0.7 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-session-metrics | 0.4.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(ResolveMessage: Cannot find package '@opentui/solid' imported from /tmp/ver |
| opencode-slack-agent | 3.5.5 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-telegram-plugin | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-tts-speak | 2.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-windows-scheduler | 1.5.8 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(ResolveMessage: Cannot find package '@opencode-ai/plugin' imported from /tm |
| opencode-work-context | 0.10.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| P-Core-System/pcore-orchestra | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| patch-for-omo | 1.0.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| patchwarden | 1.7.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: Invalid workspaceRoot: workspaceRoot cannot be user home directory ( |
| relay-flow-plugin | 0.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| reposynapse | 1.10.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| scnet-magpie | 1.0.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| shaagent | 0.3.5 | load | 插件入口疑似是 CLI 程序——宿主加载入口模块时顶层 program.parse() 吞掉宿主 argv（包把命令行工具当插件入口打包，真包缺陷） — error: unknown command 'serve' |
| skyer-now/carlos-flow | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| swarm-code | 0.1.24 | load | --- stream tail --- timestamp=2026-11-18T11:12:28.724Z level=INFO run=6b1c4812 message="cli starting" version=2.3.1 channel=latest local=false args="[\"plugin\" |
| yanamianna0501/antigravity-acp-auth | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @phux/opencode | 0.10.0 | render | gui setup: Cannot read properties of undefined (reading 'finally') |
| @rizal72/oc-git | 0.2.4 | render | gui setup: Unknown error (cause: Cannot read properties of undefined (reading 'catch')) |
| alexandr777git/opencode-session-tokens | — | render | gui render: Panel.render threw: Unknown error (cause: c(...).toFixed is not a function) |
| almas/opencode-read-aloud | — | render | ambiguous gui bundle under git-opencode-read-aloud-c0da1adb30b4: plugin, opencode-tts — cannot identify the plugin's own |
| almas/opencode-tts | — | render | gui render: Slot.render() returned a mixed non-Node array |
| almas/opencode-voice-input | — | render | gui render: SettingsPage.render threw: Unknown error (cause: Cannot read properties of undefined (reading 'catch')) |
| context-rollover | 0.2.0 | render | gui setup: setup() registered no contributions |
| opencode-activity-indicator | 0.1.0 | render | gui whitelist: module not in gui host whitelist: electron |
| opencode-control-surfbird-for-kitesurf | 0.6.0 | render | gui whitelist: module not in gui host whitelist: node:fs/promises |
| opencode-figma | 0.1.6 | render | gui whitelist: module not in gui host whitelist: electron |
| opencode-loop-recover | 0.2.4 | render | gui whitelist: module not in gui host whitelist: node:fs/promises |
| opencode-pull-requests | 0.1.3 | render | gui whitelist: module not in gui host whitelist: node:child_process |
| opencode-quota-gui | 1.3.1 | render | gui setup: setup() registered no contributions |
| opencode-remote-desktop | 0.2.4 | render | gui render: Panel.render component mount threw: Unknown error (cause: screen is not defined) |
| adriansoriacastellano/hitl-analytics-team | — | structure | 63f56866139f7c87ddf38b29b/.agents/skills/skill_build_marts_layer/SKILL.md, hitl-analytics-team-e529082c885d23863f56866139f7c87ddf38b29b/.agents/skills/skill_bui |
| agent-sh/agnix | — | structure | (无日志摘录) |
| agisota/old-one | — | structure | (无日志摘录) |
| ArkFlame/FlameWM | — | structure | (无日志摘录) |
| ashikonik/skills-library-mcp | — | structure | (无日志摘录) |
| atqamz/hand | — | structure | (无日志摘录) |
| bamr87/bashos | — | structure | (无日志摘录) |
| benbrastmckie/nvim | — | structure | (无日志摘录) |
| bthavanish/demiurge | — | structure | no parseable SKILL.md frontmatter in bthavanish/demiurge#3bd448bb56d7cee99fbbf9eea35991446e3286fd (checked 12: demiurge-3bd448bb56d7cee99fbbf9eea35991446e3286fd |
| Burnsedia/Django-Agent | — | structure | no SKILL.md in Burnsedia/Django-Agent#368c4440d80910de6b819bf7fe21c2ff7f4afcc9 tarball |
| dilanrojas/dotfiles | — | structure | (无日志摘录) |
| fnodotdev/fno | — | structure | (无日志摘录) |
| madeinorbit/podium | — | structure | (无日志摘录) |
| motusakapeppo/opencode-skill-assemblea-complessa | — | structure | no parseable SKILL.md frontmatter in motusakapeppo/opencode-skill-assemblea-complessa#f28c42476f8fdfb6aa0746eb6ce8188c18a81cac (checked 1: opencode-skill-assemb |
| openchamber/openchamber | — | structure | (无日志摘录) |
| ParadevAI/Paradev | — | structure | (无日志摘录) |
| Ricky06202/nixdots | — | structure | (无日志摘录) |
| schizo16/opencode-skillforge | — | structure | no parseable SKILL.md frontmatter in schizo16/opencode-skillforge#e1c09c427843a693b62bb0d8e1106952f15d2e10 (checked 3: opencode-skillforge-e1c09c427843a693b62bb |
| termio-sh/termio | — | structure | (无日志摘录) |
| UiPath/coder_eval | — | structure | no parseable SKILL.md frontmatter in UiPath/coder_eval#05bab863e87f579c15441742a39ceeb055d34117 (checked 6: coder_eval-05bab863e87f579c15441742a39ceeb055d34117/ |
| wangyufengsky/agent-workflow | — | structure | (无日志摘录) |
| zhitongblog/unterm | — | structure | (无日志摘录) |

## AI 判过但装不上
| 包 | 版本 |
|---|---|
| @alex123bob/opencode-cache-stats | 1.5.0 |
| @basicbit/vrchat-mcp | 0.1.17 |
| @clicktocode/core | 0.3.3 |
| @ctliz/agent-intercom-opencode | 0.14.0 |
| @cultivx/codereach | 0.2.39 |
| @darknesskiller/opencode-cliproxyapi | 0.4.0 |
| @grinev/opencode-telegram-bot | 0.28.0 |
| @guru.prasath/model-opencode | 0.1.0 |
| @happycastle/opencode-litellm | 0.8.0 |
| @helldinhow/sdd-flow-opencode-plugin | 0.6.16 |
| @howaboua/opencode-roadmap-plugin | 0.2.1 |
| @jack-yang/opencode-quota | 4.11.1 |
| @jacob-z/opencode-token-usage | 0.1.0 |
| @jeikeilim/tenet | 26.11.0 |
| @joe-broadhead/opencode-artifacts | 0.7.0 |
| @justmpm/agent-runner | 0.10.1 |
| @kimchi-dev/opencode-kimchi | 1.0.6 |
| @kodizm/acp | 0.9.4 |
| @lawaty/lacode | 2.3.0-beta.8 |
| @mark_future_ai/opencode-buddy | 1.1.2 |
| @mcrescenzo/opencode-workflows | 0.2.0 |
| @mingzzz/ocx-wechat-control | 0.2.6 |
| @moxxy/plugin-provider-acp | 0.49.1 |
| @nano-step/oh-my-harness | 1.2.5 |
| @niebaopeng/ocusage | 1.0.6 |
| @npll/omol | 5.0.0-beta.6-omol.202608120621 |
| @omniroute/opencode-plugin | 0.2.2 |
| @omniroute/opencode-plugin-v2 | 0.1.1 |
| @openpets/anthropic | 1.0.4 |
| @paflopes/opencode-qwen-auth | 0.0.7 |
| @pathrule/opencode | 1.0.8 |
| @privacypillar/pii-shield-opencode | 0.0.1-alpha.6 |
| @reasoning-router/opencode | 0.1.11 |
| @redivo/opencode | 1.2.2 |
| @scrylog/opencode-plugin | 0.9.3 |
| @sublang/cligent | 0.40.0 |
| @sunerpy/oh-my-openagent | 4.21.0 |
| @super-pocock-ai/suite | 2.3.30 |
| @te-river/opencode-alibabatokenplan | 0.2.17 |
| @tryvira/opencode | 0.1.66 |
| @vicoa/opencode | 0.2.1 |
| @wolfx/oh-my-openagent | 4.19.0 |
| @wwkit/harness | 1.0.46 |
| @xeedio/prompt-plumber | 0.6.0 |
| @yourlocalai/your-local-ai | 0.1.5 |
| @yoyoyoake/pi-token-plan-monitor | 0.2.3 |
| @yugimob/pi-opencode-go-rotation | 1.7.4 |
| 00bx-photoshop-mcp | 1.1.2 |
| 12343954/opencode-tts-speak | — |
| 199084/opencode-relay-pool | — |
| 1cyberlangke1/my-opencode-toolkit | — |
| 4nkitd/opencode-workspace-sidebar | — |
| 521ox/OpenCode-V2-zh-CN | — |
| 6yte96/freebuffet | — |
| 81ueman/relay | — |
| 897243839/dream-RSI-memory | — |
| a-saeedia/bource-mcp | — |
| aahljhljhlj-ux/opencode-session-analyzer | — |
| aaronpiipponen/opencode-keepalive | — |
| Adamkadaban/opencode-package-managers-hook | — |
| adamtrepka/token-fence | — |
| adyoi/mcp-rag-memory | — |
| afwlehmann/opencode-worktree-plugin | — |
| agent-security-policies | 1.5.7 |
| agent-steward | 0.0.5 |
| agentjoey/opencode-remote-control | — |
| agyforclaude | 0.0.3 |
| ai4nucleome/BioMaster | — |
| Alaye-Dong/opencode-hud | — |
| aleks-spv/opencode_retrypush | — |
| alexandru/opencode-session-todo | — |
| AlexisBalayre/agentspine | — |
| ambystechcom/AmbyKit | — |
| ameshkov/opencode-sdd | — |
| aminammar1/ai-persona | — |
| anaskhan96/opencode-plugin-codex-usage | — |
| AndresArzamendia/Pastoral | — |
| Anjai7/Marvel-ecommerce | — |
| anthropic-multi-auth | 0.1.1 |
| antick/skills | — |
| APLaS-Plus/opencode-autoguard | — |
| artemy/semaphore | — |
| artificial-code-cli | 0.7.0 |
| askferret/automatic-waffle | — |
| avivgerz-hue/ghost-qa | — |
| ayzitix/quanta | — |
| BB-84C/bgs-modding-superpowers | — |
| bbingz/scnet-auth | — |
| belambert/opencode-livetrace | — |
| best-radar/bradar-ECC | — |
| best-radar/bradar-ponytail | — |
| bitIO/opencode-provider-balance | — |
| bsmnt | 0.26.1 |
| Builderstar/opencode-v1.18.21-custom-snapshot | — |
| context-signals-mcp | 1.1.3 |
| cortex-agents | 5.0.1 |
| CultureDigitali/opencode-cron | — |
| dailycrypt/AI-Sales-Agent | — |
| dceoy/opencode-action | — |
| denggui-ai/shy-cameo-skill | — |
| garikipatisai-code/sdlc-lean | — |
| gazacode | 2.0.2 |
| gitnexus-opencode | 0.5.3 |
| goatcode-sh | 0.1.9 |
| habithive-code | 0.3.1 |
| harness-mdocs | 2.2.0 |
| hc-teleport-agent | 0.3.0 |
| hivemind-3.0 | 0.1.0 |
| iamironz/opencode-sessions-explorer | — |
| ilahomesick/opencode-true-mem-v2 | — |
| involvex/Desk-Escape | — |
| jira-cli-agent | 0.2.0 |
| jn-s3s/opencode-tui-quota-usage | — |
| joe-broadhead/opencode-ashby | — |
| joe-broadhead/opencode-elevenlabs | — |
| juliantorr-es/rig-relay | — |
| Khip01/opencode-rich-presence | — |
| lazyopencode-core | 0.0.4 |
| magpie-agy-acp | 0.1.12 |
| magpie-wakatime | 0.2.0 |
| memory-bank-skill | 7.4.3 |
| mike-zentarisystems/zentari-mac-dev-workstation | — |
| Mte90/opencode-auto-resume | — |
| NekoYume517/opencode-xiaoyiwork-auth | — |
| NeoMei/SuperWagie | — |
| novel-writer-english | 1.5.1 |
| oc-arkive | 5.3.0 |
| oc-nonstop-router | 1.0.1 |
| oc-ping | 0.0.3 |
| oh-my-groundcontrol | 0.0.1 |
| oh-my-research | 0.1.0 |
| omctest | 0.0.3 |
| omo-stable | 3.6.0 |
| omo-suites | 1.17.0 |
| op-anthropic-auth | 0.1.4 |
| open-autopm | 3.6.11 |
| open-diff | 0.1.8 |
| open-loom | 0.1.10 |
| opencode-1m-context | 0.1.12 |
| opencode-agentic-engine | 0.5.12 |
| opencode-agentrouter-auth1 | 0.2.0-dev.2 |
| opencode-antigravity-auth-updated | 1.7.0 |
| opencode-anyrouter-auth | 0.1.0 |
| opencode-arise | 0.1.6 |
| opencode-asyntai | 1.0.0 |
| opencode-autopm | 3.7.0 |
| opencode-autoship | 2.21.1 |
| opencode-autoskills | 1.2.0 |
| opencode-business-flow-reviewer | 2.0.0 |
| opencode-cloudflare-image | 2.0.0 |
| opencode-cn | 1.2.27 |
| opencode-code-archaeology | 2.16.11 |
| opencode-codebuddy-external-auth | 1.0.28 |
| opencode-computer-use-win | 0.1.3 |
| opencode-copilot-1m | 1.10.0 |
| opencode-datalens-harness | 0.1.0 |
| opencode-discord-rpc | 1.0.1 |
| opencode-event-debug | 1.0.0 |
| opencode-fish-pet | 0.9.1 |
| opencode-focus | 0.1.3 |
| opencode-forgekeeper | 5.0.1 |
| opencode-gemini-proxy | 1.1.0 |
| opencode-gitbutler | 0.1.11 |
| opencode-gliner-prune | 0.1.5 |
| opencode-godot-toolkit | 1.1.0 |
| opencode-island | 0.9.0 |
| opencode-kickbacks | 0.1.1 |
| opencode-langgraph | 0.13.3 |
| opencode-lark | 0.2.2 |
| opencode-links | 0.1.1 |
| opencode-lookout | 0.1.3 |
| opencode-mad | 1.1.0 |
| opencode-mailbox | 0.0.13 |
| opencode-memfs | 0.0.12 |
| opencode-memory-pro | 1.6.2 |
| opencode-mimikkai-connect | 1.0.3 |
| opencode-model-routers | 0.2.11 |
| opencode-multisession | 0.3.0 |
| opencode-navigator | 1.0.0 |
| opencode-novel-plugin | 1.1.1 |
| opencode-novel-tools | 0.1.0 |
| opencode-ntfy-with-questions | 0.2.1 |
| opencode-obsidian | 1.1.3 |
| opencode-oci-oidc | 1.1.28 |
| opencode-omni-memory-plugin | 2.0.1 |
| opencode-openrouter-auth-broker-plugin | 0.2.2 |
| opencode-paste-as-file | 0.1.1 |
| opencode-permission-notify | 0.1.1 |
| opencode-plugin-ast-lsp | 0.0.6 |
| opencode-plugin-gitea | 0.3.3 |
| opencode-plugin-hub | 0.6.7 |
| opencode-plugin-inspector | 0.0.7 |
| opencode-powerpack | 2.0.0 |
| opencode-promemory-4861 | 0.6.10 |
| opencode-prompt-rail | 0.1.9 |
| opencode-prompt-recorder | 1.9.9 |
| opencode-provider-litellm | 1.0.1 |
| opencode-qwen-auth-plugin | 0.1.4 |
| opencode-rive-sidebar | 0.1.0 |
| opencode-sdlc-plugin | 1.1.4 |
| opencode-shell-safety | 0.7.0 |
| opencode-shell-tasks | 0.1.1 |
| opencode-shingan | 1.3.0 |
| opencode-side-panel-sessions | 0.2.0 |
| opencode-slim-mcp | 1.0.0 |
| opencode-switchback | 2026.11.6 |
| opencode-tailscale | 0.0.6 |
| opencode-talk | 0.1.1 |
| opencode-taskflow | 1.0.0 |
| opencode-telegram-bot | 1.1.2 |
| opencode-tianji | 0.6.0 |
| opencode-token-spend-bar | 1.0.3 |
| opencode-triton-ascend-generator | 0.1.0 |
| opencode-tui-utils | 1.3.0 |
| opencode-tuicr-plugin | 0.1.1 |
| opencode-turn-stats | 1.0.0 |
| opencode-ultra | 0.9.9 |
| opencode-usage-plugin | 0.0.2 |
| opencode-v2-tui-closetab | 0.1.0 |
| opencode-vcc | 0.1.0-alpha.1 |
| opencode-vibeplan | 0.2.0 |
| opencode-voice2text | 0.1.21 |
| opencode-web-plugin | 0.1.1 |
| opencode-websearch-cited-fork | 2.0.4 |
| opencode-worklog | 0.0.2 |
| opencode-wrap | 0.3.0 |
| opencode-xai-oauth | 1.2.0 |
| opencode-zh-desktop | 0.2.2 |
| opencode-zh-plugin | 0.1.7 |
| opencode2-shell-tasks | 0.1.1 |
| opencode2-tps2 | 0.1.0 |
| opencode2-vision-relay | 0.2.2 |
| opencommand-plugin | 0.0.29 |
| opencub | 0.1.0 |
| opendevbrowser | 0.0.40 |
| openengineer | 0.3.1 |
| openeuler-agent-shennong-crash-online | 0.10.4 |
| openpaul | 1.0.0 |
| openprototype | 1.8.4 |
| openrouter-genimage-kote-opencode | 0.1.0 |
| Ownistic/opencode-subagent-control | — |
| pasei-dev/opencode-profile-switcher | — |
| phlight | 0.2.15 |
| pixincreate/opencode-global-sessions | — |
| po-po-code | 0.9.6 |
| Porabuild/Poracode | — |
| project-knowledge | 4.6.1 |
| Realmagnum/opencode-session-timestamps | — |
| rhmcp | 1.1.1 |
| rjstone/opencode-plugin-template | — |
| SaberOnGo/public-domain-books-translation | — |
| seniormode | 0.1.1 |
| silopolis/opencode-readonly-guard | — |
| sisyphus-debatewiki | 1.0.3 |
| skill-author | 1.1.0 |
| skillsmp-mcp | 1.0.4 |
| slipway-agents | 0.17.0 |
| solidity-argus | 0.7.0 |
| solomemory-ai/opencode-solomemory | — |
| specifica-br | 1.12.2 |
| status-provider | 0.3.1 |
| terry2010/opencode-loop-recover | — |
| tobias-weiss-ai-xr/opencode-saia-plugin | — |
| ulises-jeremias/agent-toolkit | — |
| YonCZ/OpenCode-Presence | — |
| yuhp/opencode-models-discovery | — |

> 数据源：catalog 分支 index.json + ai-verdicts.jsonl（governing concern 判词 reason 以 装测失败 开头的目标；另含 ai:pass + verify:failed 目标）。
> 对应历史 issue：closed issues label:concern:verify / label:ai:pass → https://github.com/awesome-market/awesome-opencode-market/issues?q=is%3Aissue+label%3Aconcern%3Averify
