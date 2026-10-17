import { Capacitor, registerPlugin } from "@capacitor/core";

interface AndroidImmersiveAPI {
  enter(): Promise<void>;
  exit(): Promise<void>;
}

const immersivePlugin = registerPlugin<AndroidImmersiveAPI>("AndroidImmersive");

/** Returns true when Android handled the request; false on browser platforms. */
export async function setAndroidImmersive(enabled: boolean): Promise<boolean> {
  if (Capacitor.getPlatform() !== "android") return false;
  if (enabled) await immersivePlugin.enter();
  else await immersivePlugin.exit();
  return true;
}
