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
