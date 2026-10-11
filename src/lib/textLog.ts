import { textLogDedupeKey } from "@/shared/text";

export function appendTextLog(items: string[], text: string, limit: number): string[] {
  const key = textLogDedupeKey(text);
  if (!key) return items;

  const seen = new Set(items.map(textLogDedupeKey));
  if (seen.has(key)) return items;

  return [...items, text].slice(-limit);
}
