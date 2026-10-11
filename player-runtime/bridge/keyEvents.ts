// @ts-nocheck

import { exactModifierMatch } from "@/shared/keyInput";

export { exactModifierMatch };

export function keyEventMatchesChord(event, chord) {
  return (
    event.code === chord.code &&
    exactModifierMatch(event, chord)
  );
}

export function positiveFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}
