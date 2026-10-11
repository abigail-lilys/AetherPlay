import { useCallback, useState } from "react";
import { appendTextLog } from "@/src/lib/textLog";

export function useTextLog(limit: number) {
  const [textLogs, setTextLogs] = useState<string[]>([]);
  const [logsOpen, setLogsOpen] = useState(false);

  const append = useCallback((text: string) => {
    setTextLogs((items) => appendTextLog(items, text, limit));
  }, [limit]);

  const reset = useCallback(() => {
    setTextLogs([]);
  }, []);

  return {
    append,
    logsOpen,
    reset,
    setLogsOpen,
    textLogs,
  };
}
