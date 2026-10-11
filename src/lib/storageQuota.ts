import { estimateStorage } from "@/src/lib/storage";

const storageEstimateRetryDelaysMs = [0, 50, 150, 350, 750, 1500, 2500];
const storageLimitMessage = "Browser storage limit exceeded.";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

export async function estimateStorageAfterMutation(
  previous?: StorageEstimate,
): Promise<StorageEstimate | undefined> {
  const previousUsage =
    typeof previous?.usage === "number" ? previous.usage : undefined;
  let latest: StorageEstimate | undefined;

  for (const delayMs of storageEstimateRetryDelaysMs) {
    if (delayMs > 0) await wait(delayMs);
    latest = await estimateStorage();
    if (
      previousUsage === undefined ||
      typeof latest?.usage !== "number" ||
      latest.usage < previousUsage
    ) {
      return latest;
    }
  }

  return latest;
}

export async function browserStorageError(
  requiredBytes: number,
): Promise<string | undefined> {
  const estimate = await estimateStorage();
  if (
    typeof estimate?.quota !== "number" ||
    typeof estimate.usage !== "number"
  ) {
    return undefined;
  }

  const availableBytes = Math.max(0, estimate.quota - estimate.usage);
  return requiredBytes > availableBytes ? storageLimitMessage : undefined;
}

export function isBrowserStorageLimitError(cause: unknown): boolean {
  if (!(cause instanceof Error)) return false;

  const details = `${cause.name} ${cause.message}`;
  return (
    cause.name === "QuotaExceededError" ||
    cause.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    /quota|storage.*exceed|exceed.*storage|out of.*storage/i.test(details)
  );
}

export function importErrorMessage(cause: unknown): string {
  if (isBrowserStorageLimitError(cause)) return storageLimitMessage;
  return cause instanceof Error ? cause.message : "Import failed.";
}
