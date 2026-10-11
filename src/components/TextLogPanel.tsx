import { Icon } from "@/src/components/Icon";

interface TextLogPanelProps {
  logsOpen: boolean;
  setLogsOpen: (open: boolean | ((open: boolean) => boolean)) => void;
  textLogLimit: number;
  textLogs: string[];
}

export function TextLogPanel({ logsOpen, setLogsOpen, textLogLimit, textLogs }: TextLogPanelProps) {
  const displayedLogs = [...textLogs].reverse();

  return (
    <section className={logsOpen ? "text-log-panel open" : "text-log-panel"} aria-label="Text log">
      <button type="button" className="text-log-header" aria-expanded={logsOpen} onClick={() => setLogsOpen((open) => !open)}>
        <span>
          <Icon name="logs" />
          Text log
        </span>
        <span>
          {textLogs.length}/{textLogLimit}
          <Icon name="chevronDown" />
        </span>
      </button>
      {logsOpen && (
        <div className="text-log-list" role="log" aria-live="polite" aria-relevant="additions">
          {displayedLogs.length > 0 ? (
            displayedLogs.map((line, index) => (
              <div className="text-log-row" key={`${displayedLogs.length - index}:${line}`}>
                <span className="text-log-number" aria-label={`Log ${index + 1}`}>
                  {index + 1}
                </span>
                <p className="text-log-text">{line}</p>
              </div>
            ))
          ) : (
            <p className="text-log-empty">No text yet.</p>
          )}
        </div>
      )}
    </section>
  );
}
