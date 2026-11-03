import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.digitalarms.cavale",
  appName: "Cavale",
  webDir: "dist",
  android: {
    allowMixedContent: false,
    backgroundColor: "#0b1026",
  },
  server: { androidScheme: "https" },
};

export default config;
