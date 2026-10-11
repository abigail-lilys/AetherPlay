import type { KeyChord } from "@/src/lib/types";

export function chordFromEvent(
  event: Pick<KeyboardEvent, "code" | "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey">,
): KeyChord | null {
  const modifierCode = ["AltLeft", "AltRight", "ControlLeft", "ControlRight", "MetaLeft", "MetaRight", "ShiftLeft", "ShiftRight"].includes(
    event.code,
  );
  const hasModifier = event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
  if (!hasModifier && modifierCode) return null;
  const chord = {
    code: modifierCode ? undefined : event.code,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
  };
  return {
    ...chord,
    label: chordLabel(chord),
  };
}

export function chordLabel(
  chord: Pick<KeyChord, "code" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey"> & { key?: string },
): string {
  const parts = [];
  if (chord.ctrlKey) parts.push("Ctrl");
  if (chord.altKey) parts.push("Option");
  if (chord.metaKey) parts.push("Command");
  if (chord.shiftKey) parts.push("Shift");
  if (chord.code) parts.push(chord.code.replace(/^Key/, "").replace(/^Digit/, ""));
  return parts.join("+") || "Key";
}

export function sameChord(a: KeyChord, b: KeyChord): boolean {
  return (
    (a.code || "") === (b.code || "") &&
    Boolean(a.altKey) === Boolean(b.altKey) &&
    Boolean(a.ctrlKey) === Boolean(b.ctrlKey) &&
    Boolean(a.metaKey) === Boolean(b.metaKey) &&
    Boolean(a.shiftKey) === Boolean(b.shiftKey)
  );
}
