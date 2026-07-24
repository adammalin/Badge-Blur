import { env, pipeline } from "@huggingface/transformers";
import {
  CLASSIFIER_LABELS,
  CLASSIFIER_MARGIN,
  CLASSIFIER_MODEL_ID,
  CLASSIFIER_POSITIVE_LABEL_COUNT,
  GLOBAL_CLASSIFIER_LABELS,
  GLOBAL_CLASSIFIER_MAX_SCORE,
  GLOBAL_CLASSIFIER_POSITIVE_LABEL_COUNT,
  GLOBAL_CLASSIFIER_REJECT_MARGIN,
  MODEL_ID,
  PERSON_THRESHOLD,
  TORSO_THRESHOLD,
} from "./detector-config.js";
import {
  classifierEvidence,
  globalClassifierDecision,
} from "./classifier-utils.js";
import {
  deduplicateBadgeDetections,
  filterBadgeDetections,
} from "./detection-utils.js";
import {
  createUniqueRunDirectory,
  findRunEntry,
  indexRunFiles,
  normalizeSourcePath,
  sourceRootName,
} from "./run-storage.js";
import {
  CHECKPOINT_DOCUMENT_TYPE,
  CHECKPOINT_SCHEMA_VERSION,
  checkpointStatusForItem,
  isBatchCheckpoint,
  recoveryStatusForEntry,
  shouldProcessItem,
  summarizeCheckpointFiles,
} from "./checkpoint.js";
import {
  describeWorkerSelection,
  normalizeWorkerPreference,
  resolveWorkerCount,
} from "./worker-policy.js";
import { runWorkerPool } from "./worker-pool.js";
import { maskDeleteControlCenter } from "./mask-controls.js";
import {
  loadActiveProjectCache,
  saveActiveProjectCache,
} from "./project-cache.js";
import {
  validateRunImport,
  validateSourceSelection,
} from "./run-import.js";

const APP_VERSION = "0.20.0";
const IMAGE_API_VERSION = 6;
const SUPPORTED_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "tif",
  "tiff",
  "webp",
  "avif",
  "heic",
  "heif",
]);
const CAROUSEL_RADIUS = 2;
const PROJECT_CACHE_DOCUMENT_TYPE = "badge-blur-active-project";
const PROJECT_CACHE_SCHEMA_VERSION = 1;

env.localModelPath = "/models/";
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.backends.onnx.wasm.wasmPaths = "/vendor/onnx/";

const elements = {
  chooseSourceButton: document.querySelector("#chooseSourceButton"),
  folderInput: document.querySelector("#folderInput"),
  sourceFolderLabel: document.querySelector("#sourceFolderLabel"),
  labelsInput: document.querySelector("#labelsInput"),
  enhancedInput: document.querySelector("#enhancedInput"),
  thresholdInput: document.querySelector("#thresholdInput"),
  thresholdOutput: document.querySelector("#thresholdOutput"),
  paddingInput: document.querySelector("#paddingInput"),
  paddingOutput: document.querySelector("#paddingOutput"),
  redactionStyleInput: document.querySelector("#redactionStyleInput"),
  redactionStyleHelp: document.querySelector("#redactionStyleHelp"),
  strengthInput: document.querySelector("#strengthInput"),
  strengthLabel: document.querySelector("#strengthLabel"),
  strengthOutput: document.querySelector("#strengthOutput"),
  strengthHelp: document.querySelector("#strengthHelp"),
  featherInput: document.querySelector("#featherInput"),
  featherOutput: document.querySelector("#featherOutput"),
  workerCountInput: document.querySelector("#workerCountInput"),
  workerCountHelp: document.querySelector("#workerCountHelp"),
  loadModelButton: document.querySelector("#loadModelButton"),
  runAllButton: document.querySelector("#runAllButton"),
  pauseWorkflowArrow: document.querySelector("#pauseWorkflowArrow"),
  exportWorkflowArrow: document.querySelector("#exportWorkflowArrow"),
  pauseResumeButton: document.querySelector("#pauseResumeButton"),
  exportAllButton: document.querySelector("#exportAllButton"),
  changeExportButton: document.querySelector("#changeExportButton"),
  resetExportButton: document.querySelector("#resetExportButton"),
  exportDestination: document.querySelector("#exportDestination"),
  batchTime: document.querySelector("#batchTime"),
  exportTime: document.querySelector("#exportTime"),
  exportLocationOptions: document.querySelector("#exportLocationOptions"),
  importRunButton: document.querySelector("#importRunButton"),
  runManifestInput: document.querySelector("#runManifestInput"),
  modelStatus: document.querySelector("#modelStatus"),
  progressWrap: document.querySelector("#progressWrap"),
  progressBar: document.querySelector("#progressBar"),
  progressText: document.querySelector("#progressText"),
  exportCompatibility: document.querySelector("#exportCompatibility"),
  summaryText: document.querySelector("#summaryText"),
  emptyState: document.querySelector("#emptyState"),
  reviewGrid: document.querySelector("#reviewGrid"),
  filmstrip: document.querySelector("#filmstrip"),
  pagination: document.querySelector("#pagination"),
  previousPageButton: document.querySelector("#previousPageButton"),
  nextPageButton: document.querySelector("#nextPageButton"),
  pageStatus: document.querySelector("#pageStatus"),
  completionBanner: document.querySelector("#completionBanner"),
  completionText: document.querySelector("#completionText"),
  openExportFolderButton: document.querySelector("#openExportFolderButton"),
  themeToggleButton: document.querySelector("#themeToggleButton"),
  quitAppButton: document.querySelector("#quitAppButton"),
  quitDialog: document.querySelector("#quitDialog"),
  quitDialogCancel: document.querySelector("#quitDialogCancel"),
  quitDialogSafe: document.querySelector("#quitDialogSafe"),
  quitDialogImmediate: document.querySelector("#quitDialogImmediate"),
};

let modelWorkers = [];
let items = [];
let running = false;
let pauseRequested = false;
let batchPaused = false;
let batchPromise = null;
let runState = "idle";
let batchOperation = null;
let activeIndex = 0;
let pageRenderToken = 0;
let importedManifest = null;
let serverReady = false;
let lifecycleToken = null;
let sourceDirectoryHandle = null;
let expectedSourceFolderName = null;
let customExportDirectoryHandle = null;
let activeRun = null;
let batchStartedAt = null;
let batchTimer = null;
let lastBatchDurationMs = null;
let lastBatchWorkerCount = null;
let exportStartedAt = null;
let exportTimer = null;
let lastExportDurationMs = null;
let computeBenchmarkScore = null;
let exportQueue = Promise.resolve();
let carouselRenderQueue = Promise.resolve();
const itemExportTimers = new Map();
let thumbnailObserver = null;
let cachedProject = null;
let projectCacheLoaded = false;
let restoringCachedProject = false;
let projectCacheTimer = null;

elements.thresholdInput.addEventListener("input", () => {
  elements.thresholdOutput.value = Number(elements.thresholdInput.value).toFixed(2);
});
elements.paddingInput.addEventListener("input", () => {
  elements.paddingOutput.value = `${elements.paddingInput.value}%`;
  redrawAll();
});
elements.strengthInput.addEventListener("input", () => {
  elements.strengthOutput.value = elements.strengthInput.value;
  updateRedactionStyleUI();
});
elements.featherInput.addEventListener("input", () => {
  elements.featherOutput.value = `${elements.featherInput.value}%`;
});
for (const input of [
  elements.paddingInput,
  elements.strengthInput,
  elements.featherInput,
]) {
  input.addEventListener("change", () => scheduleAllEditedExports());
}
elements.redactionStyleInput.addEventListener("change", () => {
  updateRedactionStyleUI();
  scheduleAllEditedExports();
});
elements.workerCountInput.addEventListener("change", updateWorkerCountUI);
for (const input of [
  elements.labelsInput,
  elements.enhancedInput,
  elements.thresholdInput,
  elements.paddingInput,
  elements.redactionStyleInput,
  elements.strengthInput,
  elements.featherInput,
  elements.workerCountInput,
]) {
  input.addEventListener("change", scheduleProjectCache);
}
elements.chooseSourceButton.addEventListener("click", chooseSourceFolder);
elements.folderInput.addEventListener("change", loadSelectedFiles);
elements.loadModelButton.addEventListener("click", loadModel);
elements.runAllButton.addEventListener("click", () => void startBatch());
elements.pauseResumeButton.addEventListener("click", () => {
  if (running) requestPause();
  else if (batchPaused) void startBatch();
});
elements.exportAllButton.addEventListener("click", exportAll);
elements.openExportFolderButton.addEventListener("click", openExportFolder);
elements.themeToggleButton.addEventListener("click", toggleTheme);
elements.changeExportButton.addEventListener("click", chooseCustomExportFolder);
elements.resetExportButton.addEventListener("click", useSourceExportFolder);
elements.importRunButton.addEventListener("click", () => {
  elements.runManifestInput.value = "";
  elements.runManifestInput.click();
});
elements.runManifestInput.addEventListener("change", importPreviousRun);
elements.previousPageButton.addEventListener("click", () => changeCarousel(-1));
elements.nextPageButton.addEventListener("click", () => changeCarousel(1));
elements.quitAppButton.addEventListener("click", quitBadgeBlur);
window.__badgeBlurPrepareToQuit = prepareForQuit;
if (typeof window.showDirectoryPicker !== "function") {
  elements.exportCompatibility.hidden = false;
}
document.addEventListener("keydown", (event) => {
  if (
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLSelectElement ||
    event.target instanceof HTMLTextAreaElement
  ) {
    return;
  }
  if (
    !running &&
    (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
    items.length > 1
  ) {
    event.preventDefault();
    void changeCarousel(event.key === "ArrowLeft" ? -1 : 1);
    return;
  }
  if (event.key !== "Delete" && event.key !== "Backspace") return;
  const selected = items.find((item) => item.selectedBoxId);
  if (selected) {
    event.preventDefault();
    removeSelectedBox(selected);
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") void persistProjectCache();
});
initializeTheme();
updateButtons();
updateRedactionStyleUI();
updateWorkerCountUI();
void verifyLocalServer();

function initializeTheme() {
  let storedTheme = null;
  try {
    storedTheme = localStorage.getItem("badge-blur-theme");
  } catch {
    // Use the operating-system preference when storage is unavailable.
  }
  const theme =
    storedTheme === "light" || storedTheme === "dark"
      ? storedTheme
      : window.matchMedia?.("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  applyTheme(theme);
}

function toggleTheme() {
  const nextTheme =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
  try {
    localStorage.setItem("badge-blur-theme", nextTheme);
  } catch {
    // The selected theme still applies for the current session.
  }
}

function applyTheme(theme) {
  const dark = theme === "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  elements.themeToggleButton.setAttribute("aria-pressed", String(dark));
  const label = dark ? "Use light mode" : "Use dark mode";
  elements.themeToggleButton.setAttribute("aria-label", label);
  elements.themeToggleButton.title = label;
}

async function verifyLocalServer() {
  try {
    const response = await fetch("/api/status", { cache: "no-store" });
    const contentType = response.headers.get("Content-Type") || "";
    if (!response.ok || !contentType.includes("application/json")) {
      throw new Error("The running local server is from an older app version.");
    }
    const status = await response.json();
    if (
      status.appVersion !== APP_VERSION ||
      status.apiVersion !== IMAGE_API_VERSION ||
      typeof status.lifecycleToken !== "string" ||
      status.lifecycleToken.length < 32
    ) {
      throw new Error(
        `Browser ${APP_VERSION} is connected to local server ` +
          `${status.appVersion || "unknown"}.`,
      );
    }
    lifecycleToken = status.lifecycleToken;
    serverReady = true;
    updateButtons();
    await loadModel();
    await restoreCachedProject();
  } catch (error) {
    console.error("Local server compatibility check failed.", error);
    serverReady = false;
    lifecycleToken = null;
    setModelStatus("error", "Restart required");
    showProgress(
      "This page is connected to an older Badge Blur server. Close old " +
        "Badge Blur windows, start this version again, and reload.",
      0,
    );
    updateButtons();
  }
}

async function quitBadgeBlur() {
  if (!serverReady || !lifecycleToken) return;
  if (!(await prepareForQuit())) return;

  const token = lifecycleToken;
  elements.quitAppButton.disabled = true;
  elements.quitAppButton.setAttribute("aria-label", "Shutting down Badge Blur");
  elements.quitAppButton.title = "Shutting down Badge Blur";

  try {
    const response = await fetch("/api/shutdown", {
      method: "POST",
      headers: {
        "X-Badge-Lifecycle-Token": token,
      },
    });
    const detail = await response.json().catch(() => ({}));
    if (!response.ok || !detail.shuttingDown) {
      throw new Error(detail.error || `Shutdown failed (${response.status}).`);
    }

    serverReady = false;
    lifecycleToken = null;
    running = false;
    stopBatchTimer();
    stopExportTimer();
    updateButtons();
    setModelStatus("idle", "App stopped");
    showProgress(
      "Badge Blur has shut down and released its local server. You can close this browser tab.",
      100,
    );
    elements.quitAppButton.setAttribute("aria-label", "Badge Blur stopped");
    elements.quitAppButton.title = "Badge Blur stopped";
  } catch (error) {
    console.error("Badge Blur shutdown failed.", error);
    elements.quitAppButton.disabled = false;
    elements.quitAppButton.setAttribute("aria-label", "Quit Badge Blur");
    elements.quitAppButton.title = `Quit Badge Blur · ${error.message}`;
  }
}

async function prepareForQuit() {
  if (!running) {
    if (batchPaused) {
      await exportQueue.catch(() => undefined);
      await writeRunMetadata("paused");
    }
    return true;
  }

  const choice = await chooseRunningQuitMode();
  if (choice === "cancel") return false;
  if (choice === "immediate") return true;

  requestPause();
  await batchPromise;
  await exportQueue.catch(() => undefined);
  await writeRunMetadata(batchPaused ? "paused" : runState);
  return true;
}

function chooseRunningQuitMode() {
  if (!elements.quitDialog?.showModal) {
    return Promise.resolve(
      window.confirm(
        "Pause safely before quitting? Active images will finish and save first.",
      )
        ? "safe"
        : "cancel",
    );
  }

  return new Promise((resolveChoice) => {
    const finish = (choice) => {
      elements.quitDialog.close();
      elements.quitDialogCancel.removeEventListener("click", cancel);
      elements.quitDialogSafe.removeEventListener("click", safe);
      elements.quitDialogImmediate.removeEventListener("click", immediate);
      elements.quitDialog.removeEventListener("cancel", dismiss);
      resolveChoice(choice);
    };
    const cancel = () => finish("cancel");
    const safe = () => finish("safe");
    const immediate = () => finish("immediate");
    const dismiss = (event) => {
      event.preventDefault();
      finish("cancel");
    };
    elements.quitDialogCancel.addEventListener("click", cancel, { once: true });
    elements.quitDialogSafe.addEventListener("click", safe, { once: true });
    elements.quitDialogImmediate.addEventListener("click", immediate, {
      once: true,
    });
    elements.quitDialog.addEventListener("cancel", dismiss, { once: true });
    elements.quitDialog.showModal();
  });
}

async function chooseSourceFolder({ promptedByImport = false } = {}) {
  if (!serverReady || running) return;
  if (typeof window.showDirectoryPicker !== "function") {
    elements.folderInput.click();
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({
      id: "badge-remover-source",
      mode: "readwrite",
    });
    const selected = await collectDirectoryImages(handle);
    validateSourceSelection(importedManifest, selected);
    sourceDirectoryHandle = handle;
    expectedSourceFolderName = null;
    elements.chooseSourceButton.textContent = "Choose source folder";
    customExportDirectoryHandle = null;
    await prepareCachedProjectForSource(handle.name);
    if (!isBatchCheckpoint(importedManifest) || !activeRun) {
      activeRun = null;
    }
    elements.sourceFolderLabel.textContent =
      `${handle.name} · ${selected.length} supported image${selected.length === 1 ? "" : "s"}`;
    updateExportDestination();
    await setSelectedFiles(selected);
  } catch (error) {
    if (error.name !== "AbortError") {
      console.error(error);
      showProgress(`Could not open the source folder: ${error.message}`, 0);
    } else if (promptedByImport && expectedSourceFolderName) {
      showProgress(
        `Run file loaded. Choose the original source folder named ${expectedSourceFolderName}.`,
        100,
      );
    }
  }
}

async function collectDirectoryImages(directory, prefix = "") {
  const selected = [];
  for await (const [name, handle] of directory.entries()) {
    if (handle.kind === "directory") {
      if (name.toLowerCase() === "exports") continue;
      selected.push(
        ...(await collectDirectoryImages(handle, `${prefix}${name}/`)),
      );
      continue;
    }
    if (!SUPPORTED_EXTENSIONS.has(fileExtension(name))) continue;
    selected.push({
      file: await handle.getFile(),
      relativePath: `${prefix}${name}`,
    });
  }
  return selected.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function loadSelectedFiles(event) {
  try {
    const selected = [...event.target.files]
      .filter((file) => SUPPORTED_EXTENSIONS.has(fileExtension(file.name)))
      .map((file) => ({
        file,
        relativePath: fallbackRelativePath(file),
      }))
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    validateSourceSelection(importedManifest, selected);
    sourceDirectoryHandle = null;
    expectedSourceFolderName = null;
    elements.chooseSourceButton.textContent = "Choose source folder";
    customExportDirectoryHandle = null;
    if (!isBatchCheckpoint(importedManifest) || !activeRun) {
      activeRun = null;
    }
    await prepareCachedProjectForSource(
      sourceRootName(selected[0]?.file) || "Selected folder",
    );
    elements.sourceFolderLabel.textContent =
      `${sourceRootName(selected[0]?.file) || "Selected folder"} · ${selected.length} supported image${selected.length === 1 ? "" : "s"}`;
    updateExportDestination();
    await setSelectedFiles(selected);
  } catch (error) {
    console.error(error);
    showProgress(`Could not open the source folder: ${error.message}`, 0);
  }
}

async function setSelectedFiles(selected) {
  releaseItems();
  thumbnailObserver?.disconnect();
  thumbnailObserver = null;
  for (const timer of itemExportTimers.values()) clearTimeout(timer);
  itemExportTimers.clear();
  items = selected.map(({ file, relativePath }, index) => ({
    id: `image-${index}-${crypto.randomUUID()}`,
    file,
    relativePath,
    width: null,
    height: null,
    imageInfo: null,
    decodeError: null,
    previewUrl: null,
    previewImage: null,
    previewPromise: null,
    thumbnailUrl: null,
    thumbnailPromise: null,
    processing: false,
    workerNumber: null,
    boxes: [],
    modelBoxes: [],
    selectedBoxId: null,
    viewMode: "before",
    redactedPreviewUrl: null,
    redactedPreviewRevision: -1,
    editRevision: 0,
    exportRevision: -1,
    exportStatus: "Waiting for batch",
    timing: null,
    status: "queued",
    message: "Waiting for detection",
  }));
  activeIndex = 0;
  pauseRequested = false;
  batchPaused = false;
  runState = activeRun ? "paused" : "idle";
  lastBatchDurationMs = null;
  lastBatchWorkerCount = null;
  lastExportDurationMs = null;
  exportStartedAt = null;
  stopExportTimer();
  updateBatchTime();
  updateExportTime();
  hideCompletion();

  elements.emptyState.hidden = items.length > 0;
  renderFilmstrip();
  await renderCarousel();
  await restoreImportedRun();
  updateSummary();
  updateButtons();
  scheduleProjectCache();
}

async function importPreviousRun(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const document = JSON.parse(await file.text());
    const importInfo = validateRunImport(file.name, document);
    if (isBatchCheckpoint(document)) {
      await attachCheckpointRunDirectory(document);
    } else {
      activeRun = null;
    }
    importedManifest = document;
    expectedSourceFolderName = importInfo.sourceRootName;
    restoreRunSettings(document);
    if (items.length === 0) {
      if (await restoreFromKnownSource(document)) return;
      showProgress(
        isBatchCheckpoint(document)
          ? `Checkpoint and run folder loaded. Choose the original source folder named ${importInfo.sourceRootName}.`
          : `Previous run loaded for ${importInfo.fileCount} image(s). Choose the original source folder named ${importInfo.sourceRootName}.`,
        100,
      );
      elements.chooseSourceButton.textContent =
        `Choose “${importInfo.sourceRootName}” folder`;
      await chooseSourceFolder({ promptedByImport: true });
      return;
    }
    await restoreImportedRun();
  } catch (error) {
    console.error(error);
    importedManifest = null;
    expectedSourceFolderName = null;
    elements.chooseSourceButton.textContent = "Choose source folder";
    showProgress(`Could not import the previous run: ${error.message}`, 0);
  }
}

async function restoreFromKnownSource(manifest) {
  const candidates = [
    sourceDirectoryHandle,
    cachedProject?.sourceDirectoryHandle,
  ].filter(Boolean);
  for (const handle of candidates) {
    if (handle.name !== manifest.sourceRootName) continue;
    if ((await directoryPermission(handle, "readwrite", true)) !== "granted") {
      continue;
    }
    try {
      const selected = await collectDirectoryImages(handle);
      validateSourceSelection(manifest, selected);
      sourceDirectoryHandle = handle;
      expectedSourceFolderName = null;
      customExportDirectoryHandle = null;
      if (!isBatchCheckpoint(manifest) || !activeRun) {
        activeRun = null;
      }
      elements.chooseSourceButton.textContent = "Choose source folder";
      elements.sourceFolderLabel.textContent =
        `${handle.name} · ${selected.length} supported image${selected.length === 1 ? "" : "s"}`;
      updateExportDestination();
      await setSelectedFiles(selected);
      return true;
    } catch (error) {
      console.warn("A saved source-folder permission did not match this run.", error);
    }
  }
  return false;
}

async function attachCheckpointRunDirectory(checkpoint) {
  if (typeof window.showDirectoryPicker !== "function") {
    throw new Error(
      "Checkpoint recovery requires the Badge Blur Electron folder picker.",
    );
  }
  const directory = await window.showDirectoryPicker({
    id: "badge-blur-resume-run",
    mode: "readwrite",
  });
  if (directory.name !== checkpoint.runFolderName) {
    throw new Error(
      `Choose the original run folder named ${checkpoint.runFolderName}.`,
    );
  }
  let selectedCheckpoint;
  try {
    const checkpointHandle = await directory.getFileHandle(
      "badge-blur-checkpoint.json",
    );
    selectedCheckpoint = JSON.parse(
      await (await checkpointHandle.getFile()).text(),
    );
  } catch {
    throw new Error(
      "That folder does not contain a readable badge-blur-checkpoint.json.",
    );
  }
  if (
    !isBatchCheckpoint(selectedCheckpoint) ||
    selectedCheckpoint.runId !== checkpoint.runId
  ) {
    throw new Error(
      "That folder belongs to a different Badge Blur run. Choose the exact run folder that contains the imported checkpoint.",
    );
  }
  activeRun = {
    directory,
    runId: checkpoint.runId,
    runFolderName: checkpoint.runFolderName,
    parentLabel: "Resumed existing run",
    generatedAt: checkpoint.generatedAt || new Date().toISOString(),
  };
  updateExportDestination();
}

function restoreRunSettings(manifest) {
  const settings = [
    [elements.thresholdInput, elements.thresholdOutput, manifest.threshold, (v) => Number(v).toFixed(2)],
    [elements.paddingInput, elements.paddingOutput, manifest.paddingPercent, (v) => `${v}%`],
    [elements.strengthInput, elements.strengthOutput, manifest.redactionStrength, String],
    [elements.featherInput, elements.featherOutput, manifest.featherPercent, (v) => `${v}%`],
  ];
  for (const [input, output, value, format] of settings) {
    if (value === undefined || value === null) continue;
    input.value = String(value);
    output.value = format(value);
  }
  elements.redactionStyleInput.value =
    manifest.redactionStyle === "gaussian" ? "gaussian" : "mosaic";
  elements.strengthOutput.value = elements.strengthInput.value;
  updateRedactionStyleUI();
  elements.workerCountInput.value = normalizeWorkerPreference(
    manifest.workerPreference,
  );
  updateWorkerCountUI();
  if (manifest.detectionPhrases) {
    elements.labelsInput.value = normalizeGroundingPrompt(
      manifest.detectionPhrases,
    );
  }
  if (typeof manifest.enhancedTorsoRescue === "boolean") {
    elements.enhancedInput.checked = manifest.enhancedTorsoRescue;
  }
}

async function restoreImportedRun() {
  if (!importedManifest || items.length === 0) return;
  const checkpoint = isBatchCheckpoint(importedManifest);
  const runFileIndex = indexRunFiles(importedManifest.files);
  let restored = 0;
  let mismatched = 0;
  let completed = 0;
  let pending = 0;
  for (const item of items) {
    const entry = findRunEntry(runFileIndex, sourceRelativePath(item));
    if (!entry) continue;
    const sizeChanged =
      entry.byteSize != null && Number(entry.byteSize) !== item.file.size;
    const modifiedChanged =
      checkpoint &&
      entry.lastModifiedMilliseconds != null &&
      Number(entry.lastModifiedMilliseconds) !== item.file.lastModified;
    if (sizeChanged || modifiedChanged) {
      item.status = "error";
      item.message = "Previous-run match skipped: source file changed";
      mismatched += 1;
      continue;
    }
    item.boxes = (entry.reviewedMasks || []).map(deserializeMask);
    item.modelBoxes = (entry.initialModelMasks || []).map(deserializeMask);
    item.selectedBoxId = null;
    item.imageInfo = entry.imageInfo || null;
    item.editRevision = Math.max(0, Number(entry.editRevision) || 0);
    if (checkpoint) {
      const recoveryStatus = recoveryStatusForEntry(entry);
      if (recoveryStatus === "completed") {
        item.status = "detected";
        item.exportRevision = item.editRevision;
        item.exportedAt = entry.exportedAt || null;
        item.message =
          `${item.boxes.length} saved mask${item.boxes.length === 1 ? "" : "s"} recovered`;
        item.exportStatus = "Recovered · already saved";
        completed += 1;
      } else if (recoveryStatus === "export-pending") {
        item.status = "detected";
        item.exportRevision = -1;
        item.message =
          `${item.boxes.length} mask${item.boxes.length === 1 ? "" : "s"} recovered`;
        item.exportStatus = "Recovered · export pending";
        pending += 1;
      } else {
        item.status = "queued";
        item.exportRevision = -1;
        item.message =
          entry.checkpointStatus === "active"
            ? "Interrupted during processing · ready to retry"
            : "Waiting to resume";
        item.exportStatus = "Checkpoint restored · detection pending";
        pending += 1;
      }
    } else {
      item.status = "detected";
      item.message = `${item.boxes.length} mask${item.boxes.length === 1 ? "" : "s"} restored`;
      item.editRevision += 1;
      item.exportStatus = "Restored · awaiting export";
    }
    restored += 1;
  }
  if (checkpoint) {
    batchPaused = pending > 0;
    pauseRequested = false;
    runState = batchPaused ? "paused" : "completed";
  }
  activeIndex = 0;
  renderFilmstrip();
  await renderCarousel();
  updateSummary();
  updateButtons();
  showProgress(
    checkpoint
      ? `Recovered ${completed} saved · ${pending} pending` +
          (mismatched ? ` · ${mismatched} changed source file(s) skipped` : "")
      : `Restored ${restored} of ${importedManifest.files.length} previous-run file(s)` +
      (mismatched ? ` · ${mismatched} changed source file(s) skipped` : ""),
    restored ? 100 : 0,
  );
  if (checkpoint && !batchPaused && completed > 0) {
    showCompletion(
      "Recovered batch complete",
      "Every saved image was restored. Review begins with the first image.",
    );
  }
  scheduleProjectCache();
}

async function restoreCachedProject() {
  projectCacheLoaded = true;
  try {
    cachedProject = await loadActiveProjectCache();
  } catch (error) {
    console.warn("Badge Blur could not read its local project cache.", error);
    return;
  }
  if (
    !cachedProject ||
    cachedProject.documentType !== PROJECT_CACHE_DOCUMENT_TYPE ||
    Number(cachedProject.schemaVersion) !== PROJECT_CACHE_SCHEMA_VERSION ||
    !isBatchCheckpoint(cachedProject.snapshot)
  ) {
    cachedProject = null;
    return;
  }

  const sourceHandle = cachedProject.sourceDirectoryHandle;
  if (
    !sourceHandle ||
    (await directoryPermission(sourceHandle, "readwrite")) !== "granted"
  ) {
    showProgress(
      `Saved project found from ${formatCacheTime(cachedProject.savedAt)}. ` +
        "Choose its original source folder to restore the review.",
      100,
    );
    return;
  }

  restoringCachedProject = true;
  try {
    sourceDirectoryHandle = sourceHandle;
    customExportDirectoryHandle = await usableCachedDirectory(
      cachedProject.customExportDirectoryHandle,
    );
    activeRun = await cachedActiveRun(cachedProject);
    importedManifest = cachedProject.snapshot;
    restoreRunSettings(importedManifest);
    const selected = await collectDirectoryImages(sourceDirectoryHandle);
    elements.sourceFolderLabel.textContent =
      `${sourceDirectoryHandle.name} · ${selected.length} supported image${selected.length === 1 ? "" : "s"}`;
    updateExportDestination();
    await setSelectedFiles(selected);
    restoreCachedSessionDetails(cachedProject);
    showProgress(
      `Restored ${items.length} image${items.length === 1 ? "" : "s"} from the local project cache.`,
      100,
    );
  } catch (error) {
    console.warn("Badge Blur could not restore its cached project.", error);
    showProgress(
      "A saved project is available. Choose its original source folder to restore it.",
      100,
    );
  } finally {
    restoringCachedProject = false;
  }
  scheduleProjectCache();
}

async function prepareCachedProjectForSource(sourceName) {
  if (
    !cachedProject ||
    cachedProject.snapshot?.sourceRootName !== sourceName
  ) {
    if (cachedProject) {
      cachedProject = null;
      importedManifest = null;
      activeRun = null;
    }
    return;
  }
  importedManifest = cachedProject.snapshot;
  restoreRunSettings(importedManifest);
  activeRun = await cachedActiveRun(cachedProject, { request: true });
  customExportDirectoryHandle = await usableCachedDirectory(
    cachedProject.customExportDirectoryHandle,
    { request: true },
  );
}

async function cachedActiveRun(project, { request = false } = {}) {
  const directory = await usableCachedDirectory(
    project.activeRunDirectoryHandle,
    { request },
  );
  if (!directory || !project.activeRun) return null;
  return {
    ...project.activeRun,
    directory,
  };
}

async function usableCachedDirectory(handle, { request = false } = {}) {
  if (!handle) return null;
  const permission = await directoryPermission(handle, "readwrite", request);
  return permission === "granted" ? handle : null;
}

async function directoryPermission(handle, mode, request = false) {
  if (!handle?.queryPermission) return "granted";
  let permission = await handle.queryPermission({ mode });
  if (
    permission === "prompt" &&
    request &&
    typeof handle.requestPermission === "function"
  ) {
    permission = await handle.requestPermission({ mode });
  }
  return permission;
}

function restoreCachedSessionDetails(project) {
  lastBatchDurationMs =
    Number(project.lastBatchDurationMs) >= 0
      ? Number(project.lastBatchDurationMs)
      : null;
  lastExportDurationMs =
    Number(project.lastExportDurationMs) >= 0
      ? Number(project.lastExportDurationMs)
      : null;
  activeIndex = clamp(
    Number(project.activeIndex) || 0,
    0,
    Math.max(0, items.length - 1),
  );
  updateBatchTime();
  updateExportTime();
  void renderCarousel();
}

function formatCacheTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "an earlier session" : date.toLocaleString();
}

function scheduleProjectCache() {
  if (
    !projectCacheLoaded ||
    restoringCachedProject ||
    items.length === 0
  ) {
    return;
  }
  clearTimeout(projectCacheTimer);
  projectCacheTimer = setTimeout(() => {
    projectCacheTimer = null;
    void persistProjectCache();
  }, 250);
}

async function persistProjectCache() {
  if (
    !projectCacheLoaded ||
    restoringCachedProject ||
    items.length === 0
  ) {
    return;
  }
  const snapshot = buildProjectCacheSnapshot();
  const project = {
    documentType: PROJECT_CACHE_DOCUMENT_TYPE,
    schemaVersion: PROJECT_CACHE_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    sourceDirectoryHandle,
    customExportDirectoryHandle,
    activeRunDirectoryHandle: activeRun?.directory || null,
    activeRun: activeRun
      ? {
          runId: activeRun.runId,
          runFolderName: activeRun.runFolderName,
          parentLabel: activeRun.parentLabel,
          generatedAt: activeRun.generatedAt,
        }
      : null,
    activeIndex,
    lastBatchDurationMs,
    lastExportDurationMs,
    snapshot,
  };
  try {
    await saveActiveProjectCache(project);
    cachedProject = project;
  } catch (error) {
    try {
      const projectWithoutHandles = {
        ...project,
        sourceDirectoryHandle: null,
        customExportDirectoryHandle: null,
        activeRunDirectoryHandle: null,
      };
      await saveActiveProjectCache(projectWithoutHandles);
      cachedProject = projectWithoutHandles;
    } catch (fallbackError) {
      console.warn(
        "Badge Blur could not update its local project cache.",
        fallbackError || error,
      );
    }
  }
}

function buildProjectCacheSnapshot() {
  const files = items.map((item) => checkpointEntry(item));
  return {
    documentType: CHECKPOINT_DOCUMENT_TYPE,
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    runId: activeRun?.runId || null,
    runFolderName: activeRun?.runFolderName || null,
    sourceRootName:
      sourceDirectoryHandle?.name || sourceRootName(items[0]?.file) || null,
    generatedAt: activeRun?.generatedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    localOnly: true,
    batchState: running ? "paused" : runState,
    threshold: Number(elements.thresholdInput.value),
    paddingPercent: Number(elements.paddingInput.value),
    redactionStrength: Number(elements.strengthInput.value),
    redactionStyle: elements.redactionStyleInput.value,
    featherPercent: Number(elements.featherInput.value),
    workerPreference: elements.workerCountInput.value,
    detectionPhrases: elements.labelsInput.value,
    enhancedTorsoRescue: elements.enhancedInput.checked,
    summary: summarizeCheckpointFiles(files),
    files,
  };
}

function deserializeMask(mask) {
  const restored = {
    id: crypto.randomUUID(),
    x: Number(mask.x) || 0,
    y: Number(mask.y) || 0,
    width: Number(mask.width) || 1,
    height: Number(mask.height) || 1,
    label: mask.label || "restored badge",
    score: Number(mask.score) || 1,
    source: mask.source || "manual",
    autoFitted: Boolean(mask.autoFitted),
    fitConfidence: Number(mask.fitConfidence) || 0,
    fitReason: mask.fitReason || "Restored from a previous run.",
    userAdjusted: Boolean(mask.userAdjusted),
    detectionBounds: mask.detectionBounds ? { ...mask.detectionBounds } : null,
    classifierPositiveScore:
      mask.classifierPositiveScore == null
        ? null
        : Number(mask.classifierPositiveScore),
    classifierNegativeScore:
      mask.classifierNegativeScore == null
        ? null
        : Number(mask.classifierNegativeScore),
    classifierMargin:
      mask.classifierMargin == null ? null : Number(mask.classifierMargin),
    classifierTopLabel: mask.classifierTopLabel || null,
    classifierDecision: mask.classifierDecision || null,
  };
  restored.points =
    Array.isArray(mask.points) && mask.points.length === 4
      ? mask.points.map((point) => ({
          x: Number(point.x) || 0,
          y: Number(point.y) || 0,
        }))
      : rectangleCorners(restored);
  updateMaskBounds(restored);
  return restored;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not decode image."));
    image.src = url;
  });
}

function releaseItems() {
  for (const item of items) {
    releasePreview(item);
    if (item.thumbnailUrl) URL.revokeObjectURL(item.thumbnailUrl);
    item.thumbnailUrl = null;
    item.thumbnailPromise = null;
  }
}

function releasePreview(item) {
  if (item.processing || item.previewPromise) return;
  if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  if (item.redactedPreviewUrl) URL.revokeObjectURL(item.redactedPreviewUrl);
  item.previewUrl = null;
  item.previewImage = null;
  item.redactedPreviewUrl = null;
  item.redactedPreviewRevision = -1;
}

async function ensurePreview(item) {
  if (item.decodeError) throw new Error(item.decodeError);
  if (item.previewImage) return;
  if (item.previewPromise) return item.previewPromise;
  item.previewPromise = (async () => {
    try {
      const response = await localImageRequest("/api/image/decode", item.file);
      item.imageInfo = response.info;
      item.width = response.info.width;
      item.height = response.info.height;
      item.previewUrl = URL.createObjectURL(response.blob);
      item.previewImage = await loadImage(item.previewUrl);
    } catch (error) {
      item.decodeError = error.message;
      throw error;
    } finally {
      item.previewPromise = null;
    }
  })();
  return item.previewPromise;
}

async function ensureThumbnail(item) {
  if (item.thumbnailUrl || item.thumbnailPromise || item.decodeError) {
    return item.thumbnailPromise;
  }
  item.thumbnailPromise = (async () => {
    try {
      const response = await localImageRequest("/api/image/decode", item.file, {
        width: 240,
        height: 156,
        fit: "cover",
        quality: 72,
      });
      item.thumbnailUrl = URL.createObjectURL(response.blob);
      const image = elements.filmstrip.querySelector(
        `[data-filmstrip-id="${item.id}"] .filmstrip-thumb`,
      );
      if (image) {
        image.src = item.thumbnailUrl;
        image.hidden = false;
        image.nextElementSibling.hidden = true;
      }
    } catch (error) {
      console.warn(`Thumbnail unavailable for ${item.file.name}: ${error.message}`);
    } finally {
      item.thumbnailPromise = null;
    }
  })();
  return item.thumbnailPromise;
}

async function loadModel() {
  if (modelWorkers.length || running) return;
  setModelStatus("loading", "Loading local model…");
  elements.loadModelButton.disabled = true;
  elements.loadModelButton.hidden = true;

  try {
    modelWorkers.push(await loadModelWorker(1));
    computeBenchmarkScore = runLocalComputeBenchmark();
    updateWorkerCountUI();
    const resolvedWorkers = resolveConfiguredWorkerCount();
    const autoLabel =
      elements.workerCountInput.value === "auto" ? "Auto: " : "";
    setModelStatus(
      "ready",
      `Local models ready · ${autoLabel}${resolvedWorkers} worker${resolvedWorkers === 1 ? "" : "s"}`,
    );
    elements.loadModelButton.hidden = true;
  } catch (error) {
    console.error(error);
    setModelStatus("error", "Model load failed");
    elements.loadModelButton.disabled = false;
    elements.loadModelButton.hidden = false;
    elements.loadModelButton.textContent = "Retry local models";
    showProgress(
      `Could not load the bundled model: ${error.message}. Run npm run prepare and reload.`,
      0,
    );
  } finally {
    updateButtons();
  }
}

async function loadModelWorker(workerNumber) {
  setModelStatus("loading", `Loading detector for worker ${workerNumber}…`);
  const workerDetector = await pipeline("zero-shot-object-detection", MODEL_ID, {
    dtype: "q8",
    device: "wasm",
  });
  try {
    setModelStatus("loading", `Loading classifier for worker ${workerNumber}…`);
    const workerClassifier = await pipeline(
      "zero-shot-image-classification",
      CLASSIFIER_MODEL_ID,
      {
        dtype: "q8",
        device: "wasm",
      },
    );
    return {
      detector: workerDetector,
      rescueClassifier: workerClassifier,
      workerNumber,
    };
  } catch (error) {
    await workerDetector.dispose?.();
    throw error;
  }
}

async function ensureModelWorkers(requestedCount) {
  while (modelWorkers.length < requestedCount) {
    const workerNumber = modelWorkers.length + 1;
    showProgress(
      `Preparing local model worker ${workerNumber} of ${requestedCount}…`,
      0,
    );
    try {
      modelWorkers.push(await loadModelWorker(workerNumber));
    } catch (error) {
      console.warn(`Could not prepare worker ${workerNumber}: ${error.message}`);
      showProgress(
        `Worker ${workerNumber} could not start. Continuing with ${modelWorkers.length}.`,
        0,
      );
      break;
    }
  }
  const activeCount = Math.max(1, Math.min(requestedCount, modelWorkers.length));
  setModelStatus(
    "ready",
    `Local models ready · ${activeCount} worker${activeCount === 1 ? "" : "s"}`,
  );
  return activeCount;
}

async function startBatch() {
  if (batchPromise || running) return batchPromise;
  batchPromise = runAll()
    .catch((error) => {
      console.error("Batch processing failed.", error);
      running = false;
      batchOperation = null;
      pauseRequested = false;
      stopBatchTimer();
      showProgress(`Batch stopped: ${error.message}`, 0);
      updateButtons();
    })
    .finally(() => {
      batchPromise = null;
    });
  return batchPromise;
}

function requestPause() {
  if (!running || pauseRequested) return;
  pauseRequested = true;
  showProgress(
    "Pausing safely · active images will finish and save before the batch pauses…",
    batchProgressPercent(),
  );
  updateButtons();
}

async function runAll() {
  if (!modelWorkers.length || running || items.length === 0) return;
  const pendingIndices = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => shouldProcessItem(item))
    .map(({ index }) => index);
  if (pendingIndices.length === 0) {
    batchPaused = false;
    runState = "completed";
    activeIndex = 0;
    showProgress("Every image in this run is already saved.", 100);
    showCompletion(
      "Batch already complete",
      "Every image is saved. Review begins with the first image.",
    );
    await renderCarousel();
    updateButtons();
    return;
  }

  running = true;
  batchOperation = "batch";
  pauseRequested = false;
  batchPaused = false;
  runState = "running";
  hideCompletion();
  lastBatchWorkerCount = null;
  batchStartedAt = performance.now();
  startBatchTimer();
  updateButtons();
  elements.progressWrap.hidden = false;
  const run = await ensureExportRun({ allowPrompt: true });
  if (!run) {
    running = false;
    batchOperation = null;
    runState = "idle";
    stopBatchTimer();
    updateButtons();
    return;
  }
  await writeRunMetadata("running");
  const requestedCount = resolveConfiguredWorkerCount();
  const workerCount = await ensureModelWorkers(requestedCount);
  lastBatchWorkerCount = workerCount;
  updateBatchTime();
  const activeIndices = new Set();
  const pendingExports = [];
  let completed = items.length - pendingIndices.length;

  await runWorkerPool(
    modelWorkers.slice(0, workerCount),
    pendingIndices.length,
    async (models, pendingIndex, workerIndex) => {
      const index = pendingIndices[pendingIndex];
      const item = items[index];
      const itemStartedAt = performance.now();
      item.processing = true;
      item.workerNumber = workerIndex + 1;
      activeIndices.add(index);
      activeIndex = Math.min(...activeIndices);
      await queueCarouselRender();
      showBatchWorkerProgress(completed, activeIndices.size, workerCount);

      try {
        if (item.status !== "detected") {
          const detectionStartedAt = performance.now();
          await detectItem(item, models);
          const detectionMs = performance.now() - detectionStartedAt;
          item.timing = {
            detectionMs,
            exportMs: 0,
            totalMs: detectionMs,
          };
        }
        if (item.status === "detected") {
          const exportPromise = queueItemExport(item, {
            updatePreview: isItemVisible(item),
          }).finally(() => {
            item.timing.totalMs = performance.now() - itemStartedAt;
            completed += 1;
            showBatchWorkerProgress(completed, activeIndices.size, workerCount);
            renderItemStatus(item);
          });
          pendingExports.push(exportPromise);
        } else {
          item.exportStatus = "Not exported because detection failed";
          const checkpointPromise = queueCheckpointWrite("running").finally(
            () => {
              completed += 1;
              showBatchWorkerProgress(
                completed,
                activeIndices.size,
                workerCount,
              );
            },
          );
          pendingExports.push(checkpointPromise);
        }
        renderItemStatus(item);
      } finally {
        item.processing = false;
        activeIndices.delete(index);
        activeIndex = activeIndices.size ? Math.min(...activeIndices) : index;
        showBatchWorkerProgress(completed, activeIndices.size, workerCount);
        await queueCarouselRender();
        if (!isItemVisible(item)) releasePreview(item);
      }
    },
    { shouldContinue: () => !pauseRequested },
  );
  await Promise.all(pendingExports);
  await exportQueue.catch(() => undefined);

  lastBatchDurationMs = performance.now() - batchStartedAt;
  lastExportDurationMs = totalRecordedExportTime();
  updateExportTime();
  stopBatchTimer();
  const remaining = items.filter((item) => shouldProcessItem(item)).length;
  if (pauseRequested && remaining > 0) {
    running = false;
    batchOperation = null;
    pauseRequested = false;
    batchPaused = true;
    runState = "paused";
    await writeRunMetadata("paused");
    showProgress(
      `Paused safely · ${finishedItemCount()} of ${items.length} saved or finished · ${remaining} remaining`,
      batchProgressPercent(),
    );
    await renderCarousel();
    updateButtons();
    updateSummary();
    return;
  }

  runState = "completed";
  await writeRunMetadata("completed");
  showProgress(
    `Batch finished with ${workerCount} worker${workerCount === 1 ? "" : "s"} in ${formatDuration(lastBatchDurationMs)}.` +
      (remaining
        ? ` ${remaining} failed or unsaved image${remaining === 1 ? "" : "s"} can be retried.`
        : " Review the centered images; edits auto-save."),
    100,
  );
  running = false;
  batchOperation = null;
  pauseRequested = false;
  batchPaused = false;
  activeIndex = 0;
  showCompletion(
    "Batch processing complete",
    `${finishedItemCount()} of ${items.length} images finished. Review begins with the first image.`,
  );
  await renderCarousel();
  updateButtons();
  updateSummary();
}

async function detectItem(item, models = modelWorkers[0]) {
  item.status = "running";
  item.message = item.workerNumber
    ? `Worker ${item.workerNumber} · detecting…`
    : "Detecting…";
  renderItemStatus(item);

  try {
    if (!models?.detector || !models?.rescueClassifier) {
      throw new Error("A local model worker is not ready.");
    }
    await ensurePreview(item);
    const prompt = normalizeGroundingPrompt(elements.labelsInput.value);
    elements.labelsInput.value = prompt;
    const threshold = Number(elements.thresholdInput.value);
    const output = await models.detector(item.previewUrl, [prompt], {
      threshold,
      top_k: 40,
    });
    const scaleX = item.width / item.previewImage.naturalWidth;
    const scaleY = item.height / item.previewImage.naturalHeight;
    const candidates = output.map((result) =>
      normalizeDetection(result, item, scaleX, scaleY),
    );
    const unverifiedModelBoxes = filterBadgeDetections(candidates, item);
    const globalVerification = elements.enhancedInput.checked
      ? await verifyGlobalCandidates(item, unverifiedModelBoxes, models)
      : { retained: unverifiedModelBoxes, rejected: [] };
    const modelBoxes = globalVerification.retained.map((box) =>
      withRectangleCorners({
        ...box,
        detectionBounds: {
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        },
      }),
    );
    const torsoRescues = elements.enhancedInput.checked
      ? await detectTorsoRescues(item, prompt, modelBoxes, models)
      : [];
    const detectedBoxes = mergeGlobalWithTorsoRescues(
      modelBoxes,
      torsoRescues,
    );
    item.boxes = await autoFitDetectedMasks(item, detectedBoxes);
    item.modelBoxes = item.boxes.map(cloneMask);
    item.globalClassifierRejectedCount = globalVerification.rejected.length;
    item.globalClassifierRejected = globalVerification.rejected.map(cloneMask);
    item.status = "detected";
    const fittedCount = item.boxes.filter((box) => box.autoFitted).length;
    item.message =
      `${item.boxes.length} likely badge${item.boxes.length === 1 ? "" : "s"}` +
      (globalVerification.rejected.length
        ? ` · ${globalVerification.rejected.length} negative rejected`
        : "") +
      (torsoRescues.length ? ` · ${torsoRescues.length} torso rescue` : "") +
      (fittedCount ? ` · ${fittedCount} corner-fit` : " · rectangle fallback");
  } catch (error) {
    console.error(error);
    item.status = "error";
    item.message = error.message;
  }

  if (document.querySelector(`[data-item-id="${item.id}"]`)) {
    try {
      await ensurePreview(item);
    } catch {
      await ensureErrorPreview(item);
    }
    renderItemStatus(item);
    drawItem(item);
  }
  updateSummary();
}

async function verifyGlobalCandidates(item, boxes, models) {
  const retained = [];
  const rejected = [];
  for (const box of boxes) {
    if (box.score > GLOBAL_CLASSIFIER_MAX_SCORE) {
      retained.push({
        ...box,
        classifierDecision: "kept-high-confidence",
      });
      continue;
    }
    const evidence = await classifyBadgePatch(
      item,
      box,
      models,
      GLOBAL_CLASSIFIER_LABELS,
      GLOBAL_CLASSIFIER_POSITIVE_LABEL_COUNT,
    );
    const classified = {
      ...box,
      classifierPositiveScore: evidence.positiveScore,
      classifierNegativeScore: evidence.negativeScore,
      classifierMargin: evidence.margin,
      classifierTopLabel: evidence.topLabel,
      classifierDecision: globalClassifierDecision(
        box.score,
        evidence,
        GLOBAL_CLASSIFIER_MAX_SCORE,
        GLOBAL_CLASSIFIER_REJECT_MARGIN,
      ),
    };
    (classified.classifierDecision === "rejected-negative"
      ? rejected
      : retained
    ).push(classified);
  }
  return { retained, rejected };
}

function normalizeGroundingPrompt(value) {
  const prompt = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/,+/g, ".")
    .replace(/\s*\.\s*/g, ". ")
    .replace(/\s+/g, " ")
    .replace(/[.\s]+$/g, "");
  return `${prompt || "identification badge"}.`;
}

async function detectTorsoRescues(item, prompt, globalBoxes, models) {
  const scaleX = item.width / item.previewImage.naturalWidth;
  const scaleY = item.height / item.previewImage.naturalHeight;
  const personOutput = await models.detector(item.previewUrl, ["person."], {
    threshold: PERSON_THRESHOLD,
    top_k: 30,
  });
  const persons = deduplicateBadgeDetections(
    personOutput
      .map((result) => normalizeDetection(result, item, scaleX, scaleY))
      .filter((box) => isPlausiblePerson(box, item)),
    0.52,
  ).slice(0, 24);
  const regions = deduplicateCropRegions(
    persons.map((person) =>
      boundedCropRegion(
        {
          left: person.x - person.width * 0.12,
          top: person.y + person.height * 0.08,
          width: person.width * 1.24,
          height: person.height * 0.62,
        },
        item.width,
        item.height,
      ),
    ),
  );
  const candidates = [];

  for (const region of regions) {
    if (region.width < 48 || region.height < 64) continue;
    const torso = await localImageRequest("/api/image/crop", item.file, {
      region,
      width: 1200,
      height: 1200,
      fit: "inside",
    });
    const torsoUrl = URL.createObjectURL(torso.blob);
    try {
      const output = await models.detector(torsoUrl, [prompt], {
        threshold: TORSO_THRESHOLD,
        top_k: 30,
      });
      const cropImage = {
        width: torso.info.width,
        height: torso.info.height,
      };
      const best = filterBadgeDetections(
        output.map((result) => normalizeDetection(result, cropImage)),
        cropImage,
      )
        .filter((box) => isPlausibleTorsoBadge(box, cropImage))
        .sort((a, b) => b.score - a.score)
        .slice(0, 1);
      for (const box of best) {
        const mapped = {
          ...box,
          id: crypto.randomUUID(),
          x: region.left + (box.x / cropImage.width) * region.width,
          y: region.top + (box.y / cropImage.height) * region.height,
          width: (box.width / cropImage.width) * region.width,
          height: (box.height / cropImage.height) * region.height,
          source: "torso-rescue",
          detectionPass: "torso-rescue",
        };
        if (
          globalBoxes.some((global) => boxesOverlap(mapped, global, 0.24, 0.5))
        ) {
          continue;
        }
        if (await classifyTorsoRescue(item, mapped, models)) {
          candidates.push(
            withRectangleCorners({
              ...mapped,
              detectionBounds: {
                x: mapped.x,
                y: mapped.y,
                width: mapped.width,
                height: mapped.height,
              },
            }),
          );
        }
      }
    } finally {
      URL.revokeObjectURL(torsoUrl);
    }
  }
  return deduplicateBadgeDetections(candidates, 0.32);
}

async function classifyTorsoRescue(item, box, models) {
  const evidence = await classifyBadgePatch(
    item,
    box,
    models,
    CLASSIFIER_LABELS,
    CLASSIFIER_POSITIVE_LABEL_COUNT,
  );
  return evidence.margin >= CLASSIFIER_MARGIN;
}

async function classifyBadgePatch(
  item,
  box,
  models,
  labels,
  positiveLabelCount,
) {
  const region = paddedBoxRegion(box, item.width, item.height, 1.15);
  const patch = await localImageRequest("/api/image/crop", item.file, {
    region,
    width: 384,
    height: 384,
    fit: "cover",
  });
  const patchUrl = URL.createObjectURL(patch.blob);
  try {
    const classifications = await models.rescueClassifier(
      patchUrl,
      labels,
    );
    return classifierEvidence(classifications, labels, positiveLabelCount);
  } finally {
    URL.revokeObjectURL(patchUrl);
  }
}

function isPlausiblePerson(box, item) {
  const areaRatio = (box.width * box.height) / (item.width * item.height);
  const aspect = box.width / box.height;
  return (
    box.label === "person" &&
    areaRatio >= 0.0025 &&
    areaRatio <= 0.82 &&
    aspect >= 0.14 &&
    aspect <= 1.45
  );
}

function isPlausibleTorsoBadge(box, crop) {
  const aspect = box.width / box.height;
  const areaRatio = (box.width * box.height) / (crop.width * crop.height);
  const centerX = (box.x + box.width / 2) / crop.width;
  const centerY = (box.y + box.height / 2) / crop.height;
  return (
    aspect >= 0.42 &&
    aspect <= 1.65 &&
    areaRatio >= 0.00025 &&
    areaRatio <= 0.035 &&
    centerX >= 0.1 &&
    centerX <= 0.9 &&
    centerY >= 0.16 &&
    centerY <= 0.86
  );
}

function mergeGlobalWithTorsoRescues(globalBoxes, torsoBoxes) {
  const global = deduplicateBadgeDetections(globalBoxes, 0.32);
  const rescues = deduplicateBadgeDetections(torsoBoxes, 0.32).filter(
    (candidate) =>
      global.every(
        (globalBox) => !boxesOverlap(candidate, globalBox, 0.24, 0.5),
      ),
  );
  return [...global, ...rescues];
}

function deduplicateCropRegions(regions) {
  const retained = [];
  for (const candidate of regions.sort(
    (a, b) => b.width * b.height - a.width * a.height,
  )) {
    if (
      retained.every(
        (region) => !boxesOverlap(candidate, region, 0.52, 0.72),
      )
    ) {
      retained.push(candidate);
    }
  }
  return retained;
}

function boxesOverlap(a, b, iouThreshold, containedThreshold) {
  const left = Math.max(a.x ?? a.left, b.x ?? b.left);
  const top = Math.max(a.y ?? a.top, b.y ?? b.top);
  const right = Math.min(
    (a.x ?? a.left) + a.width,
    (b.x ?? b.left) + b.width,
  );
  const bottom = Math.min(
    (a.y ?? a.top) + a.height,
    (b.y ?? b.top) + b.height,
  );
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  if (!intersection) return false;
  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  const iou = intersection / (areaA + areaB - intersection);
  const contained = intersection / Math.min(areaA, areaB);
  return iou >= iouThreshold || contained >= containedThreshold;
}

function boundedCropRegion(input, width, height) {
  const left = clamp(Math.floor(input.left), 0, width - 1);
  const top = clamp(Math.floor(input.top), 0, height - 1);
  const right = clamp(Math.ceil(input.left + input.width), left + 1, width);
  const bottom = clamp(Math.ceil(input.top + input.height), top + 1, height);
  return { left, top, width: right - left, height: bottom - top };
}

function paddedBoxRegion(box, width, height, paddingFactor) {
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const cropWidth = Math.max(box.width * (1 + paddingFactor * 2), 96);
  const cropHeight = Math.max(box.height * (1 + paddingFactor * 2), 96);
  return boundedCropRegion(
    {
      left: centerX - cropWidth / 2,
      top: centerY - cropHeight / 2,
      width: cropWidth,
      height: cropHeight,
    },
    width,
    height,
  );
}

async function autoFitDetectedMasks(item, boxes) {
  if (boxes.length === 0) return boxes;
  try {
    const result = await localJsonRequest("/api/image/fit-mask", item.file, {
      boxes: boxes.map(({ x, y, width, height }) => ({ x, y, width, height })),
      paddingPercent: Number(elements.paddingInput.value),
    });
    return boxes.map((box, index) => {
      const fit = result.masks?.[index];
      if (!fit || !Array.isArray(fit.points) || fit.points.length !== 4) {
        return {
          ...box,
          autoFitted: false,
          fitConfidence: 0,
          fitReason: "No corner fit was returned.",
        };
      }
      const fitted = {
        ...box,
        points: fit.points.map((point) => ({ x: point.x, y: point.y })),
        autoFitted: Boolean(fit.refined),
        fitConfidence: Number(fit.confidence) || 0,
        fitReason: fit.reason,
      };
      updateMaskBounds(fitted);
      return fitted;
    });
  } catch (error) {
    console.warn(`Automatic corner fitting skipped: ${error.message}`);
    return boxes.map((box) => ({
      ...box,
      autoFitted: false,
      fitConfidence: 0,
      fitReason: error.message,
    }));
  }
}

function normalizeDetection(result, item, scaleX = 1, scaleY = 1) {
  const { xmin, ymin, xmax, ymax } = result.box;
  return {
    id: crypto.randomUUID(),
    x: clamp(xmin * scaleX, 0, item.width),
    y: clamp(ymin * scaleY, 0, item.height),
    width: clamp((xmax - xmin) * scaleX, 1, item.width),
    height: clamp((ymax - ymin) * scaleY, 1, item.height),
    label: result.label,
    score: Number(result.score),
    source: "model",
  };
}

async function renderCarousel() {
  const renderToken = ++pageRenderToken;
  const visibleItems = carouselItems();

  for (const item of items) {
    if (!visibleItems.includes(item) && !item.processing) releasePreview(item);
  }

  if (items.length === 0) {
    elements.reviewGrid.replaceChildren();
    updateCarouselControls();
    return;
  }

  elements.reviewGrid.classList.add("is-transitioning");
  const item = items[activeIndex];
  try {
    await ensurePreview(item);
  } catch (error) {
    item.status = "error";
    item.message = error.message;
    await ensureErrorPreview(item);
  }
  if (renderToken !== pageRenderToken) return;
  elements.reviewGrid.replaceChildren();
  const slot = document.createElement("div");
  slot.className = "carousel-slot is-center";
  elements.reviewGrid.append(slot);
  renderItem(item, slot, true);
  updateCarouselControls();
  updateFilmstripSelection();
  requestAnimationFrame(() => {
    elements.reviewGrid.classList.remove("is-transitioning");
  });
  void preloadCarouselNeighbors();
}

function queueCarouselRender() {
  carouselRenderQueue = carouselRenderQueue
    .catch(() => undefined)
    .then(() => renderCarousel());
  return carouselRenderQueue;
}

function carouselItems() {
  return items.slice(
    Math.max(0, activeIndex - CAROUSEL_RADIUS),
    Math.min(items.length, activeIndex + CAROUSEL_RADIUS + 1),
  );
}

function isItemVisible(item) {
  return carouselItems().includes(item);
}

function renderFilmstrip() {
  thumbnailObserver?.disconnect();
  elements.filmstrip.replaceChildren();
  elements.filmstrip.hidden = items.length === 0;
  if (items.length === 0) return;
  const itemById = new Map(items.map((item) => [item.id, item]));

  if (typeof IntersectionObserver === "function") {
    thumbnailObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const item = itemById.get(entry.target.dataset.filmstripId);
          if (item) void ensureThumbnail(item);
          thumbnailObserver.unobserve(entry.target);
        }
      },
      {
        root: elements.filmstrip,
        rootMargin: "240px",
        threshold: 0.01,
      },
    );
  }

  items.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "filmstrip-item";
    button.dataset.filmstripId = item.id;
    const filmstripState = filmstripStateForItem(item);
    button.dataset.state = filmstripState.key;
    button.setAttribute("aria-label", `Review image ${index + 1}: ${item.file.name}`);
    button.innerHTML = `
      <img class="filmstrip-thumb" alt="" hidden />
      <span class="filmstrip-placeholder" aria-hidden="true">Loading…</span>
      <span class="filmstrip-number">${index + 1}</span>
      <span class="filmstrip-name"></span>
      <span class="filmstrip-state"></span>
    `;
    button.querySelector(".filmstrip-name").textContent = item.file.name;
    button.querySelector(".filmstrip-state").textContent = filmstripState.label;
    if (item.thumbnailUrl) {
      const image = button.querySelector(".filmstrip-thumb");
      image.src = item.thumbnailUrl;
      image.hidden = false;
      button.querySelector(".filmstrip-placeholder").hidden = true;
    }
    button.addEventListener("click", () => {
      void centerCarouselAt(index);
    });
    elements.filmstrip.append(button);
    if (thumbnailObserver) thumbnailObserver.observe(button);
    else if (index < 12) void ensureThumbnail(item);
  });
  updateFilmstripSelection({ scroll: false });
}

function updateFilmstripSelection({ scroll = true } = {}) {
  for (const [index, button] of [
    ...elements.filmstrip.querySelectorAll(".filmstrip-item"),
  ].entries()) {
    const active = index === activeIndex;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-current", active ? "true" : "false");
  }
  if (scroll) {
    elements.filmstrip
      .querySelector(".filmstrip-item.is-active")
      ?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }
}

function updateFilmstripItem(item) {
  const button = elements.filmstrip.querySelector(
    `[data-filmstrip-id="${item.id}"]`,
  );
  if (!button) return;
  const state = filmstripStateForItem(item);
  button.dataset.state = state.key;
  button.querySelector(".filmstrip-state").textContent = state.label;
  button.title = item.message;
}

function filmstripStateForItem(item) {
  if (item.processing || item.status === "running") {
    return { key: "processing", label: "Processing" };
  }
  if (checkpointStatusForItem(item) === "completed") {
    return { key: "done", label: "✓ Done" };
  }
  if (item.decodeError || item.status === "error" || item.exportError) {
    return { key: "error", label: "Needs attention" };
  }
  if (item.status === "detected") {
    return activeRun
      ? { key: "saving", label: "Saving" }
      : { key: "ready", label: "Ready for review" };
  }
  return { key: "waiting", label: "Waiting" };
}

async function preloadCarouselNeighbors() {
  const neighbors = carouselItems().filter(
    (item) => item !== items[activeIndex] && !item.previewImage,
  );
  await Promise.allSettled(neighbors.map((item) => ensurePreview(item)));
}

async function changeCarousel(direction) {
  if (running) return;
  const nextIndex = clamp(activeIndex + direction, 0, items.length - 1);
  if (nextIndex === activeIndex) return;
  activeIndex = nextIndex;
  updateButtons();
  await renderCarousel();
  scheduleProjectCache();
}

function updateCarouselControls() {
  elements.pagination.hidden = items.length <= 1;
  elements.pageStatus.textContent =
    items.length === 0
      ? "No images"
      : `Image ${activeIndex + 1} of ${items.length} · use ← → or the filmstrip`;
  elements.previousPageButton.disabled = running || activeIndex === 0;
  elements.nextPageButton.disabled = running || activeIndex >= items.length - 1;
}

async function centerCarouselAt(index) {
  if (running || index === activeIndex) return;
  activeIndex = index;
  updateButtons();
  await renderCarousel();
  scheduleProjectCache();
}

function renderItem(item, slot, isActive) {
  const card = document.createElement("article");
  card.className = `image-card ${isActive ? "is-active" : "is-preview"}`;
  card.dataset.itemId = item.id;
  card.innerHTML = `
      <div class="card-heading">
        <div>
          <h3></h3>
          <p class="dimensions"></p>
          <p class="item-timing"></p>
        </div>
        <span class="item-status"></span>
      </div>
      <div class="comparison-toggle" role="group" aria-label="Before and after view">
        <button class="before-view" type="button">Before · edit masks</button>
        <button class="after-view" type="button">After · exported</button>
      </div>
      <div class="canvas-wrap">
        <canvas aria-label="Image with editable badge detections"></canvas>
        <img class="after-preview" alt="Redacted export preview" hidden />
        <p class="after-pending" hidden>Preparing redacted preview…</p>
      </div>
      <p class="export-status"></p>
      <div class="card-actions">
        <button class="button small detect-one">Detect</button>
        <button class="button small secondary remove-box">Remove selected</button>
        <button class="button small secondary export-one">Save update</button>
      </div>
    `;
  slot.append(card);

  if (isActive) {
    const canvas = card.querySelector("canvas");
    setupCanvasInteraction(canvas, item);
    card.querySelector(".detect-one").addEventListener("click", async () => {
      if (!modelWorkers.length) await loadModel();
      if (!modelWorkers.length) return;
      const startedAt = performance.now();
      item.workerNumber = 1;
      await detectItem(item, modelWorkers[0]);
      item.timing = {
        detectionMs: performance.now() - startedAt,
        exportMs: 0,
        totalMs: performance.now() - startedAt,
      };
      await queueItemExport(item, { updatePreview: true });
    });
    card.querySelector(".remove-box").addEventListener("click", () => {
      removeSelectedBox(item);
    });
    card.querySelector(".export-one").addEventListener("click", () => {
      queueItemExport(item, { updatePreview: true });
    });
    card.querySelector(".before-view").addEventListener("click", () => {
      void setItemView(item, "before");
    });
    card.querySelector(".after-view").addEventListener("click", () => {
      void setItemView(item, "after");
    });
  } else {
    card.addEventListener("click", () => {
      void centerCarouselAt(items.indexOf(item));
    });
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Center ${item.file.name}`);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        void centerCarouselAt(items.indexOf(item));
      }
    });
  }

  card.querySelector("h3").textContent = item.file.name;
  const conversion = item.imageInfo?.converted ? " · HEIC/HEIF → TIFF" : "";
  card.querySelector(".dimensions").textContent = item.decodeError
    ? "Not processed"
    : `${item.width} × ${item.height}${conversion}`;
  card.querySelector(".item-timing").textContent = item.timing
    ? `${item.workerNumber ? `Worker ${item.workerNumber} · ` : ""}Detection ${formatDuration(item.timing.detectionMs)} · export ${formatDuration(item.timing.exportMs)}`
    : "Timing available after processing";
  card.querySelector(".export-status").textContent = item.exportStatus;
  card.querySelector(".detect-one").disabled = Boolean(item.decodeError);
  card.querySelector(".export-one").disabled = Boolean(item.decodeError);
  renderItemStatus(item);
  drawItem(item);
  updateItemView(item);
}

function renderItemStatus(item) {
  updateFilmstripItem(item);
  const card = document.querySelector(`[data-item-id="${item.id}"]`);
  if (!card) return;
  const status = card.querySelector(".item-status");
  status.textContent = item.message;
  status.dataset.state = item.status;
  card.querySelector(".remove-box").disabled = !item.selectedBoxId;
  const timing = card.querySelector(".item-timing");
  if (timing) {
    timing.textContent = item.timing
      ? `${item.workerNumber ? `Worker ${item.workerNumber} · ` : ""}Detection ${formatDuration(item.timing.detectionMs)} · export ${formatDuration(item.timing.exportMs)}`
      : "Timing available after processing";
  }
  const exportStatus = card.querySelector(".export-status");
  if (exportStatus) exportStatus.textContent = item.exportStatus;
}

function updateItemView(item) {
  const card = document.querySelector(`[data-item-id="${item.id}"]`);
  if (!card) return;
  const beforeButton = card.querySelector(".before-view");
  const afterButton = card.querySelector(".after-view");
  const canvas = card.querySelector("canvas");
  const afterImage = card.querySelector(".after-preview");
  const pending = card.querySelector(".after-pending");
  const showingAfter = item.viewMode === "after";
  beforeButton.classList.toggle("is-selected", !showingAfter);
  afterButton.classList.toggle("is-selected", showingAfter);
  beforeButton.setAttribute("aria-pressed", String(!showingAfter));
  afterButton.setAttribute("aria-pressed", String(showingAfter));
  canvas.hidden = showingAfter;
  const previewReady =
    showingAfter &&
    item.redactedPreviewUrl &&
    item.redactedPreviewRevision === item.editRevision;
  afterImage.hidden = !previewReady;
  pending.hidden = !showingAfter || previewReady;
  if (previewReady) afterImage.src = item.redactedPreviewUrl;
}

async function setItemView(item, viewMode) {
  item.viewMode = viewMode;
  updateItemView(item);
  if (viewMode !== "after") return;
  try {
    await ensureRedactedPreview(item);
  } catch (error) {
    console.error(error);
    item.exportStatus = `Preview failed: ${error.message}`;
    renderItemStatus(item);
  }
}

async function ensureRedactedPreview(item) {
  if (
    item.redactedPreviewUrl &&
    item.redactedPreviewRevision === item.editRevision
  ) {
    updateItemView(item);
    return;
  }
  const blob = await createRedactedBlob(item);
  setRedactedPreview(item, blob);
}

function setRedactedPreview(item, blob) {
  if (item.redactedPreviewUrl) URL.revokeObjectURL(item.redactedPreviewUrl);
  item.redactedPreviewUrl = URL.createObjectURL(blob);
  item.redactedPreviewRevision = item.editRevision;
  updateItemView(item);
}

function markItemEdited(item) {
  item.editRevision += 1;
  if (item.redactedPreviewUrl) URL.revokeObjectURL(item.redactedPreviewUrl);
  item.redactedPreviewUrl = null;
  item.redactedPreviewRevision = -1;
  item.exportStatus = activeRun
    ? "Edit pending auto-save…"
    : "Edit preview ready; choose an export destination to auto-save";
  updateItemView(item);
  renderItemStatus(item);
  scheduleItemExport(item);
}

function setupCanvasInteraction(canvas, item) {
  let dragStart = null;
  let previewBox = null;
  let cornerDrag = null;

  canvas.addEventListener("pointerdown", (event) => {
    const point = canvasPoint(event, canvas);
    const deleteHit = [...item.boxes]
      .reverse()
      .find((box) => hitDeleteControl(point, box, canvas));
    if (deleteHit) {
      event.preventDefault();
      dragStart = null;
      previewBox = null;
      cornerDrag = null;
      removeBoxById(item, deleteHit.id);
      return;
    }

    const selected = item.boxes.find((box) => box.id === item.selectedBoxId);
    const cornerIndex = selected
      ? hitCornerIndex(point, selected, canvas)
      : -1;
    if (selected && cornerIndex >= 0) {
      cornerDrag = { box: selected, cornerIndex };
      dragStart = null;
      previewBox = null;
      canvas.setPointerCapture(event.pointerId);
      return;
    }

    const hit = [...item.boxes]
      .reverse()
      .find((box) => pointInPolygon(point, maskPoints(box)));
    if (hit) {
      item.selectedBoxId = hit.id;
      dragStart = null;
      drawItem(item);
      renderItemStatus(item);
      return;
    }
    item.selectedBoxId = null;
    dragStart = point;
    previewBox = null;
    canvas.setPointerCapture(event.pointerId);
    renderItemStatus(item);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!cornerDrag && !dragStart) {
      const point = canvasPoint(event, canvas);
      const deleteHit = [...item.boxes]
        .reverse()
        .some((box) => hitDeleteControl(point, box, canvas));
      canvas.style.cursor = deleteHit ? "pointer" : "crosshair";
    }
    if (cornerDrag) {
      const point = canvasPoint(event, canvas);
      const candidate = maskPoints(cornerDrag.box).map((corner) => ({ ...corner }));
      candidate[cornerDrag.cornerIndex] = {
        x: clamp(point.x, 0, item.width),
        y: clamp(point.y, 0, item.height),
      };
      if (isConvexQuadrilateral(candidate)) {
        cornerDrag.box.points = candidate;
        updateMaskBounds(cornerDrag.box);
        cornerDrag.box.userAdjusted = true;
        item.message = `${item.boxes.length} reviewed mask${item.boxes.length === 1 ? "" : "s"}`;
        drawItem(item);
        renderItemStatus(item);
      }
      return;
    }
    if (!dragStart) return;
    const point = canvasPoint(event, canvas);
    previewBox = rectFromPoints(dragStart, point);
    drawItem(item, previewBox);
  });

  canvas.addEventListener("pointerup", (event) => {
    if (cornerDrag) {
      cornerDrag = null;
      canvas.releasePointerCapture(event.pointerId);
      markItemEdited(item);
      updateSummary();
      return;
    }
    if (!dragStart) return;
    const point = canvasPoint(event, canvas);
    const box = rectFromPoints(dragStart, point);
    dragStart = null;
    previewBox = null;
    if (box.width >= 8 && box.height >= 8) {
      const manualBox = {
        ...box,
        id: crypto.randomUUID(),
        label: "manual badge",
        score: 1,
        source: "manual",
      };
      manualBox.points = rectangleCorners(manualBox);
      item.boxes.push(manualBox);
      item.selectedBoxId = manualBox.id;
      item.message = `${item.boxes.length} reviewed mask${item.boxes.length === 1 ? "" : "s"}`;
      markItemEdited(item);
    }
    drawItem(item);
    renderItemStatus(item);
    updateSummary();
  });

  canvas.addEventListener("pointercancel", () => {
    dragStart = null;
    previewBox = null;
    cornerDrag = null;
    drawItem(item);
  });

  canvas.addEventListener("pointerleave", () => {
    if (!cornerDrag && !dragStart) canvas.style.cursor = "crosshair";
  });
}

function canvasPoint(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * Number(canvas.dataset.sourceWidth),
    y: ((event.clientY - rect.top) / rect.height) * Number(canvas.dataset.sourceHeight),
  };
}

function rectFromPoints(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

function drawItem(item, previewBox = null) {
  const card = document.querySelector(`[data-item-id="${item.id}"]`);
  if (!card) return;
  const canvas = card.querySelector("canvas");
  canvas.width = item.previewImage.naturalWidth;
  canvas.height = item.previewImage.naturalHeight;
  canvas.dataset.sourceWidth = item.width;
  canvas.dataset.sourceHeight = item.height;
  const context = canvas.getContext("2d");
  context.drawImage(item.previewImage, 0, 0);
  const scaleX = canvas.width / item.width;
  const scaleY = canvas.height / item.height;

  const scaledBoxes = item.boxes.map((box) => scaleBox(box, scaleX, scaleY));
  for (const box of scaledBoxes) {
    drawBox(
      context,
      box,
      box.id === item.selectedBoxId,
    );
  }
  for (const box of scaledBoxes) drawDeleteControl(context, box);
  if (previewBox) {
    drawBox(
      context,
      scaleBox(
        { ...previewBox, label: "new mask", score: 1, source: "manual" },
        scaleX,
        scaleY,
      ),
      true,
    );
  }
}

function scaleBox(box, scaleX, scaleY) {
  return {
    ...box,
    x: box.x * scaleX,
    y: box.y * scaleY,
    width: box.width * scaleX,
    height: box.height * scaleY,
    points: maskPoints(box).map((point) => ({
      x: point.x * scaleX,
      y: point.y * scaleY,
    })),
  };
}

function drawBox(context, box, selected) {
  const scale = Math.max(context.canvas.width, context.canvas.height) / 1200;
  const lineWidth = Math.max(3, 4 * scale);
  const color = selected
    ? "#ff9e1b"
    : box.source === "manual"
      ? "#00b38f"
      : "#fe5000";
  context.save();
  context.fillStyle = `${color}24`;
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  tracePolygon(context, maskPoints(box));
  context.fill();
  context.stroke();

  const score = box.source === "manual" ? "manual" : `${Math.round(box.score * 100)}%`;
  const fitLabel = box.autoFitted
    ? box.userAdjusted
      ? " · corner-fit adjusted"
      : " · corner-fit"
    : "";
  const label = `${box.label} · ${score}${fitLabel}`;
  context.font =
    `600 ${Math.max(16, 19 * scale)}px Mulish, Aptos, Arial, sans-serif`;
  const textWidth = context.measureText(label).width;
  const labelHeight = Math.max(26, 31 * scale);
  const labelY = Math.max(0, box.y - labelHeight);
  context.fillStyle = color;
  context.fillRect(box.x, labelY, textWidth + 18 * scale, labelHeight);
  context.fillStyle = "#ffffff";
  context.textBaseline = "middle";
  context.fillText(label, box.x + 8 * scale, labelY + labelHeight / 2);
  if (selected) {
    const handleRadius = Math.max(7, 9 * scale);
    for (const point of maskPoints(box)) {
      context.beginPath();
      context.arc(point.x, point.y, handleRadius, 0, Math.PI * 2);
      context.fillStyle = "#ffffff";
      context.fill();
      context.strokeStyle = color;
      context.lineWidth = Math.max(3, 3 * scale);
      context.stroke();
    }
  }
  context.restore();
}

function drawDeleteControl(context, box) {
  const rect = context.canvas.getBoundingClientRect();
  const canvasPerCssX = context.canvas.width / Math.max(rect.width, 1);
  const canvasPerCssY = context.canvas.height / Math.max(rect.height, 1);
  const radiusX = 13 * canvasPerCssX;
  const radiusY = 13 * canvasPerCssY;
  const center = maskDeleteControlCenter(
    box,
    context.canvas.width,
    context.canvas.height,
    canvasPerCssX,
    canvasPerCssY,
  );

  context.save();
  context.beginPath();
  context.ellipse(center.x, center.y, radiusX, radiusY, 0, 0, Math.PI * 2);
  context.fillStyle = "#fe5000";
  context.fill();
  context.strokeStyle = "#ffffff";
  context.lineWidth = Math.max(2 * canvasPerCssX, 2);
  context.stroke();
  context.strokeStyle = "#ffffff";
  context.lineWidth = Math.max(2.5 * canvasPerCssX, 2.5);
  context.lineCap = "round";
  const armX = 4.5 * canvasPerCssX;
  const armY = 4.5 * canvasPerCssY;
  context.beginPath();
  context.moveTo(center.x - armX, center.y - armY);
  context.lineTo(center.x + armX, center.y + armY);
  context.moveTo(center.x + armX, center.y - armY);
  context.lineTo(center.x - armX, center.y + armY);
  context.stroke();
  context.restore();
}

function tracePolygon(context, points) {
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  context.closePath();
}

function withRectangleCorners(box) {
  return { ...box, points: rectangleCorners(box) };
}

function cloneMask(box) {
  return {
    ...box,
    detectionBounds: box.detectionBounds ? { ...box.detectionBounds } : undefined,
    points: maskPoints(box).map((point) => ({ ...point })),
  };
}

function rectangleCorners(box) {
  return [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ];
}

function maskPoints(box) {
  return Array.isArray(box.points) && box.points.length === 4
    ? box.points
    : rectangleCorners(box);
}

function hitCornerIndex(point, box, canvas) {
  const rect = canvas.getBoundingClientRect();
  const radius = (16 / rect.width) * Number(canvas.dataset.sourceWidth);
  return maskPoints(box).findIndex(
    (corner) => Math.hypot(point.x - corner.x, point.y - corner.y) <= radius,
  );
}

function hitDeleteControl(point, box, canvas) {
  const rect = canvas.getBoundingClientRect();
  const sourceWidth = Number(canvas.dataset.sourceWidth);
  const sourceHeight = Number(canvas.dataset.sourceHeight);
  const sourcePerCssX = sourceWidth / Math.max(rect.width, 1);
  const sourcePerCssY = sourceHeight / Math.max(rect.height, 1);
  const hitRadiusX = 18 * sourcePerCssX;
  const hitRadiusY = 18 * sourcePerCssY;
  const center = maskDeleteControlCenter(
    box,
    sourceWidth,
    sourceHeight,
    sourcePerCssX,
    sourcePerCssY,
  );
  const dx = (point.x - center.x) / hitRadiusX;
  const dy = (point.y - center.y) / hitRadiusY;
  return dx * dx + dy * dy <= 1;
}

function pointInPolygon(point, points) {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const a = points[index];
    const b = points[previous];
    const crosses =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function isConvexQuadrilateral(points) {
  if (points.length !== 4 || Math.abs(polygonArea(points)) < 64) return false;
  const signs = [];
  for (let index = 0; index < 4; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % 4];
    const c = points[(index + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) > 0.01) signs.push(Math.sign(cross));
  }
  return signs.length === 4 && signs.every((sign) => sign === signs[0]);
}

function polygonArea(points) {
  return Math.abs(
    points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length];
      return sum + point.x * next.y - next.x * point.y;
    }, 0) / 2,
  );
}

function updateMaskBounds(box) {
  const xs = box.points.map((point) => point.x);
  const ys = box.points.map((point) => point.y);
  box.x = Math.min(...xs);
  box.y = Math.min(...ys);
  box.width = Math.max(...xs) - box.x;
  box.height = Math.max(...ys) - box.y;
}

function redrawAll() {
  for (const item of items) drawItem(item);
}

function removeSelectedBox(item) {
  if (!item.selectedBoxId) return;
  removeBoxById(item, item.selectedBoxId);
}

function removeBoxById(item, boxId) {
  item.boxes = item.boxes.filter((box) => box.id !== boxId);
  item.selectedBoxId = null;
  item.message = `${item.boxes.length} reviewed mask${item.boxes.length === 1 ? "" : "s"}`;
  markItemEdited(item);
  drawItem(item);
  renderItemStatus(item);
  updateSummary();
}

async function chooseCustomExportFolder() {
  if (typeof window.showDirectoryPicker !== "function" || running) return;
  try {
    customExportDirectoryHandle = await window.showDirectoryPicker({
      id: "badge-remover-export",
      mode: "readwrite",
    });
    activeRun = null;
    updateExportDestination();
  } catch (error) {
    if (error.name !== "AbortError") {
      console.error(error);
      showProgress(`Could not open the export folder: ${error.message}`, 0);
    }
  }
}

function useSourceExportFolder() {
  customExportDirectoryHandle = null;
  activeRun = null;
  updateExportDestination();
}

function updateExportDestination() {
  if (activeRun) {
    elements.exportDestination.textContent =
      `${activeRun.parentLabel} / ${activeRun.runFolderName}`;
  } else if (customExportDirectoryHandle) {
    elements.exportDestination.textContent =
      `${customExportDirectoryHandle.name} / new unique run folder`;
  } else if (sourceDirectoryHandle) {
    elements.exportDestination.textContent =
      `${sourceDirectoryHandle.name} / exports / new unique run folder`;
  } else {
    elements.exportDestination.textContent =
      "Source folder handle unavailable; choose an export folder before the batch.";
  }
  elements.resetExportButton.hidden = !customExportDirectoryHandle;
  updateButtons();
}

async function openExportFolder() {
  if (!activeRun || !window.badgeBlurDesktop?.openExportFolder) return;
  try {
    const checkpointHandle = await activeRun.directory.getFileHandle(
      "badge-blur-checkpoint.json",
    );
    const checkpointFile = await checkpointHandle.getFile();
    await window.badgeBlurDesktop.openExportFolder(checkpointFile);
  } catch (error) {
    console.error("Could not open the export folder.", error);
    showProgress(`Could not open the export folder: ${error.message}`, 100);
  }
}

async function ensureExportRun({ allowPrompt = false } = {}) {
  if (activeRun) return activeRun;
  if (typeof window.showDirectoryPicker !== "function") return null;

  try {
    let parentDirectory;
    let parentLabel;
    if (customExportDirectoryHandle) {
      parentDirectory = customExportDirectoryHandle;
      parentLabel = customExportDirectoryHandle.name;
    } else if (sourceDirectoryHandle) {
      parentDirectory = await sourceDirectoryHandle.getDirectoryHandle("exports", {
        create: true,
      });
      parentLabel = `${sourceDirectoryHandle.name} / exports`;
    } else if (allowPrompt) {
      customExportDirectoryHandle = await window.showDirectoryPicker({
        id: "badge-remover-export",
        mode: "readwrite",
      });
      parentDirectory = customExportDirectoryHandle;
      parentLabel = customExportDirectoryHandle.name;
    } else {
      return null;
    }

    const run = await createUniqueRunDirectory(parentDirectory);
    activeRun = {
      directory: run.directory,
      runId: run.runId,
      runFolderName: run.name,
      parentLabel,
      generatedAt: new Date().toISOString(),
    };
    updateExportDestination();
    return activeRun;
  } catch (error) {
    if (error.name !== "AbortError") {
      console.error(error);
      showProgress(`Automatic export is unavailable: ${error.message}`, 0);
    }
    return null;
  }
}

function queueItemExport(item, options = {}) {
  exportQueue = exportQueue
    .catch(() => undefined)
    .then(() => exportItemToRun(item, options));
  return exportQueue;
}

function queueCheckpointWrite(state = runState) {
  exportQueue = exportQueue
    .catch(() => undefined)
    .then(() => writeRunMetadata(state));
  return exportQueue;
}

async function exportItemToRun(item, { updatePreview = false } = {}) {
  if (item.decodeError) return;
  const startedAt = performance.now();
  item.exportStatus = activeRun ? "Auto-saving export…" : "Preparing after preview…";
  renderItemStatus(item);
  try {
    const [blob, sidecar] = await Promise.all([
      createRedactedBlob(item),
      createMetadataSidecar(item),
    ]);
    if (updatePreview || isItemVisible(item) || item.viewMode === "after") {
      setRedactedPreview(item, blob);
    }
    if (activeRun) {
      const name = outputRelativePath(item);
      const sidecarName = `${name}.metadata.mie`;
      await writeRelativeFile(activeRun.directory, name, blob);
      await writeRelativeFile(activeRun.directory, sidecarName, sidecar);
      item.exportRevision = item.editRevision;
      item.exportedAt = new Date().toISOString();
      item.exportError = null;
      item.exportStatus = `Saved automatically · ${activeRun.runFolderName}`;
      await writeRunMetadata(runState);
    } else {
      item.exportStatus =
        "After preview ready · choose an export destination to auto-save";
    }
  } catch (error) {
    console.error(error);
    item.exportError = error.message;
    item.exportStatus = `Export failed: ${error.message}`;
  } finally {
    const exportMs = performance.now() - startedAt;
    item.timing ||= { detectionMs: 0, exportMs: 0, totalMs: 0 };
    item.timing.exportMs = exportMs;
    item.timing.totalMs = item.timing.detectionMs + exportMs;
    if (batchOperation === "batch") {
      lastExportDurationMs = totalRecordedExportTime();
      updateExportTime();
    } else if (batchOperation !== "reexport") {
      lastExportDurationMs = exportMs;
      updateExportTime();
    }
    renderItemStatus(item);
    scheduleProjectCache();
  }
}

function scheduleItemExport(item) {
  if (item.status !== "detected" || running) return;
  scheduleProjectCache();
  clearTimeout(itemExportTimers.get(item.id));
  itemExportTimers.set(
    item.id,
    setTimeout(() => {
      itemExportTimers.delete(item.id);
      void queueItemExport(item, { updatePreview: item.viewMode === "after" });
    }, 500),
  );
}

let settingsExportTimer = null;
function scheduleAllEditedExports() {
  for (const item of items) {
    if (item.status !== "detected") continue;
    item.editRevision += 1;
    if (item.redactedPreviewUrl) URL.revokeObjectURL(item.redactedPreviewUrl);
    item.redactedPreviewUrl = null;
    item.redactedPreviewRevision = -1;
    item.exportStatus = activeRun
      ? "Settings changed · auto-save pending…"
      : "Settings changed · after preview needs refresh";
    renderItemStatus(item);
    updateItemView(item);
  }
  scheduleProjectCache();
  if (running) return;
  clearTimeout(settingsExportTimer);
  settingsExportTimer = setTimeout(() => {
    for (const item of items) {
      if (item.status === "detected") {
        void queueItemExport(item, { updatePreview: isItemVisible(item) });
      }
    }
  }, 700);
}

async function exportAll() {
  if (items.length === 0 || running) return;
  const run = await ensureExportRun({ allowPrompt: true });
  if (!run) {
    showProgress(
      "Choose an export folder in Chrome or Edge to enable automatic batch saves.",
      0,
    );
    return;
  }
  running = true;
  batchOperation = "reexport";
  runState = "running";
  hideCompletion();
  exportStartedAt = performance.now();
  startExportTimer();
  updateButtons();
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.status !== "detected") continue;
    activeIndex = index;
    await renderCarousel();
    showProgress(
      `Re-exporting ${index + 1} of ${items.length}: ${item.file.name}`,
      (index / items.length) * 100,
    );
    await queueItemExport(item, { updatePreview: true });
    if (!isItemVisible(item)) releasePreview(item);
  }
  lastExportDurationMs = performance.now() - exportStartedAt;
  stopExportTimer();
  runState = "completed";
  await writeRunMetadata("completed");
  running = false;
  batchOperation = null;
  activeIndex = 0;
  showCompletion(
    "Export complete",
    `${items.filter((item) => item.exportRevision >= 0).length} redacted image${items.filter((item) => item.exportRevision >= 0).length === 1 ? "" : "s"} saved. Review begins with the first image.`,
  );
  await renderCarousel();
  updateButtons();
  showProgress(
    `Export finished in ${formatDuration(lastExportDurationMs)} · ${run.runFolderName}`,
    100,
  );
}

async function writeRunMetadata(checkpointState = runState) {
  if (!activeRun) return;
  const manifest = buildRunManifest();
  const trainingAnnotations = buildTrainingAnnotations(manifest);
  const checkpoint = buildRunCheckpoint(manifest, checkpointState);
  await writeFile(
    activeRun.directory,
    "badge-removal-manifest.json",
    new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }),
  );
  await writeFile(
    activeRun.directory,
    "badge-training-annotations.coco.json",
    new Blob([JSON.stringify(trainingAnnotations, null, 2)], {
      type: "application/json",
    }),
  );
  await writeFile(
    activeRun.directory,
    "badge-blur-checkpoint.json",
    new Blob([JSON.stringify(checkpoint, null, 2)], {
      type: "application/json",
    }),
  );
}

function buildRunCheckpoint(manifest, checkpointState) {
  const files = items.map((item) => checkpointEntry(item));
  return {
    ...manifest,
    documentType: CHECKPOINT_DOCUMENT_TYPE,
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    manifestSchemaVersion: manifest.schemaVersion,
    batchState: checkpointState,
    updatedAt: new Date().toISOString(),
    summary: summarizeCheckpointFiles(files),
    files,
  };
}

function checkpointEntry(item) {
  const finalMasks = item.boxes.map(serializeBox);
  const initialModelMasks = item.modelBoxes.map(serializeBox);
  const output = item.imageInfo ? outputRelativePath(item) : null;
  return {
    input: item.file.name,
    sourcePath: sourceRelativePath(item),
    byteSize: item.file.size,
    lastModified: new Date(item.file.lastModified).toISOString(),
    lastModifiedMilliseconds: item.file.lastModified,
    checkpointStatus: checkpointStatusForItem(item),
    status: item.status,
    message: item.message,
    output,
    metadataArchive: output ? `${output}.metadata.mie` : null,
    imageInfo: item.imageInfo,
    exportedAt: item.exportedAt || null,
    editRevision: item.editRevision,
    exportRevision: item.exportRevision,
    exportError: item.exportError || null,
    processingTimeMs: item.timing?.totalMs || null,
    detectionTimeMs: item.timing?.detectionMs || null,
    exportTimeMs: item.timing?.exportMs || null,
    workerNumber: item.workerNumber,
    initialModelMasks,
    reviewedMasks: finalMasks,
  };
}

function buildRunManifest() {
  return {
    schemaVersion: 10,
    appVersion: APP_VERSION,
    runId: activeRun.runId,
    runFolderName: activeRun.runFolderName,
    generatedAt: activeRun.generatedAt,
    updatedAt: new Date().toISOString(),
    localOnly: true,
    originalsIncluded: false,
    sourceRootName:
      sourceDirectoryHandle?.name || sourceRootName(items[0]?.file) || null,
    importedFromRunId: importedManifest?.runId || null,
    model: MODEL_ID,
    detectionPhrases: elements.labelsInput.value,
    enhancedTorsoRescue: elements.enhancedInput.checked,
    globalNegativeClassifier: {
      enabled: elements.enhancedInput.checked,
      model: CLASSIFIER_MODEL_ID,
      maxDetectionScore: GLOBAL_CLASSIFIER_MAX_SCORE,
      rejectMargin: GLOBAL_CLASSIFIER_REJECT_MARGIN,
      labels: GLOBAL_CLASSIFIER_LABELS,
    },
    threshold: Number(elements.thresholdInput.value),
    paddingPercent: Number(elements.paddingInput.value),
    redactionStrength: Number(elements.strengthInput.value),
    redactionStyle: elements.redactionStyleInput.value,
    featherPercent: Number(elements.featherInput.value),
    workerPreference: elements.workerCountInput.value,
    workerCount: lastBatchWorkerCount,
    workerCapabilities: {
      hardwareConcurrency: workerCapabilities().hardwareConcurrency,
      deviceMemory: workerCapabilities().deviceMemory,
      computeScore: computeBenchmarkScore == null
        ? null
        : Number(computeBenchmarkScore.toFixed(1)),
    },
    batchDurationMs: lastBatchDurationMs,
    exportDurationMs: lastExportDurationMs,
    files: items
      .filter((item) => item.exportRevision >= 0)
      .map((item) => manifestEntry(item)),
    failures: items
      .filter((item) => item.exportError)
      .map((item) => ({
        input: item.file.name,
        sourcePath: sourceRelativePath(item),
        error: item.exportError,
      })),
  };
}

function manifestEntry(item) {
  const finalMasks = item.boxes.map(serializeBox);
  const initialModelMasks = item.modelBoxes.map(serializeBox);
  const output = outputRelativePath(item);
  return {
    input: item.file.name,
    sourcePath: sourceRelativePath(item),
    output,
    metadataArchive: `${output}.metadata.mie`,
    sourceFormat: item.imageInfo.sourceFormat,
    outputFormat: item.imageInfo.outputFormat,
    formatConverted: item.imageInfo.converted,
    metadataPolicy:
      "Transfer writable metadata and ICC profile; normalize Orientation to 1 after pixel rotation; exclude unsafe embedded previews; preserve non-preview source metadata in adjacent MIE archive.",
    width: item.width,
    height: item.height,
    mimeType: item.file.type,
    byteSize: item.file.size,
    lastModified: new Date(item.file.lastModified).toISOString(),
    exportedAt: item.exportedAt,
    editRevision: item.editRevision,
    processingTimeMs: item.timing?.totalMs || null,
    detectionTimeMs: item.timing?.detectionMs || null,
    exportTimeMs: item.timing?.exportMs || null,
    workerNumber: item.workerNumber,
    globalClassifierRejectedCount: item.globalClassifierRejectedCount || 0,
    globalClassifierRejected: (item.globalClassifierRejected || []).map(
      serializeBox,
    ),
    initialModelMaskCount: initialModelMasks.length,
    initialModelMasks,
    reviewedMaskCount: finalMasks.length,
    reviewedMasks: finalMasks,
  };
}

function buildTrainingAnnotations(manifest) {
  const training = {
    info: {
      description: "Locally reviewed four-corner badge masks",
      generatedAt: manifest.generatedAt,
      localOnly: true,
      model: MODEL_ID,
      reviewAssumption:
        "Export records the latest automatically saved mask revision.",
    },
    licenses: [],
    categories: [{ id: 1, name: "identification badge", supercategory: "badge" }],
    images: [],
    annotations: [],
  };
  let annotationId = 1;
  manifest.files.forEach((entry, index) => {
    const imageId = index + 1;
    training.images.push({
      id: imageId,
      file_name: entry.sourcePath,
      width: entry.width,
      height: entry.height,
    });
    for (const mask of entry.reviewedMasks) {
      training.annotations.push({
        id: annotationId,
        image_id: imageId,
        category_id: 1,
        bbox: [mask.x, mask.y, mask.width, mask.height],
        segmentation: [mask.points.flatMap((point) => [point.x, point.y])],
        area: mask.area,
        iscrowd: 0,
        attributes: {
          source: mask.source,
          originalLabel: mask.label,
          originalScore: mask.score,
          autoFitted: mask.autoFitted,
          fitConfidence: mask.fitConfidence,
          userAdjusted: mask.userAdjusted,
        },
      });
      annotationId += 1;
    }
  });
  return training;
}

function serializeBox(box) {
  const { x, y, width, height, label, score, source } = box;
  const points = maskPoints(box).map((point) => ({
    x: Math.round(point.x),
    y: Math.round(point.y),
  }));
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
    label,
    score,
    source,
    points,
    area: Math.round(polygonArea(points)),
    autoFitted: Boolean(box.autoFitted),
    fitConfidence: Number(box.fitConfidence) || 0,
    fitReason: box.fitReason || null,
    userAdjusted: Boolean(box.userAdjusted),
    detectionBounds: box.detectionBounds
      ? {
          x: Math.round(box.detectionBounds.x),
          y: Math.round(box.detectionBounds.y),
          width: Math.round(box.detectionBounds.width),
          height: Math.round(box.detectionBounds.height),
        }
      : null,
    classifierPositiveScore: box.classifierPositiveScore ?? null,
    classifierNegativeScore: box.classifierNegativeScore ?? null,
    classifierMargin: box.classifierMargin ?? null,
    classifierTopLabel: box.classifierTopLabel ?? null,
    classifierDecision: box.classifierDecision ?? null,
  };
}

async function createRedactedBlob(item) {
  await ensurePreview(item);
  const response = await localImageRequest("/api/image/redact", item.file, {
    masks: item.boxes.map((box) => expandedMask(box, item)),
    style: elements.redactionStyleInput.value,
    strength: Number(elements.strengthInput.value),
    featherPercent: Number(elements.featherInput.value),
  });
  item.imageInfo = response.info;
  return response.blob;
}

function expandedMask(box, item) {
  const padding = Number(elements.paddingInput.value) / 100;
  const points = maskPoints(box);
  const center = points.reduce(
    (sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }),
    { x: 0, y: 0 },
  );
  const factor = 1 + padding * 2;
  return {
    points: points.map((point) => ({
      x: clamp(center.x + (point.x - center.x) * factor, 0, item.width),
      y: clamp(center.y + (point.y - center.y) * factor, 0, item.height),
    })),
  };
}

async function createMetadataSidecar(item) {
  const response = await localImageRequest("/api/image/metadata", item.file);
  return response.blob;
}

async function writeFile(directory, name, blob) {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

async function writeRelativeFile(rootDirectory, relativePath, blob) {
  const parts = relativePath.split("/").filter(Boolean);
  const name = parts.pop();
  let directory = rootDirectory;
  for (const part of parts) {
    directory = await directory.getDirectoryHandle(part, { create: true });
  }
  await writeFile(directory, name, blob);
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function outputName(item) {
  const name = item.file.name;
  const dot = name.lastIndexOf(".");
  const base = dot < 0 ? name : name.slice(0, dot);
  const extension = item.imageInfo?.outputExtension || `.${fileExtension(name)}`;
  if (item.imageInfo?.converted) {
    return `${base}-redacted-from-${fileExtension(name)}${extension}`;
  }
  return `${base}-redacted${extension}`;
}

function fallbackRelativePath(file) {
  const parts = (file.webkitRelativePath || file.name).split("/").filter(Boolean);
  if (parts.length > 1) parts.shift();
  return parts.join("/");
}

function sourceRelativePath(itemOrFile) {
  if (itemOrFile?.relativePath) {
    return normalizeSourcePath(itemOrFile.relativePath);
  }
  return fallbackRelativePath(itemOrFile);
}

function outputRelativePath(item) {
  const sourcePath = sourceRelativePath(item);
  const parts = sourcePath.split("/");
  parts.pop();
  parts.push(outputName(item));
  return parts.join("/");
}

async function localImageRequest(path, file, options) {
  const headers = {
    "Content-Type": "application/octet-stream",
    "X-Badge-Source-Name": encodeHeader(file.name),
  };
  if (options) {
    headers["X-Badge-Options"] = encodeHeader(JSON.stringify(options));
  }
  const response = await fetch(path, { method: "POST", headers, body: file });
  if (!response.ok) {
    let message = `Local image processing failed (${response.status}).`;
    try {
      const detail = await response.json();
      if (detail.error) message = detail.error;
    } catch {
      // Keep the HTTP fallback.
    }
    throw new Error(message);
  }
  const encodedInfo = response.headers.get("X-Badge-Image-Info");
  return {
    blob: await response.blob(),
    info: encodedInfo ? JSON.parse(decodeHeader(encodedInfo)) : null,
  };
}

async function localJsonRequest(path, file, options) {
  const headers = {
    "Content-Type": "application/octet-stream",
    "X-Badge-Source-Name": encodeHeader(file.name),
    "X-Badge-Options": encodeHeader(JSON.stringify(options || {})),
  };
  const response = await fetch(path, { method: "POST", headers, body: file });
  const responseText = await response.text();
  let detail;
  try {
    detail = JSON.parse(responseText);
  } catch {
    if (response.status === 404) {
      throw new Error(
        "The local image-processing server is an older version. Close old " +
          "Badge Blur windows and restart this app.",
      );
    }
    throw new Error(
      `Local image fitting returned an invalid response (${response.status}).`,
    );
  }
  if (!response.ok) {
    throw new Error(detail.error || `Local image fitting failed (${response.status}).`);
  }
  return detail;
}

function encodeHeader(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeHeader(value) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const binary = atob(padded);
  return new TextDecoder().decode(
    Uint8Array.from(binary, (character) => character.charCodeAt(0)),
  );
}

function fileExtension(name) {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

async function ensureErrorPreview(item) {
  if (item.previewImage) return;
  item.width ||= 800;
  item.height ||= 500;
  const canvas = document.createElement("canvas");
  canvas.width = 800;
  canvas.height = 500;
  const context = canvas.getContext("2d");
  context.fillStyle = "#dbdcdb";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#fe5000";
  context.font = "600 28px Mulish, Aptos, Arial, sans-serif";
  context.fillText("Image not processed", 48, 82);
  context.fillStyle = "#373a36";
  context.font = "20px Mulish, Aptos, Arial, sans-serif";
  const words = item.message.split(/\s+/);
  let line = "";
  let y = 130;
  for (const word of words) {
    const next = `${line} ${word}`.trim();
    if (context.measureText(next).width > 690) {
      context.fillText(line, 48, y);
      line = word;
      y += 30;
    } else {
      line = next;
    }
  }
  context.fillText(line, 48, y);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  item.previewUrl = URL.createObjectURL(blob);
  item.previewImage = await loadImage(item.previewUrl);
}

function updateSummary() {
  if (items.length === 0) {
    elements.summaryText.textContent = "No images selected.";
    return;
  }
  const masks = items.reduce((total, item) => total + item.boxes.length, 0);
  const errors = items.filter((item) => item.status === "error").length;
  elements.summaryText.textContent =
    `${items.length} image${items.length === 1 ? "" : "s"} · ` +
    `${masks} mask${masks === 1 ? "" : "s"}` +
    (errors ? ` · ${errors} error${errors === 1 ? "" : "s"}` : "");
  scheduleProjectCache();
}

function updateButtons() {
  const hasProcessableItems = items.some((item) => !item.decodeError);
  const hasDetectedItems = items.some((item) => item.status === "detected");
  const hasPendingItems = items.some((item) => shouldProcessItem(item));
  const batchLocked = running || batchPaused;
  elements.runAllButton.disabled =
    !serverReady ||
    !modelWorkers.length ||
    !hasProcessableItems ||
    !hasPendingItems ||
    batchLocked;
  elements.runAllButton.textContent = items.some(
    (item) => checkpointStatusForItem(item) === "failed",
  )
    ? "Retry unfinished"
    : "Start batch";
  elements.pauseResumeButton.hidden =
    (running && batchOperation !== "batch") || (!running && !batchPaused);
  elements.pauseWorkflowArrow.hidden = elements.pauseResumeButton.hidden;
  elements.pauseResumeButton.disabled =
    !serverReady || (running && pauseRequested);
  elements.pauseResumeButton.textContent = running
    ? pauseRequested
      ? "Pausing safely…"
      : "Pause after active images"
    : "Resume batch";
  elements.exportAllButton.disabled =
    !serverReady || !hasDetectedItems || batchLocked;
  elements.exportAllButton.textContent = activeRun ? "Re-export all" : "Export all";
  elements.loadModelButton.disabled =
    !serverReady || Boolean(modelWorkers.length) || batchLocked;
  elements.loadModelButton.hidden =
    elements.modelStatus.dataset.state !== "error" || Boolean(modelWorkers.length);
  elements.chooseSourceButton.disabled = !serverReady || batchLocked;
  elements.folderInput.disabled = !serverReady || batchLocked;
  elements.changeExportButton.disabled =
    !serverReady ||
    batchLocked ||
    typeof window.showDirectoryPicker !== "function";
  elements.resetExportButton.disabled = !serverReady || batchLocked;
  elements.importRunButton.disabled = !serverReady || batchLocked;
  elements.quitAppButton.disabled = !serverReady || !lifecycleToken;
  elements.openExportFolderButton.disabled =
    !activeRun ||
    !items.some((item) => item.exportRevision >= 0) ||
    !window.badgeBlurDesktop?.openExportFolder;
  elements.openExportFolderButton.hidden =
    !window.badgeBlurDesktop?.openExportFolder;
  elements.exportLocationOptions.hidden = Boolean(activeRun);
  for (const control of [
    elements.labelsInput,
    elements.enhancedInput,
    elements.thresholdInput,
    elements.paddingInput,
    elements.redactionStyleInput,
    elements.strengthInput,
    elements.featherInput,
    elements.workerCountInput,
  ]) {
    control.disabled = batchLocked;
  }
  updateCarouselControls();
}

function setModelStatus(state, text) {
  elements.modelStatus.dataset.state = state;
  const title = elements.modelStatus.querySelector("strong");
  const detail = elements.modelStatus.querySelector(":scope > div > span");
  const [headline, ...rest] = String(text).split(" · ");
  title.textContent =
    state === "ready"
      ? "Local models ready"
      : state === "error"
        ? "Local models unavailable"
        : "Preparing local models";
  detail.textContent =
    rest.length > 0
      ? rest.join(" · ")
      : state === "ready"
        ? headline
        : text;
}

function updateRedactionStyleUI() {
  const gaussian = elements.redactionStyleInput.value === "gaussian";
  elements.strengthLabel.textContent =
    gaussian ? "Blur strength" : "Mosaic strength";
  elements.redactionStyleHelp.textContent = gaussian
    ? "Smoothly obscures badge text without visible blocks."
    : "Uses visible square pixels for a stronger redaction effect.";
  elements.strengthHelp.textContent = gaussian
    ? `${elements.strengthInput.value}% of the badge's shorter edge.`
    : `Block scale ${elements.strengthInput.value} of 12.`;
}

function workerCapabilities() {
  return {
    hardwareConcurrency: navigator.hardwareConcurrency || 4,
    deviceMemory: navigator.deviceMemory || null,
    computeScore: computeBenchmarkScore,
  };
}

function resolveConfiguredWorkerCount(batchSize = items.length || Infinity) {
  return resolveWorkerCount(
    elements.workerCountInput.value,
    workerCapabilities(),
    batchSize,
  );
}

function updateWorkerCountUI() {
  const preference = normalizeWorkerPreference(elements.workerCountInput.value);
  elements.workerCountInput.value = preference;
  const resolved = resolveConfiguredWorkerCount();
  let description = describeWorkerSelection(
    preference,
    resolved,
    workerCapabilities(),
  );
  if (preference === "4") {
    description += " · high-memory mode";
  } else if (preference === "auto") {
    description += computeBenchmarkScore == null
      ? " · compute benchmark runs after model load"
      : " · benchmarked locally";
  }
  elements.workerCountHelp.textContent = description;
}

function runLocalComputeBenchmark(durationMs = 60) {
  const startedAt = performance.now();
  let operations = 0;
  let state = 0x12345678;
  while (performance.now() - startedAt < durationMs) {
    for (let index = 0; index < 1000; index += 1) {
      state = Math.imul(state ^ (state >>> 13), 0x5bd1e995);
    }
    operations += 1000;
  }
  // Retain the state so an optimizing engine cannot discard the loop.
  if (state === 0) console.debug(state);
  return operations / Math.max(1, performance.now() - startedAt);
}

function showBatchWorkerProgress(completed, active, workerCount) {
  const percent = items.length ? (completed / items.length) * 100 : 0;
  showProgress(
    `${completed} of ${items.length} finished · ${active} active · ${workerCount} worker${workerCount === 1 ? "" : "s"}`,
    percent,
  );
}

function finishedItemCount() {
  return items.filter((item) => {
    const status = checkpointStatusForItem(item);
    return status === "completed" || status === "failed";
  }).length;
}

function batchProgressPercent() {
  return items.length ? (finishedItemCount() / items.length) * 100 : 0;
}

function showProgress(text, percent) {
  elements.progressWrap.hidden = false;
  elements.progressText.textContent = text;
  elements.progressBar.style.width = `${clamp(percent, 0, 100)}%`;
}

function hideCompletion() {
  elements.completionBanner.hidden = true;
}

function showCompletion(title, text) {
  elements.completionBanner.querySelector("strong").textContent = title;
  elements.completionText.textContent = text;
  elements.completionBanner.hidden = false;
  updateButtons();
}

function startBatchTimer() {
  stopBatchTimer();
  updateBatchTime();
  batchTimer = setInterval(updateBatchTime, 250);
}

function stopBatchTimer() {
  if (batchTimer) clearInterval(batchTimer);
  batchTimer = null;
  updateBatchTime();
}

function startExportTimer() {
  stopExportTimer();
  exportStartedAt = performance.now();
  updateExportTime();
  exportTimer = setInterval(updateExportTime, 250);
}

function stopExportTimer() {
  if (exportTimer) clearInterval(exportTimer);
  exportTimer = null;
  updateExportTime();
}

function totalRecordedExportTime() {
  return items.reduce(
    (total, item) => total + (Number(item.timing?.exportMs) || 0),
    0,
  );
}

function updateExportTime() {
  if (exportTimer && exportStartedAt != null) {
    elements.exportTime.textContent =
      `Exporting · ${formatDuration(performance.now() - exportStartedAt)}`;
  } else if (lastExportDurationMs != null) {
    elements.exportTime.textContent =
      `Last export · ${formatDuration(lastExportDurationMs)}`;
  } else {
    elements.exportTime.textContent = "Not started";
  }
}

function updateBatchTime() {
  if (batchTimer && batchStartedAt != null) {
    elements.batchTime.textContent =
      `Processing · ${formatDuration(performance.now() - batchStartedAt)}` +
      (lastBatchWorkerCount
        ? ` · ${lastBatchWorkerCount} worker${lastBatchWorkerCount === 1 ? "" : "s"}`
        : "");
  } else if (lastBatchDurationMs != null) {
    elements.batchTime.textContent =
      `Last batch · ${formatDuration(lastBatchDurationMs)}` +
      (lastBatchWorkerCount
        ? ` · ${lastBatchWorkerCount} worker${lastBatchWorkerCount === 1 ? "" : "s"}`
        : "");
  } else {
    elements.batchTime.textContent = "Not started";
  }
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, milliseconds) / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(totalSeconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
