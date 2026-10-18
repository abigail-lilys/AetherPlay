import { logDiagnostic } from "@/src/lib/diagnostics";
import {
  useEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
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
    // BENTEN_PROBE: find out why window.Benten is undefined (module script / AudioContext / worklet).
    {
      type BentenWin = Window & {
        eval: (code: string) => unknown;
        Benten?: unknown;
        AudioContext?: typeof AudioContext;
        AudioWorkletNode?: unknown;
      };
      const frame = player.frameRef.current;
      const runBentenProbe = async (label: string) => {
        try {
          const w = frame?.contentWindow as BentenWin | null;
          if (!w) {
            logDiagnostic("warn", "benten.probe", { label, reason: "no-window" });
            return;
          }
          let importResult = "not-run";
          try {
            importResult = String(
              await (w.eval(
                "import(new URL('lib/benten_front.js', document.baseURI).href)" +
                  ".then(function (m) { return 'ok:' + Object.keys(m).join(','); })" +
                  ".catch(function (e) { return 'error:' + String((e && e.message) || e); })",
              ) as Promise<string>),
            );
          } catch (cause) {
            importResult = "eval-failed:" + (cause instanceof Error ? cause.message : String(cause));
          }
          let audio = "n/a";
          try {
            const Ctor = w.AudioContext;
            if (Ctor) {
              const ctx = new Ctor({ latencyHint: "balanced", sampleRate: 44100 });
              audio = "ok:" + ctx.sampleRate + ":" + ctx.state;
              void ctx.close();
            }
          } catch (cause) {
            audio = "error:" + (cause instanceof Error ? cause.message : String(cause));
          }
          const entries = w.performance
            .getEntriesByType("resource")
            .filter((entry) => /benten|midisound/.test(entry.name))
            .map((entry) => {
              const resource = entry as PerformanceResourceTiming & { responseStatus?: number };
              return {
                name: entry.name.split("/lib/")[1] ?? entry.name,
                status: resource.responseStatus ?? -1,
                type: resource.initiatorType,
              };
            });
          logDiagnostic("info", "benten.probe", {
            label,
            hasBenten: typeof w.Benten,
            importResult,
            audio,
            worklet: typeof w.AudioWorkletNode,
            entries: JSON.stringify(entries),
            ua: w.navigator.userAgent,
          });
        } catch (cause) {
          logDiagnostic("warn", "benten.probe.failed", {
            label,
            error: cause instanceof Error ? cause.message : String(cause),
          });
        }
      };
      window.setTimeout(() => void runBentenProbe("after-4s"), 4000);
      window.setTimeout(() => void runBentenProbe("after-10s"), 10000);
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
