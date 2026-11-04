/** Keyword category classifier — assigns display categories at ingestion time.
 *  Category values are stable ENGLISH ids; localized display names live in
 *  CAT_NAMES and flow into the index `categories` dict ({en, zh}).
 *  Client-side plugins/market keeps an identical fallback for old entries. */

export const CAT_NAMES: Record<string, { en: string; zh: string }> = {
  appearance: { en: 'appearance', zh: '主题与外观' },
  models: { en: 'models & providers', zh: '模型与接入' },
  sessions: { en: 'sessions', zh: '会话与消息' },
  memory: { en: 'memory', zh: '记忆' },
  notifications: { en: 'notifications', zh: '通知' },
  security: { en: 'security & permissions', zh: '安全与权限' },
  workflow: { en: 'dev workflow', zh: '开发流程' },
  tools: { en: 'tools & capabilities', zh: '工具与能力' },
  integrations: { en: 'integrations', zh: '集成与移动' },
  other: { en: 'other', zh: '其他' },
}

/** Legacy zh display names → ids — old catalog data + old submissions carry
 *  the pre-id values; normalize at merge/render boundaries. */
const ZH_TO_ID: Record<string, string> = Object.fromEntries(
  Object.entries(CAT_NAMES).map(([id, d]) => [d.zh, id]))

export function catId(c: string): string {
  return CAT_NAMES[c] ? c : (ZH_TO_ID[c] ?? c)
}

const CAT_RULES: [string, RegExp][] = [
  ['appearance', /theme|color|icon|font|appearance|ui-|css|style/i],
  ['models', /model|provider|llm|gpt|claude|deepseek|ollama|api[-_ ]key|pricing|token|usage|cost|billing/i],
  ['sessions', /session|chat|conversation|message|history|compaction|context/i],
  ['memory', /memory|remember|recall|knowledge|note|persist/i],
  ['notifications', /notif|alert|toast|sound|remind|bell/i],
  ['security', /secur|guard|permission|policy|audit|sandbox|auth|firewall|protect/i],
  ['workflow', /git|commit|review|test|lint|ci|deploy|release|debug|refactor|scaffold|spec|project|template|starter|suite|kit|workflow|task[-_ ]?runner/i],
  ['tools', /tool|command|search|fetch|browse|file|terminal|shell|exec|agent|skill|mcp|manage|track|monitor|watch|dashboard|status|quota|limit|metric/i],
  ['integrations', /integrat|qq|wechat|slack|discord|telegram|feishu|mobile|remote|browser|chrome/i],
]
export function classify(name: string, slug: string, descEn: string, extra: readonly string[] = []): string[] {
  const hay = `${name} ${slug} ${descEn} ${extra.join(' ')}`
  const hits = CAT_RULES.filter(([, r]) => r.test(hay)).map(([c]) => c)
  return hits.length ? hits.slice(0, 2) : ['other']
}
