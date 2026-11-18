# 装测失败日报 — 2026-11-18

> 机械装测测量结果，**不是安全判定**：verify 管线实测"装不上/加载失败"的条目。
> 这些条目不再逐条开 issue——翻案靠重测转 verified 或人工 verdict；条目离开本表即翻案成功。

## 汇总
- 当前装测失败条目：**688**
- 按阶段：**load** 563 · **install** 98 · **structure** 15 · **render** 10 · **interactive** 2
- AI 判过但装不上：**481**（判词有效、字节装不上——同样等重测/上游修复翻案，见第二表）

## 明细
| 包 | 版本 | 阶段 | 原因摘要 |
|---|---|---|---|
| @arrislink/axon | 2.0.0 | install | Error: Plugin package has no server, GUI, or TUI entrypoint: @arrislink/axon@2.0.0 |
| @chikage0o0/opencode-dcp | 3.1.14 | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install @chikage0o0/opencode-dcp@3.1.14: unable to resolve dependency tree |
| @cogbox/opencode | 0.190.5 | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install @cogbox/opencode@0.190.5: No matching version found for @cogbox/sdk@^0.163.0. |
| @elixcode/elixcode-bun | 0.9.4 | install | Error: Plugin package has no server, GUI, or TUI entrypoint: @elixcode/elixcode-bun@0.9.4 |
| @kykiles/opencode-mem | 13.10.5 | install | Error: Plugin package has no server, GUI, or TUI entrypoint: @kykiles/opencode-mem@13.10.5 |
| @opensploit/core | 0.2.0 | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install @opensploit/core@0.2.0: unable to resolve dependency tree |
| @sanoma-ai/connector-opencode | 0.11.24 | install | [sandboxed egress is allow-listed — an install fetch failure can be network policy, not a broken package] |
| @sergemso/opencode-plugin | 1.0.0 | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install @sergemso/opencode-plugin@1.0.0: unable to resolve dependency tree |
| @toolu/core | 7.11.0 | install | Error: Plugin package has no server, GUI, or TUI entrypoint: @toolu/core@7.11.0 |
| @vibecontrols/vibe-plugin-ai-opencode | 2026.1115.1 | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install @vibecontrols/vibe-plugin-ai-opencode@2026.1115.1: unable to resolve dependency tree |
| @wentaoyuan/opencode-worktree | 0.5.2 | install | Error: Plugin package has no server, GUI, or TUI entrypoint: @wentaoyuan/opencode-worktree@0.5.2 |
| @xiaowei1906/opencode-beep | 0.1.0 | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install @xiaowei1906/opencode-beep@0.1.0: Unsupported platform |
| 0then0/agentkcal | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install 0the |
| 521ox/OpenCode-V2-zh-CN | — | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install 521ox/OpenCode-V2-zh-CN#aebac391dcaeb6d857e19f33622f030a26bc9614: git dep preparation fail |
| agiledon/openmole | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install agil |
| aimeoa/hanshuang-codex | — | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install aimeoa/hanshuang-codex#cf9c1537c2bd4ed8577ed6509ee665a39709d7d4: git dep preparation faile |
| Akshat-2011/vibe-wise-opencode | — | install | Error: Plugin package has no server, GUI, or TUI entrypoint: Akshat-2011/vibe-wise-opencode#07154ac85cd7fad1f88ccdfb3d06ad04a45f22e0 |
| Alaye-Dong/opencode-hud | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Alay |
| aleks-spv/opencode_retrypush | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install alek |
| alexandru/opencode-session-todo | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install alex |
| AlexisBalayre/agentspine | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Alex |
| AltimateAI/altimate-code | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Alti |
| amadeus-ex-machina/christina | — | install | Error: Plugin package has no server, GUI, or TUI entrypoint: amadeus-ex-machina/christina#d6320bbb9d189c12814b3a83dc26cb74dfc8adf0 |
| AmethystLuna/embedded-workbench | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Amet |
| anandpant/opencode-palantir | — | install | Error: Plugin package has no server, GUI, or TUI entrypoint: anandpant/opencode-palantir#a8ffe2b9e8aac3b5380d3db3eec34ad3414f1f47 |
| anargia-pixels/opencode-automode-plugin | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install anar |
| AnotiaWang/opencode-web-plugin | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Anot |
| Ar5en1c/localqa | — | install | Error: Plugin package has no server, GUI, or TUI entrypoint: Ar5en1c/localqa#fe4891f61c8c16b9dc69e223bfa2d3228655933a |
| ArchAIHarness/agent-workflows | — | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install ArchAIHarness/agent-workflows#d9cef47f196410f6769a865924c0b469b4eea1b0: An unknown git err |
| ariga39/opencode-vision | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install arig |
| ashutoshrathi0909-oss/everything-claude-code | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install ashu |
| ATLAS-DEV78423/AgentBridge | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install ATLA |
| atman-33/multi-agent-ff15 | — | install | Error: Plugin package has no server, GUI, or TUI entrypoint: atman-33/multi-agent-ff15#1d30afc6c5dfbf0734cba4f3b3a9b9de56909fa6 |
| avinash-1707/Myrios | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install avin |
| aydemir/opencode-plugins | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install ayde |
| ayushnandi718-dev/opencode-chat | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install ayus |
| B-A-M-N/opencode-xgoal | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install B-A- |
| balatD/gorc | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install bala |
| bastian-seifert/armin | — | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install bastian-seifert/armin#ecb3b61fb3124ea238fd0e6d8558a18a528eecbf: Could not read package.jso |
| batuhansk/opencode-talk | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install batu |
| bbingz/polycli | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install bbin |
| benjaminshafii/digital-empire | — | install | [sandboxed egress is allow-listed — an install fetch failure can be network policy, not a broken package] |
| BernardYan2357/opencode-image-vision | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Bern |
| betterspec/opencode-betterspec | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install bett |
| beydemirfurkan/opencode-gladio | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install beyd |
| BITRATE-Labs/vrchat-mcp | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install BITR |
| BlakeHastings/opencode-litellm | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Blak |
| Bouska/opencode-dcg-plugin | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Bous |
| br4zz4/opencode-smart-session-picker | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install br4z |
| bskim/opencode-azure-entra-auth | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install bski |
| btca-server | 2.0.5 | install | [sandboxed egress is allow-listed — an install fetch failure can be network policy, not a broken package] |
| buddy-hq/buddy | — | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install buddy-hq/buddy#88e972bb13d33d10dfad7bec0d81cb465ef3c4bc: git dep preparation failed |
| buffsystems/buff-code | — | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install buffsystems/buff-code#efe79f86186cccf4b9f50d33da8aeebe3a9c10c4: git dep preparation failed |
| bulga138/peso | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install bulg |
| cbartens/bkit | — | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install cbartens/bkit#56363678d784bc2615e1785a39f152b550bce67d: git dep preparation failed |
| codesensehq/codesense | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install code |
| cosminfuica/opencode-prompt-optimizer | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install cosm |
| devshaydez/seira | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install devs |
| fro-bot/space-bus | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install fro- |
| gonzalezpazmonica/savia | — | install | [sandboxed egress is allow-listed — an install fetch failure can be network policy, not a broken package] |
| gotenksIN/opencode-websearch-addons | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install gote |
| heyimteee/ensemble | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install heyi |
| joe-broadhead/opencode-browse | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install joe- |
| joe-broadhead/opencode-gws | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install joe- |
| joe-broadhead/opencode-inference | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install joe- |
| joe-broadhead/opencode-jira | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install joe- |
| joe-broadhead/opencode-jobs | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install joe- |
| joe-broadhead/opencode-linear | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install joe- |
| joe-broadhead/opencode-plaud | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install joe- |
| joe-broadhead/opencode-slack | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install joe- |
| joe-broadhead/opencode-tavily | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install joe- |
| joe-broadhead/opencode-utilities | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install joe- |
| joe-broadhead/opencode-voice | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install joe- |
| joe-broadhead/opencode-x | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install joe- |
| marcusrbrown/opencode-copilot-delegate | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install marc |
| marcusrbrown/systematic | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install marc |
| mcp-harmonyos | 1.1.0 | install | Error: Plugin package has no server, GUI, or TUI entrypoint: mcp-harmonyos@1.1.0 |
| n8n-nodes-opencode-ai | 0.1.10 | install | Error: Plugin package has no server, GUI, or TUI entrypoint: n8n-nodes-opencode-ai@0.1.10 |
| nah-ai | 0.0.1-beta.13 | install | Error: Plugin package has no server, GUI, or TUI entrypoint: nah-ai@0.0.1-beta.13 |
| open-controller | 2.0.2 | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install open-controller@2.0.2: Unsupported platform |
| opencode-bypass-agent | 1.0.0 | install | Error: Plugin package has no server, GUI, or TUI entrypoint: opencode-bypass-agent@1.0.0 |
| opencode-raven | 2.4.0 | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install opencode-raven@2.4.0: unable to resolve dependency tree |
| pythongiant/laya-drift | — | install | Error: Plugin package has no server, GUI, or TUI entrypoint: pythongiant/laya-drift#89ae9b28b60a47602247c785377512d8ca121a26 |
| sblattj/agentic-coding-harness | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install sbla |
| ShaoRoy/site-selection-skill | — | install | Error: Plugin package has no server, GUI, or TUI entrypoint: ShaoRoy/site-selection-skill#5195ce8d052417bee11e7636fa87c8ec096d48c5 |
| Sn0wo2/oc-keep-going | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Sn0w |
| SocialGouv/ultra11y | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Soci |
| stefanhoelzl/codehydra | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install stef |
| texugo7badger/OLYMPUS | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install texu |
| thejohnd0e/opencode-answer-date | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install thej |
| Thomashighbaugh/buchbinder | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Thom |
| Verbiflow/mako | — | install | 依赖安装失败（npm/git 拉取或包准备阶段报错） — NpmInstallFailedError: Failed to install Verbiflow/mako#5b3bdea8a751823692737f10c97a32a5c9890d82: git dep preparation failed |
| YahyaHammad/Venastine-Research-Harness | — | install | Error: Plugin package has no server, GUI, or TUI entrypoint: YahyaHammad/Venastine-Research-Harness#4b84e65b996b4bc2342cc18d4c04c0edcbf477a6 |
| YonCZ/rich-opencode | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install YonC |
| yurgeno/saut | — | install | Error: Plugin package has no server, GUI, or TUI entrypoint: yurgeno/saut#a456c9620151fdb7dfceb5034790cf3f539cba73 |
| ZaxbyHub/opencode-swarm | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install Zaxb |
| zhiwenC125/Cybertron-agents | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install zhiw |
| zufall-upon/Sortie-dogs | — | install | 上游 opencode bug——git 插件带 build/prepare 类脚本时 plugin add 在 ≤2.3.0 必失败（anomalyco/opencode#62817），非包本身问题，宿主版本修复后自动重测 — NpmInstallFailedError: Failed to install zufa |
| mii9000/opencode-auto-switch | — | interactive | 交互式启动检查未通过——TUI 阶段异常退出 — plugin half passed (interactive); skill payload failed: |
| yriveiro/spectre | — | interactive | tre-e14594b8de1a6104f3f7f612723005cb4202cd11/skills/definitions/pr-canvas/SKILL.md, spectre-e14594b8de1a6104f3f7f612723005cb4202cd11/skills/definitions/principl |
| @0xsero/open-queue | 1.0.11 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @5dive/opencode-chat | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @5x-ai/5x-cli | 1.3.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @a4hgehad/weave-mcp | 0.10.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @accelerate-data/promptfoo-eval-harness | 1.9.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @accomplish_ai/agent-core | 0.4.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: Failed to load native module: pty.node, checked: build/Release, buil |
| @adayacas/loopbreaker | 0.3.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @adhd/sox-host-registry | 0.7.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @aeterna-org/opencode-plugin | 0.7.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @aexol/pi-wizard | 0.6.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @agent-a/cli | 0.1.17 | load | --- stream tail --- timestamp=2026-11-16T08:06:23.588Z level=INFO run=0764b633 message="cli starting" version=2.3.0 channel=latest local=false args="[\"plugin\" |
| @agent-context/opencode-sift | 0.0.7 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @agentplugins/adapter-opencode | 0.6.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @ai-sdk/harness-opencode | 1.0.190 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @aipno/opencode-token-monitor | 1.0.6 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @alvarovfon/opencode-agent-monitor | 1.2.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @amends-dev/codemode-opencode | 0.2.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @anis00723/opencode-debug | 1.6.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @anthonyfangqing/opencode-special-edition | 1.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @aquaticcalf/opencode-telegram | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @arandajulian/opencode-claude-mem | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @arcevico/opencode-agent-pulse | 0.2.7 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @aria-mcps/aria-mcp-gateway | 0.1.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @ariane-emory/must-have-plugin | 1.0.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @ariane-emory/opencode-antigravity-auth | 1.2.1-b-fix-account-duplication | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @aryaminus/controlkeel-opencode | 0.4.21 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @asmadsen/opencode-node-package-manager | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @atlascloudai/opencode | 1.0.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @austinthesing/magic-shell | 1.2.2 | load | --- stream tail --- --port\",\"0\"]" role=cli timestamp=2026-11-16T08:51:59.320Z level=INFO run=debfb775 message="database schema bootstrap started" migrations= |
| @bdliyq/opencode-rate-limit-retry | 1.0.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @bengabay94/mrzero | 0.1.0-alpha.1 | load | 插件入口疑似是 CLI 程序——宿主加载入口模块时顶层 program.parse() 吞掉宿主 argv（包把命令行工具当插件入口打包，真包缺陷） — error: unknown command 'serve' |
| @benjamolina/opencode-antigravity-guard | 1.1.24 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @betterspec/opencode | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(ResolveMessage: Cannot find package '@opencode-ai/plugin' imported from /tm |
| @bloodf/opencode-claude-mem | 1.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @bluelovers/opencode-arise | 0.1.40 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @bogyie/opencode-kiro-plugin | 0.3.24 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @br4zz4/opencode-smart-tools | 0.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(TypeError: undefined is not an object (evaluating 'context.keymap.layer'))] |
| @bwanamaker/brandobot | 0.4.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @bytesbrains/opencode-cruise | 0.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @carson2222/fusion | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(ResolveMessage: Cannot find package '@opencode-ai/plugin' imported from /tm |
| @cat4869/token-lean | 0.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @chethann/opencode-workflow | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @chriscode/devmux | 1.10.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @codemcp/workflows-opencode | 6.24.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @corti/cli | 1.6.3 | load | 插件入口疑似是 CLI 程序——宿主加载入口模块时顶层 program.parse() 吞掉宿主 argv（包把命令行工具当插件入口打包，真包缺陷） — error: unknown command 'serve' |
| @cosmosdeng/nodeflow-mcp | 0.4.0-next.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @cravenceiling/opencode-etf | 1.0.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @crazy-goat/nexos-provider | 1.16.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @crixue/opencode-voice-stt | 0.2.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — serve reports the plugin failed to load |
| @ctbrk/ctbk-opencode-notifier | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @ctliz/pi-intercom | 0.14.5 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @curl.md/opencode | 0.1.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @cyan_tachyon/inf-copilot | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @d-ai/magpie | 0.1.7 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @deep-assistant/agent | 0.0.7 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @dendaio/opencode-9router-plugin | 1.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @devcxl/opencode-thinking-translater | 0.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @deveco-test/deveco-harness | 0.2.0-test.8 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @devtheops/opencode-plugin-mempalace | 1.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @dmmop/opencode-key-rotator | 2.2.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(TypeError: Schema.isStartsWith is not a function. (In 'Schema.isStartsWith( |
| @doingdev/opencode-claude-manager-plugin | 0.1.100 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @doyzheng/ezllm-codebuddy-ide-auth | 0.3.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @dragonwize/opencode-event-shell-exec | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @dudousxd/nestjs-agent-opencode | 2.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @duoyun/opencode-notification | 1.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @edo1994/opencode-queue | 0.13.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: Cannot load \"effect/dist/unstable/http/index.js\" from plugin node_ |
| @elelem/opencat | 1.0.7 | load | ❌ Error: Missing SLACK_BOT_TOKEN or SLACK_APP_TOKEN. |
| @ereinha/opencode-enhanced-quotas | 1.3.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @f97/opencode-morph-fast-apply | 1.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @fastman/mcp-kaneo | 2.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @fox-js/pad-skills | 4.0.1-0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @fox-js/pc-skills | 4.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @fpytloun/opencode-mnemory | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @fractary/opencode-codex | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @fractary/opencode-core | 1.0.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @fractary/opencode-faber | 1.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @fractary/opencode-faber-cloud | 1.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @fractary/opencode-faber-code | 0.6.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @franzmoca/opencode-lombok | 0.1.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @fulcrum-agent-os/opencode-plugin | 0.0.6 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @gchamon/opencode-kiro-auth | 2.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @gfn-cis/opencode-temp-sanitize | 0.3.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: EACCES: permission denied, mkdir '/tmp/opencode/home-adce5cbc')]) |
| @ghilteras/opencode-model-fallback | 0.4.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @gitawego/opencode-vision | 0.2.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @gitgen/gitgen | 1.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @gitterm/bot | 0.4.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @gitterm/discord-bot | 0.3.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @gitterm/slack-bot | 0.3.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @gramatr/opencode-plugin | 0.33.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @grandmaster451/kilo-superpowers | 2026.317.816 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @grant-vine/wunderkind | 0.28.12 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @groundtrack/opencode-plugin | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @guan612/opencode-ai-light | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @guolei1994/tool | 1.0.16 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @hacr/opencode-autobe | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @happycastle/opencode-graphiti | 0.6.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @happycastle/opencode-openmemory | 0.0.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @hellofriday430/opencode-minimax-bridge | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(ResolveMessage: Cannot find package '@opencode-ai/plugin' imported from /tm |
| @heretek-ai/godot-testkit | 1.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @hmos-library-adapter/flutter | 0.1.6 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @hmos-library-adapter/rn | 0.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @hmos-library-adapter/sdk | 0.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @hotmanxp/opencode-qwen-login-plugin | 1.3.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @howaboua/opencode-planning-toolkit | 0.0.6 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @humaiz/opencode-cmdsync | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @humaiz/shot-drop-opencode | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @iam-brain/opencode-codex-auth | 1.10.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @iamtoricool/opencool-qwen-auth | 0.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @inference/trace-opencode | 0.1.13 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @inferhub/helper | 0.2.9 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @intisy-ai/antigravity-auth | 1.17.7 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @intisy-ai/opencode-loader | 1.13.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @intisy-ai/opencode-proxy | 2.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @intisy-ai/plugin-updater | 1.15.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @involvex/opencode-statusbar | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @isupervillain/opencode-container-exec | 1.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @iwahbi/opencode-claude-stack | 1.2.19 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @jack-yang/opencode-bark-notify | 1.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @jack-yang/opencode-tps-meter | 1.4.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(TypeError: undefined is not an object (evaluating 'ctx.data.on'))]) |
| @jacob-z/opencode-token-usage | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @jairodri/huckleberry-cli | 1.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @jamesmurdza/coding-agents-sdk | 0.1.8 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @jamesmurdza/opencode-daytona | 0.1.25 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @jannniiiii/opencode-claude-skill-sync | 1.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @jantcz/webai | 0.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @javargasm/opencode-graphify | 0.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @javargasm/opencode-kiro-auth | 8.3.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @jentrix/plugin-opencode | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @jianmu-plugins/page-agent-console | 1.3.8 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @jianmu-plugins/page-chat | 0.1.14 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @jianmu-plugins/tools-calc | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @jimmyyen/opencode-context-cache | 1.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @jimmyyen/opencode-registry-plugin | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @jmylchreest/aide-plugin | 0.1.18 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @joe-broadhead/opencode-artifacts | 0.4.0 | load | plugin half passed (load); skill payload failed: |
| @joe-broadhead/opencode-jobs | 0.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: HOST_UNTESTED: This plugin supports OpenCode >=2.2.3 <2.3.0, found 2 |
| @johannus22/opencode-tps-meter | 0.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @juristechllc/fireworks-serialized-provider | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @justmpm/ai-tool | 6.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(TypeError: Context.GenericTag is not a function. (In 'Context.GenericTag(\" |
| @k98kurz/opencode-fixtodo | 0.0.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @kagan-sh/kagan | 0.4.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @kevinfx/magpie-mcloud | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @kevinfx/magpie-wps-lingxi | 0.3.5 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @kiritoko1029/opencode-add-oai-instruction | 1.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @knowl/opencode | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @kungfusaini/opencode-worklog | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @lansya/opencode-plugin-claude-memory | 1.0.7 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @leo.gimp/opencode-usage-bar | 3.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(TypeError: ctx.storage.store is not a function. (In 'ctx.storage.store(\"se |
| @leo000001/opencode-notify-native | 1.4.6 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @lightfish/react-opencode-ui | 0.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @loreai/opencode | 0.40.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @lucid-agents/opencode-x402-plugin | 0.1.12 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @lyculs/opencode-engram | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @lyculs/opencode-firecrawl | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @lyculs/opencode-startup-context | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(BuildMessage: Unexpected escape sequence)]) |
| @lynxlabs/oikonomos | 0.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @lzy6755/ai-chat-opencode | 0.1.6 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(AggregateError: 12 errors building \"/tmp/verify-juHJqN/u/cache/opencode/np |
| @mac110/opencode-openai-compatible | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @macqueen1001/opencode-think-with-me | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mageyuki/opencode-subagent-statusline | 0.7.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — serve reports the plugin failed to load |
| @mailshieldai/opencode-canvas | 0.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @malaclyde/knowledge-base | 0.1.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @marcelorodrigo/opencode-spring-crew | 0.3.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mastra/opencode | 0.1.43 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mazac-fox/opencode-conductor | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mazac-fox/opencode-fleet-contracts | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mcrescenzo/opencode-child | 0.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mcrescenzo/opencode-goals | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mcrescenzo/opencode-sessions | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @melodyoftears/opencode-qwen-auth | 1.3.7 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mhsenam/opencode-token-saver | 0.4.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @microsoft/agent-governance-opencode | 5.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mimirsynth/opencode | 0.1.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mingeon/opencode-blueprint | 0.3.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mingxy/cerebro | 2.3.8 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mingxy/ocosay | 1.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mirsella/context7-account-broker | 0.4.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @misaelcs/opencode-jev | 2.0.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mixio-pro/kalaasetu-plugin | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mixio-pro/mixiocode-plugin | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mjfuertesf/pi-quota-status | 0.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mlflow/opencode | 0.5.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @molecule/api-agent-transcript-opencode | 1.0.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @monotykamary/pi-opencode-provider | 1.0.84 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @moozie/opencode-voice | 0.0.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @moritakaaz/opencode-apc | 1.2.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mscortana/toki | 2.22.7 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mtrojnar/pi-usage | 0.2.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @mytai20100/opencode-browser | 0.0.8 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @n0c1ip/opencode-pohuy | 0.1.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @nahuelcio/opencode-ado | 0.4.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @nano-step/skill-manager | 5.30.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @neilurk12/pi-free-models | 1.0.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @neomei/opencode-clawmessenger | 0.5.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @neomei/opencode-feishu | 0.6.9 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @neomei/opencode-qiwei | 0.3.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @nest4869/argos | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @netsirk/depot | 3.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(SyntaxError: Export named 'Either' not found in module 'effect'.)]) |
| @ninkch/opencode-mem | 1.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @nk070281sjv/cli | 3.0.65 | load | 插件入口疑似是 CLI 程序——宿主加载入口模块时顶层 program.parse() 吞掉宿主 argv（包把命令行工具当插件入口打包，真包缺陷） — error: unknown command 'serve' |
| @nodeint/migent-adapters | 0.8.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @npll/omol | 5.0.0-beta.6-omol.202608120621 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: ENOENT: no such file or directory, open '/tmp/verify-U7nFUG/u/cache/ |
| @obrigado/surface | 0.4.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @octafy/helper | 0.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @oh-harness/plugin | 0.2.0-test.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @old-mikser/occontext-thinking-trim | 1.0.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @openagentsy/footprint | 0.2.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @openagentsy/hooks | 0.2.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @openagentsy/ledger | 0.2.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @openagentsy/memory | 0.2.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @openagentsy/models | 0.2.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @openagentsy/tasks | 0.2.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @openclient-ios/opencode-plugin | 0.5.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: Invalid OpenCode server port)]) |
| @opencode_weave/weave | 0.9.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @opencode-cockpit/daemon | 0.11.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @opencode-cockpit/protocol | 0.11.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @opencode-compat/adapter | 0.4.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @opencode-compat/cli | 0.4.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @opencode-compat/facade-plugin | 0.4.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @opencode-compat/facade-sdk | 0.4.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @opencode-compat/pi-bridge | 0.4.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @opencode-qq/plugin-sdk | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @opencode-trace/core | 0.0.7 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @opencode-trace/plugin | 0.0.7 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @opencomms/opencode-plugin | 0.1.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @opencoop/opencode-plugin | 1.16.0 | load | --- stream tail --- lugin@1.16.0/1794816389200/node_modules/@opencoop/opencode-plugin/dist/index.js http.span=181 role=server timestamp=2026-11-16T08:06:40.338Z |
| @openhax/codex | 0.4.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @openpets/elevenlabs | 1.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(ResolveMessage: Cannot find module './src/tools/script-production' imported |
| @openpets/fal | 1.0.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @openpets/huggingface | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(ResolveMessage: Cannot find package 'openpets-sdk' imported from /tmp/verif |
| @openpets/telegram-bot | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(ResolveMessage: Cannot find module './openapi-tools' imported from /tmp/ver |
| @openplugins/token-balance | 1.1.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: Environment variable \"OPENTUI_FORCE_WCWIDTH\" is already registered |
| @openprojectx/opencode-kimi-auth | 0.3.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @opentj/opencode-oauth2-plugin | 1.0.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @otsupeko_lee/work-work | 1.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @ousing9/omo-no-time | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @overbit/opencode-plugin-litellm | 0.7.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @oxel40/opencode-model-groups | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @oy-cli/opencode | 0.14.13 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(TypeError: undefined is not an object (evaluating 'ctx.catalog.transform')) |
| @pantheon-ai/opencode-warcraft-notifications | 1.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @parallel-web/opencode-plugin | 1.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @pavel.sommer/agiter | 0.52.0-alpha.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @pawbxj/arena-cli | 1.0.0-Beta | load | --- stream tail --- timestamp=2026-11-16T09:37:56.121Z level=INFO run=a556afee message="cli starting" version=2.3.0 channel=latest local=false args="[\"plugin\" |
| @pemessage/opencode-worktree | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @pipellm/magpie-websearch | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @pkcpkc/opencode-plugin-command-hooks | 0.4.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @pnz1990/open-krode | 0.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @polygraph/opencode-plugin | 0.5.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @potb/opencode-plugin-noop | 0.0.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @principal-ade/agent-manager | 1.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @promethean-os/opencode-openai-codex-auth | 3.2.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @quarkos/pi-fusion | 1.0.12 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @r3nic1e/opencode-openai-decisions | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: openai-decisions: set options.endpoint to the Decisions URL, for exa |
| @r4coder/magpie-plugin | 0.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @rafamacalaba/armada | 1.2.9 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @ratteeth1/opencode-session-manager | 0.1.5 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @razroo/opencode-model-fallback | 0.3.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @really-knows-ai/foundry | 3.15.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @redfoxxo/pounce | 1.1.0 | load | --- stream tail --- timestamp=2026-11-16T12:05:21.209Z level=INFO run=9cb436c5 message="cli starting" version=2.3.0 channel=latest local=false args="[\"plugin\" |
| @rejacky/opencode-insights | 1.0.1 | load | --- stream tail --- :06:10.391Z level=INFO run=3aeab3f8 message="watcher stopped" path=/tmp/verify-OYPdJg/u type=entries http.span=20510 role=server timestamp=2 |
| @renjfk/opencode-notify | 1.1.0 | load | --- stream tail --- :05:51.736Z level=INFO run=d809d0cd message="watcher stopped" path=/tmp/verify-JyMabg/u type=entries http.span=20517 role=server timestamp=2 |
| @renjfk/opencode-secret-tools | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: Both listCmd and getCmd are required options)]) |
| @rezarria/opencode-mcp-bridge | 1.2.5 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @riskihajar/opencode-omniroute-auth | 1.3.29 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @robinmarin/opencode-teams | 0.1.7 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @rstacruz/opencode-autoask | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @rurout/opencode-v2 | 0.2.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — serve reports the plugin failed to load |
| @s3tupw1zard/langfuse-opencode-observability-plugin | 0.1.0-dev.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(SyntaxError: Export named 'SeverityNumber' not found in module '/tmp/verify |
| @seed-lab/opencode-seed-agent | 0.1.22 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @sentiolabs/opencode-arc | 0.3.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @sentiolabs/opencode-slop-review | 0.5.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @seonggukchoi/opencode-notifier | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @sergemso/opencode-observability | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(ResolveMessage: Cannot find package '@opentui/solid' imported from /tmp/ver |
| @serii84/vertex-partner-provider | 1.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @serviceme/devtools-core | 3.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @sessionwise/opencode-plugin | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @sffmc/utilities | 0.16.5 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(ResolveMessage: Cannot find package 'safe-regex' imported from /tmp/verify- |
| @shakespeare.diy/opencode-plugin | 0.5.23 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @shaogefenhao/overnight | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @sheiksadi/opencat | 0.0.5 | load | ❌ Error: Missing SLACK_BOT_TOKEN or SLACK_APP_TOKEN. |
| @shgroup/opencode-serenity-plugin | 0.9.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @shodocan/opencode-hindsight | 1.0.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @skastr0/background-tasks-opencode | 0.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(TypeError: Schema.nonNegative is not a function. (In 'Schema.nonNegative()' |
| @skastr0/groundwork-opencode-plugin | 0.2.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @snubisks/opencode-dcp | 3.1.14 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @sonic182/graphmem | 0.15.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @spmurrayzzz/opencode-openai-codex-auth | 3.3.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @spritz-finance/opencode | 0.1.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @subadeepan_y/vi3ion-opencode | 0.1.7 | load | plugin half passed (load); skill payload failed: |
| @sublang/cligent | 0.39.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @suncreation/opencode-claude-patch | 0.3.8 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @super-pocock-ai/memory-core | 2.3.30 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @sureshsankaran/ralph-wiggum | 0.3.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @syntax-syllogism/aloop | 0.12.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @talocode/skilllane | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @tder311/opencode-orchestrator | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @te-river/opencode-alibabatokenplan | 0.2.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: Environment variable \"OPENTUI_FORCE_UNICODE\" is already registered |
| @tengxiaohtx/connect | 1.2.7 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @the3asic/opencode-smart-title | 0.2.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @thehugeman/opencode-anthropic-auth-community | 0.0.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @thesammykins/discord_opencode | 1.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @thesammykins/tether | 1.7.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @tkwf/opencode-shellfix | 2.3.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @tokenmix/opencode-plugin | 0.3.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @tokentop/agent-opencode | 1.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @toninho09/opencode-wakeup | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @toolr/seedr | 0.1.80 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @typedecision/runtime-linux-x64-gnu | 0.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(TypeError: To load Node-API modules, use require() or process.dlopen instea |
| @until-dev/plugins | 0.2.9 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @varonell/ai-usage | 1.7.8 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(ResolveMessage: Cannot find module 'electron'\nRequire stack:\n- /tmp/verif |
| @vaur94/figma-rust | 0.4.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(TypeError: Schema.isStartsWith is not a function. (In 'Schema.isStartsWith( |
| @veedubin/boomerang-v2 | 4.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: \nSomething went wrong installing the \"sharp\" module\n\nCannot fin |
| @veedubin/opencode-boomerang | 1.0.12 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @velum-labs/routekit-tool-opencode | 1.5.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: Cannot load \"effect/dist/unstable/process/index.js\" from plugin no |
| @vheins/opencode-model-fallback | 0.1.18 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @vikrant82/opencode-context-truncate | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @vmifev/auto-init-config | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @voidrot/openai-featherless-compatible | 0.3.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @volcengine/tls-observer-opencode | 0.0.8 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @wafonro2/opencode-resurrect | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @wakeshift/opencode | 1.4.63 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @weiyentan/opencode-plugin-sqlite | 0.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(SyntaxError: Export named 'Database' not found in module '/tmp/verify-8kJn0 |
| @whomwah/opencode-nelson-muntz | 1.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @wix/pathgrade | 1.0.69 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @wolfx/oh-my-openagent | 4.19.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @wzzjjboy/opencode-wecom-notify-plugin | 0.1.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @x1aoye/conflux-oc | 0.2.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @x1aoye/tao-tie-oc | 0.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @xeaser/opencode-obsidian-sync | 0.1.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @xpufx/agent-mux | 0.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @yanu30adi/vision-bridge-mcp | 0.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @yaoguai_xh/opencode-goal-plugin | 0.10.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @yourlocalai/your-local-ai | 0.1.5 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @yoyoyoake/pi-token-plan-monitor | 0.2.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @yugimob/pi-opencode-go-rotation | 1.7.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @yyg27/manbun | 4.10.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @z3z1ma/open-loom-playbooks | 0.3.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @zchazc/nbcb-provider | 1.0.5 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @zeklop/opencode-antigravity-auth | 1.6.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @zenmux/opencode-oauth | 0.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @zhzy0077/opencode-terminal-title | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @zilliz/memsearch-opencode | 0.4.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: MemSearch CLI unavailable. Install with uv tool install 'memsearch[o |
| @ziuus/daily | 1.2.9 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @zmide/opencode-codex-provider | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @zwidny/opencode-mempalace | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| 00bx-kiro-gateway | 1.0.9 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| aaronpiipponen/shadow-orchestrator | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: /tmp/verify-CCtC24/u/cache/opencode/npm/git-shadow-orchestrator-95e2 |
| acp2openai | 0.1.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| active-collab-agent | 0.12.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| agent-data/job-search | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| agent-memory-store | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| agent-sdk-kit | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(ResolveMessage: Cannot find package '@github/copilot-sdk' imported from /tm |
| agent-status-opencode | 0.1.33 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| agentic-remem | 0.2.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| agy-openai-bridge | 0.2.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| ailense | 0.1.5 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| aios-forge | 1.2.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| Ajwyunsx/opencode-commandcode-go | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| akm-opencode | 0.10.261130 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| alchemylab | 3.6.0 | load | 2026-11-17T08:31:28.930Z [error]: Failed to start HTTP API server {"service":"mcp-http-server","error":"RangeError: options.port should be >= 0 and < 65536. Rec |
| alexmarco/opencode-skill-pulse | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| alkevintan/opencode-advisor | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| alkevintan/opencode-vision | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| alpha-agent-ai | 1.0.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| amazingteam | 3.0.23 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| andyzasl/opencode-copilot | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(TypeError: undefined is not an object (evaluating 'context.data.on'))]) |
| anis-dr/opencode-mermaid-renderer | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| Ansh-Sonkusare/jev-compaction-harnesses | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| antigravity-auth | 1.17.7 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| antri_cli | 1.57.52 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: cannot add command 'backend' as already have command 'cloud\|backend' |
| anytxt-opencode | 0.0.5 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| arch-governance-nfrega | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| arfoux/rs-guard-v1 | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| aryasaatvik/opencode-plugin-executor | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: Cannot load \"effect/dist/unstable/http/index.js\" from plugin node_ |
| Asno-dev/apex | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| auto-model-switcher | 1.3.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| autoaidev | 1.0.312 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(ResolveMessage: Cannot find module 'vscode'\nRequire stack:\n- /tmp/verify- |
| autosquid/omo-mem | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| avaritiachaos/qoder-proxy | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| awesome-agent-skills-mcp | 1.0.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| bad-noodles/opencode-qwen-auth | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| Barathaner/paul-persistent-atlassian-undestanding-meeting-logger | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| bartoszarendt/castwork | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| bc1xxx/orchestrator-opencode | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| benskls/openstrat | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| better-opencode-async-agents | 0.10.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| better-opencode-openai-codex-auth | 0.1.5 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| bg-tasks-mcp | 0.8.0 | load | --- errors --- [bg-tasks] Error: unknown argument "serve" --- stream tail --- timestamp=2026-11-16T12:53:58.500Z level=INFO run=86f257f3 message="cli starting"  |
| bhumitschaudhry/Slopnought | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| bitbucket-agent | 1.3.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| bnc4vk/opencode-model-scorecard | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(SyntaxError: Export named 'jsxDEV' not found in module '/tmp/verify-iJYSA7/ |
| BowTiedSwan/opencode-video-gateway | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| bsosik1/opencode-arcana | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| ca-x/magpie-intern-ai | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| cache-timer | 1.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| claude-ai-switcher | 1.5.0 | load | 插件入口疑似是 CLI 程序——宿主加载入口模块时顶层 program.parse() 吞掉宿主 argv（包把命令行工具当插件入口打包，真包缺陷） — error: unknown command 'serve' |
| clew-code | 0.11.0 | load | 插件入口疑似是 CLI 程序——宿主加载入口模块时顶层 program.parse() 吞掉宿主 argv（包把命令行工具当插件入口打包，真包缺陷） — error: unknown option '--port' |
| cli-continues | 2.4.3 | load | 插件入口疑似是 CLI 程序——宿主加载入口模块时顶层 program.parse() 吞掉宿主 argv（包把命令行工具当插件入口打包，真包缺陷） — error: unknown option '--port' |
| cliproxy-provider | 1.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| code-stroll | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| codemax-opencode-setup | 1.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| codex-plugin-oc | 1.0.6 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| cortico-provider-opencode | 0.7.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(ResolveMessage: Cannot find package 'cortico' imported from /tmp/verify-dpY |
| cosa-opencode | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| database-admin | 1.2.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| deveco-model-plugin | 0.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| dico-open | 0.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| discourse-descent | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| dm-bot | 1.1.18 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — serve reports the plugin failed to load |
| dondon-notify | 0.1.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| donice-evaluator | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| dyegolara/lnurl-auth-agents | — | load | --- stream tail --- -port\",\"0\"]" role=cli timestamp=2026-11-16T08:51:52.827Z level=INFO run=cc8f85ec message="database schema bootstrap started" migrations=5 |
| endvour | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| etchplan-opencode | 0.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| eve-ai | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| even-agent-home | 1.0.10 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| fernhop | 1.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| firefox-mcp-marionette | 0.9.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| fortunememory | 1.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| gateclaw-telegram-bot | 0.15.0 | load | Failed to start bot: Missing required environment variable: TELEGRAM_BOT_TOKEN (expected in /tmp/verify-sVd8Gp/u/.env) |
| gitbot-ai | 0.0.3 | load | 插件入口疑似是 CLI 程序——宿主加载入口模块时顶层 program.parse() 吞掉宿主 argv（包把命令行工具当插件入口打包，真包缺陷） — error: unknown command 'serve' |
| glootie-oc | 2.0.6 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| goodtome/magpie-teleagent-login | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| grok-search-skill | 1.3.9 | load | --- stream tail --- timestamp=2026-11-16T10:13:07.306Z level=INFO run=07450a1a message="cli starting" version=2.3.0 channel=latest local=false args="[\"plugin\" |
| gsd-opencode | 1.38.5 | load | 插件入口疑似是 CLI 程序——宿主加载入口模块时顶层 program.parse() 吞掉宿主 argv（包把命令行工具当插件入口打包，真包缺陷） — ✗ error: unknown command 'serve' |
| gyoshu | 0.4.33 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| halloweed-anthropic-auth | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| img-read | 1.1.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| inject-user-id | 0.3.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| iron-horse-opencode | 1.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| jarvis-hq | 0.0.7 | load | 插件入口疑似是 CLI 程序——宿主加载入口模块时顶层 program.parse() 吞掉宿主 argv（包把命令行工具当插件入口打包，真包缺陷） — error: unknown command 'serve' |
| Jiao77/magpie-string-ai | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| jinyue806/Agnes-Code | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| kei-mcp | 1.6.0 | load | Error: API key required. Use --api-key or set KEI_API_KEY environment variable. |
| kilo-opencode-command-code | 1.2.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| kravchenski/switchyard | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| libclaw | 0.1.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| llisa | 1.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| local-knowledge-graph | 1.14.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| magpie-alysis-code | 0.1.16 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| magpie-amd-cloud | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| magpie-ducoro | 0.4.10 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| magpie-gemini-web | 0.15.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| magpie-kilo-auth | 0.5.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| magpie-lobsterai-auth | 0.2.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| magpie-marvis | 0.2.57 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| magpie-mira-relay | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| magpie-model-quota | 0.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| magpie-plugin-loomy-auth | 0.1.27 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| magpie-providers-hub | 0.13.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| mcpx-cli | 0.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| mem0-collector | 0.7.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| minoemem | 1.0.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| nimsuper | 0.3.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| oc-blackbytes | 0.8.7 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| oc-codex-multi-account | 1.0.20 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| officeace-auth | 0.3.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| oh-my-china | 1.1.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| oh-my-resume | 0.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| omo-recommend-models | 3.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| open-ralph-loop | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencarly | 1.0.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencheese-session-stats | 1.3.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-0-injection | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-adversary | 0.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-ag-auth | 1.6.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-agent-cpa-env-switcher-plugin | 0.2.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-agent-doctrine | 0.1.5 | load | error: unknown argument: --port |
| opencode-agentrouter-auth | 0.1.10 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-agents-local | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-agy | 0.15.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-aiway-auth | 1.0.22 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-annotate | 2.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — serve reports the plugin failed to load |
| opencode-anthropic-context-1m | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-anthropic-user-agent-plugin | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-antigravity-auth-remix | 1.5.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-antigravity-auth-tweaked | 1.9.7 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-antigravity-autopilot | 2.3.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-api | 1.0.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-api-node | 1.2.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-ascii | 0.1.8 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-ask-human | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-auto-continue | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-auto-shift | 0.5.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-avatar | 0.3.21 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-bgtask | 1.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-bonescript-backend | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-browser-control | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-byte | 1.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(SyntaxError: Export named 'Plugin' not found in module '/tmp/verify-d2IL8n/ |
| opencode-capture | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-capy | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-cau-maas-auth | 0.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-chorus | 0.10.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-claude-auth-custom | 1.0.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-cloakpipe | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-code-review | 1.0.9 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-codex-auth-rotation | 1.0.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-content-filter | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-continual-learning | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-copy-picker | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-deepseek-chan | 1.0.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-delegations-sidebar | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-devcontainers | 0.5.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-discuss | 0.7.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(ResolveMessage: Cannot find package '@opencode/ai' imported from /tmp/verif |
| opencode-discussion-agent | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-durable-goal | 0.1.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-env-protect | 0.3.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-epf | 0.3.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-feishu | 1.10.10 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-fleetview | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-flema-engram-sidebar | 0.4.6 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: Environment variable \"OPENTUI_FORCE_UNICODE\" is already registered |
| opencode-format-lint | 0.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-fs-ops | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-gateway | 0.8.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-gbuild | 0.13.1 | load | plugin half passed (load); skill payload failed: |
| opencode-gemini-cli-provider | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-gemini-subagent | 0.1.27 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: @opencode-ai/plugin not found. This plugin must be loaded from withi |
| opencode-gh-ci | 0.2.5 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-glm-clipboard | 2.2.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-go-monitor | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-google-search | 0.1.5 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-gpt-unlocked | 1.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-harness | 7.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-im-bridge | 0.46.0 | load | at error (/tmp/verify-pyx92I/u/cache/opencode/npm/opencode-im-bridge@0.46.0/1794819141586/node_modules/zod/v3/types.js:39:31) |
| opencode-itsuki | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-kimi-auth | 0.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-kunrouter-auth | 0.8.6 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-langgraph | 0.13.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-litellm-plugin | 1.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-local-provider | 0.1.8 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-mirasim-auth | 0.9.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-multi-llm | 0.1.9 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-muse | 1.1.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(MuseInvalidConfigError: muse does not advertise --contributor-mode; refusin |
| opencode-oauth | 0.4.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — serve reports the plugin failed to load |
| opencode-openai-sub-switcher | 1.0.7 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-plugin-codex-usage | 0.1.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(SyntaxError: Export named 'jsxDEV' not found in module '/tmp/verify-rXJuiA/ |
| opencode-plugin-question-force-close | 1.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: Environment variable \"OPENTUI_FORCE_WCWIDTH\" is already registered |
| opencode-proxy | 2.0.5 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-qoder-plugin | 0.2.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-session-metrics | 0.4.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(ResolveMessage: Cannot find package '@opentui/solid' imported from /tmp/ver |
| opencode-shell-guard | 1.3.8 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-sound-hooks | 1.1.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-tab-status | 1.1.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-tts-speak | 2.0.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-tui-image-clipboard-fix | 1.0.17 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-vision-paste | 0.3.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-windows-scheduler | 1.5.8 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(ResolveMessage: Cannot find package '@opencode-ai/plugin' imported from /tm |
| opencode-work-context | 0.9.0 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode-workspace-mailbox | 0.6.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| opencode2api-proxy | 1.2.2 | load | 930 \| } catch (error) { |
| P-Core-System/pcore-orchestra | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| patch-for-omo | 1.0.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| patchwarden | 1.7.2 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(Error: Invalid workspaceRoot: workspaceRoot cannot be user home directory ( |
| pi-cn-free-model-providers | 1.0.31 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Die(ResolveMessage: Cannot find package '@earendil-works/pi-coding-agent' impor |
| pi-opencode-go-provider | 1.1.60 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| rakumux | 0.1.61 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| relay-flow-plugin | 0.0.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| scnet-magpie | 1.0.3 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| shaagent | 0.3.5 | load | 插件入口疑似是 CLI 程序——宿主加载入口模块时顶层 program.parse() 吞掉宿主 argv（包把命令行工具当插件入口打包，真包缺陷） — error: unknown command 'serve' |
| spotme | 1.2.4 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| suvadu-opencode-hook | 0.1.1 | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| swarm-code | 0.1.24 | load | --- stream tail --- timestamp=2026-11-16T13:20:49.174Z level=INFO run=ecf59573 message="cli starting" version=2.3.0 channel=latest local=false args="[\"plugin\" |
| yanamianna0501/antigravity-acp-auth | — | load | 插件模块无法被宿主加载（初始化抛错或导出不符契约——常见于未适配当前 opencode 版本） — failed to load plugin — Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id |
| @phux/opencode | 0.10.0 | render | gui setup: Cannot read properties of undefined (reading 'finally') |
| @rizal72/oc-git | 0.2.3 | render | gui setup: Unknown error (cause: Cannot read properties of undefined (reading 'catch')) |
| context-rollover | 0.1.14 | render | gui setup: setup() registered no contributions |
| opencode-activity-indicator | 0.1.0 | render | gui whitelist: module not in gui host whitelist: electron |
| opencode-control-surfbird-for-kitesurf | 0.6.0 | render | gui whitelist: module not in gui host whitelist: node:fs/promises |
| opencode-loop-recover | 0.2.4 | render | gui whitelist: module not in gui host whitelist: node:fs/promises |
| opencode-navigator | 0.27.8 | render | gui whitelist: module not in gui host whitelist: node:crypto |
| opencode-quota-gui | 1.3.1 | render | gui setup: setup() registered no contributions |
| opencode-remote-desktop | 0.2.4 | render | gui render: Panel.render component mount threw: Unknown error (cause: screen is not defined) |
| opencode-voice-dictation | 0.14.0 | render | gui whitelist: module not in gui host whitelist: node:child_process |
| adriansoriacastellano/hitl-analytics-team | — | structure | 63f56866139f7c87ddf38b29b/.agents/skills/skill_build_marts_layer/SKILL.md, hitl-analytics-team-e529082c885d23863f56866139f7c87ddf38b29b/.agents/skills/skill_bui |
| agisota/old-one | — | structure | (无日志摘录) |
| ashikonik/skills-library-mcp | — | structure | (无日志摘录) |
| benbrastmckie/nvim | — | structure | (无日志摘录) |
| bthavanish/demiurge | — | structure | no parseable SKILL.md frontmatter in bthavanish/demiurge#3bd448bb56d7cee99fbbf9eea35991446e3286fd (checked 12: demiurge-3bd448bb56d7cee99fbbf9eea35991446e3286fd |
| Burnsedia/Django-Agent | — | structure | no SKILL.md in Burnsedia/Django-Agent#368c4440d80910de6b819bf7fe21c2ff7f4afcc9 tarball |
| dilanrojas/dotfiles | — | structure | (无日志摘录) |
| madeinorbit/podium | — | structure | (无日志摘录) |
| motusakapeppo/opencode-skill-assemblea-complessa | — | structure | no parseable SKILL.md frontmatter in motusakapeppo/opencode-skill-assemblea-complessa#f28c42476f8fdfb6aa0746eb6ce8188c18a81cac (checked 1: opencode-skill-assemb |
| openchamber/openchamber | — | structure | (无日志摘录) |
| Ricky06202/nixdots | — | structure | (无日志摘录) |
| schizo16/opencode-skillforge | — | structure | no parseable SKILL.md frontmatter in schizo16/opencode-skillforge#e1c09c427843a693b62bb0d8e1106952f15d2e10 (checked 3: opencode-skillforge-e1c09c427843a693b62bb |
| UiPath/coder_eval | — | structure | no parseable SKILL.md frontmatter in UiPath/coder_eval#23677d320ea74819d51d098c71613789f5e5d870 (checked 6: coder_eval-23677d320ea74819d51d098c71613789f5e5d870/ |
| wangyufengsky/agent-workflow | — | structure | (无日志摘录) |
| zhitongblog/unterm | — | structure | (无日志摘录) |

## AI 判过但装不上
| 包 | 版本 |
|---|---|
| @agentapprove/opencode | 0.1.28 |
| @andy-toolforge/hermes-opencode-mcp-bridge | 0.1.6 |
| @bloodyeagle/megamemory | 2.6.3 |
| @ctliz/agent-intercom-opencode | 0.14.0 |
| @cultivx/codereach | 0.2.39 |
| @eamilos/cli | 1.8.3 |
| @forloop-cc/forloop-opencode-plugin-planner | 2.2.27 |
| @grinev/opencode-telegram-bot | 0.28.0 |
| @guru.prasath/model-opencode | 0.1.0 |
| @happycastle/opencode-litellm | 0.8.0 |
| @helldinhow/sdd-flow-opencode-plugin | 0.6.16 |
| @hung319/opencode-iflow-cli | 5.0.2 |
| @jack-yang/opencode-quota | 4.11.1 |
| @jeikeilim/tenet | 26.11.0 |
| @justmpm/agent-runner | 0.10.1 |
| @kevindevm/opencode-telegram-group-topics-bot | 0.19.0 |
| @kimchi-dev/opencode-kimchi | 1.0.6 |
| @kodizm/acp | 0.9.4 |
| @lawaty/lacode | 2.3.0-beta.8 |
| @mark_future_ai/opencode-buddy | 1.1.2 |
| @mcrescenzo/opencode-self-evolve | 0.1.2 |
| @mcrescenzo/opencode-workflows | 0.2.0 |
| @midfleet/agent | 0.4.67 |
| @mingzzz/ocx-wechat-control | 0.2.6 |
| @moxxy/plugin-provider-acp | 0.49.0 |
| @nano-step/oh-my-harness | 1.2.5 |
| @openviking/magpie-plugin | 0.2.2 |
| @paflopes/opencode-qwen-auth | 0.0.7 |
| @pathrule/opencode | 1.0.8 |
| @pdbr/opencode-plugin-langfuse | 2026.7.0 |
| @reasoning-router/opencode | 0.1.11 |
| @redivo/opencode | 1.2.2 |
| @scrylog/opencode-plugin | 0.9.1 |
| @ship-cli/opencode | 0.2.3 |
| @sk5s/opencode-db-minimize | 1.0.0 |
| @softprobe/opencode-plugin | 0.1.20 |
| @sunerpy/oh-my-openagent | 4.21.0 |
| @sunerpy/opencode-kiro-auth | 0.20.7 |
| @supanadit/morse-web | 0.29.0 |
| @telemetry-dev/opencode | 0.2.8 |
| @usful/opencode-multi-model-fallback | 0.4.2 |
| @vicoa/opencode | 0.2.1 |
| @whatcode-ai/sdk | 2.8.2 |
| @whatcode-ai/whatcode | 2.8.2 |
| @xeedio/prompt-plumber | 0.6.0 |
| @xesrevinu/opencode-context-shield | 0.1.1 |
| @xiaoqiong0v0/opencode-browser-tool | 1.15.0 |
| @y00njinuk/opencode-claude-auth | 2.2.6 |
| 00bx-photoshop-mcp | 1.1.2 |
| 199084/opencode-relay-pool | — |
| 1cyberlangke1/my-opencode-toolkit | — |
| 4nkitd/opencode-workspace-sidebar | — |
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
| agirahman/righthand | — |
| agyforclaude | 0.0.3 |
| aisubs | 0.4.1 |
| ambystechcom/AmbyKit | — |
| ameshkov/opencode-sdd | — |
| aminammar1/ai-persona | — |
| anaskhan96/opencode-plugin-codex-usage | — |
| anti-ghostsec/AnonCode | — |
| antick/skills | — |
| APLaS-Plus/opencode-autoguard | — |
| ArkFlame/FlameWM | — |
| artemy/semaphore | — |
| avivgerz-hue/ghost-qa | — |
| ayzitix/quanta | — |
| bbingz/scnet-auth | — |
| belambert/opencode-livetrace | — |
| best-radar/bradar-ECC | — |
| best-radar/bradar-ponytail | — |
| BharatCode-ai/bharatcode-desktop | — |
| bitIO/opencode-provider-balance | — |
| bsmnt | 0.26.1 |
| Builderstar/opencode-v1.18.21-custom-snapshot | — |
| chncaesar/opencode-plugin-memory | — |
| christiangalsterer/opencode-requesty-plugin | — |
| context-signals-mcp | 1.1.3 |
| copilothydra | 0.3.9 |
| cortex-agents | 5.0.1 |
| CultureDigitali/opencode-cron | — |
| drf-react-by-schema-agent-console | 0.0.2 |
| esafak/muninn | — |
| garikipatisai-code/sdlc-lean | — |
| gazacode | 2.0.2 |
| Gyl1219/magpie-providers-hub | — |
| hamzasoussi53/opencode-island | — |
| harness-mdocs | 2.2.0 |
| hc-teleport-agent | 0.3.0 |
| hiresquire-cli | 1.2.8 |
| iamironz/opencode-sessions-explorer | — |
| IgorGanapolsky/ThumbGate | — |
| ilahomesick/opencode-true-mem-v2 | — |
| jfrz38/opencode-wololo-notifications | — |
| jira-cli-agent | 0.2.0 |
| jn-s3s/opencode-tui-quota-usage | — |
| joe-broadhead/opencode-affinity | — |
| joe-broadhead/opencode-boxd | — |
| joe-broadhead/opencode-github | — |
| joe-broadhead/opencode-granola | — |
| joe-broadhead/opencode-history | — |
| joe-broadhead/opencode-notion | — |
| joe-broadhead/opencode-openrouter | — |
| juliantorr-es/rig-relay | — |
| Khip01/opencode-rich-presence | — |
| kimi-video-plugin | 1.0.7 |
| kraken-code | 1.6.0 |
| kunickiaj/codemem | — |
| lazyopencode-core | 0.0.4 |
| Looted/kibi | — |
| magpie-agy-acp | 0.1.12 |
| magpie-deeprelay | 0.1.0 |
| magpie-jmds | 0.1.4 |
| magpie-plugin-codar | 0.3.0 |
| magpie-scnet-auth | 0.1.5 |
| mcbedrock-mcp | 1.1.0 |
| mcp-jira-confluence | 3.1.3 |
| mcp-subagents-opencode | 1.2.5 |
| mdtracker | 1.4.1 |
| megallm | 3.1.0 |
| memory-dashboard-by-mkerkmeester | 0.0.3 |
| mike-zentarisystems/zentari-mac-dev-workstation | — |
| mimocode-mempalace | 0.3.4 |
| MisonL/magpie-plugin-msmoli | — |
| n8n-nodes-opencode | 1.0.0 |
| NekoYume517/opencode-xiaoyiwork-auth | — |
| novel-writer-english | 1.5.1 |
| oc-export | 0.3.3 |
| oc-nonstop-router | 1.0.1 |
| oc-ping | 0.0.3 |
| oc-plugin-goblin-mode | 0.1.0 |
| oc-sync | 0.1.18 |
| ocwatch | 0.6.0 |
| oh-my-groundcontrol | 0.0.1 |
| oh-my-research | 0.1.0 |
| omctest | 0.0.3 |
| omnirouter-helper | 0.3.0 |
| omo-suites | 1.17.0 |
| op-anthropic-auth | 0.1.4 |
| open-autopm | 3.6.11 |
| open-copilot-bridge | 0.1.0 |
| open-loom | 0.1.10 |
| opencode-1m-context | 0.1.12 |
| opencode-9router-plugin | 0.1.5 |
| opencode-9router-plus | 0.7.0 |
| opencode-account-manager | 0.6.9 |
| opencode-acm | 0.5.57 |
| opencode-agent-supervisor | 2.12.0 |
| opencode-agentic-engine | 0.5.12 |
| opencode-agentrouter-auth1 | 0.2.0-dev.2 |
| opencode-android-tdd | 0.1.0 |
| opencode-anthropic-cache | 1.0.0 |
| opencode-antigravity-auth-updated | 1.7.0 |
| opencode-antigravity-image | 0.3.0 |
| opencode-antigravity-multi-auth | 1.0.8 |
| opencode-antigravity-quota | 0.1.7 |
| opencode-aoe-sounds | 1.0.1 |
| opencode-artifacts-plugin | 0.3.0 |
| opencode-ast-grep | 0.1.1 |
| opencode-asyntai | 1.0.0 |
| opencode-auto-rename | 1.3.0 |
| opencode-auto-reviewer | 0.1.0 |
| opencode-auto-router | 0.1.4 |
| opencode-auto-vision-shawnie | 1.0.0 |
| opencode-autodiscover | 1.3.0 |
| opencode-autosave-conversation | 1.1.0 |
| opencode-autoskills | 1.2.0 |
| opencode-azure-setup | 1.1.4 |
| opencode-bark | 0.0.1 |
| opencode-baseline-hooks | 0.9.5 |
| opencode-bedrock-sso | 0.1.0 |
| opencode-block | 1.3.1 |
| opencode-brevity-plugin | 1.0.21 |
| opencode-business-flow-reviewer | 2.0.0 |
| opencode-ccs-sync | 0.0.1 |
| opencode-chrome-annotation | 1.0.4 |
| opencode-claude-tailguard | 0.1.0 |
| opencode-cline-mode | 2.1.0 |
| opencode-cliproxy-provider | 1.1.2 |
| opencode-cliproxyapi | 0.1.2 |
| opencode-cliproxyapi-sync | 1.5.0 |
| opencode-cloudflare-image | 2.0.0 |
| opencode-cmux-gc | 0.2.1 |
| opencode-cn | 1.2.27 |
| opencode-code-archaeology | 2.16.11 |
| opencode-code-simplifier | 1.5.0 |
| opencode-codebuddy-external-auth | 1.0.28 |
| opencode-codex-bridge | 0.1.0 |
| opencode-computer-use-win | 0.1.3 |
| opencode-config-cli | 1.2.0 |
| opencode-context-warning | 0.1.0 |
| opencode-copilot-1m | 1.10.0 |
| opencode-copilot-account-switcher | 1.0.0 |
| opencode-crof-sidebar | 0.1.2 |
| opencode-crs-bedrock | 2.0.0 |
| opencode-datalens-harness | 0.1.0 |
| opencode-daytona | 0.1.1 |
| opencode-deadline-pressure | 0.2.0 |
| opencode-debug-helper | 0.1.2 |
| opencode-diane | 0.0.10 |
| opencode-discord-bot | 0.3.1 |
| opencode-discord-presence | 0.7.2 |
| opencode-discord-rpc | 1.0.1 |
| opencode-done-notify | 1.0.0 |
| opencode-drawer-cadence | 1.6.0 |
| opencode-engram | 0.1.2 |
| opencode-event-debug | 1.0.0 |
| opencode-evomap-bridge | 0.2.0 |
| opencode-fallback | 1.2.0 |
| opencode-fast-apply | 2.2.3 |
| opencode-fff-search | 0.8.0 |
| opencode-forgekeeper | 4.0.1 |
| opencode-free-vision-proxy | 0.1.1 |
| opencode-gemini-business | 2.3.0 |
| opencode-gemini-cli-oauth | 1.3.0 |
| opencode-gemini-image | 1.0.4 |
| opencode-gemini-proxy | 1.1.0 |
| opencode-generative-ui | 0.1.5 |
| opencode-ghostty-notify | 1.0.0 |
| opencode-gitbutler | 0.1.11 |
| opencode-github-copilot-auto-model | 0.2.0 |
| opencode-gliner-prune | 0.1.5 |
| opencode-go-usage | 1.0.5 |
| opencode-godot-lsp | 1.0.1 |
| opencode-godot-toolkit | 1.1.0 |
| opencode-graphiti | 0.2.4 |
| opencode-hapticfeedback-mx4 | 0.0.1 |
| opencode-hybrid-search | 0.1.1 |
| opencode-hypr-notifier | 1.1.0 |
| opencode-idarouter-provider | 0.1.0 |
| opencode-idle-workspace-reaper | 0.1.1 |
| opencode-island | 0.8.0 |
| opencode-isolate | 0.1.0 |
| opencode-jinguobyte-adapter | 1.0.0 |
| opencode-k8s-workspaces | 0.1.1 |
| opencode-kickbacks | 0.1.1 |
| opencode-kiro-multi-auth | 1.1.1 |
| opencode-lcm | 0.15.1 |
| opencode-links | 0.1.1 |
| opencode-live-skills | 0.0.2 |
| opencode-loader | 1.13.0 |
| opencode-loamlog | 0.2.3 |
| opencode-local-ollama | 0.1.0 |
| opencode-lookout | 0.1.3 |
| opencode-lore | 0.40.0 |
| opencode-mad | 1.1.0 |
| opencode-mailbox | 0.0.13 |
| opencode-memex | 1.0.0 |
| opencode-memory-pro | 1.6.2 |
| opencode-messages | 0.1.1 |
| opencode-mimikkai-connect | 1.0.3 |
| opencode-model-fallback-chain | 1.0.1 |
| opencode-model-scorecard | 0.1.1 |
| opencode-model-toggle | 1.0.1 |
| opencode-model-updater | 1.3.0 |
| opencode-models-discovery-v2 | 0.0.7 |
| opencode-models-discovery-wz | 0.8.1 |
| opencode-morph-rotation | 0.1.0 |
| opencode-multi-model | 0.2.2 |
| opencode-multisession | 0.3.0 |
| opencode-notify-macos | 0.0.2 |
| opencode-notify-me | 1.0.1 |
| opencode-novel-plugin | 1.1.1 |
| opencode-novel-tools | 0.1.0 |
| opencode-ntfs-glob-plugin | 0.1.0 |
| opencode-ntfy-with-questions | 0.2.1 |
| opencode-obsidian | 1.1.3 |
| opencode-ocsm | 1.0.1 |
| opencode-ollama-router | 1.0.1 |
| opencode-omni | 0.0.1 |
| opencode-omni-memory-plugin | 2.0.1 |
| opencode-openai-codex-shuv | 4.4.1 |
| opencode-openai-compatible | 1.0.9 |
| opencode-openai-multi-auth | 5.0.6 |
| opencode-openai-profiles | 0.1.5 |
| opencode-openrouter-auth-broker-plugin | 0.2.2 |
| opencode-osc9 | 0.1.1 |
| opencode-otel-plugin | 0.11.2 |
| opencode-paper2code | 0.1.2 |
| opencode-paste-as-file | 0.1.1 |
| opencode-permission-audit | 0.1.0 |
| opencode-permission-log | 1.0.0 |
| opencode-permission-notify | 0.1.1 |
| opencode-personal-knowledge | 1.0.10 |
| opencode-pilot | 0.29.3 |
| opencode-pingme | 1.0.1 |
| opencode-plugin-advisor | 0.1.1 |
| opencode-plugin-always-questions | 1.0.0 |
| opencode-plugin-ast-lsp | 0.0.6 |
| opencode-plugin-brain | 0.1.0 |
| opencode-plugin-code-context | 0.1.1 |
| opencode-plugin-commander | 0.1.4 |
| opencode-plugin-docs | 0.1.1 |
| opencode-plugin-gitea | 0.3.3 |
| opencode-plugin-hive | 0.1.4 |
| opencode-plugin-hub | 0.6.6 |
| opencode-plugin-image-attachment | 1.0.0 |
| opencode-plugin-imoveis | 0.1.0 |
| opencode-plugin-inspector | 0.0.7 |
| opencode-plugin-mercado | 0.1.0 |
| opencode-plugin-neuron | 0.2.2 |
| opencode-plugin-notification | 0.0.5 |
| opencode-plugin-updates | 1.2.0 |
| opencode-powerpack | 2.0.0 |
| opencode-project | 1.17.2 |
| opencode-project-memory | 0.1.0 |
| opencode-promemory-4861 | 0.6.10 |
| opencode-prompt-enhancer-translator | 3.2.0 |
| opencode-prompt-guard | 1.0.1 |
| opencode-prompt-rail | 0.1.9 |
| opencode-prompt-recorder | 1.9.9 |
| opencode-prompt-tracker | 1.0.0 |
| opencode-provider-litellm | 0.10.0 |
| opencode-proxy-inject | 0.1.0 |
| opencode-qwen-auth-plugin | 0.1.4 |
| opencode-rag | 1.1.0 |
| opencode-ralph-wiggum | 1.0.0 |
| opencode-rate-limit-fallback | 0.3.1 |
| opencode-recall | 0.1.0 |
| opencode-redstone | 1.1.5 |
| opencode-reminders | 1.0.1 |
| opencode-repos | 0.4.3 |
| opencode-requesty-models | 0.1.9 |
| opencode-review-helper | 0.3.1 |
| opencode-ricks | 0.1.0 |
| opencode-rive-sidebar | 0.1.0 |
| opencode-roundtable | 0.3.1 |
| opencode-rtk | 0.0.1 |
| opencode-rules-hub | 1.0.0 |
| opencode-rules-md | 0.12.0 |
| opencode-say | 1.0.0 |
| opencode-sdd | 1.5.0 |
| opencode-sdlc-plugin | 1.1.4 |
| opencode-session-backup | 1.3.0 |
| opencode-sessions | 1.0.0 |
| opencode-shell-safety | 0.7.0 |
| opencode-shell-tasks | 0.1.1 |
| opencode-skill-distiller | 0.2.0 |
| opencode-skill-finder | 2.2.1 |
| opencode-skill-hush | 0.1.0 |
| opencode-skilld | 1.0.1 |
| opencode-skills-hub | 0.0.5 |
| opencode-slim-mcp | 1.0.0 |
| opencode-sonar-fix | 0.1.0 |
| opencode-sound-alert | 1.0.0 |
| opencode-speaker | 1.0.7 |
| opencode-sprintable | 0.1.0 |
| opencode-ssh-logger | 0.1.7 |
| opencode-stability-guard | 0.2.7 |
| opencode-starcraft | 1.0.3 |
| opencode-status-ball | 0.1.0 |
| opencode-stream-rules | 0.1.1 |
| opencode-strip-empty-params-plugin | 0.1.1 |
| opencode-stt | 0.1.0 |
| opencode-subagent-completion-hook | 0.2.0 |
| opencode-subagent-delegate | 1.2.5 |
| opencode-svip-proxy | 0.3.0 |
| opencode-swisscomgpt | 1.0.2 |
| opencode-switchback | 2026.11.5 |
| opencode-symbolic-executor | 0.10.8 |
| opencode-tailscale | 0.0.6 |
| opencode-task-result-guard | 0.1.2 |
| opencode-task-utils | 1.2.1 |
| opencode-taskflow | 1.0.0 |
| opencode-teams | 0.1.0 |
| opencode-telegram-bot | 1.1.2 |
| opencode-telegram-group-topics-bot | 0.17.0 |
| opencode-telegram-plugin | 0.1.0 |
| opencode-temporal-context | 0.1.0 |
| opencode-tianji | 0.6.0 |
| opencode-timeout-auto-reject | 0.1.0 |
| opencode-title-gen | 0.2.0 |
| opencode-tmux | 0.1.0 |
| opencode-tmux-status | 0.1.0 |
| opencode-to-atif-traces | 0.0.2 |
| opencode-token-min | 1.0.3 |
| opencode-topic-compaction | 0.1.0 |
| opencode-trae-cli-auth | 0.1.4 |
| opencode-tsindex-guidance | 0.2.2 |
| opencode-tss | 1.1.0 |
| opencode-tts | 2.0.0 |
| opencode-tui-utils | 1.3.0 |
| opencode-tuicr-plugin | 0.1.1 |
| opencode-turn-stats | 1.0.0 |
| opencode-usage-checker | 0.0.3 |
| opencode-usage-plugin | 0.0.2 |
| opencode-v2-tui-closetab | 0.1.0 |
| opencode-vcc | 0.1.0-alpha.1 |
| opencode-verify-subagent-plugin | 1.0.0 |
| opencode-vibe-webhook | 1.0.3 |
| opencode-vibeplan | 0.2.0 |
| opencode-vise | 0.1.0 |
| opencode-vision-bridge | 0.2.1 |
| opencode-vision-fallback | 0.1.1 |
| opencode-vision-plugin | 1.0.7 |
| opencode-voice2text | 0.1.21 |
| opencode-web-deepsearch | 1.0.14 |
| opencode-web-plugin | 0.1.1 |
| opencode-web-preview | 0.1.0 |
| opencode-websearch-cited-fork | 2.0.4 |
| opencode-wechat-bot | 1.6.2 |
| opencode-windsurf-codeium | 0.1.38 |
| opencode-with-ads | 1.0.1 |
| opencode-woclaw | 0.1.0 |
| opencode-workaholic | 0.4.0 |
| opencode-workbench | 0.3.2 |
| opencode-worklog | 0.0.2 |
| opencode-worktrunk-workspaces | 0.1.0 |
| opencode-wrap | 0.3.0 |
| opencode-write-status | 0.5.0 |
| opencode-xai-oauth | 1.2.0 |
| opencode-yolo-toggle | 0.1.0 |
| opencode-zellij-agent-comm | 0.1.0 |
| opencode-zellij-namer | 1.1.3 |
| opencode-zellij-renamer | 1.1.0 |
| opencode-zellij-tab-status | 1.0.1 |
| opencode-zh-desktop | 0.2.2 |
| opencode-zh-plugin | 0.1.7 |
| opencode-zoekt-code-search | 0.2.1 |
| opencode2-shell-tasks | 0.1.1 |
| opencode2-tps2 | 0.1.0 |
| opencode2-vision-relay | 0.2.2 |
| opencommand-plugin | 0.0.29 |
| opencub | 0.1.0 |
| opendevbrowser | 0.0.40 |
| openducky | 1.0.1 |
| openeuler-agent-shennong-crash-online | 0.10.4 |
| openpaul | 1.0.0 |
| openpets-sdk | 1.3.3 |
| openprototype | 1.8.4 |
| openrouter-genimage-kote-opencode | 0.1.0 |
| opentower | 0.4.5 |
| oxdingzg/miao | — |
| pandora-tui | 0.3.1 |
| ParadevAI/Paradev | — |
| pasei-dev/opencode-profile-switcher | — |
| phlight | 0.2.15 |
| pi-opencodego | 0.1.5 |
| pixincreate/opencode-global-sessions | — |
| po-po-code | 0.9.6 |
| popopen | 1.4.0 |
| portainer-mcp-server | 1.0.0 |
| pretty-aui | 0.1.0-rc.1 |
| project-knowledge | 4.6.1 |
| pty-auto | 0.3.6 |
| pulsecloud-mcp | 1.0.30 |
| Realmagnum/opencode-session-timestamps | — |
| reflexkit | 0.1.0 |
| rhmcp | 1.1.1 |
| rig-opencode | 0.1.1 |
| rjstone/opencode-plugin-template | — |
| rsih-opencode | 0.2.0-preview.2 |
| rynfar/meridian | — |
| SaberOnGo/public-domain-books-translation | — |
| scionwood | 0.1.0 |
| seeya-mcp | 0.1.3 |
| seniormode | 0.1.1 |
| skelm | 0.4.8 |
| skill-author | 1.1.0 |
| slipway-agents | 0.17.0 |
| sofa-opencode | 0.1.0 |
| solidity-argus | 0.7.0 |
| solomemory-ai/opencode-solomemory | — |
| spec-and-loop | 3.3.7 |
| specifica-br | 1.12.2 |
| super-memory-pro | 2.0.0 |
| tobias-weiss-ai-xr/opencode-saia-plugin | — |
| WhiteHades/metldr | — |
| YKLovePython/halfsize | — |
| YonCZ/OpenCode-Presence | — |
| yuhp/opencode-models-discovery | — |

> 数据源：catalog 分支 index.json + ai-verdicts.jsonl（governing concern 判词 reason 以 装测失败 开头的目标；另含 ai:pass + verify:failed 目标）。
> 对应历史 issue：closed issues label:concern:verify / label:ai:pass → https://github.com/awesome-market/awesome-opencode-market/issues?q=is%3Aissue+label%3Aconcern%3Averify
