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
  describeWorkerSelection,
  normalizeWorkerPreference,
  resolveWorkerCount,
} from "./worker-policy.js";
import { runWorkerPool } from "./worker-pool.js";

const APP_VERSION = "0.18.0";
const IMAGE_API_VERSION = 5;
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
const CAROUSEL_RADIUS = 1;

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
  exportAllButton: document.querySelector("#exportAllButton"),
  changeExportButton: document.querySelector("#changeExportButton"),
  resetExportButton: document.querySelector("#resetExportButton"),
  exportDestination: document.querySelector("#exportDestination"),
  batchTime: document.querySelector("#batchTime"),
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
  pagination: document.querySelector("#pagination"),
  previousPageButton: document.querySelector("#previousPageButton"),
  nextPageButton: document.querySelector("#nextPageButton"),
  pageStatus: document.querySelector("#pageStatus"),
  quitAppButton: document.querySelector("#quitAppButton"),
  quitAppHelp: document.querySelector("#quitAppHelp"),
};

let modelWorkers = [];
let items = [];
let running = false;
let activeIndex = 0;
let pageRenderToken = 0;
let importedManifest = null;
let serverReady = false;
let lifecycleToken = null;
let sourceDirectoryHandle = null;
let customExportDirectoryHandle = null;
let activeRun = null;
let batchStartedAt = null;
let batchTimer = null;
let lastBatchDurationMs = null;
let lastBatchWorkerCount = null;
let computeBenchmarkScore = null;
let exportQueue = Promise.resolve();
let carouselRenderQueue = Promise.resolve();
const itemExportTimers = new Map();

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
elements.chooseSourceButton.addEventListener("click", chooseSourceFolder);
elements.folderInput.addEventListener("change", loadSelectedFiles);
elements.loadModelButton.addEventListener("click", loadModel);
elements.runAllButton.addEventListener("click", runAll);
elements.exportAllButton.addEventListener("click", exportAll);
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
if (typeof window.showDirectoryPicker !== "function") {
  elements.exportCompatibility.hidden = false;
}
document.addEventListener("keydown", (event) => {
  if (event.key !== "Delete" && event.key !== "Backspace") return;
  if (event.target instanceof HTMLInputElement) return;
  const selected = items.find((item) => item.selectedBoxId);
  if (selected) {
    event.preventDefault();
    removeSelectedBox(selected);
  }
});
updateButtons();
updateRedactionStyleUI();
updateWorkerCountUI();
void verifyLocalServer();

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
  if (
    running &&
    !window.confirm(
      "A batch is still running. Quit Badge Blur and stop processing now?",
    )
  ) {
    return;
  }

  const token = lifecycleToken;
  elements.quitAppButton.disabled = true;
  elements.quitAppButton.textContent = "Shutting down…";
  elements.quitAppHelp.textContent =
    "Stopping the private local service and releasing its port.";

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
    updateButtons();
    setModelStatus("idle", "App stopped");
    showProgress(
      "Badge Blur has shut down and released its local server. You can close this browser tab.",
      100,
    );
    elements.quitAppButton.textContent = "Badge Blur stopped";
    elements.quitAppHelp.textContent =
      "The private local service is no longer running.";
  } catch (error) {
    console.error("Badge Blur shutdown failed.", error);
    elements.quitAppButton.disabled = false;
    elements.quitAppButton.textContent = "Quit Badge Blur";
    elements.quitAppHelp.textContent =
      `Could not stop the local service: ${error.message}`;
  }
}

async function chooseSourceFolder() {
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
    sourceDirectoryHandle = handle;
    customExportDirectoryHandle = null;
    activeRun = null;
    elements.sourceFolderLabel.textContent =
      `${handle.name} · ${selected.length} supported image${selected.length === 1 ? "" : "s"}`;
    updateExportDestination();
    await setSelectedFiles(selected);
  } catch (error) {
    if (error.name !== "AbortError") {
      console.error(error);
      showProgress(`Could not open the source folder: ${error.message}`, 0);
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
  sourceDirectoryHandle = null;
  customExportDirectoryHandle = null;
  activeRun = null;
  const selected = [...event.target.files]
    .filter((file) => SUPPORTED_EXTENSIONS.has(fileExtension(file.name)))
    .map((file) => ({
      file,
      relativePath: fallbackRelativePath(file),
    }))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  elements.sourceFolderLabel.textContent =
    `${sourceRootName(selected[0]?.file) || "Selected folder"} · ${selected.length} supported image${selected.length === 1 ? "" : "s"}`;
  updateExportDestination();
  await setSelectedFiles(selected);
}

async function setSelectedFiles(selected) {
  releaseItems();
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
  lastBatchDurationMs = null;
  lastBatchWorkerCount = null;
  updateBatchTime();

  elements.emptyState.hidden = items.length > 0;
  await renderCarousel();
  await restoreImportedRun();
  updateSummary();
  updateButtons();
}

async function importPreviousRun(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const manifest = JSON.parse(await file.text());
    if (!manifest || !Array.isArray(manifest.files)) {
      throw new Error("This is not a Badge Blur run manifest.");
    }
    importedManifest = manifest;
    restoreRunSettings(manifest);
    if (items.length === 0) {
      showProgress(
        "Previous run loaded. Now choose the original source-image folder.",
        100,
      );
      return;
    }
    await restoreImportedRun();
  } catch (error) {
    console.error(error);
    importedManifest = null;
    showProgress(`Could not import the previous run: ${error.message}`, 0);
  }
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
  const runFileIndex = indexRunFiles(importedManifest.files);
  let restored = 0;
  let mismatched = 0;
  for (const item of items) {
    const entry = findRunEntry(runFileIndex, sourceRelativePath(item));
    if (!entry) continue;
    if (entry.byteSize != null && Number(entry.byteSize) !== item.file.size) {
      item.status = "error";
      item.message = "Previous-run match skipped: source file size changed";
      mismatched += 1;
      continue;
    }
    item.boxes = (entry.reviewedMasks || []).map(deserializeMask);
    item.modelBoxes = (entry.initialModelMasks || []).map(deserializeMask);
    item.selectedBoxId = null;
    item.status = "detected";
    item.message = `${item.boxes.length} mask${item.boxes.length === 1 ? "" : "s"} restored`;
    item.editRevision += 1;
    item.exportStatus = "Restored · awaiting export";
    restored += 1;
  }
  activeIndex = 0;
  await renderCarousel();
  updateSummary();
  updateButtons();
  showProgress(
    `Restored ${restored} of ${importedManifest.files.length} previous-run file(s)` +
      (mismatched ? ` · ${mismatched} changed source file(s) skipped` : ""),
    restored ? 100 : 0,
  );
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
  for (const item of items) releasePreview(item);
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

async function loadModel() {
  if (modelWorkers.length || running) return;
  setModelStatus("loading", "Loading local model…");
  elements.loadModelButton.disabled = true;

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
    elements.loadModelButton.textContent = "Models loaded";
  } catch (error) {
    console.error(error);
    setModelStatus("error", "Model load failed");
    elements.loadModelButton.disabled = false;
    elements.loadModelButton.textContent = "Retry local model";
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

async function runAll() {
  if (!modelWorkers.length || running || items.length === 0) return;
  running = true;
  lastBatchWorkerCount = null;
  batchStartedAt = performance.now();
  startBatchTimer();
  updateButtons();
  elements.progressWrap.hidden = false;
  await ensureExportRun({ allowPrompt: true });
  const requestedCount = resolveConfiguredWorkerCount();
  const workerCount = await ensureModelWorkers(requestedCount);
  lastBatchWorkerCount = workerCount;
  updateBatchTime();
  const activeIndices = new Set();
  const pendingExports = [];
  let completed = 0;

  await runWorkerPool(
    modelWorkers.slice(0, workerCount),
    items.length,
    async (models, index, workerIndex) => {
      const item = items[index];
      const itemStartedAt = performance.now();
      item.processing = true;
      item.workerNumber = workerIndex + 1;
      activeIndices.add(index);
      activeIndex = Math.min(...activeIndices);
      await queueCarouselRender();
      showBatchWorkerProgress(completed, activeIndices.size, workerCount);

      try {
        const detectionStartedAt = performance.now();
        await detectItem(item, models);
        const detectionMs = performance.now() - detectionStartedAt;
        item.timing = {
          detectionMs,
          exportMs: 0,
          totalMs: detectionMs,
        };
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
          completed += 1;
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
  );
  await Promise.all(pendingExports);

  lastBatchDurationMs = performance.now() - batchStartedAt;
  stopBatchTimer();
  await writeRunMetadata();
  showProgress(
    `Batch finished with ${workerCount} worker${workerCount === 1 ? "" : "s"} in ${formatDuration(lastBatchDurationMs)}. Review the centered images; edits auto-save.`,
    100,
  );
  running = false;
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

  elements.reviewGrid.replaceChildren();
  for (let offset = -CAROUSEL_RADIUS; offset <= CAROUSEL_RADIUS; offset += 1) {
    const index = activeIndex + offset;
    const slot = document.createElement("div");
    slot.className = `carousel-slot ${offset === 0 ? "is-center" : "is-side"}`;
    elements.reviewGrid.append(slot);
    if (index < 0 || index >= items.length) {
      slot.classList.add("is-empty");
      continue;
    }
    const item = items[index];
    try {
      await ensurePreview(item);
    } catch (error) {
      item.status = "error";
      item.message = error.message;
      await ensureErrorPreview(item);
    }
    if (renderToken !== pageRenderToken) return;
    renderItem(item, slot, offset === 0);
  }
  updateCarouselControls();
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

async function changeCarousel(direction) {
  if (running) return;
  const nextIndex = clamp(activeIndex + direction, 0, items.length - 1);
  if (nextIndex === activeIndex) return;
  activeIndex = nextIndex;
  updateButtons();
  await renderCarousel();
  document.querySelector(".review-section")?.scrollIntoView({ behavior: "smooth" });
}

function updateCarouselControls() {
  elements.pagination.hidden = items.length <= 1;
  elements.pageStatus.textContent =
    items.length === 0
      ? "No images"
      : `Image ${activeIndex + 1} of ${items.length} · active image centered`;
  elements.previousPageButton.disabled = running || activeIndex === 0;
  elements.nextPageButton.disabled = running || activeIndex >= items.length - 1;
}

async function centerCarouselAt(index) {
  if (running || index === activeIndex) return;
  activeIndex = index;
  updateButtons();
  await renderCarousel();
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
  const color = selected ? "#ffb000" : box.source === "manual" ? "#00a878" : "#e53935";
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
  context.font = `600 ${Math.max(16, 19 * scale)}px system-ui`;
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
  const center = {
    x: clamp(box.x + box.width + 5 * canvasPerCssX, radiusX, context.canvas.width - radiusX),
    y: clamp(box.y + box.height + 5 * canvasPerCssY, radiusY, context.canvas.height - radiusY),
  };

  context.save();
  context.beginPath();
  context.ellipse(center.x, center.y, radiusX, radiusY, 0, 0, Math.PI * 2);
  context.fillStyle = "#b42318";
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
  const center = {
    x: clamp(box.x + box.width + 5 * sourcePerCssX, 13 * sourcePerCssX, sourceWidth - 13 * sourcePerCssX),
    y: clamp(box.y + box.height + 5 * sourcePerCssY, 13 * sourcePerCssY, sourceHeight - 13 * sourcePerCssY),
  };
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
      await writeRunMetadata();
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
    renderItemStatus(item);
  }
}

function scheduleItemExport(item) {
  if (item.status !== "detected" || running) return;
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
  const startedAt = performance.now();
  batchStartedAt = startedAt;
  startBatchTimer();
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
  lastBatchDurationMs = performance.now() - startedAt;
  stopBatchTimer();
  await writeRunMetadata();
  running = false;
  await renderCarousel();
  updateButtons();
  showProgress(
    `Re-export finished in ${formatDuration(lastBatchDurationMs)} · ${run.runFolderName}`,
    100,
  );
}

async function writeRunMetadata() {
  if (!activeRun) return;
  const manifest = buildRunManifest();
  const trainingAnnotations = buildTrainingAnnotations(manifest);
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
}

function buildRunManifest() {
  return {
    schemaVersion: 9,
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
  context.fillStyle = "#f3f4f2";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#5b1a1a";
  context.font = "600 28px system-ui";
  context.fillText("Image not processed", 48, 82);
  context.fillStyle = "#333333";
  context.font = "20px system-ui";
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
}

function updateButtons() {
  const hasProcessableItems = items.some((item) => !item.decodeError);
  const hasDetectedItems = items.some((item) => item.status === "detected");
  elements.runAllButton.disabled =
    !serverReady || !modelWorkers.length || !hasProcessableItems || running;
  elements.exportAllButton.disabled =
    !serverReady || !hasDetectedItems || running;
  elements.loadModelButton.disabled =
    !serverReady || Boolean(modelWorkers.length) || running;
  elements.chooseSourceButton.disabled = !serverReady || running;
  elements.folderInput.disabled = !serverReady || running;
  elements.changeExportButton.disabled =
    !serverReady || running || typeof window.showDirectoryPicker !== "function";
  elements.resetExportButton.disabled = !serverReady || running;
  elements.importRunButton.disabled = !serverReady || running;
  elements.quitAppButton.disabled = !serverReady || !lifecycleToken;
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
    control.disabled = running;
  }
  updateCarouselControls();
}

function setModelStatus(state, text) {
  elements.modelStatus.dataset.state = state;
  elements.modelStatus.textContent = text;
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

function showProgress(text, percent) {
  elements.progressWrap.hidden = false;
  elements.progressText.textContent = text;
  elements.progressBar.style.width = `${clamp(percent, 0, 100)}%`;
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
