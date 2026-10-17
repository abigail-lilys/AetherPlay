import { Capacitor, registerPlugin } from "@capacitor/core";

export type GameScreenOrientation = "landscape" | "portrait" | "system";

interface AndroidOrientationAPI {
  setOrientation(options: { orientation: GameScreenOrientation }): Promise<{ orientation: GameScreenOrientation }>;
}

const orientationPlugin = registerPlugin<AndroidOrientationAPI>("AndroidOrientation");

export async function setAndroidScreenOrientation(
  orientation: GameScreenOrientation,
): Promise<void> {
  if (Capacitor.getPlatform() !== "android") return;
  await orientationPlugin.setOrientation({ orientation });
}
