import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: "com.aetherplay.app",
  appName: "AetherPlay",
  webDir: 'dist',
  plugins: {
    Nodejs: {
      nodeDir: 'nodejs',
      startMode: 'manual',
    },
  },
};

export default config;
