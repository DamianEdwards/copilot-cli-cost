import { Application } from "@webviewjs/webview";

const { CW_URL, CW_TITLE, CW_WIDTH, CW_HEIGHT } = process.env;
const app = new Application();
const win = app.createBrowserWindow({
  title: CW_TITLE,
  width: Number(CW_WIDTH),
  height: Number(CW_HEIGHT)
});
win.createWebview({ url: CW_URL, enableDevtools: true });
app.run();
