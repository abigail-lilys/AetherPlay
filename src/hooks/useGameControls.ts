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
    // WOLF_TOUCH_UI_RESTORE_PATCH_V3: probe the real layout (WoditorGameSettings is a lexical const, read via eval).
    {
      type FrameWin = Window & { adjustGameUI?: () => void; eval: (code: string) => unknown };
      const frame = player.frameRef.current;
      const rect = (e: Element | null) => {
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
      };
      const probe = (label: string) => {
        try {
          const w = frame?.contentWindow as FrameWin | null;
          const d = w?.document;
          if (!w || !d) {
            logDiagnostic("warn", "wolf-touch-ui.probe", { label, reason: "no-window" });
            return;
          }
          const chain = (id: string) => {
            const out: unknown[] = [];
            let e: Element | null = d.getElementById(id);
            while (e && e !== d.documentElement) {
              const cs = w.getComputedStyle(e);
              out.push({
                id: e.id || e.tagName.toLowerCase(),
                display: cs.display,
                vis: cs.visibility,
                pos: cs.position,
                w: cs.width,
                h: cs.height,
                ov: cs.overflow,
                rect: rect(e),
              });
              e = e.parentElement;
            }
            return out;
          };
          let settings: unknown = null;
          try {
            settings = w.eval(
              "typeof WoditorGameSettings === 'undefined' ? null : JSON.stringify(WoditorGameSettings)",
            );
          } catch {
            settings = "eval-failed";
          }
          const suspicious: string[] = [];
          for (const sheet of Array.from(d.styleSheets)) {
            try {
              for (const rule of Array.from(sheet.cssRules)) {
                const text = rule.cssText;
                if (
                  /screen-(side|holder|left|right)|itemh|side-content|#enter|#esc|#shift|move-axis|right-hold/.test(text) &&
                  /!important|display:\s*none|visibility|width:\s*0|height:\s*0/.test(text)
                ) {
                  suspicious.push(text.slice(0, 240));
                }
              }
            } catch {
              /* cross-origin sheet */
            }
          }
          logDiagnostic("info", "wolf-touch-ui.probe", {
            label,
            inner: [w.innerWidth, w.innerHeight],
            settings,
            styleSheets: d.styleSheets.length,
            suspicious: suspicious.slice(0, 12),
            chainLeft: chain("screen-left"),
            chainEnter: chain("enter"),
          });
        } catch (cause) {
          logDiagnostic("warn", "wolf-touch-ui.probe.failed", {
            label,
            error: cause instanceof Error ? cause.message : String(cause),
          });
        }
      };
      const experiment = () => {
        const w = frame?.contentWindow as FrameWin | null;
        const d = w?.document;
        if (!w || !d) return;
        for (const id of ["screen-holder-left", "screen-holder-right"]) {
          d.getElementById(id)?.style.setProperty("display", "flex", "important");
        }
        for (const id of ["screen-left", "screen-right"]) {
          const e = d.getElementById(id);
          if (!e) continue;
          e.style.setProperty("display", "block", "important");
          e.style.setProperty("width", "100%", "important");
          e.style.setProperty("height", "100%", "important");
        }
        w.adjustGameUI?.();
      };
      probe("iframe-load");
      window.setTimeout(() => probe("after-3s"), 3000);
      window.setTimeout(() => {
        experiment();
        probe("after-experiment");
      }, 4000);
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
