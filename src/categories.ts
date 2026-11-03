/** Keyword category classifier — assigns display categories at ingestion time.
 *  Client-side plugins/market keeps an identical fallback for old entries. */
const CAT_RULES: [string, RegExp][] = [
  ['主题与外观', /theme|color|icon|font|appearance|ui-|css|style/i],
  ['模型与接入', /model|provider|llm|gpt|claude|deepseek|ollama|api[-_ ]key|pricing|token|usage|cost|billing/i],
  ['会话与消息', /session|chat|conversation|message|history|compaction|context/i],
  ['记忆', /memory|remember|recall|knowledge|note|persist/i],
  ['通知', /notif|alert|toast|sound|remind|bell/i],
  ['安全与权限', /secur|guard|permission|policy|audit|sandbox|auth|firewall|protect/i],
  ['开发流程', /git|commit|review|test|lint|ci|deploy|release|debug|refactor|scaffold|spec/i],
  ['工具与能力', /tool|command|search|fetch|browse|file|terminal|shell|exec|agent|skill|mcp/i],
  ['集成与移动', /integrat|qq|wechat|slack|discord|telegram|feishu|mobile|remote|browser|chrome/i],
]
export function classify(name: string, slug: string, descEn: string, extra: readonly string[] = []): string[] {
  const hay = `${name} ${slug} ${descEn} ${extra.join(' ')}`
  const hits = CAT_RULES.filter(([, r]) => r.test(hay)).map(([c]) => c)
  return hits.length ? hits.slice(0, 2) : ['其他']
}
