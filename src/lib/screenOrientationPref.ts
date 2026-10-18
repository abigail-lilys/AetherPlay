import type { GameScreenOrientation } from "@/src/lib/androidOrientation";

export const SCREEN_ORIENTATION_KEY = "local-web-game-player-screen-orientation-v1";

export function readScreenOrientationPref(): GameScreenOrientation {
  try {
    const stored = localStorage.getItem(SCREEN_ORIENTATION_KEY);
    return stored === "portrait" || stored === "system" ? stored : "landscape";
  } catch {
    return "landscape";
  }
}

export function writeScreenOrientationPref(value: GameScreenOrientation): void {
  try {
    localStorage.setItem(SCREEN_ORIENTATION_KEY, value);
  } catch {
    // Storage can be unavailable.
  }
}
