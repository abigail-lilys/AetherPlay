export interface ModifierState {
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

export interface NormalizedKeyChord extends ModifierState {
  code?: string;
  label: string;
}

export function exactModifierMatch(
  event: ModifierState,
  trigger: ModifierState,
): boolean {
  return (
    Boolean(event.altKey) === Boolean(trigger.altKey) &&
    Boolean(event.ctrlKey) === Boolean(trigger.ctrlKey) &&
    Boolean(event.metaKey) === Boolean(trigger.metaKey) &&
    Boolean(event.shiftKey) === Boolean(trigger.shiftKey)
  );
}

export function normalizeKeyChord(
  chord: Partial<NormalizedKeyChord> | null | undefined,
): NormalizedKeyChord | null {
  if (!chord || typeof chord !== "object") return null;
  return {
    code: typeof chord.code === "string" && chord.code ? chord.code : undefined,
    altKey: Boolean(chord.altKey),
    ctrlKey: Boolean(chord.ctrlKey),
    metaKey: Boolean(chord.metaKey),
    shiftKey: Boolean(chord.shiftKey),
    label: typeof chord.label === "string" && chord.label ? chord.label : "Key",
  };
}
