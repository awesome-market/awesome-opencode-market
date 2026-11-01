# 卡点验证状态（随 spike 推进更新）

| # | 卡点 | 状态 | 证据 |
|---|---|---|---|
| A1 | 无头启动需 provider/auth | 🟡 部分 | `plugin list` 在空 HOME 无 server 时会挂起等待（说明 CLI 默认找运行中 server，CI 需 `--standalone` 或先起服务） |
| A2 | plugin add 在 CI 行为 | 🟡 部分 | add 子命令非交互、接受 "npm or Git package specifier"；file:// 支持未验（本地路径传参待测） |
| A3 | canary 激活信号 | ⬜ 未验 | 待 spike：plugin list / 日志 marker / hook 调用三案 |
| A4 | SDK 包名 | ✅ 已解 | `@opencode/plugin`（opencode-loop-recover peerDep 实证） |
| A5 | bun 是否执行 postinstall | ⬜ 未验 | 待 CI 沙箱验证 |
| B1-B4 | 数据卡点 | ⬜ 待 P1 | — |
