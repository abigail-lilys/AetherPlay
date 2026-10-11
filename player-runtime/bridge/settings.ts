// @ts-nocheck

import { normalizeKeyChord } from "@/shared/keyInput";

export function createSettingsStore(initialSettings) {
  let current = normalizeSettings(initialSettings);

  return {
    get current() {
      return current;
    },
    replace(next) {
      current = normalizeSettings(next);
      return current;
    },
    patch(patch) {
      current = normalizeSettings({ ...current, ...patch });
      return current;
    },
    get reservedKeys() {
      return current.reservedKeys;
    },
    get dictionaryDismissGuard() {
      return current.dictionaryDismissGuard;
    },
    get overlayEnabled() {
      return current.overlayEnabled;
    },
    get readableOverlay() {
      return current.readableOverlay;
    },
    get readerMode() {
      return current.readerMode;
    },
  };
}

export function normalizeSettings(next) {
  const normalized = next || {};
  const overlayEnabled = Boolean(normalized.overlayEnabled);
  return {
    reservedKeys: normalized.reservedKeys || [],
    dictionaryDismissGuard: normalizeDictionaryDismissGuard(normalized.dictionaryDismissGuard),
    overlayEnabled,
    readableOverlay: overlayEnabled && Boolean(normalized.readableOverlay),
    readerMode: overlayEnabled,
  };
}

function normalizeDictionaryDismissGuard(next) {
  const guard = next || {};
  const triggers = Array.isArray(guard.triggers) && guard.triggers.length > 0
    ? guard.triggers.map(normalizeKeyChord).filter(Boolean)
    : [];
  return {
    enabled: guard.enabled !== false,
    triggers,
  };
}
