# 卡点验证状态（随 spike 推进更新）

## Spike #1（run 41347141082）关键发现

**装错了版本**：`bun install -g opencode-ai` 装到的是 **v1.19.5**（旧 CLI），不是 v2.2.5。
v1 的 `plugin` 命令语义不同：`opencode plugin <module>` 把参数当包名装——
我们的 `plugin list` 实际装了一个叫 "list" 的 npm 包（日志可见 "Added to ./.opencode/opencode.json"）。
**v2 CLI 是 `@opencode/cli` 包**（amplifying.ai 文档佐证：v1=opencode-ai，v2=@opencode/cli）。

附带发现：v1 `plugin add` 默认写到**项目级** `.opencode/opencode.json`，`-g` 才写全局——
这对隔离装测是好事：装测可以完全关在临时目录里，不碰真实 HOME。

| # | 卡点 | 状态 | 证据 |
|---|---|---|---|
| A1 | 无头启动需 provider/auth | 🟡 | v1 plugin add 无 server 也能写 config；server 启动验证待 v2 重测 |
| A2 | plugin add 在 CI 行为 | 🟡 | 非交互可用；file:// 未验（v1 只认 npm/Git specifier，v2 待测） |
| A3 | canary 激活信号 | ⬜ | v1 无 `plugin list` 子命令；待 v2 重测 |
| A4 | SDK 包名 | ✅ | `@opencode/plugin`（loop-recover peerDep 实证） |
| A5 | bun postinstall | ⬜ | 待 v2 沙箱测 |
| **新 A6** | **CI 装对 v2 二进制** | 🔴→需修 | `opencode-ai`=v1；v2 需 `@opencode/cli` 或官方安装脚本 |

下一步：改用 v2 安装方式重跑 spike。

## Spike #3 发现
- 官方安装脚本 `opencode.ai/install` 默认也装 **v1.19.5**——v2 是独立轨道
- 下一步试 `npm i -g @opencode/cli`（npm 默认放行 postinstall，bun 才拦）

## Spike #4（run 41347715406）——P0 基本判定通过

✅ **A1**：`plugin add` 无 provider/auth 也能跑（v2 装好即用）
✅ **A2**：`plugin add` 非交互可用；但 **file:// 不支持**——"must be an npm registry package or Git specifier"。负样本改用假 npm 名或 git 源
✅ **A4**：`@opencode/plugin` 确认
✅ **A5**：bun 默认拦 postinstall（`@opencode/cli` 在 bun 下装失败实证）——npm i -g 才放行
✅ **A6（新增）**：v2 正确装法 = `npm i -g @opencode/cli`（v2.2.5）；官方 install 脚本和 `bun i -g opencode-ai` 都装 v1.19.5

🟡 **残留**：
- `plugin list` 报 "No plugins found" 但 add 明明成功——add 写到 `~/.config/opencode/opencode.json`，说明隔离要用 `XDG_CONFIG_HOME` 不是 `HOME`（下一轮验证）
- 真激活信号：add 只写 config+装包，"插件是否真被加载"还需 server 启动观测——canary 路径 b/c 待验
- file:// 不支持 → 负样本 fixture 策略改：用不存在的 npm 名 / git specifier 或本地起 registry stub

**P0 初步结论：可行**——v2 在 CI 能装、能 add 插件、无需凭据；剩余是信号细节不是可行性问题。
