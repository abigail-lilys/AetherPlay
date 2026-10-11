import { formatBytes } from "@/src/lib/format";
import type { GameRecord } from "@/src/lib/types";
import { Icon } from "@/src/components/Icon";

interface GameCardProps {
  active: boolean;
  boundSession: boolean;
  game: GameRecord;
  onDelete: (game: GameRecord) => void;
  onDownloadSaves: (game: GameRecord) => void;
  onBindSessionFolder: (game: GameRecord) => void;
  onSelect: (gameId: string) => void;
}

function storageLabel(game: GameRecord, boundSession: boolean): string {
  if (game.sourceKind === "local-folder")
    return "linked folder, no browser storage";
  if (game.sourceKind === "session-folder")
    return boundSession ? "bound" : "not bound";
  return "stored";
}

function detailsLabel(game: GameRecord, boundSession: boolean): string {
  const label = storageLabel(game, boundSession);
  if (
    game.sourceKind === "local-folder" ||
    game.sourceKind === "session-folder"
  ) {
    return `${game.fileCount} files · ${label}`;
  }
  return `${game.fileCount} files · ${formatBytes(game.totalBytes)} · ${label}`;
}

export function GameCard({
  active,
  boundSession,
  game,
  onBindSessionFolder,
  onDelete,
  onDownloadSaves,
  onSelect,
}: GameCardProps) {
  const canBindSession = game.sourceKind === "session-folder";
  const unboundSession = canBindSession && !boundSession;
  const className = [
    "game-card",
    active ? "active" : "",
    unboundSession ? "unbound-session" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const handleMainClick = () => {
    if (unboundSession) {
      onBindSessionFolder(game);
      return;
    }
    onSelect(game.id);
  };

  return (
    <article className={className}>
      <button type="button" className="game-main" onClick={handleMainClick}>
        <strong>{game.title}</strong>
        <span>{detailsLabel(game, boundSession)}</span>
      </button>

      <button
        type="button"
        className="icon-button"
        aria-label={`Download saves for ${game.title}`}
        title="Download saves"
        onClick={() => onDownloadSaves(game)}
      >
        <Icon name="download" />
      </button>

      <button
        type="button"
        className="icon-button"
        aria-label={`Delete ${game.title}`}
        onClick={() => onDelete(game)}
      >
        <Icon name="trash" />
      </button>
    </article>
  );
}
