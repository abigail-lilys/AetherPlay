import {
  useEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { logDiagnostic } from "@/src/lib/diagnostics";
import { chordFromEvent, sameChord } from "@/src/lib/keyChords";
import { reservedKeyForEvent } from "@/src/lib/keys";
import {
  defaultDictionaryDismissGuard,
  dictionaryGuardFor,
  overlayTogglePatch,
  showTogglePatch,
} from "@/src/lib/playerSettings";
import type {
  DictionaryDismissGuard,
  GameRecord,
  ReservedKeyAction,
} from "@/src/lib/types";
import type { useGameLibrary } from "@/src/hooks/useGameLibrary";
import type { usePlayerFrame } from "@/src/hooks/usePlayerFrame";

const unsavedProgressWarning =
  "Leave the current game? Unsaved progress in the game may be lost.";

interface GameControlsOptions {
  library: ReturnType<typeof useGameLibrary>;
  overlayAvailable: boolean;
  player: ReturnType<typeof usePlayerFrame>;
}

export function useGameControls({
  library,
  overlayAvailable,
  player,
}: GameControlsOptions) {
  const [recordingGuardTrigger, setRecordingGuardTrigger] = useState(false);
  const activeDictionaryGuard = library.activeGame
    ? dictionaryGuardFor(library.activeGame)
    : defaultDictionaryDismissGuard;

  useEffect(() => {
    setRecordingGuardTrigger(false);
  }, [library.activeGame?.id]);

  function confirmLeavingActiveGame(nextGameId: string | null) {
    if (!library.activeGame || library.activeGame.id === nextGameId) return true;
    return window.confirm(unsavedProgressWarning);
  }

  async function selectGame(gameId: string) {
    if (confirmLeavingActiveGame(gameId)) {
      await library.setActiveGameId(gameId);
    }
  }

  async function returnHome() {
    if (confirmLeavingActiveGame(null)) {
      await library.setActiveGameId(null);
    }
  }

  async function setGameSettings(
    game: GameRecord,
    patch: Partial<GameRecord["settings"]>,
  ) {
    const updated = await library.saveGameSettings(game, patch);
    player.postPlayerMessage({
      type: "player-settings",
      settings: updated.settings,
    });
  }

  async function setGameSettingsAndFocus(
    game: GameRecord,
    patch: Partial<GameRecord["settings"]>,
  ) {
    void player.focusPlayer();
    await setGameSettings(game, patch);
    player.scheduleFocusPlayer();
  }

  async function handleReservedAction(action: ReservedKeyAction) {
    const game = library.activeGame;
    if (!game) return;
    if (
      !overlayAvailable &&
      (action === "toggleOverlay" || action === "toggleReader")
    ) {
      return;
    }

    if (action === "toggleOverlay") {
      await setGameSettings(game, overlayTogglePatch(game));
      player.scheduleFocusPlayer();
    }
    if (action === "toggleReader" && game.settings.overlayEnabled) {
      await setGameSettings(game, showTogglePatch(game));
      player.scheduleFocusPlayer();
    }
    if (action === "focusPlayer") player.scheduleFocusPlayer();
    if (action === "fullscreen") await player.requestFullscreen();
  }

  function onAppKeyDown(event: ReactKeyboardEvent) {
    const game = library.activeGame;
    if (!game) return;

    const reserved = reservedKeyForEvent(event.nativeEvent, game.settings);
    if (!reserved) return;
    event.preventDefault();
    void handleReservedAction(reserved.action);
  }

  async function setDictionaryGuard(
    game: GameRecord,
    guard: DictionaryDismissGuard,
  ) {
    await setGameSettings(game, { dictionaryDismissGuard: guard });
  }

  async function recordGuardTrigger(
    game: GameRecord,
    event: ReactKeyboardEvent,
  ) {
    if (!recordingGuardTrigger) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.code === "Escape") {
      setRecordingGuardTrigger(false);
      return;
    }

    const chord = chordFromEvent(event.nativeEvent);
    if (!chord) return;
    const guard = dictionaryGuardFor(game);
    const triggers = guard.triggers.some((item) => sameChord(item, chord))
      ? guard.triggers
      : [...guard.triggers, chord];
    setRecordingGuardTrigger(false);
    await setDictionaryGuard(game, { ...guard, triggers });
  }

  async function removeGuardTrigger(game: GameRecord, index: number) {
    const guard = dictionaryGuardFor(game);
    await setDictionaryGuard(game, {
      ...guard,
      triggers: guard.triggers.filter(
        (_, itemIndex) => itemIndex !== index,
      ),
    });
  }

  function handleIframeLoad() {
    // WOLF_TOUCH_UI_RESTORE_PATCH_V2: retry until the game UI exists, lock the flags, and log probes.
    {
      type WoditorWindow = Window & {
        WoditorGameSettings?: Record<string, unknown>;
        adjustGameUI?: () => void;
      };
      const frame = player.frameRef.current;
      const probe = (label: string) => {
        try {
          const w = frame?.contentWindow as WoditorWindow | null;
          const d = w?.document;
          const box = (id: string) => {
            const e = d?.getElementById(id);
            if (!e || !w) return null;
            const r = e.getBoundingClientRect();
            return {
              hidden: e.hidden,
              display: w.getComputedStyle(e).display,
              w: Math.round(r.width),
              h: Math.round(r.height),
            };
          };
          logDiagnostic("info", "wolf-touch-ui.probe", {
            label,
            href: String(w?.location?.href ?? ""),
            hasSettings: Boolean(w?.WoditorGameSettings),
            hasAdjust: typeof w?.adjustGameUI === "function",
            settings: JSON.stringify(w?.WoditorGameSettings ?? null),
            inner: [w?.innerWidth ?? 0, w?.innerHeight ?? 0],
            fullscreenElement: Boolean(d?.fullscreenElement),
            left: box("screen-left"),
            right: box("screen-right"),
            enter: box("enter"),
            shift: box("shift"),
            esc: box("esc"),
            moveAxis: box("move-axis"),
            rightHold: box("right-hold"),
          });
        } catch (cause) {
          logDiagnostic("warn", "wolf-touch-ui.probe.failed", {
            label,
            error: cause instanceof Error ? cause.message : String(cause),
          });
        }
      };
      const restore = () => {
        const w = frame?.contentWindow as WoditorWindow | null;
        const s = w?.WoditorGameSettings;
        if (!w || !s || typeof w.adjustGameUI !== "function") return false;
        for (const key of ["hideSideButtons", "isFullscreen", "isPseudoFullscreen"]) {
          try {
            Object.defineProperty(s, key, {
              get: () => false,
              set: () => undefined,
              configurable: true,
              enumerable: true,
            });
          } catch {
            Reflect.set(s, key, false);
          }
        }
        w.adjustGameUI();
        return true;
      };
      probe("iframe-load");
      let tries = 0;
      const timer = window.setInterval(() => {
        tries += 1;
        const done = restore();
        if (!done && tries < 40) return;
        window.clearInterval(timer);
        probe(done ? "restored" : "gave-up");
        window.setTimeout(() => probe("after-3s"), 3000);
        window.setTimeout(() => probe("after-8s"), 8000);
      }, 250);
    }
    const game = library.activeGame;
    if (!game) return;

    player.postPlayerMessage({
      type: "player-settings",
      settings: game.settings,
    });
    player.resetViewportCache();
    player.schedulePlayerViewportNotify();
    window.setTimeout(player.schedulePlayerViewportNotify, 0);
    window.setTimeout(player.schedulePlayerViewportNotify, 250);
  }

  return {
    activeDictionaryGuard,
    handleIframeLoad,
    handleReservedAction,
    onAppKeyDown,
    recordingGuardTrigger,
    recordGuardTrigger,
    removeGuardTrigger,
    returnHome,
    selectGame,
    setDictionaryGuard,
    setGameSettingsAndFocus,
    setRecordingGuardTrigger,
  };
}
