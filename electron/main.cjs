/**
 * SheetSnap — Electron main process (starter).
 *
 * Spawns the standalone Next.js server bundled under resources/server and
 * opens a window on it. In development it just loads the dev server.
 *
 * See PACKAGING.md for the full build pipeline.
 */
const { app, BrowserWindow, shell } = require("electron");
const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const fs = require("node:fs");

const PORT = Number(process.env.SHEETSNAP_PORT ?? 3658);
const HOST = "127.0.0.1";
let serverProcess = null;

function waitForPort(port, host, timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const socket = net.connect(port, host);
      socket.once("connect", () => {
        socket.end();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - started > timeoutMs)
          reject(new Error("Server did not start in time"));
        else setTimeout(tryOnce, 250);
      });
    };
    tryOnce();
  });
}

function startServer() {
  const serverDir = path.join(process.resourcesPath, "server");
  const serverJs = path.join(serverDir, "server.js");
  if (!fs.existsSync(serverJs)) {
    console.error(`[sheetsnap] standalone server not found at ${serverJs}`);
    return;
  }
  // Bundled per-platform tools (see PACKAGING.md §3)
  const binDir = path.join(process.resourcesPath, "bin");
  serverProcess = spawn(process.execPath, [serverJs], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      HOSTNAME: HOST,
      PORT: String(PORT),
      // App data (job history + artifacts) lives in the OS-specific user
      // data folder, NOT inside the install directory or project root:
      //   Windows  %APPDATA%/SheetSnap
      //   macOS    ~/Library/Application Support/SheetSnap
      //   Linux    ~/.config/SheetSnap
      SHEETSNAP_DATA_DIR: app.getPath("userData"),
      YTDLP_PATH: path.join(
        binDir,
        process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp",
      ),
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  serverProcess.on("exit", (code) =>
    console.log(`[sheetsnap] server exited (${code})`),
  );
}

async function createWindow() {
  const dev = !app.isPackaged;
  if (dev) {
    // Expect `next dev` to be running on :3000
    const win = new BrowserWindow(windowOptions());
    await win.loadURL("http://127.0.0.1:3000");
    return;
  }
  startServer();
  await waitForPort(PORT, HOST);
  const win = new BrowserWindow(windowOptions());
  await win.loadURL(`http://${HOST}:${PORT}`);
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
}

function windowOptions() {
  return {
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: "SheetSnap",
    backgroundColor: "#fafafa",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
}

app.whenReady().then(() => {
  void createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (serverProcess) serverProcess.kill();
  app.quit();
});

app.on("before-quit", () => {
  if (serverProcess) serverProcess.kill();
});
