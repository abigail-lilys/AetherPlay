import type { DictionaryDismissGuard, GameRecord, KeyChord, PlayerSettings, ReservedKey } from "@/src/lib/types";
import { normalizeKeyChord } from "@/shared/keyInput";

export const defaultDictionaryDismissGuard: DictionaryDismissGuard = {
  enabled: true,
  triggers: [],
};

export const defaultReservedKeys: ReservedKey[] = [
  {
    code: "KeyT",
    altKey: true,
    action: "toggleOverlay",
    label: "Alt+T",
  },
  {
    code: "KeyR",
    altKey: true,
    action: "toggleReader",
    label: "Alt+R",
  },
  {
    code: "KeyF",
    altKey: true,
    action: "fullscreen",
    label: "Alt+F",
  },
];

function normalizeDictionaryDismissGuard(guard: Partial<DictionaryDismissGuard> | undefined): DictionaryDismissGuard {
  const triggers = Array.isArray(guard?.triggers) ? guard.triggers.map(normalizeKeyChord).filter((trigger): trigger is KeyChord => Boolean(trigger)) : [];
  return {
    enabled: guard?.enabled ?? defaultDictionaryDismissGuard.enabled,
    triggers: triggers.length > 0 ? triggers : defaultDictionaryDismissGuard.triggers.map((trigger) => ({ ...trigger })),
  };
}

export function normalizePlayerSettings(settings: Partial<PlayerSettings> | undefined): PlayerSettings {
  const overlayEnabled = Boolean(settings?.overlayEnabled);
  return {
    reservedKeys: settings?.reservedKeys?.length ? settings.reservedKeys : defaultReservedKeys.map((key) => ({ ...key })),
    dictionaryDismissGuard: normalizeDictionaryDismissGuard(settings?.dictionaryDismissGuard),
    overlayEnabled,
    readableOverlay: overlayEnabled && Boolean(settings?.readableOverlay),
    readerMode: overlayEnabled,
  };
}

export function overlayTogglePatch(game: GameRecord): Partial<GameRecord["settings"]> {
  if (game.settings.overlayEnabled) {
    return {
      overlayEnabled: false,
      readableOverlay: false,
      readerMode: false,
    };
  }
  return { overlayEnabled: true, readableOverlay: false, readerMode: true };
}

export function showTogglePatch(game: GameRecord): Partial<GameRecord["settings"]> {
  if (!game.settings.overlayEnabled) {
    return {
      overlayEnabled: false,
      readableOverlay: false,
      readerMode: false,
    };
  }
  return {
    overlayEnabled: true,
    readableOverlay: !Boolean(game.settings.readableOverlay),
    readerMode: true,
  };
}

export function dictionaryGuardFor(game: GameRecord): DictionaryDismissGuard {
  return normalizeDictionaryDismissGuard(game.settings.dictionaryDismissGuard);
}
