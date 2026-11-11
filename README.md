# OpenCode Market

[中文说明](https://github.com/awesome-market/awesome-opencode-market/blob/main/README.zh.md)

[![npm](https://img.shields.io/npm/v/awesome-opencode-market)](https://www.npmjs.com/package/awesome-opencode-market)
[![license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/awesome-market/awesome-opencode-market/blob/main/LICENSE)

Find plugins and skills for OpenCode, see what they do and whether they have
been tested, and install them without leaving the app.

![OpenCode Market panel](https://raw.githubusercontent.com/awesome-market/awesome-opencode-market/main/docs/market-panel.png)

## Why this exists

OpenCode has a large plugin ecosystem but no built-in marketplace. Community
lists help, but they are maintained by hand and mostly tell you a plugin exists
— not whether it installs or what it does to your setup.

Market's catalog is generated, not curated by hand: entries are discovered,
scanned, and test-installed where possible, so a listing carries actual check
results instead of a copied description.

## Get started

```bash
opencode plugin add awesome-opencode-market
```

Then open the **Market** panel (GUI) or the Market view in the TUI.

## What you get

- **Browse and search** the catalog — filter by category and by which OpenCode
  features a plugin uses
- **Check labels** — `verified`, `failed`, `skipped`, `unverified`, each spelled
  out in plain words before you install
- **One-click install and update** — including an Update All for everything
  that has a newer approved version
- **Skills** — discover and install skills alongside plugins
- **Bilingual** — English and 中文, remembered between sessions

## Choose with more confidence

Each listing shows useful details before you install: what the extension is
for, which OpenCode areas it uses, and whether it has been tested. If an
extension hasn't been tested, the listing says so. A check is useful
information, not a guarantee that software is safe.

The catalog is regenerated regularly, so you can discover new and updated
extensions without relying on a manually maintained list.

## The catalog is also data

The same catalog feeds the Market panel, the TUI, and the website — one source
behind every surface:

- Machine-readable index:
  `https://terry2010.github.io/awesome-opencode-market/index.json`
- Skill file catalog:
  `https://terry2010.github.io/awesome-opencode-market/skills/`
- [Browse the catalog on the web](https://terry2010.github.io/awesome-opencode-market/)
- [Daily digest](https://github.com/terry2010/awesome-opencode-market/tree/catalog/digest)
  — the announcement surface: every version about to be released is posted
  here first, so objections can land before it ships

The index URL is the only data-plane endpoint the client needs. Point it at a
mirror or a private catalog via the plugin's `indexUrl` option or the
`OPENCODE_MARKET_INDEX` env var.

## Suggest a plugin or skill

[Send a suggestion](https://github.com/terry2010/awesome-opencode-market/issues/new?template=submission.yml)
— submissions go through the same scan and test-install pipeline as everything
else before they appear in the catalog.

[Source code and project details](https://github.com/awesome-market/awesome-opencode-market) ·
[MIT license](https://github.com/awesome-market/awesome-opencode-market/blob/main/LICENSE)
