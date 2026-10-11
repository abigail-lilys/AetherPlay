import type { KeyboardEvent } from "react";
import type { DictionaryDismissGuard, GameRecord } from "@/src/lib/types";
import { chordLabel } from "@/src/lib/keyChords";
import { Icon } from "@/src/components/Icon";

interface DictionaryGuardPanelProps {
  activeGame?: GameRecord;
  guard: DictionaryDismissGuard;
  onRecordTrigger: (game: GameRecord, event: KeyboardEvent) => void;
  onRemoveTrigger: (game: GameRecord, index: number) => void;
  onToggle: (game: GameRecord, guard: DictionaryDismissGuard) => void;
  recording: boolean;
  setRecording: (recording: boolean) => void;
}

export function DictionaryGuardPanel({
  activeGame,
  guard,
  onRecordTrigger,
  onRemoveTrigger,
  onToggle,
  recording,
  setRecording,
}: DictionaryGuardPanelProps) {
  return (
    <section className="guard-popover" aria-label="Guard settings">
      <div className="guard-row">
        <span>Guard</span>
        <button
          type="button"
          aria-label="Guard"
          title="Guard"
          aria-pressed={guard.enabled}
          disabled={!activeGame}
          onClick={() => {
            if (!activeGame) return;
            if (guard.enabled) setRecording(false);
            onToggle(activeGame, { ...guard, enabled: !guard.enabled });
          }}
        >
          {guard.enabled ? "On" : "Off"}
        </button>
      </div>
      <div className={guard.enabled ? "guard-chips" : "guard-chips disabled"}>
        {guard.triggers.map((trigger, index) => {
          const label = chordLabel(trigger);
          return (
            <button className="guard-chip removable" key={`${label}:${index}`} type="button" disabled={!activeGame || !guard.enabled} onClick={() => activeGame && onRemoveTrigger(activeGame, index)}>
              <span>{label}</span>
              <Icon name="x" />
            </button>
          );
        })}
        <button
          type="button"
          className={recording ? "guard-add-button recording" : "guard-add-button"}
          aria-label="Add guard trigger"
          title="Add guard trigger"
          aria-pressed={recording}
          disabled={!activeGame || !guard.enabled}
          onClick={(event) => {
            setRecording(true);
            event.currentTarget.focus();
          }}
          onKeyDown={(event) => activeGame && onRecordTrigger(activeGame, event)}
        >
          <Icon name="plus" />
        </button>
      </div>
    </section>
  );
}
