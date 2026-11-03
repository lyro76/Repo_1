import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.digitalarms.novaflipper",
  appName: "Nova Flipper",
  webDir: "dist",
  android: { allowMixedContent: false, backgroundColor: "#07070f" },
  server: { androidScheme: "https" },
};

export default config;
