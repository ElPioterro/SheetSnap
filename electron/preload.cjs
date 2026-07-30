/**
 * SheetSnap — preload script. Exposes a tiny, safe bridge to the renderer so
 * the UI can detect it runs inside the desktop shell.
 */
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("sheetsnapDesktop", {
  desktop: true,
  platform: process.platform,
  versions: {
    app: process.env.npm_package_version ?? "1.0.0",
    electron: process.versions.electron,
  },
});
