import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.digitalarms.espritclair",
  appName: "Esprit Clair",
  webDir: "dist",
  android: { allowMixedContent: false, backgroundColor: "#0f1620" },
  server: { androidScheme: "https" },
};

export default config;
