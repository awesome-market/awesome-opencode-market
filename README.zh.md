# OpenCode Market

[Read in English](https://github.com/awesome-market/awesome-opencode-market/blob/main/README.md)

在 OpenCode 里发现插件和技能，先了解它们的用途和测试情况，再直接安装。

![OpenCode Market 面板](https://raw.githubusercontent.com/awesome-market/awesome-opencode-market/main/docs/market-panel.png)

## 为什么做这个

OpenCode 的插件生态很大，但没有内置的应用市场。社区列表靠手工维护，大
多只能告诉你某个插件存在——没法告诉你它能不能装上、会影响什么。

Market 的目录是自动生成的，不靠人工维护：条目经过发现、扫描，有条件的
还会做实测安装，所以你看到的不是抄来的简介，而是实际的检查结果。

## 开始使用

```bash
opencode plugin add awesome-opencode-market
```

随后打开 OpenCode 的 **Market** 面板（GUI)，或在 TUI 里打开 Market 视图。

## 能看到什么

- **浏览和搜索**完整目录——按分类、按插件用到的 OpenCode 功能筛选
- **检查标签**——`verified` / `failed` / `skipped` / `unverified`，安装前
  用大白话说明含义
- **一键安装和更新**——包括把所有有新版可装的插件一次更新完
- **技能**——插件之外也能发现和安装技能
- **双语**——中文和 English，选择会被记住

## 安装前多了解一点

每个条目会展示用途、使用 OpenCode 的哪些功能，以及是否经过测试。尚未测
试的条目会明确标注。测试结果可以帮助了解情况，但不代表软件一定安全。

目录会定期重新生成，方便发现新扩展和已有扩展的更新。

## 目录本身也是数据

Market 面板、TUI 和网站读的是同一份目录——所有界面背后同一个数据源：

- 机器可读的索引：
  `https://awesome-market.github.io/awesome-opencode-market/index.json`
- 技能文件目录：
  `https://awesome-market.github.io/awesome-opencode-market/skills/`
- [在网页上浏览目录](https://awesome-market.github.io/awesome-opencode-market/)
- [每日日报](https://github.com/awesome-market/awesome-opencode-market/tree/catalog/digest)
  ——上架预告面：每个将放行的版本先在这里公示，异议可在放行前提出

## 推荐插件或技能

[提交推荐](https://github.com/awesome-market/awesome-opencode-market/issues/new?template=submission.yml)
——投稿和其他条目一样，要先过扫描和实测安装，才会出现在目录里。

[项目源码与详情](https://github.com/awesome-market/awesome-opencode-market) ·
[MIT 许可证](https://github.com/awesome-market/awesome-opencode-market/blob/main/LICENSE)
