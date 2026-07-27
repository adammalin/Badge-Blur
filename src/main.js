import {
  CLASSIFIER_LABELS,
  CLASSIFIER_MARGIN,
  CLASSIFIER_MODEL_ID,
  CLASSIFIER_POSITIVE_LABEL_COUNT,
  GLOBAL_CLASSIFIER_LABELS,
  GLOBAL_CLASSIFIER_MAX_SCORE,
  GLOBAL_CLASSIFIER_POSITIVE_LABEL_COUNT,
  GLOBAL_CLASSIFIER_REJECT_MARGIN,
  LANYARD_BADGE_THRESHOLD,
  LANYARD_PROMPT,
  LANYARD_THRESHOLD,
  MODEL_ID,
  PERSON_THRESHOLD,
  TORSO_THRESHOLD,
} from "./detector-config.js";
import {
  classifierEvidence,
  globalClassifierDecision,
} from "./classifier-utils.js";
import {
  complementaryBadgePrompt,
  deduplicateBadgeDetections,
  filterBadgeDetections,
  isComplementaryBadgeOrientation,
} from "./detection-utils.js";
import {
  hasUnexportedChanges,
  reusableRedactedPreview,
} from "./export-state.js";
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
  candidateCenterInsideRegion,
  candidateInsideTorso,
  lanyardBadgeSearchRegion,
  torsoRegionForPerson,
} from "./person-guidance.js";
import {
  loadActiveProjectCache,
  saveActiveProjectCache,
} from "./project-cache.js";
import {
  validateRunImport,
  validateSourceSelection,
} from "./run-import.js";
import {
  assessReviewAttention,
  associateBadgesToPeople,
} from "./review-attention.js";
import {
  applyForCurrentEditRevision,
  isCurrentEditRevision,
} from "./edit-revisions.js";
import { createModelWorker } from "./model-worker-client.js";
import {
  MAX_REDACTION_STRENGTH,
  MIN_REDACTION_STRENGTH,
  normalizeRedactionStrength,
  redactionStrengthRecord,
  resolveRedactionStrength,
} from "../shared/redaction-strength.js";
import {
  exportExtension,
  normalizeExportFormat,
  resolveExportFormat,
} from "../shared/export-format.js";
import {
  adjacentBadgeId,
  reviewProgressSummary,
  selectedBadgePosition,
} from "./review-ui.js";
import {
  continuousViewZoom,
  fittedImageSize,
  steppedViewZoom,
} from "./view-transform.js";

const APP_VERSION = "0.22.1";
const IMAGE_API_VERSION = 7;
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
const VIEW_SCALE_STORAGE_KEY = "badge-blur-view-scale";
const INFERENCE_THREADS_PER_WORKER = Math.max(
  1,
  Math.min(2, (navigator.hardwareConcurrency || 4) - 4),
);

const elements = {
  setupPanel: document.querySelector("#setupPanel"),
  reviewSection: document.querySelector("#reviewSection"),
  backToSetupButton: document.querySelector("#backToSetupButton"),
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
  outputFormatChoice: document.querySelector("#outputFormatChoice"),
  outputFormatInput: document.querySelector("#outputFormatInput"),
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
  exportChangedButton: document.querySelector("#exportChangedButton"),
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
  progressTimer: document.querySelector("#progressTimer"),
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
  attentionQueueButton: document.querySelector("#attentionQueueButton"),
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
const itemExportTimers = new Map();
let thumbnailObserver = null;
let cachedProject = null;
let projectCacheLoaded = false;
let restoringCachedProject = false;
let projectCacheTimer = null;
let defaultViewScaleMode = readViewScaleMode();
let spacePanning = false;
const sourceRegistrationState = new WeakMap();

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
elements.outputFormatInput.addEventListener("change", () => {
  if (!elements.outputFormatInput.value) return;
  elements.outputFormatInput.value = normalizeExportFormat(
    elements.outputFormatInput.value,
  );
  elements.outputFormatChoice.classList.remove("needs-choice");
  scheduleAllEditedExports();
  updateButtons();
});
elements.workerCountInput.addEventListener("change", updateWorkerCountUI);
for (const input of [
  elements.labelsInput,
  elements.enhancedInput,
  elements.thresholdInput,
  elements.paddingInput,
  elements.redactionStyleInput,
  elements.outputFormatInput,
  elements.strengthInput,
  elements.featherInput,
  elements.workerCountInput,
]) {
  input.addEventListener("change", scheduleProjectCache);
}
elements.chooseSourceButton.addEventListener("click", chooseSourceFolder);
elements.folderInput.addEventListener("change", loadSelectedFiles);
elements.loadModelButton.addEventListener("click", loadModel);
elements.runAllButton.addEventListener("click", () => {
  setWorkflowStage("review");
  void startBatch();
});
elements.backToSetupButton.addEventListener("click", () => {
  if (!running) setWorkflowStage("setup");
});
elements.pauseResumeButton.addEventListener("click", () => {
  if (running) requestPause();
  else if (batchPaused) void startBatch();
});
elements.exportAllButton.addEventListener("click", exportAll);
elements.exportChangedButton.addEventListener("click", exportChanged);
elements.openExportFolderButton.addEventListener("click", openExportFolder);
elements.attentionQueueButton.addEventListener("click", () => {
  void goToNextAttentionItem();
});
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
  const activeItem = items[activeIndex];
  if (
    (event.metaKey || event.ctrlKey) &&
    ["=", "+", "-", "_", "0"].includes(event.key)
  ) {
    event.preventDefault();
    if (event.key === "0") setViewScaleMode(activeItem, "fit");
    else stepItemZoom(activeItem, event.key === "-" || event.key === "_" ? -1 : 1);
    return;
  }
  if (event.code === "Space" && activeItem && !elements.quitDialog.open) {
    event.preventDefault();
    spacePanning = true;
    document
      .querySelector(`[data-item-id="${activeItem.id}"] .canvas-wrap`)
      ?.classList.add("is-hand-tool");
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey || elements.quitDialog.open) {
    return;
  }
  if (
    (event.key === "ArrowLeft" ||
      event.key === "ArrowRight" ||
      event.key.toLowerCase() === "j" ||
      event.key.toLowerCase() === "k") &&
    items.length > 1
  ) {
    event.preventDefault();
    void changeCarousel(
      event.key === "ArrowLeft" || event.key.toLowerCase() === "k" ? -1 : 1,
    );
    return;
  }
  const key = event.key.toLowerCase();
  if (key === "n") {
    event.preventDefault();
    void goToNextAttentionItem();
    return;
  }
  if (key === "v" && activeItem?.status === "detected") {
    event.preventDefault();
    void setItemView(
      activeItem,
      activeItem.viewMode === "after" ? "before" : "after",
    );
    return;
  }
  if (key === "m" && activeItem && !activeItem.processing) {
    event.preventDefault();
    void setItemView(activeItem, "before");
    document
      .querySelector(`[data-item-id="${activeItem.id}"] canvas`)
      ?.focus();
    setCurrentImageReviewMessage("Mask edit mode · drag across a missed badge.");
    return;
  }
  if (key === "r") {
    event.preventDefault();
    void toggleActiveItemReviewed();
    return;
  }
  if (key === "p") {
    if (running) {
      event.preventDefault();
      requestPause();
    } else if (batchPaused) {
      event.preventDefault();
      void startBatch();
    }
    return;
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    const activeItem = items[activeIndex];
    if (activeItem?.selectedBoxId && !activeItem.processing) {
      event.preventDefault();
      removeSelectedBox(activeItem);
    }
  }
});
document.addEventListener("keyup", (event) => {
  if (event.code !== "Space") return;
  spacePanning = false;
  for (const viewer of document.querySelectorAll(".canvas-wrap")) {
    viewer.classList.remove("is-hand-tool", "is-panning");
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") void persistProjectCache();
});
window.addEventListener("resize", () => {
  requestAnimationFrame(refreshViewerLayouts);
});
if (new URLSearchParams(window.location.search).get("smoke") === "1") {
  window.__badgeBlurReviewSmoke = Object.freeze({
    loadFixture: loadReviewSmokeFixture,
    state: reviewSmokeState,
    simulateOtherImageProcessing,
    addManualMaskAndShowAfter,
  });
}
initializeTheme();
setWorkflowStage("setup", { focus: false });
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

function readViewScaleMode() {
  try {
    return localStorage.getItem(VIEW_SCALE_STORAGE_KEY) === "fill"
      ? "fill"
      : "fit";
  } catch {
    return "fit";
  }
}

function setViewScaleMode(item, mode) {
  if (!item) return;
  const normalizedMode = mode === "fill" ? "fill" : "fit";
  item.viewScaleMode = normalizedMode;
  item.viewZoom = 1;
  defaultViewScaleMode = normalizedMode;
  try {
    localStorage.setItem(VIEW_SCALE_STORAGE_KEY, defaultViewScaleMode);
  } catch {
    // The selected view still applies for the current session.
  }
  const card = document.querySelector(`[data-item-id="${item.id}"]`);
  if (!card) return;
  updateViewScaleControls(card, item);
  const viewer = card.querySelector(".canvas-wrap");
  if (viewer) {
    viewer.scrollTop = 0;
    viewer.scrollLeft = 0;
  }
  requestAnimationFrame(() => updateViewerLayout(card, item));
}

function updateViewScaleControls(card, item) {
  const mode = item?.viewScaleMode || defaultViewScaleMode;
  const fillWidth = mode === "fill";
  const fitted = mode === "fit";
  card.dataset.viewScale = mode;
  const fitButton = card.querySelector(".fit-view");
  const fillButton = card.querySelector(".fill-view");
  const zoomLevel = card.querySelector(".zoom-level");
  if (!fitButton || !fillButton || !zoomLevel) return;
  fitButton.classList.toggle("is-selected", fitted);
  fillButton.classList.toggle("is-selected", fillWidth);
  fitButton.setAttribute("aria-pressed", String(fitted));
  fillButton.setAttribute("aria-pressed", String(fillWidth));
  zoomLevel.textContent =
    mode === "zoom"
      ? `${Math.round(item.viewZoom * 100)}%`
      : mode === "fill"
        ? "Fill"
        : "Fit";
  zoomLevel.setAttribute(
    "aria-label",
    mode === "zoom"
      ? `Zoom ${Math.round(item.viewZoom * 100)} percent; reset to fit`
      : `${zoomLevel.textContent} view; reset to fit`,
  );
}

async function createReviewSmokeFile(name, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#e6eee6");
  gradient.addColorStop(1, "#075b38");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#ffffff";
  context.fillRect(width * 0.2, height * 0.18, width * 0.6, height * 0.24);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  return new File([blob], name, { type: "image/png" });
}

async function loadReviewSmokeFixture() {
  const files = await Promise.all([
    createReviewSmokeFile("review-smoke-one.png", 420, 1260),
    createReviewSmokeFile("review-smoke-two.png", 560, 980),
  ]);
  await setSelectedFiles(
    files.map((file) => ({ file, relativePath: file.name })),
  );
  await Promise.all(items.map((item) => ensurePreview(item)));
  const boxCounts = [2, 1];
  for (const [itemIndex, item] of items.entries()) {
    item.boxes = Array.from({ length: boxCounts[itemIndex] }, (_, boxIndex) => {
      const width = item.width * 0.22;
      const height = item.height * 0.12;
      const box = {
        id: `smoke-box-${itemIndex}-${boxIndex}`,
        x: item.width * (0.18 + boxIndex * 0.34),
        y: item.height * (0.32 + boxIndex * 0.12),
        width,
        height,
        label: "synthetic badge",
        score: 0.9,
        source: "manual",
      };
      box.points = rectangleCorners(box);
      return box;
    });
    item.status = "detected";
    item.message = `${item.boxes.length} smoke badge${
      item.boxes.length === 1 ? "" : "s"
    }`;
    item.exportStatus = "Smoke review ready";
    item.viewScaleMode = "fit";
    item.viewZoom = 1;
    refreshItemAttention(item);
  }
  activeIndex = 0;
  renderFilmstrip();
  await renderCarousel();
  setWorkflowStage("review", { focus: false });
  await new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
  updateSummary();
  updateButtons();
  return reviewSmokeState();
}

function reviewSmokeState() {
  const activeItem = items[activeIndex] || null;
  const selected = activeItem?.boxes.find(
    (box) => box.id === activeItem.selectedBoxId,
  );
  return {
    activeIndex,
    boxCounts: items.map((item) => item.boxes.length),
    selectedBoxIds: items.map((item) => item.selectedBoxId),
    selectedStrength: selected?.redactionStrength ?? null,
    summary: elements.summaryText.textContent,
    inspectorTitle:
      document.querySelector(".selected-mask-title")?.textContent || null,
    viewScaleMode: activeItem?.viewScaleMode || null,
    viewZoom: activeItem?.viewZoom || null,
    exportStatus: activeItem?.exportStatus || null,
    exportInFlight: Boolean(activeItem?.exportInFlight),
    exportQueueCount: activeItem?.exportQueueCount || 0,
    editRevision: activeItem?.editRevision ?? null,
    redactedPreviewRevision: activeItem?.redactedPreviewRevision ?? null,
    redactedPreviewBytes: activeItem?.redactedPreviewBlob?.size || 0,
    imageInfoOutputFormat: activeItem?.imageInfo?.outputFormat || null,
    reviewConfirmations: items.map((item) => item.reviewConfirmed),
    reviewActionInFlight: Boolean(activeItem?.reviewActionInFlight),
    reviewControl:
      document.querySelector(".current-image-review-state")?.textContent || null,
    workflowStage: document.body.dataset.workflowStage,
  };
}

function simulateOtherImageProcessing(enabled) {
  const activeItem = items[activeIndex];
  const otherItem = items.find((item) => item !== activeItem);
  running = Boolean(enabled);
  if (otherItem) otherItem.processing = Boolean(enabled);
  if (activeItem) renderItemStatus(activeItem);
  return reviewSmokeState();
}

async function addManualMaskAndShowAfter() {
  const item = items[activeIndex];
  if (!item) return reviewSmokeState();
  const manualBox = {
    id: `smoke-manual-${crypto.randomUUID()}`,
    x: item.width * 0.35,
    y: item.height * 0.68,
    width: item.width * 0.2,
    height: item.height * 0.08,
    label: "manual badge",
    score: 1,
    source: "manual",
  };
  manualBox.points = rectangleCorners(manualBox);
  item.boxes.push(manualBox);
  item.manualAddedCount += 1;
  item.selectedBoxId = manualBox.id;
  markItemEdited(item);
  await setItemView(item, "after");
  return reviewSmokeState();
}

function updateViewerScrollAffordance(card) {
  if (!card) return;
  const frame = card.querySelector(".viewer-frame");
  if (!frame) return;
  frame.classList.remove("has-scroll-content");
  frame.classList.add("is-at-bottom");
}

function updateViewerLayout(card, item) {
  if (!card || !item?.previewImage) return;
  const viewer = card.querySelector(".canvas-wrap");
  const frame = card.querySelector(".viewer-frame");
  const stage = card.querySelector(".viewer-content");
  const canvas = card.querySelector("canvas");
  const afterImage = card.querySelector(".after-preview");
  if (!viewer || !frame || !stage || !canvas || !afterImage) return;
  const baseHeight = Math.round(
    window.innerWidth <= 760
      ? clamp(window.innerHeight * 0.62, 420, 640)
      : clamp(window.innerHeight * 0.72, 560, 960),
  );
  frame.style.height = `${baseHeight}px`;
  frame.dataset.baseHeight = String(baseHeight);
  const viewportWidth = viewer.clientWidth;
  const viewportHeight = baseHeight;
  if (!(viewportWidth > 0) || !(viewportHeight > 0)) return;

  const size = fittedImageSize(
    canvas.width || item.previewImage.naturalWidth,
    canvas.height || item.previewImage.naturalHeight,
    viewportWidth,
    viewportHeight,
    item.viewScaleMode,
    item.viewZoom,
  );
  const expandedHeight =
    item.viewScaleMode === "fit"
      ? baseHeight
      : Math.max(baseHeight, Math.ceil(size.height));
  frame.style.height = `${expandedHeight}px`;
  const stageWidth = Math.max(viewportWidth, size.width);
  const stageHeight = expandedHeight;
  const left = Math.max(0, (stageWidth - size.width) / 2);
  const top = Math.max(0, (stageHeight - size.height) / 2);

  stage.style.width = `${stageWidth}px`;
  stage.style.height = `${stageHeight}px`;
  for (const media of [canvas, afterImage]) {
    media.style.left = `${left}px`;
    media.style.top = `${top}px`;
    media.style.width = `${size.width}px`;
    media.style.height = `${size.height}px`;
  }
  if (size.width <= viewportWidth + 1) {
    viewer.scrollLeft = 0;
  }
  updateViewerScrollAffordance(card);
}

function setItemZoom(item, zoom, anchor = null) {
  const card = document.querySelector(`[data-item-id="${item?.id}"]`);
  if (!card) return;
  const viewer = card.querySelector(".canvas-wrap");
  const canvas = card.querySelector("canvas");
  if (!viewer || !canvas) return;
  const viewerRect = viewer.getBoundingClientRect();
  const oldCanvasRect = canvas.getBoundingClientRect();
  const clientX = anchor?.clientX ?? viewerRect.left + viewerRect.width / 2;
  const clientY = anchor?.clientY ?? viewerRect.top + viewerRect.height / 2;
  const sourceX = clamp(
    (clientX - oldCanvasRect.left) / Math.max(1, oldCanvasRect.width),
    0,
    1,
  );
  const sourceY = clamp(
    (clientY - oldCanvasRect.top) / Math.max(1, oldCanvasRect.height),
    0,
    1,
  );

  item.viewScaleMode = "zoom";
  item.viewZoom = zoom;
  updateViewScaleControls(card, item);
  updateViewerLayout(card, item);

  const newCanvasRect = canvas.getBoundingClientRect();
  viewer.scrollLeft +=
    newCanvasRect.left + sourceX * newCanvasRect.width - clientX;
  window.scrollBy({
    top: newCanvasRect.top + sourceY * newCanvasRect.height - clientY,
    behavior: "auto",
  });
  updateViewerScrollAffordance(card);
}

function stepItemZoom(item, direction, anchor = null) {
  if (!item) return;
  const current = item.viewScaleMode === "zoom" ? item.viewZoom : 1;
  setItemZoom(item, steppedViewZoom(current, direction), anchor);
}

function refreshViewerLayouts() {
  for (const card of document.querySelectorAll(".image-card")) {
    const item = items.find(
      (candidate) => candidate.id === card.dataset.itemId,
    );
    if (item) updateViewerLayout(card, item);
  }
}

function scheduleViewerLayoutRefresh() {
  requestAnimationFrame(() => {
    refreshViewerLayouts();
    // A hidden setup-stage viewer can report its old width for the first
    // frame after Start batch. Recheck after the review layout has painted.
    requestAnimationFrame(refreshViewerLayouts);
  });
}

function setWorkflowStage(stage, { focus = true } = {}) {
  const review = stage === "review";
  document.body.dataset.workflowStage = review ? "review" : "setup";
  elements.setupPanel.hidden = review;
  elements.reviewSection.hidden = !review;
  elements.setupPanel.inert = review;
  elements.reviewSection.inert = !review;
  if (review) scheduleViewerLayoutRefresh();
  if (!focus) return;
  requestAnimationFrame(() => {
    const heading = review
      ? document.querySelector("#review-title")
      : document.querySelector("#setup-title");
    heading?.setAttribute("tabindex", "-1");
    heading?.focus({ preventScroll: true });
  });
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
    if (!importedManifest) requireOutputFormatChoice();
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
    if (!importedManifest) requireOutputFormatChoice();
  } catch (error) {
    console.error(error);
    showProgress(`Could not open the source folder: ${error.message}`, 0);
  }
}

function requireOutputFormatChoice() {
  elements.outputFormatInput.value = "";
  elements.outputFormatChoice.classList.add("needs-choice");
  updateButtons();
  showProgress(
    "Folder ready · choose the output format before starting the batch.",
    100,
  );
  requestAnimationFrame(() => {
    elements.outputFormatChoice.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
    elements.outputFormatInput.focus({ preventScroll: true });
  });
}

async function setSelectedFiles(selected) {
  setWorkflowStage("setup", { focus: false });
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
    personGuidance: [],
    attention: null,
    reviewConfirmed: false,
    reviewedAt: null,
    manualAddedCount: 0,
    removedMaskCount: 0,
    cornerAdjustedCount: 0,
    selectedBoxId: null,
    viewMode: "before",
    viewScaleMode: defaultViewScaleMode,
    viewZoom: 1,
    redactedPreviewUrl: null,
    redactedPreviewBlob: null,
    redactedPreviewRevision: -1,
    redactedPreviewRequest: null,
    metadataSidecarBlob: null,
    metadataSidecarPromise: null,
    metadataSidecarRunId: null,
    exportQueueCount: 0,
    exportInFlight: false,
    activeExportRevision: -1,
    editRevision: 0,
    exportRevision: -1,
    importedRun: false,
    exportStatus: "Waiting for batch",
    timing: null,
    stageTimings: {},
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
      if (await restoreFromManifestLocation(file, document)) return;
      showProgress(
        isBatchCheckpoint(document)
          ? `Checkpoint and run folder loaded. Choose the original source folder named ${importInfo.sourceRootName}.`
          : `Previous run loaded for ${importInfo.fileCount} image(s). Choose the original source folder named ${importInfo.sourceRootName}.`,
        100,
      );
      elements.chooseSourceButton.textContent =
        `Choose “${importInfo.sourceRootName}” folder`;
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

async function restoreFromManifestLocation(file, manifest) {
  if (!window.badgeBlurDesktop?.recoverManifestSource) return false;
  try {
    const recovery =
      await window.badgeBlurDesktop.recoverManifestSource(file);
    if (
      recovery.runId !== manifest.runId ||
      recovery.runFolderName !== manifest.runFolderName ||
      recovery.sourceRootName !== manifest.sourceRootName
    ) {
      throw new Error("The recovered source folder belongs to a different run.");
    }
    const selected = recovery.files.map((source) => ({
      relativePath: source.relativePath,
      file: {
        name: source.name,
        size: source.size,
        type: source.type,
        lastModified: source.lastModified,
        webkitRelativePath:
          `${recovery.sourceRootName}/${source.relativePath}`,
        desktopSourceToken: source.token,
      },
    }));
    validateSourceSelection(manifest, selected);
    sourceDirectoryHandle = null;
    expectedSourceFolderName = null;
    customExportDirectoryHandle = null;
    if (!isBatchCheckpoint(manifest) || !activeRun) {
      activeRun = null;
    }
    elements.chooseSourceButton.textContent = "Choose source folder";
    elements.sourceFolderLabel.textContent =
      `${recovery.sourceRootName} · ${selected.length} source image${selected.length === 1 ? "" : "s"} recovered from the run location`;
    updateExportDestination();
    await setSelectedFiles(selected);
    return true;
  } catch (error) {
    console.info(
      "Badge Blur could not recover the source folder from the run location.",
      error,
    );
    return false;
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
  elements.outputFormatInput.value = normalizeExportFormat(
    manifest.outputFormatPreference,
  );
  elements.outputFormatChoice.classList.remove("needs-choice");
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
    item.personGuidance = Array.isArray(entry.personGuidance)
      ? entry.personGuidance.map(clonePersonGuide)
      : [];
    item.reviewConfirmed = Boolean(entry.reviewConfirmed);
    item.reviewedAt = entry.reviewedAt || null;
    item.manualAddedCount = Number(entry.manualAddedCount) || 0;
    item.removedMaskCount = Number(entry.removedMaskCount) || 0;
    item.cornerAdjustedCount = Number(entry.cornerAdjustedCount) || 0;
    item.selectedBoxId = null;
    item.imageInfo = entry.imageInfo || null;
    item.editRevision = Math.max(0, Number(entry.editRevision) || 0);
    item.workerNumber = Number(entry.workerNumber) || null;
    item.stageTimings =
      entry.stageTimings && typeof entry.stageTimings === "object"
        ? { ...entry.stageTimings }
        : {};
    if (
      entry.detectionTimeMs != null ||
      entry.exportTimeMs != null ||
      entry.processingTimeMs != null
    ) {
      item.timing = {
        detectionMs: Number(entry.detectionTimeMs) || 0,
        exportMs: Number(entry.exportTimeMs) || 0,
        totalMs:
          Number(entry.processingTimeMs) ||
          (Number(entry.detectionTimeMs) || 0) +
            (Number(entry.exportTimeMs) || 0),
      };
    }
    if (checkpoint) {
      const recoveryStatus = recoveryStatusForEntry(entry);
      if (recoveryStatus === "completed") {
        item.status = "detected";
        item.importedRun = true;
        item.exportRevision = item.editRevision;
        item.exportedAt = entry.exportedAt || null;
        item.message =
          `${item.boxes.length} saved mask${item.boxes.length === 1 ? "" : "s"} recovered`;
        item.exportStatus = "Recovered · already saved";
        completed += 1;
      } else if (recoveryStatus === "export-pending") {
        item.status = "detected";
        item.importedRun = true;
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
      item.importedRun = true;
      item.exportStatus = "Restored · awaiting export";
    }
    refreshItemAttention(item);
    restored += 1;
  }
  if (checkpoint) {
    batchPaused = pending > 0;
    pauseRequested = false;
    runState = batchPaused ? "paused" : "completed";
  }
  activeIndex = firstAttentionIndex();
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
  if (restored > 0) {
    setWorkflowStage("review", { focus: false });
    void preloadImportedReviewStates();
  }
  scheduleProjectCache();
}

async function preloadImportedReviewStates() {
  const candidates = carouselItems().filter(
    (item) => item.importedRun && item.status === "detected",
  );
  await Promise.allSettled(
    candidates.map(async (item) => {
      await Promise.all([ensureThumbnail(item), ensurePreview(item)]);
      await ensureRedactedPreview(item);
    }),
  );
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
    if (items.some((item) => item.status === "detected")) {
      setWorkflowStage("review", { focus: false });
    }
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
    outputFormatPreference: elements.outputFormatInput.value,
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
    detectionPass: mask.detectionPass || null,
    personId: mask.personId || null,
    lanyardGuided: Boolean(mask.lanyardGuided),
    redactionStrength: normalizeRedactionStrength(mask.redactionStrength),
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
    releasePreview(item, { includeRedacted: true });
    if (item.thumbnailUrl) URL.revokeObjectURL(item.thumbnailUrl);
    item.thumbnailUrl = null;
    item.thumbnailPromise = null;
  }
}

function releasePreview(item, { includeRedacted = false } = {}) {
  if (item.processing || item.previewPromise) return;
  if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  item.previewUrl = null;
  item.previewImage = null;
  if (includeRedacted) {
    if (item.redactedPreviewUrl) URL.revokeObjectURL(item.redactedPreviewUrl);
    item.redactedPreviewUrl = null;
    item.redactedPreviewBlob = null;
    item.redactedPreviewRevision = -1;
    item.redactedPreviewRequest = null;
  }
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
  const modelWorker = createModelWorker(workerNumber, {
    onStatus: ({ inferenceThreads }) => {
      setModelStatus(
        "loading",
        `Worker ${workerNumber} ready · ${inferenceThreads} inference thread${inferenceThreads === 1 ? "" : "s"} · UI isolated`,
      );
    },
  });
  await modelWorker.ready;
  return modelWorker;
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
  setWorkflowStage("review", { focus: false });
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
    activeIndex = firstAttentionIndex();
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
      renderItemStatus(item);
      showBatchWorkerProgress(completed, activeIndices.size, workerCount);
      await yieldToUi();

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
        showBatchWorkerProgress(completed, activeIndices.size, workerCount);
        renderItemStatus(item);
        await yieldToUi();
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
  activeIndex = firstAttentionIndex();
  showCompletion(
    "Batch processing complete",
    `${finishedItemCount()} of ${items.length} images finished · ` +
      `${attentionQueueItems().length} flagged issue${attentionQueueItems().length === 1 ? "" : "s"} · ` +
      `${unreviewedDetectedItems().length} await review confirmation.`,
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
    item.stageTimings = {};
    await timedItemStage(item, "previewDecodeMs", () => ensurePreview(item));
    const prompt = normalizeGroundingPrompt(elements.labelsInput.value);
    elements.labelsInput.value = prompt;
    const threshold = Number(elements.thresholdInput.value);
    await yieldToUi();
    const output = await timedItemStage(item, "globalDetectionMs", () =>
      models.detector(item.previewUrl, [prompt], {
        threshold,
        top_k: 40,
      }),
    );
    const scaleX = item.width / item.previewImage.naturalWidth;
    const scaleY = item.height / item.previewImage.naturalHeight;
    const candidates = output.map((result) =>
      normalizeDetection(result, item, scaleX, scaleY),
    );
    const unverifiedModelBoxes = filterBadgeDetections(candidates, item);
    const personGuidance = await timedItemStage(
      item,
      "personDetectionMs",
      () => detectPersonGuidance(item, models),
    );
    const torsoRegions = personGuidance.map((guide) => guide.torso);
    const globalVerification = await timedItemStage(
      item,
      "globalVerificationMs",
      () =>
        verifyGlobalCandidates(
          item,
          unverifiedModelBoxes,
          models,
          torsoRegions,
        ),
    );
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
      ? await timedItemStage(item, "torsoRescueMs", () =>
          detectTorsoRescues(
            item,
            prompt,
            modelBoxes,
            models,
            personGuidance,
          ),
        )
      : [];
    const detectedBoxes = mergeGlobalWithTorsoRescues(
      modelBoxes,
      torsoRescues,
    );
    item.boxes = await timedItemStage(item, "cornerFitMs", () =>
      autoFitDetectedMasks(item, detectedBoxes),
    );
    item.modelBoxes = item.boxes.map(cloneMask);
    item.personGuidance = personGuidance.map(clonePersonGuide);
    item.globalClassifierRejectedCount = globalVerification.rejected.length;
    item.globalClassifierRejected = globalVerification.rejected.map(cloneMask);
    item.status = "detected";
    item.reviewConfirmed = false;
    item.reviewedAt = null;
    item.manualAddedCount = 0;
    item.removedMaskCount = 0;
    item.cornerAdjustedCount = 0;
    refreshItemAttention(item);
    const fittedCount = item.boxes.filter((box) => box.autoFitted).length;
    const lanyardRescues = torsoRescues.filter(
      (box) => box.detectionPass === "lanyard-rescue",
    ).length;
    item.message =
      `${item.boxes.length} likely badge${item.boxes.length === 1 ? "" : "s"}` +
      (globalVerification.rejected.length
        ? ` · ${globalVerification.rejected.length} non-person/negative rejected`
        : "") +
      (lanyardRescues ? ` · ${lanyardRescues} lanyard rescue` : "") +
      (torsoRescues.length - lanyardRescues
        ? ` · ${torsoRescues.length - lanyardRescues} torso rescue`
        : "") +
      (fittedCount
        ? ` · ${fittedCount} corner-fit`
        : item.boxes.length
          ? " · rectangle fallback"
          : "");
  } catch (error) {
    console.error(error);
    item.status = "error";
    item.message = error.message;
    refreshItemAttention(item);
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

async function verifyGlobalCandidates(item, boxes, models, torsoRegions = []) {
  const retained = [];
  const rejected = [];
  for (const box of boxes) {
    if (!candidateInsideTorso(box, torsoRegions)) {
      rejected.push({
        ...box,
        classifierDecision: "rejected-outside-person",
      });
      continue;
    }
    if (box.score > GLOBAL_CLASSIFIER_MAX_SCORE) {
      retained.push({
        ...box,
        classifierDecision: "kept-high-confidence",
      });
      continue;
    }
    await yieldToUi();
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

async function detectPersonGuidance(item, models) {
  const scaleX = item.width / item.previewImage.naturalWidth;
  const scaleY = item.height / item.previewImage.naturalHeight;
  await yieldToUi();
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
  return persons.map((person, index) => {
    const areaRatio =
      (person.width * person.height) / Math.max(1, item.width * item.height);
    const prominent =
      areaRatio >= 0.025 &&
      person.width / item.width >= 0.06 &&
      person.height / item.height >= 0.28;
    return {
      id: `person-${index + 1}-${person.id}`,
      person,
      torso: torsoRegionForPerson(person, item.width, item.height),
      attentionEligible: prominent,
      badgeFoundBeforeRescue: false,
      lanyardDetected: false,
      lanyardCount: 0,
      rescueFound: false,
    };
  });
}

async function detectTorsoRescues(
  item,
  prompt,
  globalBoxes,
  models,
  personGuidance,
) {
  const candidates = [];
  const initialAssociation = associateBadgesToPeople(
    personGuidance,
    globalBoxes,
  );

  for (const guide of personGuidance) {
    const region = guide.torso;
    if (region.width < 48 || region.height < 64) continue;
    const existingBadgeIds =
      initialAssociation.badgeIdsByPerson[guide.id] || [];
    const existingBadges = globalBoxes.filter((box) =>
      existingBadgeIds.includes(box.id),
    );
    guide.badgeFoundBeforeRescue = existingBadges.length > 0;
    const torso = await localImageRequest("/api/image/crop", item.file, {
      region,
      width: 1200,
      height: 1200,
      fit: "inside",
    });
    const torsoUrl = URL.createObjectURL(torso.blob);
    try {
      const cropImage = {
        width: torso.info.width,
        height: torso.info.height,
      };
      let lanyards = [];
      // An already-matched torso only needs a quick complementary badge
      // search. Skip the lanyard pass so finding a second credential does
      // not materially slow the common case.
      if (existingBadges.length === 0) {
        try {
          await yieldToUi();
          const lanyardOutput = await models.detector(
            torsoUrl,
            [LANYARD_PROMPT],
            {
              threshold: LANYARD_THRESHOLD,
              top_k: 12,
            },
          );
          lanyards = deduplicateBadgeDetections(
            lanyardOutput
              .map((result) => normalizeDetection(result, cropImage))
              .filter((box) => isPlausibleLanyard(box, cropImage)),
            0.38,
          ).slice(0, 3);
        } catch (error) {
          console.warn("Lanyard guidance was unavailable for one person.", error);
        }
      }
      guide.lanyardCount = lanyards.length;
      guide.lanyardDetected = lanyards.length > 0;
      guide.attentionEligible =
        guide.attentionEligible || guide.lanyardDetected;
      const lanyardSearchRegions = lanyards.map((lanyard) =>
        lanyardBadgeSearchRegion(
          lanyard,
          cropImage.width,
          cropImage.height,
        ),
      );
      await yieldToUi();
      const rescuePrompt = complementaryBadgePrompt(existingBadges, prompt);
      const output = await models.detector(torsoUrl, [rescuePrompt], {
        threshold: lanyards.length
          ? LANYARD_BADGE_THRESHOLD
          : TORSO_THRESHOLD,
        top_k: 30,
      });
      const best = filterBadgeDetections(
        output.map((result) => normalizeDetection(result, cropImage)),
        cropImage,
      )
        .filter((box) => isPlausibleTorsoBadge(box, cropImage))
        .filter((box) =>
          isComplementaryBadgeOrientation(box, existingBadges),
        )
        .filter(
          (box) =>
            lanyardSearchRegions.length === 0 ||
            lanyardSearchRegions.some((searchRegion) =>
              candidateCenterInsideRegion(box, searchRegion),
            ),
        )
        .sort((a, b) => b.score - a.score)
        .slice(0, existingBadges.length > 0 ? 4 : 1);
      let acceptedForPerson = 0;
      for (const box of best) {
        const mapped = {
          ...box,
          id: crypto.randomUUID(),
          x: region.left + (box.x / cropImage.width) * region.width,
          y: region.top + (box.y / cropImage.height) * region.height,
          width: (box.width / cropImage.width) * region.width,
          height: (box.height / cropImage.height) * region.height,
          source: lanyards.length ? "lanyard-rescue" : "torso-rescue",
          detectionPass: lanyards.length
            ? "lanyard-rescue"
            : "torso-rescue",
          personId: guide.id,
          lanyardGuided: lanyards.length > 0,
        };
        if (
          globalBoxes.some((global) => boxesOverlap(mapped, global, 0.24, 0.5))
        ) {
          continue;
        }
        if (await classifyTorsoRescue(item, mapped, models)) {
          guide.rescueFound = true;
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
          acceptedForPerson += 1;
          if (acceptedForPerson >= 1) break;
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
    await yieldToUi();
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
    aspect >= 0.3 &&
    aspect <= 2.2 &&
    areaRatio >= 0.00025 &&
    areaRatio <= 0.035 &&
    centerX >= 0.1 &&
    centerX <= 0.9 &&
    centerY >= 0.16 &&
    centerY <= 0.86
  );
}

function isPlausibleLanyard(box, crop) {
  const aspect = box.width / Math.max(1, box.height);
  const areaRatio = (box.width * box.height) / (crop.width * crop.height);
  const centerX = (box.x + box.width / 2) / crop.width;
  const centerY = (box.y + box.height / 2) / crop.height;
  return (
    aspect >= 0.12 &&
    aspect <= 1.9 &&
    areaRatio >= 0.002 &&
    areaRatio <= 0.48 &&
    centerX >= 0.08 &&
    centerX <= 0.92 &&
    centerY >= 0.05 &&
    centerY <= 0.78
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
  const thumbnail = button.querySelector(".filmstrip-thumb");
  const redactedReady =
    item.redactedPreviewUrl &&
    item.redactedPreviewRevision === item.editRevision;
  const preview =
    item.viewMode === "after" && redactedReady
      ? item.redactedPreviewUrl
      : item.thumbnailUrl;
  if (preview && thumbnail) {
    thumbnail.src = preview;
    thumbnail.hidden = false;
    button.querySelector(".filmstrip-placeholder").hidden = true;
  }
}

function filmstripStateForItem(item) {
  if (item.processing || item.status === "running") {
    return { key: "processing", label: "Processing" };
  }
  if (item.decodeError || item.status === "error" || item.exportError) {
    return { key: "error", label: "Processing issue" };
  }
  if (item.status === "detected" && item.reviewConfirmed) {
    return { key: "reviewed", label: "✓ Reviewed" };
  }
  if (item.status === "detected" && item.attention?.reasons?.length) {
    return {
      key: "attention",
      label: "Attention needed",
    };
  }
  if (checkpointStatusForItem(item) === "completed") {
    return { key: "done", label: "✓ Saved · review pending" };
  }
  if (item.status === "detected") {
    if (item.importedRun) {
      const afterReady =
        item.redactedPreviewUrl &&
        item.redactedPreviewRevision === item.editRevision;
      return afterReady
        ? { key: "ready", label: "Before + After ready" }
        : { key: "ready", label: "Preparing review" };
    }
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
  const nextIndex = clamp(activeIndex + direction, 0, items.length - 1);
  if (nextIndex === activeIndex) return;
  activeIndex = nextIndex;
  updateButtons();
  await renderCarousel();
  scheduleProjectCache();
}

function attentionQueueItems() {
  return items.filter(
    (item) =>
      !item.reviewConfirmed &&
      Array.isArray(item.attention?.reasons) &&
      item.attention.reasons.length > 0,
  );
}

function unreviewedDetectedItems() {
  return items.filter(
    (item) => item.status === "detected" && !item.reviewConfirmed,
  );
}

async function goToNextAttentionItem() {
  const queue = attentionQueueItems();
  if (queue.length === 0) return;
  const indices = queue.map((item) => items.indexOf(item));
  const nextIndex =
    indices.find((index) => index > activeIndex) ?? indices[0];
  if (nextIndex === activeIndex) {
    await renderCarousel();
    return;
  }
  await centerCarouselAt(nextIndex);
}

async function toggleActiveItemReviewed() {
  const item = items[activeIndex];
  if (
    !item ||
    item.status !== "detected" ||
    item.processing ||
    item.reviewActionInFlight
  ) {
    return;
  }

  if (item.reviewConfirmed) {
    item.reviewConfirmed = false;
    item.reviewedAt = null;
    item.exportStatus = "Review reopened · changes remain saved";
    renderItemStatus(item);
    updateSummary();
    updateReviewAssistance();
    scheduleProjectCache();
    if (activeRun) void queueCheckpointWrite(runState);
    return;
  }

  const reviewedIndex = activeIndex;
  item.reviewConfirmed = true;
  item.reviewedAt = new Date().toISOString();
  item.reviewActionInFlight = true;
  item.exportStatus =
    item.exportRevision === item.editRevision && !item.exportError
      ? "Saving review confirmation…"
      : "Review confirmed · save queued…";
  renderItemStatus(item);
  updateSummary();
  updateReviewAssistance();
  scheduleProjectCache();
  void persistReviewedItem(item);

  const nextIndex = nextReviewIndex(reviewedIndex);
  if (nextIndex !== reviewedIndex) {
    await centerCarouselAt(nextIndex);
    setCurrentImageReviewMessage("Previous image reviewed · save is in progress.");
  }
  if (unreviewedDetectedItems().length === 0) {
    showCompletion(
      "Review complete",
      `${items.filter((candidate) => candidate.status === "detected").length} processed images are confirmed. Latest saves are finishing automatically.`,
    );
  }
}

function nextReviewIndex(currentIndex) {
  const laterReady = items.findIndex(
    (candidate, index) =>
      index > currentIndex &&
      candidate.status === "detected" &&
      !candidate.reviewConfirmed,
  );
  if (laterReady >= 0) return laterReady;
  const earlierReady = items.findIndex(
    (candidate, index) =>
      index < currentIndex &&
      candidate.status === "detected" &&
      !candidate.reviewConfirmed,
  );
  if (earlierReady >= 0) return earlierReady;
  return currentIndex < items.length - 1 ? currentIndex + 1 : currentIndex;
}

async function persistReviewedItem(item) {
  clearTimeout(itemExportTimers.get(item.id));
  itemExportTimers.delete(item.id);
  try {
    if (!activeRun) await ensureExportRun({ allowPrompt: false });
    if (item.exportQueueCount > 0 || item.exportInFlight) {
      await exportQueue.catch(() => undefined);
    }
    if (
      activeRun &&
      item.exportRevision === item.editRevision &&
      !item.exportError
    ) {
      await queueCheckpointWrite(runState);
    } else {
      await queueItemExport(item, { manual: true, updatePreview: true });
    }
    if (activeRun && item.exportRevision !== item.editRevision) {
      throw new Error(item.exportError || "The latest image revision was not saved.");
    }
    item.exportStatus = activeRun
      ? `Reviewed and saved · ${activeRun.runFolderName}`
      : "Reviewed locally · choose an export destination to save the image";
  } catch (error) {
    console.error(error);
    item.reviewConfirmed = false;
    item.reviewedAt = null;
    item.exportError = error.message;
    item.exportStatus = `Review not completed: ${error.message}`;
    refreshItemAttention(item);
  } finally {
    item.reviewActionInFlight = false;
    renderItemStatus(item);
    updateSummary();
    updateReviewAssistance();
    scheduleProjectCache();
  }
}

function updateCarouselControls() {
  elements.pagination.hidden = items.length <= 1;
  elements.pageStatus.textContent =
    items.length === 0
      ? "No images"
      : `Image ${activeIndex + 1} of ${items.length} · use ← → or the filmstrip`;
  elements.previousPageButton.disabled = activeIndex === 0;
  elements.nextPageButton.disabled = activeIndex >= items.length - 1;
  elements.summaryText.textContent = reviewProgressSummary(items, activeIndex);
}

async function centerCarouselAt(index) {
  if (index === activeIndex) return;
  activeIndex = index;
  updateButtons();
  await renderCarousel();
  if (items[activeIndex]?.importedRun) {
    void ensureRedactedPreview(items[activeIndex]).catch((error) => {
      console.warn("Imported After preview was unavailable.", error);
    });
  }
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
      <div class="viewer-toolbar">
        <div class="viewer-control-set">
          <span class="viewer-control-label" aria-hidden="true">Preview</span>
          <div class="comparison-toggle" role="group" aria-label="Before and after view">
            <button class="before-view" type="button">Before · edit masks</button>
            <button class="after-view" type="button">After · redacted</button>
          </div>
        </div>
        <div class="viewer-control-set viewer-control-set-size">
          <span class="viewer-control-label" aria-hidden="true">View</span>
          <div class="view-scale-toggle" role="group" aria-label="Image sizing">
            <button class="fit-view" type="button" title="Show the entire image">Fit in window</button>
            <button class="fill-view" type="button" title="Use the full viewer width">Fill width</button>
            <button class="zoom-out" type="button" aria-label="Zoom out" title="Zoom out">−</button>
            <button class="zoom-level" type="button" title="Reset zoom to fit">Fit</button>
            <button class="zoom-in" type="button" aria-label="Zoom in" title="Zoom in">+</button>
          </div>
        </div>
        <div class="current-image-review">
          <span class="current-image-review-state">Waiting for this image</span>
          <button class="button small secondary review-image" type="button" disabled>
            Mark this image reviewed
          </button>
        </div>
      </div>
      <div class="viewer-frame">
        <div
          class="canvas-wrap"
          tabindex="0"
          aria-label="Photo view. Use Control or Command plus scroll to zoom, and hold Space to pan."
        >
          <div class="viewer-content">
            <canvas aria-label="Image with editable badge detections"></canvas>
            <img class="after-preview" alt="Redacted export preview" hidden />
            <p class="after-pending" hidden>Preparing redacted preview…</p>
          </div>
        </div>
        <div class="scroll-affordance" aria-hidden="true">
          Scroll to inspect the full photo <span>↓</span>
        </div>
      </div>
      <p class="attention-note" hidden></p>
      <p class="export-status" role="status" aria-live="polite"></p>
      <div class="card-actions">
        <div class="mask-inspector" aria-live="polite">
          <div class="mask-inspector-selection">
            <button
              class="mask-nav previous-mask"
              type="button"
              aria-label="Select previous badge"
              title="Select previous badge"
              disabled
            >←</button>
            <div>
              <strong class="selected-mask-title">No badge selected</strong>
              <span class="selected-mask-meta">Click a box to edit it</span>
            </div>
            <button
              class="mask-nav next-mask"
              type="button"
              aria-label="Select next badge"
              title="Select next badge"
              disabled
            >→</button>
          </div>
          <label class="selected-mask-strength">
            <span class="mask-strength-label">Blur</span>
            <input
              class="mask-strength-input"
              type="range"
              min="${MIN_REDACTION_STRENGTH}"
              max="${MAX_REDACTION_STRENGTH}"
              value="${resolveRedactionStrength(null, elements.strengthInput.value)}"
              step="1"
              aria-label="Selected badge blur strength"
              disabled
            />
            <output class="mask-strength-output">—</output>
          </label>
          <button class="button small secondary reset-mask-blur" disabled>
            Reset blur
          </button>
          <button class="button small secondary remove-box" disabled>
            Remove
          </button>
        </div>
        <div class="photo-actions" aria-label="Photo actions">
          <button class="button small secondary detect-one">Re-detect image</button>
          <button
            class="button small secondary export-one"
            title="Save without marking this image reviewed or moving to the next image"
          >Save only</button>
        </div>
      </div>
    `;
  slot.append(card);

  if (isActive) {
    const canvas = card.querySelector("canvas");
    const viewer = card.querySelector(".canvas-wrap");
    canvas.tabIndex = 0;
    setupCanvasInteraction(canvas, item);
    setupViewerNavigation(viewer, item);
    card.querySelector(".detect-one").addEventListener("click", async () => {
      if (running || item.processing) return;
      if (!modelWorkers.length) await loadModel();
      if (!modelWorkers.length) return;
      const startedAt = performance.now();
      item.workerNumber = 1;
      item.processing = true;
      renderItemStatus(item);
      try {
        await detectItem(item, modelWorkers[0]);
        item.timing = {
          detectionMs: performance.now() - startedAt,
          exportMs: 0,
          totalMs: performance.now() - startedAt,
        };
        await queueItemExport(item, { updatePreview: true });
      } finally {
        item.processing = false;
        renderItemStatus(item);
      }
    });
    card.querySelector(".remove-box").addEventListener("click", () => {
      if (item.processing) return;
      removeSelectedBox(item);
    });
    card.querySelector(".previous-mask").addEventListener("click", () => {
      selectAdjacentBadge(item, -1);
    });
    card.querySelector(".next-mask").addEventListener("click", () => {
      selectAdjacentBadge(item, 1);
    });
    card.querySelector(".reset-mask-blur").addEventListener("click", () => {
      if (item.processing) return;
      const selected = item.boxes.find(
        (box) => box.id === item.selectedBoxId,
      );
      if (!selected || selected.redactionStrength == null) return;
      delete selected.redactionStrength;
      markItemEdited(item);
    });
    card.querySelector(".export-one").addEventListener("click", () => {
      if (item.processing || item.status !== "detected") return;
      queueItemExport(item, { updatePreview: true, manual: true });
    });
    card.querySelector(".before-view").addEventListener("click", () => {
      void setItemView(item, "before");
    });
    card.querySelector(".after-view").addEventListener("click", () => {
      void setItemView(item, "after");
    });
    card.querySelector(".fit-view").addEventListener("click", () => {
      setViewScaleMode(item, "fit");
    });
    card.querySelector(".fill-view").addEventListener("click", () => {
      setViewScaleMode(item, "fill");
    });
    card.querySelector(".zoom-out").addEventListener("click", () => {
      stepItemZoom(item, -1);
    });
    card.querySelector(".zoom-in").addEventListener("click", () => {
      stepItemZoom(item, 1);
    });
    card.querySelector(".zoom-level").addEventListener("click", () => {
      setViewScaleMode(item, "fit");
    });
    card.querySelector(".review-image").addEventListener("click", () => {
      void toggleActiveItemReviewed();
    });
    card.querySelector(".canvas-wrap").addEventListener("scroll", () => {
      updateViewerScrollAffordance(card);
    });
    card
      .querySelector(".mask-strength-input")
      .addEventListener("input", (event) => {
        const selected = item.boxes.find(
          (box) => box.id === item.selectedBoxId,
        );
        if (!selected) return;
        const strength = resolveRedactionStrength(
          event.currentTarget.value,
          elements.strengthInput.value,
        );
        if (selected.redactionStrength === strength) return;
        selected.redactionStrength = strength;
        markItemEdited(item);
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
  updateViewScaleControls(card, item);
  const actionLocked = Boolean(item.decodeError) || running || item.processing;
  card.querySelector(".detect-one").disabled = actionLocked;
  card.querySelector(".export-one").disabled =
    Boolean(item.decodeError) || item.processing || item.status !== "detected";
  renderItemStatus(item);
  drawItem(item);
  updateItemView(item);
  requestAnimationFrame(() => updateViewerLayout(card, item));
}

function renderItemStatus(item) {
  updateFilmstripItem(item);
  const card = document.querySelector(`[data-item-id="${item.id}"]`);
  if (!card) return;
  const status = card.querySelector(".item-status");
  status.textContent = item.message;
  status.dataset.state =
    item.status === "detected" &&
    !item.reviewConfirmed &&
    item.attention?.reasons?.length
      ? "attention"
      : item.reviewConfirmed
        ? "reviewed"
        : item.status;
  card.classList.toggle("is-reviewed", item.reviewConfirmed);
  const attentionNote = card.querySelector(".attention-note");
  if (attentionNote) {
    const reasons = item.attention?.reasons || [];
    attentionNote.hidden = reasons.length === 0 || item.reviewConfirmed;
    attentionNote.textContent = `Check this image · ${reasons.join(" · ")}`;
  }
  const reviewLocked = item.processing || item.status === "running";
  card.querySelector(".detect-one").disabled =
    Boolean(item.decodeError) || running || reviewLocked;
  card.querySelector(".remove-box").disabled =
    !item.selectedBoxId || reviewLocked;
  card.querySelector(".reset-mask-blur").disabled =
    !item.selectedBoxId || reviewLocked;
  for (const button of card.querySelectorAll(".mask-nav")) {
    button.disabled = item.boxes.length === 0 || reviewLocked;
  }
  const saveButton = card.querySelector(".export-one");
  saveButton.disabled =
    Boolean(item.decodeError) || reviewLocked || item.status !== "detected";
  saveButton.textContent = item.exportInFlight
    ? "Saving…"
    : item.exportQueueCount > 0
      ? "Save queued"
      : item.exportRevision >= 0
        ? "Re-export this image"
        : "Export this image";
  card.querySelector("canvas").classList.toggle("is-read-only", reviewLocked);
  updateSelectedMaskStrengthControl(item, card, reviewLocked);
  updateCurrentImageReviewState(card, item);
  const timing = card.querySelector(".item-timing");
  if (timing) {
    timing.textContent = item.timing
      ? `${item.workerNumber ? `Worker ${item.workerNumber} · ` : ""}Detection ${formatDuration(item.timing.detectionMs)} · export ${formatDuration(item.timing.exportMs)}`
      : "Timing available after processing";
  }
  const exportStatus = card.querySelector(".export-status");
  if (exportStatus) exportStatus.textContent = item.exportStatus;
  updateReviewAssistance();
}

function updateCurrentImageReviewState(card, item, overrideMessage = null) {
  const state = card.querySelector(".current-image-review-state");
  const button = card.querySelector(".review-image");
  if (!state || !button) return;
  button.disabled =
    item.status !== "detected" ||
    item.processing ||
    item.status === "running" ||
    item.reviewActionInFlight;
  button.textContent = item.reviewConfirmed
    ? "Reviewed ✓"
    : nextReviewIndex(items.indexOf(item)) !== items.indexOf(item)
      ? "Save, review & next →"
      : "Save & mark reviewed";
  button.setAttribute("aria-pressed", String(item.reviewConfirmed));
  if (overrideMessage) {
    state.textContent = overrideMessage;
  } else if (item.reviewConfirmed) {
    state.textContent = item.reviewActionInFlight
      ? "Centered image · saving review…"
      : "Centered image · review complete";
  } else if (item.attention?.reasons?.length) {
    state.textContent = `Centered image · check ${item.attention.reasons.join(" · ")}`;
  } else if (item.status === "detected") {
    state.textContent = "Centered image · visually inspect, then mark reviewed";
  } else {
    state.textContent = `Centered image · ${item.message}`;
  }
}

function setCurrentImageReviewMessage(message) {
  const item = items[activeIndex];
  const card = item
    ? document.querySelector(`[data-item-id="${item.id}"]`)
    : null;
  if (card && item) updateCurrentImageReviewState(card, item, message);
}

function updateSelectedMaskStrengthControl(
  item,
  card = document.querySelector(`[data-item-id="${item.id}"]`),
  reviewLocked = item.processing || item.status === "running",
) {
  if (!card) return;
  const input = card.querySelector(".mask-strength-input");
  const output = card.querySelector(".mask-strength-output");
  const label = card.querySelector(".mask-strength-label");
  const title = card.querySelector(".selected-mask-title");
  const meta = card.querySelector(".selected-mask-meta");
  const resetButton = card.querySelector(".reset-mask-blur");
  if (!input || !output || !label || !title || !meta || !resetButton) return;
  const selected = item.boxes.find((box) => box.id === item.selectedBoxId);
  input.disabled = !selected || reviewLocked;
  if (!selected) {
    input.value = String(
      resolveRedactionStrength(null, elements.strengthInput.value),
    );
    output.value = "—";
    output.textContent = "—";
    label.textContent = "Blur";
    title.textContent = "No badge selected";
    meta.textContent =
      item.boxes.length > 0
        ? "Click a box to edit it"
        : "Drag across a missed badge to add one";
    resetButton.disabled = true;
    return;
  }
  const position = selectedBadgePosition(item.boxes, item.selectedBoxId);
  const strength = resolveRedactionStrength(
    selected.redactionStrength,
    elements.strengthInput.value,
  );
  input.value = String(strength);
  output.value = String(strength);
  output.textContent = String(strength);
  label.textContent = "Blur";
  title.textContent = `Badge ${position.number} of ${position.total}`;
  meta.textContent =
    selected.redactionStrength == null
      ? `Using batch blur ${strength}`
      : "Custom blur";
  resetButton.disabled = reviewLocked || selected.redactionStrength == null;
}

function selectAdjacentBadge(item, direction) {
  if (item.processing || item.boxes.length === 0) return;
  const nextId = adjacentBadgeId(item.boxes, item.selectedBoxId, direction);
  if (!nextId) return;
  item.selectedBoxId = nextId;
  if (item.viewMode !== "before") item.viewMode = "before";
  drawItem(item);
  updateItemView(item);
  renderItemStatus(item);
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
  requestAnimationFrame(() => updateViewerLayout(card, item));
}

async function setItemView(item, viewMode) {
  item.viewMode = viewMode;
  updateItemView(item);
  updateFilmstripItem(item);
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
  await ensurePreview(item);
  if (
    item.redactedPreviewUrl &&
    item.redactedPreviewRevision === item.editRevision
  ) {
    updateItemView(item);
    return;
  }
  const request = captureRedactionRequest(item);
  if (item.redactedPreviewRequest?.revision === request.revision) {
    await item.redactedPreviewRequest.promise;
    return;
  }

  const promise = (async () => {
    const blob = await createRedactedBlob(item, request);
    return setRedactedPreview(item, blob, request.revision);
  })();
  item.redactedPreviewRequest = {
    revision: request.revision,
    promise,
  };

  let applied = false;
  try {
    applied = await promise;
  } finally {
    if (item.redactedPreviewRequest?.promise === promise) {
      item.redactedPreviewRequest = null;
    }
  }

  // An edit may have landed while the local service was producing this image.
  // If the user is still looking at After, immediately request the current
  // revision instead of allowing the stale result to become visible.
  if (!applied && item.viewMode === "after") {
    await ensureRedactedPreview(item);
  }
}

function setRedactedPreview(item, blob, revision = item.editRevision) {
  return applyForCurrentEditRevision(item, revision, () => {
    if (
      item.redactedPreviewBlob === blob &&
      item.redactedPreviewRevision === revision &&
      item.redactedPreviewUrl
    ) {
      return;
    }
    if (item.redactedPreviewUrl) URL.revokeObjectURL(item.redactedPreviewUrl);
    item.redactedPreviewBlob = blob;
    item.redactedPreviewUrl = URL.createObjectURL(blob);
    item.redactedPreviewRevision = revision;
    updateItemView(item);
    updateFilmstripItem(item);
  });
}

function markItemEdited(item) {
  item.editRevision += 1;
  item.reviewConfirmed = false;
  item.reviewedAt = null;
  refreshItemAttention(item);
  if (item.redactedPreviewUrl) URL.revokeObjectURL(item.redactedPreviewUrl);
  item.redactedPreviewUrl = null;
  item.redactedPreviewBlob = null;
  item.redactedPreviewRevision = -1;
  item.exportStatus = activeRun
    ? "Edit pending auto-save…"
    : "Edit preview ready; choose an export destination to auto-save";
  updateItemView(item);
  renderItemStatus(item);
  updateButtons();
  if (item.viewMode === "after") {
    void ensureRedactedPreview(item).catch((error) => {
      console.error(error);
      item.exportStatus = `Preview failed: ${error.message}`;
      renderItemStatus(item);
    });
  }
  scheduleItemExport(item);
}

function setupViewerNavigation(viewer, item) {
  let pan = null;

  viewer.addEventListener(
    "pointerdown",
    (event) => {
      if (!spacePanning && event.button !== 1) return;
      event.preventDefault();
      event.stopPropagation();
      pan = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        scrollLeft: viewer.scrollLeft,
        pageScrollY: window.scrollY,
      };
      viewer.classList.add("is-panning");
      viewer.setPointerCapture(event.pointerId);
    },
    { capture: true },
  );

  viewer.addEventListener(
    "pointermove",
    (event) => {
      if (!pan || pan.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      viewer.scrollLeft = pan.scrollLeft - (event.clientX - pan.clientX);
      window.scrollTo({
        top: pan.pageScrollY - (event.clientY - pan.clientY),
        behavior: "auto",
      });
      updateViewerScrollAffordance(viewer.closest(".image-card"));
    },
    { capture: true },
  );

  const endPan = (event) => {
    if (!pan || pan.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    pan = null;
    viewer.classList.remove("is-panning");
    if (viewer.hasPointerCapture(event.pointerId)) {
      viewer.releasePointerCapture(event.pointerId);
    }
  };
  viewer.addEventListener("pointerup", endPan, { capture: true });
  viewer.addEventListener("pointercancel", endPan, { capture: true });

  viewer.addEventListener(
    "wheel",
    (event) => {
      if (!(event.ctrlKey || event.metaKey || event.altKey)) return;
      event.preventDefault();
      const current = item.viewScaleMode === "zoom" ? item.viewZoom : 1;
      setItemZoom(item, continuousViewZoom(current, event.deltaY), event);
    },
    { passive: false },
  );

  viewer.addEventListener("dblclick", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    stepItemZoom(item, event.altKey ? -1 : 1, event);
  });
}

function setupCanvasInteraction(canvas, item) {
  let dragStart = null;
  let previewBox = null;
  let cornerDrag = null;

  canvas.addEventListener("pointerdown", (event) => {
    if (item.processing) return;
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
      cornerDrag = { box: selected, cornerIndex, changed: false };
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
      if (spacePanning) {
        canvas.style.cursor = "grab";
        return;
      }
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
        cornerDrag.changed = true;
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
      const changed = cornerDrag.changed;
      cornerDrag = null;
      canvas.releasePointerCapture(event.pointerId);
      if (changed) {
        item.cornerAdjustedCount += 1;
        markItemEdited(item);
        updateSummary();
      }
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
      item.manualAddedCount += 1;
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
    if (!cornerDrag && !dragStart && !spacePanning) {
      canvas.style.cursor = "crosshair";
    }
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
  for (const [index, box] of scaledBoxes.entries()) {
    drawBox(
      context,
      box,
      box.id === item.selectedBoxId,
      index,
      scaledBoxes.length,
    );
  }
  const selectedBox = scaledBoxes.find((box) => box.id === item.selectedBoxId);
  if (selectedBox) drawDeleteControl(context, selectedBox);
  if (previewBox) {
    drawBox(
      context,
      scaleBox(
        { ...previewBox, label: "new mask", score: 1, source: "manual" },
        scaleX,
        scaleY,
      ),
      true,
      scaledBoxes.length,
      scaledBoxes.length + 1,
    );
  }
  requestAnimationFrame(() => updateViewerLayout(card, item));
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

function drawBox(context, box, selected, index = 0, total = 1) {
  const scale = Math.max(context.canvas.width, context.canvas.height) / 1200;
  const lineWidth = Math.max(3, 4 * scale);
  const color = selected
    ? "#70b94b"
    : box.source === "manual"
      ? "#00b38f"
      : "#fe5000";
  context.save();
  context.fillStyle = `${color}24`;
  tracePolygon(context, maskPoints(box));
  context.fill();
  if (selected) {
    context.strokeStyle = "#ffffff";
    context.lineWidth = lineWidth + Math.max(4, 4 * scale);
    context.stroke();
    tracePolygon(context, maskPoints(box));
  }
  context.strokeStyle = color;
  context.lineWidth = selected ? lineWidth + Math.max(2, 2 * scale) : lineWidth;
  context.stroke();

  const score = box.source === "manual" ? "manual" : `${Math.round(box.score * 100)}%`;
  const fitLabel = box.autoFitted
    ? box.userAdjusted
      ? " · corner-fit adjusted"
      : " · corner-fit"
    : "";
  const badgeNumber = Math.min(index + 1, total);
  const label = selected
    ? `Badge ${badgeNumber} selected · ${score}${fitLabel}`
    : `Badge ${badgeNumber} · ${box.label} · ${score}${fitLabel}`;
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

function clonePersonGuide(guide) {
  return {
    ...guide,
    person: guide.person ? { ...guide.person } : null,
    torso: guide.torso ? { ...guide.torso } : null,
  };
}

function refreshItemAttention(item) {
  item.attention = assessReviewAttention({
    status: item.status,
    width: item.width,
    height: item.height,
    boxes: item.boxes,
    personGuides: item.personGuidance,
  });
  return item.attention;
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
  item.removedMaskCount += 1;
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
    const sourceItem = items.find(
      (item) => item.file && !item.file.desktopSourceToken,
    );
    await window.badgeBlurDesktop.openExportFolder({
      checkpointFile,
      sourceFile: sourceItem?.file || null,
      sourceRelativePath: sourceItem ? sourceRelativePath(sourceItem) : "",
      runFolderName: activeRun.runFolderName,
    });
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
  clearTimeout(itemExportTimers.get(item.id));
  itemExportTimers.delete(item.id);
  if (item.exportQueueCount > 0) {
    item.exportStatus = options.manual
      ? "Your latest changes are already queued…"
      : "Autosave already queued…";
    renderItemStatus(item);
    return exportQueue;
  }
  if (
    item.exportInFlight &&
    item.activeExportRevision === item.editRevision
  ) {
    item.exportStatus = options.manual
      ? "Your latest changes are already saving…"
      : "Autosaving latest changes…";
    renderItemStatus(item);
    return exportQueue;
  }
  item.exportQueueCount = (item.exportQueueCount || 0) + 1;
  item.exportStatus = options.manual
    ? "Manual save queued…"
    : "Autosave queued…";
  renderItemStatus(item);
  exportQueue = exportQueue
    .catch(() => undefined)
    .then(async () => {
      item.exportQueueCount = Math.max(0, item.exportQueueCount - 1);
      item.exportInFlight = true;
      item.activeExportRevision = item.editRevision;
      item.exportStatus = options.manual
        ? "Saving your changes…"
        : "Autosaving latest changes…";
      renderItemStatus(item);
      try {
        return await exportItemToRun(item, options);
      } finally {
        item.exportInFlight = false;
        item.activeExportRevision = -1;
        renderItemStatus(item);
      }
    });
  return exportQueue;
}

function queueCheckpointWrite(state = runState) {
  exportQueue = exportQueue
    .catch(() => undefined)
    .then(() => writeRunMetadata(state));
  return exportQueue;
}

async function exportItemToRun(
  item,
  { updatePreview = false, manual = false } = {},
) {
  if (item.decodeError) return;
  const startedAt = performance.now();
  let request = null;
  let needsResave = false;
  item.exportStatus = activeRun
    ? manual
      ? "Saving your changes…"
      : "Autosaving latest changes…"
    : "Preparing after preview…";
  renderItemStatus(item);
  try {
    // Keep the local service and source File readable under load by avoiding
    // two simultaneous full-file uploads for the same image.
    await ensurePreview(item);
    request = captureRedactionRequest(item);
    item.activeExportRevision = request.revision;
    if (item.redactedPreviewRequest?.revision === request.revision) {
      try {
        await item.redactedPreviewRequest.promise;
      } catch {
        // Fall through to a fresh render so a transient preview failure does
        // not prevent the image from being saved.
      }
    }
    const reusablePreview = reusableRedactedPreview(item, request.revision);
    const blob =
      reusablePreview ||
      (await timedItemStage(item, "redactionMs", () =>
        createRedactedBlob(item, request),
      ));
    setRedactedPreview(item, blob, request.revision);
    await yieldToUi();
    if (activeRun) {
      const sidecar = await timedItemStage(item, "metadataMs", () =>
        createMetadataSidecar(item),
      );
      const name = outputRelativePath(item);
      const sidecarName = `${name}.metadata.mie`;
      await timedItemStage(item, "fileWriteMs", async () => {
        await writeRelativeFile(activeRun.directory, name, blob);
        if (item.metadataSidecarRunId !== activeRun.runId) {
          await writeRelativeFile(activeRun.directory, sidecarName, sidecar);
          item.metadataSidecarRunId = activeRun.runId;
        }
      });
      if (isCurrentEditRevision(item, request.revision)) {
        item.exportRevision = request.revision;
        item.exportedAt = new Date().toISOString();
        item.exportError = null;
        item.exportStatus = `Saved automatically · ${activeRun.runFolderName}`;
        await timedItemStage(item, "checkpointWriteMs", () =>
          writeRunMetadata(runState),
        );
      } else {
        needsResave = true;
        item.exportStatus = "Newer edit pending auto-save…";
      }
    } else if (isCurrentEditRevision(item, request.revision)) {
      item.exportStatus =
        "After preview ready · choose an export destination to auto-save";
    } else {
      needsResave = true;
      item.exportStatus = "Newer edit pending preview refresh…";
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
    if (needsResave && item.status === "detected") {
      scheduleItemExport(item);
    }
    updateButtons();
  }
}

function scheduleItemExport(item) {
  if (item.status !== "detected" || item.processing) return;
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
    item.redactedPreviewBlob = null;
    item.redactedPreviewRevision = -1;
    item.exportStatus = activeRun
      ? "Settings changed · auto-save pending…"
      : "Settings changed · after preview needs refresh";
    renderItemStatus(item);
    updateItemView(item);
    if (item.viewMode === "after" && isItemVisible(item)) {
      void ensureRedactedPreview(item).catch((error) => {
        console.error(error);
        item.exportStatus = `Preview failed: ${error.message}`;
        renderItemStatus(item);
      });
    }
  }
  scheduleProjectCache();
  updateButtons();
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
  const unreviewed = unreviewedDetectedItems();
  if (unreviewed.length > 0) {
    activeIndex = items.indexOf(unreviewed[0]);
    await renderCarousel();
    showProgress(
      `Review confirmation required · ${unreviewed.length} processed image${unreviewed.length === 1 ? "" : "s"} still need visual review. Press R to confirm each image.`,
      100,
    );
    updateButtons();
    return;
  }
  const run = await ensureExportRun({ allowPrompt: true });
  if (!run) {
    showProgress(
      "Choose an export folder in Chrome or Edge to enable automatic batch saves.",
      0,
    );
    return;
  }
  await reexportItems(
    items.filter((item) => item.status === "detected"),
    {
      progressVerb: "Re-exporting",
      completionTitle: "Export complete",
    },
  );
}

function changedSinceLastExportItems() {
  return items.filter(hasUnexportedChanges);
}

async function exportChanged() {
  if (running || !activeRun) return;
  const targets = changedSinceLastExportItems();
  if (targets.length === 0) {
    showProgress("Everything is already up to date.", 100);
    updateButtons();
    return;
  }
  await reexportItems(targets, {
    progressVerb: "Re-exporting changed image",
    completionTitle: "Changed images exported",
  });
}

async function reexportItems(
  targets,
  { progressVerb = "Re-exporting", completionTitle = "Export complete" } = {},
) {
  if (!activeRun || targets.length === 0) return;
  running = true;
  batchOperation = "reexport";
  runState = "running";
  hideCompletion();
  exportStartedAt = performance.now();
  startExportTimer();
  updateButtons();
  for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
    const item = targets[targetIndex];
    activeIndex = items.indexOf(item);
    await renderCarousel();
    showProgress(
      `${progressVerb} ${targetIndex + 1} of ${targets.length}: ${item.file.name}`,
      (targetIndex / targets.length) * 100,
    );
    await queueItemExport(item, { updatePreview: true, manual: true });
    if (!isItemVisible(item)) releasePreview(item);
  }
  lastExportDurationMs = performance.now() - exportStartedAt;
  stopExportTimer();
  runState = "completed";
  await writeRunMetadata("completed");
  running = false;
  batchOperation = null;
  activeIndex = firstAttentionIndex();
  showCompletion(
    completionTitle,
    `${targets.length} redacted image${targets.length === 1 ? "" : "s"} saved. Review begins with the first image.`,
  );
  await renderCarousel();
  updateButtons();
  showProgress(
    `Export finished in ${formatDuration(lastExportDurationMs)} · ${activeRun.runFolderName}`,
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
    stageTimings: { ...(item.stageTimings || {}) },
    workerNumber: item.workerNumber,
    personGuidance: item.personGuidance.map(clonePersonGuide),
    attention: item.attention,
    reviewConfirmed: item.reviewConfirmed,
    reviewedAt: item.reviewedAt,
    manualAddedCount: item.manualAddedCount,
    removedMaskCount: item.removedMaskCount,
    cornerAdjustedCount: item.cornerAdjustedCount,
    initialModelMasks,
    reviewedMasks: finalMasks,
  };
}

function buildRunManifest() {
  return {
    schemaVersion: 12,
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
    lanyardAwareSecondPass: {
      enabled: elements.enhancedInput.checked,
      lanyardPrompt: LANYARD_PROMPT,
      lanyardThreshold: LANYARD_THRESHOLD,
      badgeThreshold: LANYARD_BADGE_THRESHOLD,
    },
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
    outputFormatPreference: elements.outputFormatInput.value,
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
    reviewSummary: {
      needsAttention: attentionQueueItems().length,
      reviewed: items.filter((item) => item.reviewConfirmed).length,
      peopleWithoutBadgeMasks: items.reduce(
        (total, item) => total + (item.attention?.unmatchedPersonCount || 0),
        0,
      ),
      manualMaskCount: items.reduce(
        (total, item) =>
          total + item.boxes.filter((box) => box.source === "manual").length,
        0,
      ),
      masksAdded: items.reduce(
        (total, item) => total + item.manualAddedCount,
        0,
      ),
      masksRemoved: items.reduce(
        (total, item) => total + item.removedMaskCount,
        0,
      ),
      cornersAdjusted: items.reduce(
        (total, item) => total + item.cornerAdjustedCount,
        0,
      ),
    },
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
    stageTimings: { ...(item.stageTimings || {}) },
    workerNumber: item.workerNumber,
    globalClassifierRejectedCount: item.globalClassifierRejectedCount || 0,
    globalClassifierRejected: (item.globalClassifierRejected || []).map(
      serializeBox,
    ),
    personGuidance: item.personGuidance.map(clonePersonGuide),
    attention: item.attention,
    reviewConfirmed: item.reviewConfirmed,
    reviewedAt: item.reviewedAt,
    manualAddedCount: item.manualAddedCount,
    removedMaskCount: item.removedMaskCount,
    cornerAdjustedCount: item.cornerAdjustedCount,
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
          redactionStrength: mask.redactionStrength,
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
    detectionPass: box.detectionPass || null,
    personId: box.personId || null,
    lanyardGuided: Boolean(box.lanyardGuided),
    ...redactionStrengthRecord(box),
  };
}

function captureRedactionRequest(item) {
  return {
    revision: item.editRevision,
    options: {
      masks: item.boxes.map((box) => expandedMask(box, item)),
      style: elements.redactionStyleInput.value,
      outputFormat: elements.outputFormatInput.value,
      strength: Number(elements.strengthInput.value),
      featherPercent: Number(elements.featherInput.value),
    },
  };
}

async function createRedactedBlob(item, request = captureRedactionRequest(item)) {
  const response = await localImageRequest("/api/image/redact", item.file, {
    ...request.options,
  });
  if (isCurrentEditRevision(item, request.revision)) {
    item.imageInfo = response.info;
  }
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
    redactionStrength: resolveRedactionStrength(
      box.redactionStrength,
      elements.strengthInput.value,
    ),
  };
}

async function createMetadataSidecar(item) {
  if (item.metadataSidecarBlob) return item.metadataSidecarBlob;
  if (!item.metadataSidecarPromise) {
    item.metadataSidecarPromise = localImageRequest(
      "/api/image/metadata",
      item.file,
    )
      .then((response) => {
        item.metadataSidecarBlob = response.blob;
        return response.blob;
      })
      .finally(() => {
        item.metadataSidecarPromise = null;
      });
  }
  return item.metadataSidecarPromise;
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
  const preference = normalizeExportFormat(elements.outputFormatInput.value);
  const sourceFormat =
    item.imageInfo?.sourceFormat ||
    (["jpg", "jpeg"].includes(fileExtension(name))
      ? "jpeg"
      : fileExtension(name) === "heic" || fileExtension(name) === "heif"
        ? "heif"
        : fileExtension(name));
  const outputFormat = resolveExportFormat(preference, sourceFormat);
  const extension = exportExtension(outputFormat);
  if (preference === "original" && sourceFormat === "heif") {
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
  const response = await cachedSourceRequest(path, file, options);
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

async function fetchLocalWithRetry(path, options) {
  try {
    return await fetch(path, options);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    await yieldToUi();
    return fetch(path, options);
  }
}

async function localJsonRequest(path, file, options) {
  const response = await cachedSourceRequest(path, file, options);
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

async function cachedSourceRequest(path, file, options, retryCache = true) {
  const registration = await ensureSourceRegistered(file);
  const headers = {
    "Content-Type": "application/octet-stream",
    "X-Badge-Source-Name": encodeHeader(registration.sourceName),
    "X-Badge-Source-Token": registration.token,
  };
  if (options) {
    headers["X-Badge-Options"] = encodeHeader(JSON.stringify(options));
  }
  const response = await fetchLocalWithRetry(path, {
    method: "POST",
    headers,
  });
  if (response.status !== 410 || !retryCache) return response;
  registration.registered = false;
  registration.promise = null;
  await ensureSourceRegistered(file);
  return cachedSourceRequest(path, file, options, false);
}

async function ensureSourceRegistered(file) {
  let registration = sourceRegistrationState.get(file);
  if (!registration) {
    registration = {
      token: crypto.randomUUID(),
      sourceName: file.name,
      registered: false,
      promise: null,
    };
    sourceRegistrationState.set(file, registration);
  }
  if (registration.registered) return registration;
  if (!registration.promise) {
    registration.promise = (async () => {
      const sourceFile = await materializeSourceFile(file);
      registration.sourceName = sourceFile.name;
      const response = await fetchLocalWithRetry("/api/image/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Badge-Source-Name": encodeHeader(sourceFile.name),
          "X-Badge-Source-Token": registration.token,
        },
        body: sourceFile,
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(
          detail.error ||
            `The local source cache rejected this image (${response.status}).`,
        );
      }
      registration.registered = true;
      return registration;
    })().finally(() => {
      registration.promise = null;
    });
  }
  await registration.promise;
  return registration;
}

async function materializeSourceFile(file) {
  if (!file?.desktopSourceToken) return file;
  if (!window.badgeBlurDesktop?.readRecoveredSource) {
    throw new Error("The Electron source-image bridge is unavailable.");
  }
  const recovered = await window.badgeBlurDesktop.readRecoveredSource(
    file.desktopSourceToken,
  );
  if (
    recovered.name !== file.name ||
    Number(recovered.size) !== Number(file.size)
  ) {
    throw new Error(`${file.name} changed after the run was imported.`);
  }
  const bytes =
    recovered.bytes instanceof Uint8Array
      ? recovered.bytes
      : new Uint8Array(recovered.bytes);
  return new File([bytes], recovered.name, {
    type: recovered.type || file.type,
    lastModified: recovered.lastModified || file.lastModified,
  });
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
  elements.summaryText.textContent = reviewProgressSummary(items, activeIndex);
  updateReviewAssistance();
  scheduleProjectCache();
}

function firstAttentionIndex() {
  const first = items.findIndex(
    (item) =>
      !item.reviewConfirmed &&
      Array.isArray(item.attention?.reasons) &&
      item.attention.reasons.length > 0,
  );
  return first >= 0 ? first : 0;
}

function updateReviewAssistance() {
  const queue = attentionQueueItems();
  elements.attentionQueueButton.disabled = queue.length === 0;
  elements.attentionQueueButton.classList.toggle(
    "has-attention",
    queue.length > 0,
  );
  elements.attentionQueueButton.textContent =
    queue.length > 0
      ? `Review ${queue.length} flagged ${queue.length === 1 ? "issue" : "issues"}`
      : "All images ready for review";
  elements.attentionQueueButton.title =
    queue.length > 0
      ? "Move to the next obvious processing or mask issue"
      : "No obvious processing or mask issues were found";
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
    !elements.outputFormatInput.value ||
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
  if (unreviewedDetectedItems().length > 0 && !running) {
    elements.exportAllButton.textContent =
      `Review ${unreviewedDetectedItems().length} before final export`;
  }
  const changedItems = changedSinceLastExportItems();
  elements.exportChangedButton.hidden = !activeRun;
  elements.exportChangedButton.disabled =
    !serverReady || batchLocked || changedItems.length === 0;
  elements.exportChangedButton.textContent =
    changedItems.length > 0
      ? `Re-export changed (${changedItems.length})`
      : "No changes to re-export";
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
  elements.backToSetupButton.disabled = running;
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
    elements.outputFormatInput,
    elements.strengthInput,
    elements.featherInput,
    elements.workerCountInput,
  ]) {
    control.disabled = batchLocked;
  }
  updateCarouselControls();
  updateReviewAssistance();
  if (items[activeIndex]) renderItemStatus(items[activeIndex]);
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
  description +=
    ` · ${INFERENCE_THREADS_PER_WORKER} inference thread${INFERENCE_THREADS_PER_WORKER === 1 ? "" : "s"} each · isolated from UI`;
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
    const elapsed = formatDuration(performance.now() - batchStartedAt);
    elements.batchTime.textContent =
      `Processing · ${elapsed}` +
      (lastBatchWorkerCount
        ? ` · ${lastBatchWorkerCount} worker${lastBatchWorkerCount === 1 ? "" : "s"}`
        : "");
    elements.progressTimer.textContent = `Elapsed · ${elapsed}`;
  } else if (lastBatchDurationMs != null) {
    const duration = formatDuration(lastBatchDurationMs);
    elements.batchTime.textContent =
      `Last batch · ${duration}` +
      (lastBatchWorkerCount
        ? ` · ${lastBatchWorkerCount} worker${lastBatchWorkerCount === 1 ? "" : "s"}`
        : "");
    elements.progressTimer.textContent = `Total · ${duration}`;
  } else {
    elements.batchTime.textContent = "Not started";
    elements.progressTimer.textContent = "Elapsed · 0.0s";
  }
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, milliseconds) / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(totalSeconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

async function timedItemStage(item, key, callback) {
  const startedAt = performance.now();
  try {
    return await callback();
  } finally {
    item.stageTimings ||= {};
    item.stageTimings[key] =
      (Number(item.stageTimings[key]) || 0) + performance.now() - startedAt;
  }
}

function yieldToUi() {
  if (globalThis.scheduler?.postTask) {
    return globalThis.scheduler.postTask(() => undefined, {
      priority: "background",
    });
  }
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
