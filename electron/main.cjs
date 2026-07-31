const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  session,
  shell,
  utilityProcess,
} = require("electron");
const {
  RUN_FOLDER_PATTERN,
  resolveDiscoveredExportFolder,
  resolveVerifiedExportFolder,
} = require("./export-folder.cjs");
const { recoverManifestSource } = require("./manifest-source.cjs");
const {
  installLocalOnlyNetworkPolicy,
} = require("./network-policy.cjs");

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
  if (!folder && process.platform === "darwin") {
    folder = resolveMacExportFolder(request);
  }
  if (!folder) {
    throw new Error(
      `Finder could not locate ${runFolderName}. The exported files remain saved in the source folder's exports directory.`,
    );
  }
  const error = await shell.openPath(folder);
  if (error) throw new Error(error);
  return true;
});

function resolveMacExportFolder(request) {
  if (!RUN_FOLDER_PATTERN.test(String(request?.runFolderName || ""))) {
    return null;
  }
  const names = [
    request.runFolderName,
    request.sourceRootName,
    request.customExportRootName,
  ].filter((name, index, values) =>
    typeof name === "string" &&
    name.length > 0 &&
    name.length <= 255 &&
    values.indexOf(name) === index,
  );
  const searchResults = [];
  for (const name of names) {
    try {
      const escapedName = name.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
      const output = execFileSync(
        "/usr/bin/mdfind",
        [`kMDItemFSName == "${escapedName}"c`],
        { encoding: "utf8", timeout: 3_000, maxBuffer: 1024 * 1024 },
      );
      searchResults.push(...output.split(/\r?\n/).filter(Boolean));
    } catch {
      // A missing or temporarily unavailable Spotlight result is handled by
      // the normal verified-path failure below; never open an unverified path.
    }
  }
  return resolveDiscoveredExportFolder({
    ...request,
    searchResults,
  });
}

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
    installLocalOnlyNetworkPolicy(session.defaultSession);
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
      const capabilities = await mainWindow.webContents.executeJavaScript(`(async () => {
        const wait = (milliseconds) =>
          new Promise((resolve) => setTimeout(resolve, milliseconds));
        const mediaCenterMetrics = (viewer, media) => {
          if (!viewer || !media) return { centered: false, missing: true };
          const viewerRect = viewer.getBoundingClientRect();
          const mediaRect = media.getBoundingClientRect();
          const stage = viewer.querySelector(".viewer-content");
          const stageRect = stage?.getBoundingClientRect();
          const viewportCenter =
            viewerRect.left + viewer.clientLeft + viewer.clientWidth / 2;
          const mediaCenter = mediaRect.left + mediaRect.width / 2;
          return {
            centered: Math.abs(mediaCenter - viewportCenter) <= 2,
            offset: Number((mediaCenter - viewportCenter).toFixed(2)),
            viewerLeft: Number(viewerRect.left.toFixed(2)),
            viewerWidth: Number(viewerRect.width.toFixed(2)),
            viewerClientLeft: viewer.clientLeft,
            viewerClientWidth: viewer.clientWidth,
            viewerScrollLeft: viewer.scrollLeft,
            stageLeft: stageRect ? Number(stageRect.left.toFixed(2)) : null,
            stageWidth: stageRect ? Number(stageRect.width.toFixed(2)) : null,
            mediaLeft: Number(mediaRect.left.toFixed(2)),
            mediaWidth: Number(mediaRect.width.toFixed(2)),
            mediaHidden: media.hidden,
            mediaStyleLeft: media.style.left,
            mediaStyleWidth: media.style.width,
          };
        };
        const result = {
          appVersion:
            document.querySelector("meta[name='badge-blur-version']")?.content ||
            null,
          directoryPicker: typeof window.showDirectoryPicker === "function",
          openExportFolderBridge:
            typeof window.badgeBlurDesktop?.openExportFolder === "function",
          manifestRecoveryBridge:
            typeof window.badgeBlurDesktop?.recoverManifestSource === "function" &&
            typeof window.badgeBlurDesktop?.readRecoveredSource === "function",
          localOnly: location.hostname === "127.0.0.1",
          userAgentIncludesElectron: navigator.userAgent.includes("Electron"),
          setupStageOnly:
            document.body.dataset.workflowStage === "setup" &&
            !document.querySelector("#setupPanel")?.hidden &&
            document.querySelector("#reviewSection")?.hidden === true,
          viewportFitted:
            document.documentElement.scrollHeight <= window.innerHeight + 1
        };

        result.externalRequestBlocked = await fetch(
          "https://example.com/badge-blur-network-policy-test",
        ).then(() => false, () => true);

        const smoke = window.__badgeBlurReviewSmoke;
        if (!smoke) return { ...result, reviewSmokeAvailable: false };
        await smoke.loadFixture();
        const cacheStatus = await fetch("/api/status", {
          cache: "no-store",
        }).then((response) => response.json());
        const sourceCacheActive =
          cacheStatus.sourceCacheItems >= 2 &&
          cacheStatus.sourceCacheBytes > 0;
        const reducedMotion = window.matchMedia(
          "(prefers-reduced-motion: reduce)"
        ).matches;
        const reviewGuidanceButton = document.querySelector(".review-image");
        const reviewGuidedAction =
          reviewGuidanceButton?.textContent.trim() ===
            "Save, review & next →" &&
          reviewGuidanceButton.classList.contains("is-guided-action") &&
          (reducedMotion ||
            getComputedStyle(reviewGuidanceButton).animationName !== "none");
        const startGuidance = smoke.previewStartGuidance();
        const startGuidedAction =
          startGuidance.guided &&
          (reducedMotion || startGuidance.animationName !== "none");
        smoke.simulateBatchProcessing(true);
        await wait(25);
        const processingEdgeStyle = getComputedStyle(document.body, "::after");
        const processingEdgeGuidance =
          document.body.classList.contains("is-batch-processing") &&
          processingEdgeStyle.position === "fixed" &&
          processingEdgeStyle.pointerEvents === "none" &&
          processingEdgeStyle.boxShadow !== "none" &&
          (reducedMotion || processingEdgeStyle.animationName !== "none");
        smoke.simulateBatchProcessing(false);
        const processingEdgeClears =
          !document.body.classList.contains("is-batch-processing");
        document
          .querySelector('[data-filmstrip-id^="image-1-"]')
          ?.click();
        await wait(50);
        smoke.showProcessingComplete();
        await wait(25);
        const processingOverlay = document.querySelector(
          "#processingCompleteOverlay"
        );
        const processingOverlayStyle = processingOverlay
          ? getComputedStyle(processingOverlay)
          : null;
        const processingCompletionVisible =
          processingOverlay?.hidden === false &&
          processingOverlayStyle?.position === "fixed" &&
          processingOverlayStyle?.backgroundImage.includes("gradient") &&
          document.querySelector("#reviewPhotosButton")?.textContent.trim() ===
            "Review photos →" &&
          Boolean(document.querySelector(".processing-complete-check svg"));
        document.querySelector("#reviewPhotosButton")?.click();
        await wait(100);
        const processingReviewState = smoke.state();
        const processingCompletionStartsReview =
          processingOverlay?.hidden === true &&
          processingReviewState.activeIndex === 0 &&
          processingReviewState.workflowStage === "review";
        smoke.refreshLayouts();
        await wait(25);
        const batchStartCenter = mediaCenterMetrics(
          document.querySelector(".canvas-wrap"),
          document.querySelector(".canvas-wrap canvas"),
        );
        const photoCenteredAtBatchStart = batchStartCenter.centered;
        document.querySelector(".fit-view")?.click();
        smoke.refreshLayouts();
        await wait(25);
        const fitCenter = mediaCenterMetrics(
          document.querySelector(".canvas-wrap"),
          document.querySelector(".canvas-wrap canvas"),
        );
        const photoCentered = fitCenter.centered;
        const bodyStyle = getComputedStyle(document.body);
        const backgroundDoesNotRepeat =
          bodyStyle.backgroundRepeat === "no-repeat" &&
          bodyStyle.backgroundAttachment === "fixed";
        const reviewAssist = document.querySelector("#attentionQueueButton");
        const neutralReadyForReview =
          reviewAssist?.textContent.trim() === "All images ready for review" &&
          reviewAssist.disabled &&
          !reviewAssist.classList.contains("has-attention") &&
          getComputedStyle(reviewAssist, "::before").content === "none";
        const outputFormatOptions = [
          ...document.querySelectorAll("#outputFormatInput option"),
        ].map((option) => option.value);
        const exportFormatSelectable =
          ["original", "jpeg", "png", "tiff", "webp"].every((format) =>
            outputFormatOptions.includes(format),
          );
        const outputFormatAskedDuringSetup =
          !document.querySelector("#outputFormatInput")?.closest("details") &&
          document.querySelector("#outputFormatInput option")?.value === "";
        const progressMeta = document.querySelector(".progress-meta");
        const progressTimer = document.querySelector("#progressTimer");
        const processingTimerRightAligned =
          getComputedStyle(progressMeta).display === "flex" &&
          getComputedStyle(progressMeta).justifyContent === "space-between" &&
          getComputedStyle(progressTimer).textAlign === "right";
        const viewerWheelEvent = new WheelEvent("wheel", {
          deltaY: 120,
          bubbles: true,
          cancelable: true,
        });
        document.querySelector(".canvas-wrap")?.dispatchEvent(viewerWheelEvent);
        const normalViewerWheelNotCaptured =
          !viewerWheelEvent.defaultPrevented &&
          getComputedStyle(document.querySelector(".canvas-wrap"))
            .overscrollBehaviorY !== "contain";
        document.querySelector(".next-mask")?.click();
        document.querySelector(".next-mask")?.click();
        await wait(25);
        const navigationState = smoke.state();
        const activeFilmstripItem = document.querySelector(
          ".filmstrip-item.is-active",
        );
        const activeFilmstripStyle = activeFilmstripItem
          ? getComputedStyle(activeFilmstripItem)
          : null;
        const filmstripSelectionVisible =
          activeFilmstripItem?.getAttribute("aria-current") === "true" &&
          activeFilmstripStyle?.zIndex === "2" &&
          activeFilmstripStyle?.boxShadow !== "none";

        const slider = document.querySelector(".mask-strength-input");
        slider.value = "8";
        slider.dispatchEvent(new Event("input", { bubbles: true }));
        await wait(25);
        const strengthState = smoke.state();
        smoke.simulateOtherImageProcessing(true);
        const concurrentEditing =
          !document.querySelector(".mask-strength-input")?.disabled &&
          !document.querySelector(".remove-box")?.disabled &&
          !document.querySelector(".review-image")?.disabled &&
          !document.querySelector(".export-one")?.disabled;
        smoke.simulateOtherImageProcessing(false);

        document.querySelector(".zoom-in")?.click();
        await wait(25);
        const zoomState = smoke.state();
        const adobeStyleZoom =
          zoomState.viewScaleMode === "zoom" &&
          zoomState.viewZoom === 1.25 &&
          document.querySelector(".zoom-level")?.textContent === "125%";
        const integratedReviewState =
          zoomState.reviewControl?.startsWith("Centered image") &&
          document.querySelector(".review-image")?.textContent?.startsWith(
            "Save, review",
          );

        document
          .querySelector('[data-filmstrip-id^="image-1-"]')
          ?.click();
        await wait(75);
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Delete", bubbles: true })
        );
        const inactiveDeleteState = smoke.state();
        document.querySelector(".next-mask")?.click();
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Delete", bubbles: true })
        );
        const activeDeleteState = smoke.state();

        document
          .querySelector('[data-filmstrip-id^="image-0-"]')
          ?.click();
        await wait(75);
        document.querySelector(".fill-view")?.click();
        const viewer = document.querySelector(".canvas-wrap");
        const frame = document.querySelector(".viewer-frame");
        const filmstrip = document.querySelector(".filmstrip");
        for (let attempt = 0; attempt < 40; attempt += 1) {
          if (
            frame.getBoundingClientRect().height >
              Number(frame.dataset.baseHeight || 0) + 2 &&
            document.body.scrollHeight > window.innerHeight
          ) {
            break;
          }
          await wait(25);
        }
        const fillExpandsPage =
          frame.getBoundingClientRect().height >
            Number(frame.dataset.baseHeight || 0) + 2 &&
          viewer.scrollHeight <= viewer.clientHeight + 2 &&
          document.body.scrollHeight > window.innerHeight;
        window.scrollTo(0, document.body.scrollHeight);
        await wait(25);
        const pageScrollWorks = window.scrollY > 0;
        const filmstripJoinedToBatchBar =
          filmstrip?.parentElement?.classList.contains("batch-dock") === true;
        const outputFormatInput = document.querySelector("#outputFormatInput");
        outputFormatInput.value = "jpeg";
        outputFormatInput.dispatchEvent(
          new Event("change", { bubbles: true })
        );
        document.querySelector(".export-one")?.click();
        const manualSaveQueuedState = smoke.state();
        const manualSaveFeedback =
          /queued|saving/i.test(manualSaveQueuedState.exportStatus || "");
        let manualSaveCompleted = false;
        let manualJpegExport = false;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const saveState = smoke.state();
          if (
            !saveState.exportInFlight &&
            saveState.exportQueueCount === 0 &&
            /after preview ready/i.test(saveState.exportStatus || "")
          ) {
            manualSaveCompleted = true;
            manualJpegExport = saveState.imageInfoOutputFormat === "jpeg";
            break;
          }
          await wait(50);
        }
        document.querySelector(".review-image")?.click();
        await wait(100);
        const reviewAdvanceState = smoke.state();
        const reviewSaveAndAdvance =
          reviewAdvanceState.activeIndex === 1 &&
          reviewAdvanceState.reviewConfirmations[0] === true;
        const manualMaskAfterState = await smoke.addManualMaskAndShowAfter();
        const manualMaskAfterRegenerated =
          manualMaskAfterState.redactedPreviewRevision ===
            manualMaskAfterState.editRevision &&
          manualMaskAfterState.redactedPreviewBytes > 0;
        document.querySelector(".review-image")?.click();
        let finalReviewOffersExport = false;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const finalReviewState = smoke.state();
          if (
            finalReviewState.reviewButtonAction === "export" &&
            finalReviewState.reviewButtonText === "Export all →"
          ) {
            finalReviewOffersExport = true;
            break;
          }
          await wait(25);
        }
        smoke.playConfetti();
        await wait(25);
        const confettiOverlay = document.querySelector("#confettiOverlay");
        const silentConfettiReady =
          window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
          (confettiOverlay?.hidden === false &&
            confettiOverlay?.childElementCount === 72);

        return {
          ...result,
          reviewSmokeAvailable: true,
          sourceCacheActive,
          reviewGuidedAction,
          startGuidedAction,
          processingEdgeGuidance,
          processingEdgeClears,
          processingCompletionVisible,
          processingCompletionStartsReview,
          photoCenteredAtBatchStart,
          photoCentered,
          batchStartCenter,
          fitCenter,
          backgroundDoesNotRepeat,
          neutralReadyForReview,
          exportFormatSelectable,
          outputFormatAskedDuringSetup,
          processingTimerRightAligned,
          normalViewerWheelNotCaptured,
          badgeNavigation:
            navigationState.inspectorTitle === "Badge 2 of 2",
          filmstripSelectionVisible,
          perBadgeStrength:
            strengthState.selectedStrength === 8,
          concurrentEditing,
          adobeStyleZoom,
          integratedReviewState,
          manualSaveFeedback,
          manualSaveCompleted,
          manualJpegExport,
          reviewSaveAndAdvance,
          manualMaskAfterRegenerated,
          finalReviewOffersExport,
          silentConfettiReady,
          inactiveDeleteProtected:
            inactiveDeleteState.boxCounts[0] === 2 &&
            inactiveDeleteState.boxCounts[1] === 1,
          activeDeleteScoped:
            activeDeleteState.boxCounts[0] === 2 &&
            activeDeleteState.boxCounts[1] === 0,
          reviewProgress:
            navigationState.summary.startsWith("Image 1 of 2"),
          reviewStage:
            navigationState.workflowStage === "review",
          fillExpandsPage,
          pageScrollWorks,
          filmstripJoinedToBatchBar,
          reviewUsesDocumentScroll:
            getComputedStyle(document.body).overflowY === "auto" &&
            pageScrollWorks
        };
      })()`);
      mainWindow.setSize(1100, 720);
      await new Promise((resolve) => setTimeout(resolve, 150));
      capabilities.shortWindowPhotoVisible =
        await mainWindow.webContents.executeJavaScript(`(() => {
          const viewer = document.querySelector(".viewer-frame");
          const canvas = document.querySelector(".canvas-wrap canvas");
          const afterImage = document.querySelector(
            ".canvas-wrap .after-preview:not([hidden])"
          );
          const viewerRect = viewer?.getBoundingClientRect();
          const photoRect = (
            afterImage || canvas
          )?.getBoundingClientRect();
          return (
            document.body.scrollHeight > window.innerHeight &&
            getComputedStyle(document.body).overflowY === "auto" &&
            viewerRect?.height >= 380 &&
            photoRect?.width > 0 &&
            photoRect?.height > 0
          );
        })()`);
      const passed =
        capabilities.directoryPicker &&
        capabilities.openExportFolderBridge &&
        capabilities.manifestRecoveryBridge &&
        capabilities.localOnly &&
        capabilities.externalRequestBlocked &&
        capabilities.userAgentIncludesElectron &&
        capabilities.setupStageOnly &&
        capabilities.viewportFitted &&
        capabilities.reviewSmokeAvailable &&
        capabilities.sourceCacheActive &&
        capabilities.reviewGuidedAction &&
        capabilities.startGuidedAction &&
        capabilities.processingEdgeGuidance &&
        capabilities.processingEdgeClears &&
        capabilities.processingCompletionVisible &&
        capabilities.processingCompletionStartsReview &&
        capabilities.photoCenteredAtBatchStart &&
        capabilities.photoCentered &&
        capabilities.backgroundDoesNotRepeat &&
        capabilities.neutralReadyForReview &&
        capabilities.exportFormatSelectable &&
        capabilities.outputFormatAskedDuringSetup &&
        capabilities.processingTimerRightAligned &&
        capabilities.normalViewerWheelNotCaptured &&
        capabilities.badgeNavigation &&
        capabilities.filmstripSelectionVisible &&
        capabilities.perBadgeStrength &&
        capabilities.concurrentEditing &&
        capabilities.adobeStyleZoom &&
        capabilities.integratedReviewState &&
        capabilities.manualSaveFeedback &&
        capabilities.manualSaveCompleted &&
        capabilities.manualJpegExport &&
        capabilities.reviewSaveAndAdvance &&
        capabilities.manualMaskAfterRegenerated &&
        capabilities.finalReviewOffersExport &&
        capabilities.silentConfettiReady &&
        capabilities.inactiveDeleteProtected &&
        capabilities.activeDeleteScoped &&
        capabilities.reviewProgress &&
        capabilities.reviewStage &&
        capabilities.fillExpandsPage &&
        capabilities.pageScrollWorks &&
        capabilities.filmstripJoinedToBatchBar &&
        capabilities.reviewUsesDocumentScroll &&
        capabilities.shortWindowPhotoVisible;
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

  void mainWindow.loadURL(smokeTest ? `${url}?smoke=1` : url);
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
