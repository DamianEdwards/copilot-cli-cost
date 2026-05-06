import { bootstrap } from "./lib/copilot-webview.js";

await bootstrap(import.meta.dirname);
await import("./main.mjs");
