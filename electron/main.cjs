const fs = require("node:fs");
const path = require("node:path");
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  utilityProcess,
} = require("electron");
const {
  CHECKPOINT_NAME,
  RUN_FOLDER_PATTERN,
  resolveVerifiedExportFolder,
} = require("./export-folder.cjs");
const { recoverManifestSource } = require("./manifest-source.cjs");

if (require("electron-squirrel-startup")) {
  app.quit();
}

const APP_NAME = "Badge Blur";
const APP_ID = "gov.ornl.badge-blur";
const SERVER_READY_TIMEOUT_MS = 20_000;
const SERVER_STOP_TIMEOUT_MS = 4_000;
const smokeTest = process.env.BADGE_BLUR_SMOKE_TEST === "1";
const smokeUserDataPath = smokeTest
  ? path.join(app.getPath("temp"), `badge-blur-smoke-${process.pid}`)
  : null;

if (smokeUserDataPath) {
  fs.mkdirSync(smokeUserDataPath, { recursive: true });
  app.setPath("userData", smokeUserDataPath);
  if (process.platform !== "win32") {
    app.once("quit", () => {
      fs.rmSync(smokeUserDataPath, { recursive: true, force: true });
    });
  }
}

let mainWindow = null;
let serverProcess = null;
let serverUrl = null;
let serverExitPromise = Promise.resolve();
let resolveServerExit = null;
let quitting = false;
let allowWindowClose = false;
let requestedExitCode = 0;
let preparingRendererQuit = false;
const recoveredSourceFiles = new Map();

app.setName(APP_NAME);
app.setAppUserModelId(APP_ID);

ipcMain.handle("badge-blur:open-export-folder", async (_event, request) => {
  const runFolderName = String(request?.runFolderName || "");
  let folder = resolveVerifiedExportFolder(request);
  if (!folder) {
    if (!RUN_FOLDER_PATTERN.test(runFolderName)) {
      throw new Error("Badge Blur could not verify the export folder.");
    }
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: `Locate ${runFolderName}`,
      buttonLabel: "Open export folder",
      defaultPath: app.getPath("desktop"),
      properties: ["openDirectory"],
      message:
        "Badge Blur could not recover the native folder path. Choose the exact run folder once.",
    });
    if (selection.canceled || selection.filePaths.length !== 1) return false;
    const selectedFolder = selection.filePaths[0];
    if (path.basename(selectedFolder) !== runFolderName) {
      throw new Error(`Choose the export folder named ${runFolderName}.`);
    }
    folder = resolveVerifiedExportFolder({
      checkpointPath: path.join(selectedFolder, CHECKPOINT_NAME),
    });
  }
  if (!folder) {
    throw new Error(
      "The selected folder does not contain this run's checkpoint file.",
    );
  }
  const error = await shell.openPath(folder);
  if (error) throw new Error(error);
  return true;
});

ipcMain.handle(
  "badge-blur:recover-manifest-source",
  async (_event, manifestPath) => {
    const recovery = recoverManifestSource(manifestPath);
    recoveredSourceFiles.clear();
    for (const file of recovery.files) {
      recoveredSourceFiles.set(file.token, {
        realPath: file.realPath,
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
        type: file.type,
      });
    }
    return {
      runId: recovery.runId,
      runFolderName: recovery.runFolderName,
      sourceRootName: recovery.sourceRootName,
      files: recovery.files.map(({ realPath: _realPath, ...file }) => file),
    };
  },
);

ipcMain.handle(
  "badge-blur:read-recovered-source",
  async (_event, token) => {
    const file = recoveredSourceFiles.get(token);
    if (!file) {
      throw new Error("The recovered source-image permission has expired.");
    }
    const stat = await fs.promises.stat(file.realPath);
    if (!stat.isFile() || stat.size !== file.size) {
      throw new Error(`${file.name} changed after the run was imported.`);
    }
    return {
      bytes: await fs.promises.readFile(file.realPath),
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      type: file.type,
    };
  },
);

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

app.whenReady().then(async () => {
  try {
    serverUrl = await startLocalServer();
    createMainWindow(serverUrl);
  } catch (error) {
    console.error("Badge Blur could not start.", error);
    dialog.showErrorBox(
      "Badge Blur could not start",
      `${error.message}\n\nNo images were uploaded or sent anywhere.`,
    );
    requestedExitCode = 1;
    await beginQuit();
  }
});

app.on("activate", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on("before-quit", (event) => {
  if (allowWindowClose) return;
  event.preventDefault();
  void requestQuitFromRenderer();
});

app.on("window-all-closed", () => {
  if (!quitting) void beginQuit();
});

function startLocalServer() {
  return new Promise((resolveStart, rejectStart) => {
    const serverPath = path.join(app.getAppPath(), "scripts", "serve.mjs");
    const pidFile = path.join(app.getPath("temp"), "badge-blur-electron-server.pid");
    let ready = false;
    let stdout = "";
    let stderr = "";

    serverExitPromise = new Promise((resolveExit) => {
      resolveServerExit = resolveExit;
    });

    serverProcess = utilityProcess.fork(serverPath, [], {
      cwd: app.getAppPath(),
      env: {
        ...process.env,
        BADGE_REMOVER_OPEN_BROWSER: "0",
        BADGE_REMOVER_PARENT_PID: String(process.pid),
        BADGE_REMOVER_PID_FILE: pidFile,
        BADGE_REMOVER_PORT: "0",
      },
      serviceName: "Badge Blur image service",
      stdio: "pipe",
    });

    const timeout = setTimeout(() => {
      rejectStart(
        new Error(
          `The private image service did not become ready.\n${stderr.trim()}`,
        ),
      );
    }, SERVER_READY_TIMEOUT_MS);

    serverProcess.stdout?.setEncoding("utf8");
    serverProcess.stderr?.setEncoding("utf8");
    serverProcess.stdout?.on("data", (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
      const match = stdout.match(/Badge Blur: (http:\/\/127\.0\.0\.1:\d+\/)/);
      if (!match || ready) return;
      ready = true;
      clearTimeout(timeout);
      resolveStart(match[1]);
    });
    serverProcess.stderr?.on("data", (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    serverProcess.on("message", (event) => {
      const message = event?.message || event;
      if (
        message?.type === "badge-blur-shutdown-requested" &&
        !quitting
      ) {
        void beginQuit({ serverAlreadyStopped: true });
      }
    });
    serverProcess.once("exit", (code) => {
      clearTimeout(timeout);
      const wasReady = ready;
      serverProcess = null;
      resolveServerExit?.(code);
      resolveServerExit = null;

      if (!wasReady) {
        rejectStart(
          new Error(
            `The private image service exited during startup (${code}).\n` +
              stderr.trim(),
          ),
        );
        return;
      }

      if (!quitting) {
        if (!smokeTest) {
          dialog.showErrorBox(
            "Badge Blur stopped",
            "The private image service stopped unexpectedly. Reopen Badge Blur to continue.",
          );
        }
        requestedExitCode = code === 0 ? 0 : 1;
        void beginQuit({ serverAlreadyStopped: true });
      }
    });
  });
}

function createMainWindow(url) {
  let smokeDeadline = null;
  const icon =
    process.platform === "win32"
      ? path.join(app.getAppPath(), "packaging", "assets", "BadgeBlur.ico")
      : path.join(app.getAppPath(), "packaging", "assets", "badge-blur-source.png");

  mainWindow = new BrowserWindow({
    title: APP_NAME,
    width: 1440,
    height: 1000,
    minWidth: 1040,
    minHeight: 720,
    show: false,
    backgroundColor: "#eff5f0",
    icon,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: true,
      webSecurity: true,
      navigateOnDragDrop: false,
    },
  });

  mainWindow.removeMenu();
  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (isAllowedExternalUrl(targetUrl)) void shell.openExternal(targetUrl);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    if (targetUrl.startsWith(url)) return;
    event.preventDefault();
    if (isAllowedExternalUrl(targetUrl)) void shell.openExternal(targetUrl);
  });
  mainWindow.on("close", (event) => {
    if (allowWindowClose) return;
    event.preventDefault();
    void requestQuitFromRenderer();
  });
  mainWindow.once("ready-to-show", () => {
    if (!smokeTest) mainWindow.show();
  });
  mainWindow.webContents.once("did-finish-load", async () => {
    if (!smokeTest) return;
    clearTimeout(smokeDeadline);
    try {
      const capabilities = await mainWindow.webContents.executeJavaScript(`({
        appVersion: document.querySelector("meta[name='badge-blur-version']")?.content || null,
        directoryPicker: typeof window.showDirectoryPicker === "function",
        openExportFolderBridge:
          typeof window.badgeBlurDesktop?.openExportFolder === "function",
        manifestRecoveryBridge:
          typeof window.badgeBlurDesktop?.recoverManifestSource === "function" &&
          typeof window.badgeBlurDesktop?.readRecoveredSource === "function",
        localOnly: location.hostname === "127.0.0.1",
        userAgentIncludesElectron: navigator.userAgent.includes("Electron")
      })`);
      const passed =
        capabilities.directoryPicker &&
        capabilities.openExportFolderBridge &&
        capabilities.manifestRecoveryBridge &&
        capabilities.localOnly &&
        capabilities.userAgentIncludesElectron;
      console.log(
        `BADGE_BLUR_ELECTRON_SMOKE ${JSON.stringify({ passed, ...capabilities })}`,
      );
      if (!passed) requestedExitCode = 1;
    } catch (error) {
      requestedExitCode = 1;
      console.error("Electron smoke test failed.", error);
    }
    await beginQuit();
  });
  mainWindow.webContents.once(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
      if (!smokeTest || !isMainFrame) return;
      clearTimeout(smokeDeadline);
      requestedExitCode = 1;
      console.error(
        `Electron smoke page failed to load (${errorCode}): ${errorDescription} · ${validatedUrl}`,
      );
      void beginQuit();
    },
  );
  if (smokeTest) {
    smokeDeadline = setTimeout(() => {
      requestedExitCode = 1;
      console.error(
        `Electron smoke page timed out · loading=${mainWindow?.webContents.isLoading()} · ${mainWindow?.webContents.getURL()}`,
      );
      void beginQuit();
    }, 30_000);
  }

  void mainWindow.loadURL(url);
}

function isAllowedExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "mailto:";
  } catch {
    return false;
  }
}

async function beginQuit({ serverAlreadyStopped = false } = {}) {
  if (quitting) return;
  quitting = true;

  if (!serverAlreadyStopped) {
    await stopLocalServer();
  }

  allowWindowClose = true;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy();
  }
  const forcedAppExit = setTimeout(() => {
    process.exit(requestedExitCode);
  }, 1_000);
  forcedAppExit.unref();
  app.exit(requestedExitCode);
}

async function requestQuitFromRenderer() {
  if (preparingRendererQuit || quitting) return;
  if (
    smokeTest ||
    !mainWindow ||
    mainWindow.isDestroyed() ||
    mainWindow.webContents.isLoading()
  ) {
    await beginQuit();
    return;
  }

  preparingRendererQuit = true;
  try {
    const approved = await mainWindow.webContents.executeJavaScript(
      "window.__badgeBlurPrepareToQuit?.() ?? true",
    );
    if (approved) {
      await beginQuit();
    }
  } catch (error) {
    console.warn(`Could not prepare the renderer to quit: ${error.message}`);
    await beginQuit();
  } finally {
    preparingRendererQuit = false;
  }
}

async function stopLocalServer() {
  const activeProcess = serverProcess;
  const activeUrl = serverUrl;
  if (!activeProcess) return;

  try {
    const statusResponse = await fetch(`${activeUrl}api/status`, {
      signal: AbortSignal.timeout(1_500),
    });
    const status = await statusResponse.json();
    await fetch(`${activeUrl}api/shutdown`, {
      method: "POST",
      headers: {
        "X-Badge-Lifecycle-Token": status.lifecycleToken,
      },
      signal: AbortSignal.timeout(1_500),
    });
  } catch (error) {
    console.warn(`Graceful service shutdown was unavailable: ${error.message}`);
  }

  await Promise.race([
    serverExitPromise,
    new Promise((resolveWait) =>
      setTimeout(resolveWait, SERVER_STOP_TIMEOUT_MS),
    ),
  ]);

  if (serverProcess) {
    serverProcess.kill();
    await Promise.race([
      serverExitPromise,
      new Promise((resolveWait) => setTimeout(resolveWait, 1_500)),
    ]);
  }
}
