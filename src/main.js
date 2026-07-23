import { env, pipeline } from "@huggingface/transformers";
import {
  CLASSIFIER_LABELS,
  CLASSIFIER_MARGIN,
  CLASSIFIER_MODEL_ID,
  MODEL_ID,
  PERSON_THRESHOLD,
  TORSO_THRESHOLD,
} from "./detector-config.js";
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

const APP_VERSION = "0.10.4";
const IMAGE_API_VERSION = 3;
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
const PAGE_SIZE = 4;

env.localModelPath = "/models/";
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.backends.onnx.wasm.wasmPaths = "/vendor/onnx/";

const elements = {
  folderInput: document.querySelector("#folderInput"),
  labelsInput: document.querySelector("#labelsInput"),
  enhancedInput: document.querySelector("#enhancedInput"),
  thresholdInput: document.querySelector("#thresholdInput"),
  thresholdOutput: document.querySelector("#thresholdOutput"),
  paddingInput: document.querySelector("#paddingInput"),
  paddingOutput: document.querySelector("#paddingOutput"),
  strengthInput: document.querySelector("#strengthInput"),
  strengthOutput: document.querySelector("#strengthOutput"),
  featherInput: document.querySelector("#featherInput"),
  featherOutput: document.querySelector("#featherOutput"),
  loadModelButton: document.querySelector("#loadModelButton"),
  runAllButton: document.querySelector("#runAllButton"),
  exportAllButton: document.querySelector("#exportAllButton"),
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
};

let detector = null;
let rescueClassifier = null;
let items = [];
let running = false;
let currentPage = 0;
let pageRenderToken = 0;
let importedManifest = null;
let serverReady = false;

elements.thresholdInput.addEventListener("input", () => {
  elements.thresholdOutput.value = Number(elements.thresholdInput.value).toFixed(2);
});
elements.paddingInput.addEventListener("input", () => {
  elements.paddingOutput.value = `${elements.paddingInput.value}%`;
  redrawAll();
});
elements.strengthInput.addEventListener("input", () => {
  elements.strengthOutput.value = elements.strengthInput.value;
});
elements.featherInput.addEventListener("input", () => {
  elements.featherOutput.value = `${elements.featherInput.value}%`;
});
elements.folderInput.addEventListener("change", loadSelectedFiles);
elements.loadModelButton.addEventListener("click", loadModel);
elements.runAllButton.addEventListener("click", runAll);
elements.exportAllButton.addEventListener("click", exportAll);
elements.importRunButton.addEventListener("click", () => {
  elements.runManifestInput.value = "";
  elements.runManifestInput.click();
});
elements.runManifestInput.addEventListener("change", importPreviousRun);
elements.previousPageButton.addEventListener("click", () => changePage(-1));
elements.nextPageButton.addEventListener("click", () => changePage(1));
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
      status.apiVersion !== IMAGE_API_VERSION
    ) {
      throw new Error(
        `Browser ${APP_VERSION} is connected to local server ` +
          `${status.appVersion || "unknown"}.`,
      );
    }
    serverReady = true;
    updateButtons();
  } catch (error) {
    console.error("Local server compatibility check failed.", error);
    serverReady = false;
    setModelStatus("error", "Restart required");
    showProgress(
      "This page is connected to an older Badge Remover server. Close old " +
        "Badge Remover Terminal windows, start this version again, and reload.",
      0,
    );
    updateButtons();
  }
}

async function loadSelectedFiles(event) {
  releaseItems();
  const selected = [...event.target.files]
    .filter((file) => SUPPORTED_EXTENSIONS.has(fileExtension(file.name)))
    .sort((a, b) => a.name.localeCompare(b.name));

  items = selected.map((file, index) => ({
    id: `image-${index}-${crypto.randomUUID()}`,
    file,
    width: null,
    height: null,
    imageInfo: null,
    decodeError: null,
    previewUrl: null,
    previewImage: null,
    boxes: [],
    modelBoxes: [],
    selectedBoxId: null,
    status: "queued",
    message: "Waiting for detection",
  }));
  currentPage = 0;

  elements.emptyState.hidden = items.length > 0;
  await renderCurrentPage();
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
      throw new Error("This is not a Badge Remover run manifest.");
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
    const entry = findRunEntry(runFileIndex, sourceRelativePath(item.file));
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
    restored += 1;
  }
  currentPage = 0;
  await renderCurrentPage();
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
  if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  item.previewUrl = null;
  item.previewImage = null;
}

async function ensurePreview(item) {
  if (item.decodeError) throw new Error(item.decodeError);
  if (item.previewImage) return;
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
  }
}

async function loadModel() {
  if (detector || running) return;
  setModelStatus("loading", "Loading local model…");
  elements.loadModelButton.disabled = true;

  try {
    detector = await pipeline("zero-shot-object-detection", MODEL_ID, {
      dtype: "q8",
      device: "wasm",
    });
    setModelStatus("loading", "Loading local classifier…");
    rescueClassifier = await pipeline(
      "zero-shot-image-classification",
      CLASSIFIER_MODEL_ID,
      {
        dtype: "q8",
        device: "wasm",
      },
    );
    setModelStatus("ready", "Local models ready");
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

async function runAll() {
  if (!detector || running || items.length === 0) return;
  running = true;
  updateButtons();
  elements.progressWrap.hidden = false;

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    showProgress(
      `Analyzing ${index + 1} of ${items.length}: ${item.file.name}`,
      (index / items.length) * 100,
    );
    await detectItem(item);
    if (!isItemOnCurrentPage(item)) releasePreview(item);
  }

  showProgress(`Detection finished for ${items.length} images. Review every mask.`, 100);
  running = false;
  await renderCurrentPage();
  updateButtons();
  updateSummary();
}

async function detectItem(item) {
  item.status = "running";
  item.message = "Detecting…";
  renderItemStatus(item);

  try {
    await ensurePreview(item);
    const prompt = normalizeGroundingPrompt(elements.labelsInput.value);
    elements.labelsInput.value = prompt;
    const threshold = Number(elements.thresholdInput.value);
    const output = await detector(item.previewUrl, [prompt], {
      threshold,
      top_k: 40,
    });
    const scaleX = item.width / item.previewImage.naturalWidth;
    const scaleY = item.height / item.previewImage.naturalHeight;
    const candidates = output.map((result) =>
      normalizeDetection(result, item, scaleX, scaleY),
    );
    const modelBoxes = filterBadgeDetections(candidates, item).map((box) =>
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
      ? await detectTorsoRescues(item, prompt, modelBoxes)
      : [];
    const detectedBoxes = mergeGlobalWithTorsoRescues(
      modelBoxes,
      torsoRescues,
    );
    item.boxes = await autoFitDetectedMasks(item, detectedBoxes);
    item.modelBoxes = item.boxes.map(cloneMask);
    item.status = "detected";
    const fittedCount = item.boxes.filter((box) => box.autoFitted).length;
    item.message =
      `${item.boxes.length} likely badge${item.boxes.length === 1 ? "" : "s"}` +
      (torsoRescues.length ? ` · ${torsoRescues.length} torso rescue` : "") +
      (fittedCount ? ` · ${fittedCount} corner-fit` : " · rectangle fallback");
  } catch (error) {
    console.error(error);
    item.status = "error";
    item.message = error.message;
  }

  if (document.querySelector(`[data-item-id="${item.id}"]`)) {
    await ensurePreview(item);
    renderItem(item);
  }
  updateSummary();
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

async function detectTorsoRescues(item, prompt, globalBoxes) {
  const scaleX = item.width / item.previewImage.naturalWidth;
  const scaleY = item.height / item.previewImage.naturalHeight;
  const personOutput = await detector(item.previewUrl, ["person."], {
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
      const output = await detector(torsoUrl, [prompt], {
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
        if (await classifyTorsoRescue(item, mapped)) {
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

async function classifyTorsoRescue(item, box) {
  const region = paddedBoxRegion(box, item.width, item.height, 1.15);
  const patch = await localImageRequest("/api/image/crop", item.file, {
    region,
    width: 384,
    height: 384,
    fit: "cover",
  });
  const patchUrl = URL.createObjectURL(patch.blob);
  try {
    const classifications = await rescueClassifier(patchUrl, CLASSIFIER_LABELS);
    const scores = Object.fromEntries(
      classifications.map(({ label, score }) => [label, Number(score)]),
    );
    const positiveScore = Math.max(
      scores[CLASSIFIER_LABELS[0]],
      scores[CLASSIFIER_LABELS[1]],
    );
    const negativeScore = Math.max(
      ...CLASSIFIER_LABELS.slice(2).map((label) => scores[label]),
    );
    return positiveScore - negativeScore >= CLASSIFIER_MARGIN;
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

async function renderCurrentPage() {
  const renderToken = ++pageRenderToken;
  const visibleItems = currentPageItems();

  for (const item of items) {
    if (!visibleItems.includes(item)) releasePreview(item);
  }

  elements.reviewGrid.replaceChildren();
  for (const item of visibleItems) {
    try {
      await ensurePreview(item);
    } catch (error) {
      item.status = "error";
      item.message = error.message;
      await ensureErrorPreview(item);
    }
    if (renderToken !== pageRenderToken) return;
    renderItem(item);
  }
  updatePagination();
}

function currentPageItems() {
  const start = currentPage * PAGE_SIZE;
  return items.slice(start, start + PAGE_SIZE);
}

function isItemOnCurrentPage(item) {
  return currentPageItems().includes(item);
}

async function changePage(direction) {
  if (running) return;
  const nextPage = clamp(currentPage + direction, 0, totalPages() - 1);
  if (nextPage === currentPage) return;
  currentPage = nextPage;
  updateButtons();
  await renderCurrentPage();
  document.querySelector(".review-section")?.scrollIntoView({ behavior: "smooth" });
}

function totalPages() {
  return Math.max(1, Math.ceil(items.length / PAGE_SIZE));
}

function updatePagination() {
  const pages = totalPages();
  elements.pagination.hidden = items.length <= PAGE_SIZE;
  elements.pageStatus.textContent =
    `Page ${currentPage + 1} of ${pages} · ${PAGE_SIZE} images maximum in memory`;
  elements.previousPageButton.disabled = running || currentPage === 0;
  elements.nextPageButton.disabled = running || currentPage >= pages - 1;
}

function renderItem(item) {
  let card = document.querySelector(`[data-item-id="${item.id}"]`);
  if (!card) {
    card = document.createElement("article");
    card.className = "image-card";
    card.dataset.itemId = item.id;
    card.innerHTML = `
      <div class="card-heading">
        <div>
          <h3></h3>
          <p class="dimensions"></p>
        </div>
        <span class="item-status"></span>
      </div>
      <div class="canvas-wrap">
        <canvas aria-label="Image with editable badge detections"></canvas>
      </div>
      <div class="card-actions">
        <button class="button small detect-one">Detect</button>
        <button class="button small secondary remove-box">Remove selected</button>
        <button class="button small secondary export-one">Export copy</button>
      </div>
    `;
    elements.reviewGrid.append(card);

    const canvas = card.querySelector("canvas");
    setupCanvasInteraction(canvas, item);
    card.querySelector(".detect-one").addEventListener("click", async () => {
      if (!detector) await loadModel();
      if (!detector) return;
      await detectItem(item);
    });
    card.querySelector(".remove-box").addEventListener("click", () => {
      removeSelectedBox(item);
    });
    card.querySelector(".export-one").addEventListener("click", () => {
      exportOne(item);
    });
  }

  card.querySelector("h3").textContent = item.file.name;
  const conversion = item.imageInfo?.converted ? " · HEIC/HEIF → TIFF" : "";
  card.querySelector(".dimensions").textContent = item.decodeError
    ? "Not processed"
    : `${item.width} × ${item.height}${conversion}`;
  card.querySelector(".detect-one").disabled = Boolean(item.decodeError);
  card.querySelector(".export-one").disabled = Boolean(item.decodeError);
  renderItemStatus(item);
  drawItem(item);
}

function renderItemStatus(item) {
  const card = document.querySelector(`[data-item-id="${item.id}"]`);
  if (!card) return;
  const status = card.querySelector(".item-status");
  status.textContent = item.message;
  status.dataset.state = item.status;
  card.querySelector(".remove-box").disabled = !item.selectedBoxId;
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
  drawItem(item);
  renderItemStatus(item);
  updateSummary();
}

async function exportOne(item) {
  try {
    const [blob, sidecar] = await Promise.all([
      createRedactedBlob(item),
      createMetadataSidecar(item),
    ]);
    const name = outputName(item);
    downloadBlob(blob, name);
    downloadBlob(sidecar, `${name}.metadata.mie`);
  } catch (error) {
    console.error(error);
    showProgress(`Could not export ${item.file.name}: ${error.message}`, 0);
  }
}

async function exportAll() {
  if (items.length === 0 || running) return;
  running = true;
  updateButtons();
  elements.progressWrap.hidden = false;

  if (typeof window.showDirectoryPicker !== "function") {
    showProgress(
      "Bulk folder export requires Microsoft Edge or Google Chrome. No files were downloaded.",
      0,
    );
    running = false;
    updateButtons();
    return;
  }

  let outputDirectory;
  let runId;
  let runFolderName;
  try {
    const selectedDirectory = await window.showDirectoryPicker({
      id: "badge-remover-export",
      mode: "readwrite",
    });
    const run = await createUniqueRunDirectory(selectedDirectory);
    outputDirectory = run.directory;
    runId = run.runId;
    runFolderName = run.name;
  } catch (error) {
    running = false;
    updateButtons();
    if (error.name !== "AbortError") {
      console.error(error);
      showProgress(`Could not open the output folder: ${error.message}`, 0);
    }
    return;
  }

  try {
    const manifest = {
      schemaVersion: 5,
      appVersion: APP_VERSION,
      runId,
      runFolderName,
      generatedAt: new Date().toISOString(),
      localOnly: true,
      originalsIncluded: false,
      sourceRootName: sourceRootName(items[0]?.file),
      importedFromRunId: importedManifest?.runId || null,
      model: MODEL_ID,
      detectionPhrases: elements.labelsInput.value,
      enhancedTorsoRescue: elements.enhancedInput.checked,
      threshold: Number(elements.thresholdInput.value),
      paddingPercent: Number(elements.paddingInput.value),
      redactionStrength: Number(elements.strengthInput.value),
      featherPercent: Number(elements.featherInput.value),
      files: [],
      failures: [],
    };
    const trainingAnnotations = {
      info: {
        description: "Locally reviewed four-corner badge masks",
        generatedAt: manifest.generatedAt,
        localOnly: true,
        model: MODEL_ID,
        reviewAssumption:
          "Export indicates that a person reviewed and corrected every final mask.",
      },
      licenses: [],
      categories: [{ id: 1, name: "identification badge", supercategory: "badge" }],
      images: [],
      annotations: [],
    };
    let annotationId = 1;

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      showProgress(
        `Exporting ${index + 1} of ${items.length}: ${item.file.name}`,
        (index / items.length) * 100,
      );
      try {
        const [blob, sidecar] = await Promise.all([
          createRedactedBlob(item),
          createMetadataSidecar(item),
        ]);
        const sourcePath = sourceRelativePath(item.file);
        const name = outputRelativePath(item);
        const sidecarName = `${name}.metadata.mie`;
        await writeRelativeFile(outputDirectory, name, blob);
        await writeRelativeFile(outputDirectory, sidecarName, sidecar);
        const finalMasks = item.boxes.map(serializeBox);
        const initialModelMasks = item.modelBoxes.map(serializeBox);
        manifest.files.push({
          input: item.file.name,
          sourcePath,
          output: name,
          metadataArchive: sidecarName,
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
          initialModelMaskCount: initialModelMasks.length,
          initialModelMasks,
          reviewedMaskCount: finalMasks.length,
          reviewedMasks: finalMasks,
        });

        const imageId = index + 1;
        trainingAnnotations.images.push({
          id: imageId,
          file_name: sourcePath,
          width: item.width,
          height: item.height,
        });
        for (const mask of finalMasks) {
          trainingAnnotations.annotations.push({
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
      } catch (error) {
        console.error(error);
        item.status = "error";
        item.message = `Export skipped: ${error.message}`;
        manifest.failures.push({
          input: item.file.name,
          sourcePath: sourceRelativePath(item.file),
          error: error.message,
        });
      }
      if (!isItemOnCurrentPage(item)) releasePreview(item);
    }

    const manifestBlob = new Blob([JSON.stringify(manifest, null, 2)], {
      type: "application/json",
    });
    const trainingBlob = new Blob([JSON.stringify(trainingAnnotations, null, 2)], {
      type: "application/json",
    });
    await writeFile(outputDirectory, "badge-removal-manifest.json", manifestBlob);
    await writeFile(
      outputDirectory,
      "badge-training-annotations.coco.json",
      trainingBlob,
    );

    showProgress(
      manifest.failures.length
        ? `Bulk export complete with ${manifest.failures.length} skipped file(s). See the manifest.`
        : `Bulk export complete in ${runFolderName}.`,
      100,
    );
  } catch (error) {
    console.error(error);
    showProgress(`Bulk export stopped: ${error.message}`, 0);
  } finally {
    running = false;
    updateButtons();
  }
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
  };
}

async function createRedactedBlob(item) {
  await ensurePreview(item);
  const response = await localImageRequest("/api/image/redact", item.file, {
    masks: item.boxes.map((box) => expandedMask(box, item)),
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

function sourceRelativePath(file) {
  const parts = (file.webkitRelativePath || file.name).split("/").filter(Boolean);
  if (parts.length > 1) parts.shift();
  return parts.join("/");
}

function outputRelativePath(item) {
  const sourcePath = sourceRelativePath(item.file);
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
          "Badge Remover Terminal windows and restart this app.",
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
  elements.runAllButton.disabled =
    !serverReady || !detector || !hasProcessableItems || running;
  elements.exportAllButton.disabled =
    !serverReady || !hasProcessableItems || running;
  elements.loadModelButton.disabled = !serverReady || Boolean(detector) || running;
  elements.folderInput.disabled = !serverReady || running;
  elements.importRunButton.disabled = !serverReady || running;
  updatePagination();
}

function setModelStatus(state, text) {
  elements.modelStatus.dataset.state = state;
  elements.modelStatus.textContent = text;
}

function showProgress(text, percent) {
  elements.progressWrap.hidden = false;
  elements.progressText.textContent = text;
  elements.progressBar.style.width = `${clamp(percent, 0, 100)}%`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
