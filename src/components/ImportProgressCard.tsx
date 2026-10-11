import type { ImportProgress } from "@/src/lib/types";

interface ImportProgressCardProps {
  progress: ImportProgress;
}

export function ImportProgressCard({ progress }: ImportProgressCardProps) {
  const progressPercent = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;

  return (
    <article className="game-card importing">
      <div className="game-main import-progress-main" aria-live="polite">
        <strong>
          ({progressPercent}%) {progress.label}
        </strong>
        <progress value={progress.completed} max={Math.max(progress.total, 1)} />
      </div>
    </article>
  );
}
