import type { GameRecord } from "@/src/lib/types";

export function playUrl(game: GameRecord): string {
  return `/play/${encodeURIComponent(game.id)}/${game.entryPath.split("/").map(encodeURIComponent).join("/")}`;
}
