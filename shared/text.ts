export function textLogDedupeKey(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}
