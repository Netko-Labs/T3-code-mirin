import { defineConfig } from "mirinjs/config";

export default defineConfig({
  id: "dev.netko-labs.t3-code-mirin",
  name: "T3 Code Mirin",
  main: "main/main.ts",
  windows: {
    main: {
      title: "T3 Code Mirin",
      width: 1280,
      height: 860,
      minWidth: 900,
      minHeight: 600,
      // The splash; main/main.ts swaps it for the server-served UI once the
      // backend answers.
      url: "app://ui/index.html",
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 16, y: 20 },
      show: "ready",
    },
  },
});
