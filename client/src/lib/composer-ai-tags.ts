export type AiProviderTag = "chatgpt" | "grok";

const LEADING_TAG_REGEX = /^@(chatgpt|grok)\b/i;

function normalizeProvider(provider: AiProviderTag): AiProviderTag {
  return provider.toLowerCase() as AiProviderTag;
}

function dedupeTags(tags: AiProviderTag[]): AiProviderTag[] {
  const seen = new Set<AiProviderTag>();
  const unique: AiProviderTag[] = [];
  for (const tag of tags) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    unique.push(tag);
  }
  return unique;
}

function composeLeadingTags(tags: AiProviderTag[], rest: string): string {
  const prefix = tags.map((tag) => `@${tag}`).join(" ");
  if (!prefix) return rest;
  if (!rest) return `${prefix} `;
  return `${prefix} ${rest}`;
}

export function extractLeadingAiTags(text: string): { tags: AiProviderTag[]; rest: string } {
  let cursor = 0;
  const tags: AiProviderTag[] = [];

  while (cursor < text.length) {
    while (cursor < text.length && /\s/.test(text[cursor] || "")) {
      cursor += 1;
    }

    const match = LEADING_TAG_REGEX.exec(text.slice(cursor));
    if (!match) break;

    tags.push(normalizeProvider(match[1] as AiProviderTag));
    cursor += match[0].length;
  }

  const rest = text.slice(cursor).replace(/^\s+/, "");
  return {
    tags: dedupeTags(tags),
    rest,
  };
}

export function hasLeadingAiTag(text: string, provider: AiProviderTag): boolean {
  const normalizedProvider = normalizeProvider(provider);
  return extractLeadingAiTags(text).tags.includes(normalizedProvider);
}

export function toggleLeadingAiTag(text: string, provider: AiProviderTag): string {
  const normalizedProvider = normalizeProvider(provider);
  const { tags, rest } = extractLeadingAiTags(text);
  const nextTags = tags.includes(normalizedProvider)
    ? tags.filter((tag) => tag !== normalizedProvider)
    : [...tags, normalizedProvider];

  return composeLeadingTags(nextTags, rest);
}
