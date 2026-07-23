import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { env, pipeline } from "@huggingface/transformers";
import sharp from "sharp";
import {
  createMetadataSidecar,
  decodePreview,
  detectColorBadgeCandidates,
  fitMaskCorners,
  redactImage,
} from "./image-runtime.mjs";
import {
  DEFAULT_FEATHER_PERCENT,
  DEFAULT_LABELS,
  DEFAULT_PADDING_PERCENT,
  DEFAULT_REDACTION_STRENGTH,
  DEFAULT_THRESHOLD,
  MODEL_ID,
} from "../src/detector-config.js";
import {
  deduplicateBadgeDetections,
  filterBadgeDetections,
} from "../src/detection-utils.js";

const projectRoot = resolve(import.meta.dirname, "..");
const packageInfo = JSON.parse(
  await readFile(resolve(projectRoot, "package.json"), "utf8"),
);
const inputDirectory = resolve(
  argumentValue("--input") ||
    resolve(projectRoot, "test-data/local-badge-evaluation"),
);
const outputRoot = resolve(
  argumentValue("--output") || resolve(projectRoot, "test-output"),
);
const skipRedaction = process.argv.includes("--skip-redaction");
const thorough = process.argv.includes("--thorough");
const personGuided = process.argv.includes("--person-guided");
const torsoGuided = process.argv.includes("--torso-guided");
const colorAssisted = process.argv.includes("--color-assisted");
const nameMatch = argumentValue("--match");
const detectionThreshold = Number(
  argumentValue("--threshold") || DEFAULT_THRESHOLD,
);
const detectionLabels = argumentValue("--prompt")
  ? [argumentValue("--prompt")]
  : DEFAULT_LABELS;
const personThreshold = Number(argumentValue("--person-threshold") || 0.22);
const cropThreshold = Number(argumentValue("--crop-threshold") || 0.5);
const classifierMargin = Number(
  argumentValue("--classifier-margin") || 0.2,
);
const classifierModelId = "Xenova/clip-vit-base-patch32";
const classifierLabels = [
  "an employee identification badge hanging from a lanyard",
  "a plastic photo ID card or conference name badge",
  "a shirt logo or printed clothing",
  "a pocket, button, zipper, or clothing detail",
  "a wall sign, sheet of paper, or equipment label",
];
const groundTruthPath = resolve(
  argumentValue("--ground-truth") ||
    resolve(projectRoot, "test-data/badge-ground-truth.json"),
);
const groundTruth = JSON.parse(await readFile(groundTruthPath, "utf8"));
const runId = randomUUID();
const timestamp = localTimestamp(new Date());
const runDirectory = resolve(
  outputRoot,
  `evaluation-${timestamp}-${runId.slice(0, 8)}`,
);
const previewDirectory = resolve(runDirectory, "previews");
const reviewDirectory = resolve(runDirectory, "review");
const redactedDirectory = resolve(runDirectory, "redacted");
const metadataDirectory = resolve(runDirectory, "metadata");
const tileDirectory = resolve(runDirectory, "tiles");

await mkdir(previewDirectory, { recursive: true });
await mkdir(reviewDirectory, { recursive: true });
if (!skipRedaction) {
  await mkdir(redactedDirectory, { recursive: true });
  await mkdir(metadataDirectory, { recursive: true });
}
if (thorough || personGuided || torsoGuided) {
  await mkdir(tileDirectory, { recursive: true });
}

const imageNames = (await readdir(inputDirectory))
  .filter((name) => /\.(jpe?g|png|tiff?|webp|avif|heic|heif)$/i.test(name))
  .filter((name) => !nameMatch || name.includes(nameMatch))
  .sort((a, b) => a.localeCompare(b));
if (imageNames.length === 0) {
  throw new Error(`No supported images found in ${inputDirectory}`);
}

env.localModelPath = `${resolve(projectRoot, "public/models")}/`;
env.allowRemoteModels = false;
env.allowLocalModels = true;

console.log(`Loading local detector ${MODEL_ID}`);
const detector = await pipeline("zero-shot-object-detection", MODEL_ID, {
  dtype: "q8",
  device: "cpu",
});
let rescueClassifier = null;
if (torsoGuided) {
  console.log(`Loading local classifier ${classifierModelId}`);
  rescueClassifier = await pipeline(
    "zero-shot-image-classification",
    classifierModelId,
    {
      dtype: "q8",
      device: "cpu",
    },
  );
}
const report = {
  schemaVersion: 1,
  appVersion: packageInfo.version,
  generatedAt: new Date().toISOString(),
  runId,
  inputDirectory,
  outputDirectory: runDirectory,
  localOnly: true,
  detectionMode: torsoGuided
    ? "grounding-dino-torso-crops"
    : personGuided
    ? "person-guided-torso-crops"
    : colorAssisted
      ? "production-color-assisted"
    : thorough
      ? "thorough-3x2-tiles"
      : "global-preview",
  model: MODEL_ID,
  labels: detectionLabels,
  groundTruthPath,
  threshold: detectionThreshold,
  personThreshold,
  cropThreshold,
  classifierModel: torsoGuided ? classifierModelId : null,
  classifierMargin: torsoGuided ? classifierMargin : null,
  paddingPercent: DEFAULT_PADDING_PERCENT,
  redactionStrength: DEFAULT_REDACTION_STRENGTH,
  featherPercent: DEFAULT_FEATHER_PERCENT,
  files: [],
};
const reviewTiles = [];

for (let index = 0; index < imageNames.length; index += 1) {
  const imageName = imageNames[index];
  const startedAt = performance.now();
  console.log(`[${index + 1}/${imageNames.length}] ${imageName}`);
  const sourcePath = resolve(inputDirectory, imageName);
  const source = await readFile(sourcePath);
  const decoded = await decodePreview(source, imageName);
  const previewStats = await sharp(decoded.preview).stats();
  const sceneLuminance =
    previewStats.channels
      .slice(0, 3)
      .reduce((sum, channel) => sum + channel.mean, 0) / 3;
  const previewPath = resolve(previewDirectory, `${safeStem(imageName)}.jpg`);
  await writeFile(previewPath, decoded.preview);
  const previewInfo = await sharp(decoded.preview).metadata();
  const raw = await detector(previewPath, detectionLabels, {
    threshold: detectionThreshold,
    top_k: 40,
  });
  const scaleX = decoded.info.width / previewInfo.width;
  const scaleY = decoded.info.height / previewInfo.height;
  const candidates = raw.map((result, resultIndex) =>
    normalizeDetection(
      result,
      decoded.info.width,
      decoded.info.height,
      scaleX,
      scaleY,
      `${index}-${resultIndex}`,
    ),
  );
  const globalBoxes = filterBadgeDetections(candidates, decoded.info);
  const tileResults = torsoGuided
    ? await detectGroundingDinoTorsoCrops({
        detector,
        source,
        imageName,
        width: decoded.info.width,
        height: decoded.info.height,
        globalPreviewPath: previewPath,
        globalPreviewInfo: previewInfo,
        tileDirectory,
        badgePrompt: detectionLabels,
        personThreshold,
        cropThreshold,
      })
    : personGuided
    ? await detectPersonCrops({
        detector,
        source,
        imageName,
        width: decoded.info.width,
        height: decoded.info.height,
        globalPreviewPath: previewPath,
        globalPreviewInfo: previewInfo,
        tileDirectory,
      })
    : thorough
    ? await detectTiles({
        detector,
        source,
        imageName,
        width: decoded.info.width,
        height: decoded.info.height,
        tileDirectory,
        threshold: detectionThreshold,
      })
    : {
        boxes: [],
        rawDetectionCount: 0,
        passCount: 0,
        personRegions: [],
        personCount: 0,
        contextRegion: null,
      };
  const colorResults = personGuided || colorAssisted
    ? await detectColorBadgeCandidates(source, imageName)
    : { candidates: [] };
  const productionColorBoxes = colorResults.candidates
    .filter((box) => {
      const areaRatio =
        (box.width * box.height) / (decoded.info.width * decoded.info.height);
      const centerY =
        (box.y + box.height / 2) / decoded.info.height;
      return (
        box.score >= 0.88 &&
        areaRatio >= 0.0025 &&
        areaRatio <= 0.012 &&
        centerY <= 0.74
      );
    })
    .map((box, colorIndex) => ({
      ...box,
      id: `production-color-${colorIndex}`,
      detectionPass: "production-color",
    }));
  const contextualColorCandidates = assignCandidateRegions(
    colorResults.candidates,
    tileResults.personRegions,
  );
  const personModelBoxes = personGuided
    ? tileResults.boxes.filter(
        (box) =>
          box.score >= 0.4 &&
          (box.regionRelativeY == null || box.regionRelativeY >= 0.26) &&
          (box.width * box.height) /
            (decoded.info.width * decoded.info.height) <=
          0.015,
      )
    : tileResults.boxes;
  const torsoModelBoxes = torsoGuided
    ? tileResults.boxes.filter(
        (box) =>
          box.score >= cropThreshold &&
          box.regionRelativeX >= 0.08 &&
          box.regionRelativeX <= 0.92 &&
          box.regionRelativeY >= 0.14 &&
          box.regionRelativeY <= 0.9,
      )
    : [];
  const classifiedTorsoBoxes = torsoGuided
    ? await classifyTorsoCandidates({
        classifier: rescueClassifier,
        source,
        imageName,
        width: decoded.info.width,
        height: decoded.info.height,
        boxes: torsoModelBoxes,
        tileDirectory,
        marginThreshold: classifierMargin,
      })
    : [];
  const modelEvidenceBoxes = [
    ...globalBoxes,
    ...personModelBoxes,
    ...classifiedTorsoBoxes,
  ];
  const imageArea = decoded.info.width * decoded.info.height;
  const regionColorBoxes = bestColorCandidatePerRegion(
    contextualColorCandidates.filter(
      (box) =>
        box.score >= 0.62 &&
        box.regionRelativeX >= 0.14 &&
        box.regionRelativeX <= 0.86 &&
        box.regionRelativeY >= 0.28 &&
        box.regionRelativeY <= 0.88,
    ),
  ).filter((box) => {
    const center = boxCenter(box);
    const areaRatio = (box.width * box.height) / imageArea;
    if (areaRatio > 0.012) return false;
    const corroborated = modelEvidenceBoxes.some((evidence) =>
      pointInBox(center, evidence),
    );
    const strongColorRescue =
      box.score >= 0.88 && areaRatio >= 0.0025 && areaRatio <= 0.025;
    return corroborated || strongColorRescue;
  });
  const crowdMode =
    sceneLuminance >= 105 &&
    tileResults.personCount >= 6 &&
    modelEvidenceBoxes.length >= 2;
  const supplementalColorBoxes = contextualColorCandidates
    .filter((box) => {
      if (!crowdMode || !tileResults.contextRegion || box.score < 0.6) {
        return false;
      }
      const center = boxCenter(box);
      return (
        pointInBox(center, tileResults.contextRegion) &&
        center.y <=
          tileResults.contextRegion.y + tileResults.contextRegion.height * 0.78
      );
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 16);
  const colorBoxes = genericNms(
    [...regionColorBoxes, ...supplementalColorBoxes],
    0.34,
  )
    .filter((box) => boxCenter(box).y <= decoded.info.height * 0.74)
    .map((box, colorIndex) => ({
      ...box,
      id: `color-${colorIndex}`,
      detectionPass: "color",
    }));
  const boxes = torsoGuided
    ? mergeGlobalWithTorsoRescues(globalBoxes, classifiedTorsoBoxes)
    : personGuided
    ? refineHybridDetections(modelEvidenceBoxes, colorBoxes)
    : colorAssisted
      ? refineHybridDetections(globalBoxes, productionColorBoxes)
    : deduplicateBadgeDetections(
        [...globalBoxes, ...personModelBoxes, ...colorBoxes],
        0.32,
      );
  const fit = await fitMaskCorners(source, imageName, {
    boxes,
    paddingPercent: DEFAULT_PADDING_PERCENT,
  });
  const masks = boxes.map((box, maskIndex) => ({
    ...box,
    points: fit.masks[maskIndex]?.points || rectanglePoints(box),
    autoFitted: Boolean(fit.masks[maskIndex]?.refined),
    fitConfidence: Number(fit.masks[maskIndex]?.confidence) || 0,
    fitReason: fit.masks[maskIndex]?.reason || "No fit result.",
  }));
  const expectedPoints = (groundTruth.images[imageName] || []).map(
    ([normalizedX, normalizedY], pointIndex) => ({
      id: `${safeStem(imageName)}-${pointIndex + 1}`,
      x: normalizedX * decoded.info.width,
      y: normalizedY * decoded.info.height,
    }),
  );
  const scoring = scoreMasks(masks, expectedPoints);

  let redactedPreview = decoded.preview;
  let outputName = null;
  let metadataName = null;
  if (!skipRedaction) {
    const redacted = await redactImage(source, imageName, {
      masks,
      strength: DEFAULT_REDACTION_STRENGTH,
      featherPercent: DEFAULT_FEATHER_PERCENT,
    });
    outputName = `${safeStem(imageName)}-redacted.${outputExtension(redacted.info.outputFormat)}`;
    metadataName = `${safeStem(imageName)}.metadata.mie`;
    await writeFile(resolve(redactedDirectory, outputName), redacted.image);
    const sidecar = await createMetadataSidecar(source, imageName);
    await writeFile(resolve(metadataDirectory, metadataName), sidecar);
    redactedPreview = await sharp(redacted.image)
      .resize({
        width: previewInfo.width,
        height: previewInfo.height,
        fit: "fill",
      })
      .jpeg({ quality: 84 })
      .toBuffer();
  }

  const overlay = overlaySvg(
    previewInfo.width,
    previewInfo.height,
    masks,
    scaleX,
    scaleY,
    expectedPoints,
    scoring.coveredPointIds,
  );
  const reviewedOriginal = await sharp(decoded.preview)
    .composite([{ input: overlay, top: 0, left: 0 }])
    .jpeg({ quality: 88 })
    .toBuffer();
  const review = await sideBySideReview(
    reviewedOriginal,
    redactedPreview,
    imageName,
    masks.length,
  );
  const reviewName = `${safeStem(imageName)}-review.jpg`;
  const reviewPath = resolve(reviewDirectory, reviewName);
  await writeFile(reviewPath, review);
  reviewTiles.push(reviewPath);

  report.files.push({
    imageName,
    sourceBytes: source.length,
    width: decoded.info.width,
    height: decoded.info.height,
    sourceFormat: decoded.info.sourceFormat,
    rawDetectionCount: raw.length,
    candidateCount: candidates.length,
    detectionPassCount: 1 + tileResults.passCount,
    tileRawDetectionCount: tileResults.rawDetectionCount,
    globalDetectionCount: globalBoxes.length,
    tileDetectionCount: tileResults.boxes.length,
    colorDetectionCount: colorBoxes.length,
    filteredDetectionCount: boxes.length,
    cornerFitCount: masks.filter((mask) => mask.autoFitted).length,
    rectangleFallbackCount: masks.filter((mask) => !mask.autoFitted).length,
    masks: masks.map(serializeMask),
    groundTruthPointCount: expectedPoints.length,
    coveredGroundTruthPointCount: scoring.coveredPointIds.size,
    missedGroundTruthPointIds: scoring.missedPointIds,
    truePositiveMaskCount: scoring.truePositiveMaskCount,
    falsePositiveMaskCount: scoring.falsePositiveMaskCount,
    recall: scoring.recall,
    precision: scoring.precision,
    redactedOutput: outputName,
    metadataArchive: metadataName,
    reviewImage: `review/${reviewName}`,
    elapsedSeconds: Number(((performance.now() - startedAt) / 1000).toFixed(2)),
  });
}

await detector.dispose();
if (rescueClassifier) await rescueClassifier.dispose();
report.summary = {
  fileCount: report.files.length,
  detectedMaskCount: report.files.reduce(
    (sum, file) => sum + file.filteredDetectionCount,
    0,
  ),
  cornerFitCount: report.files.reduce(
    (sum, file) => sum + file.cornerFitCount,
    0,
  ),
  rectangleFallbackCount: report.files.reduce(
    (sum, file) => sum + file.rectangleFallbackCount,
    0,
  ),
  groundTruthPointCount: report.files.reduce(
    (sum, file) => sum + file.groundTruthPointCount,
    0,
  ),
  coveredGroundTruthPointCount: report.files.reduce(
    (sum, file) => sum + file.coveredGroundTruthPointCount,
    0,
  ),
  truePositiveMaskCount: report.files.reduce(
    (sum, file) => sum + file.truePositiveMaskCount,
    0,
  ),
  falsePositiveMaskCount: report.files.reduce(
    (sum, file) => sum + file.falsePositiveMaskCount,
    0,
  ),
};
report.summary.recall = ratio(
  report.summary.coveredGroundTruthPointCount,
  report.summary.groundTruthPointCount,
);
report.summary.precision = ratio(
  report.summary.truePositiveMaskCount,
  report.summary.truePositiveMaskCount + report.summary.falsePositiveMaskCount,
);
report.summary.filesWithMisses = report.files.filter(
  (file) => file.missedGroundTruthPointIds.length > 0,
).length;
report.summary.filesWithFalsePositives = report.files.filter(
  (file) => file.falsePositiveMaskCount > 0,
).length;
await writeFile(
  resolve(runDirectory, "evaluation-report.json"),
  JSON.stringify(report, null, 2),
);
await createContactSheet(reviewTiles, resolve(runDirectory, "contact-sheet.jpg"));
await writeFile(resolve(outputRoot, "latest-run.txt"), `${runDirectory}\n`);

console.log(JSON.stringify(report.summary, null, 2));
console.log(`Evaluation report: ${resolve(runDirectory, "evaluation-report.json")}`);
console.log(`Contact sheet: ${resolve(runDirectory, "contact-sheet.jpg")}`);

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function localTimestamp(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    "-",
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
  ].join("");
}

function safeStem(name) {
  return basename(name, extname(name)).replaceAll(/[^a-zA-Z0-9._-]/g, "_");
}

function outputExtension(format) {
  return format === "jpeg" ? "jpg" : format;
}

function normalizeDetection(result, width, height, scaleX, scaleY, id) {
  const { xmin, ymin, xmax, ymax } = result.box;
  return {
    id,
    x: clamp(xmin * scaleX, 0, width),
    y: clamp(ymin * scaleY, 0, height),
    width: clamp((xmax - xmin) * scaleX, 1, width),
    height: clamp((ymax - ymin) * scaleY, 1, height),
    label: result.label,
    score: Number(result.score),
    source: "model",
  };
}

function bestColorCandidatePerRegion(candidates) {
  const best = new Map();
  for (const candidate of candidates) {
    if (candidate.regionIndex < 0) continue;
    const existing = best.get(candidate.regionIndex);
    if (!existing || candidate.score > existing.score) {
      best.set(candidate.regionIndex, candidate);
    }
  }
  return [...best.values()];
}

function assignCandidateRegions(candidates, regions) {
  return candidates.map((candidate) => {
    const center = boxCenter(candidate);
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < regions.length; index += 1) {
      const region = regions[index];
      if (!pointInBox(center, region)) continue;
      const regionCenter = boxCenter(region);
      const distance =
        Math.abs(center.x - regionCenter.x) / region.width +
        Math.abs(center.y - regionCenter.y) / region.height;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    const region = regions[bestIndex];
    return {
      ...candidate,
      regionIndex: bestIndex,
      regionRelativeX: region
        ? (center.x - region.x) / region.width
        : null,
      regionRelativeY: region
        ? (center.y - region.y) / region.height
        : null,
    };
  });
}

function refineHybridDetections(modelBoxes, colorBoxes) {
  const preciseModelBoxes = modelBoxes.filter((model) => {
    const modelArea = model.width * model.height;
    return !colorBoxes.some((color) => {
      const colorArea = color.width * color.height;
      const center = {
        x: color.x + color.width / 2,
        y: color.y + color.height / 2,
      };
      return modelArea > colorArea * 2.4 && pointInBox(center, model);
    });
  });
  const deduplicated = deduplicateBadgeDetections(
    [...preciseModelBoxes, ...colorBoxes],
    0.28,
  );
  const remaining = [...deduplicated].sort((a, b) => a.x - b.x);
  const merged = [];
  while (remaining.length) {
    let current = remaining.shift();
    let changed = true;
    while (changed) {
      changed = false;
      for (let index = remaining.length - 1; index >= 0; index -= 1) {
        const candidate = remaining[index];
        if (!shouldMergeCredentialBoxes(current, candidate)) continue;
        current = mergeBoxes(current, candidate);
        remaining.splice(index, 1);
        changed = true;
      }
    }
    merged.push(current);
  }
  return merged;
}

function shouldMergeCredentialBoxes(a, b) {
  const horizontalOverlap =
    Math.max(
      0,
      Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    ) / Math.min(a.width, b.width);
  const verticalGap = Math.max(
    0,
    Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height),
  );
  const contained = overlapFraction(a, b);
  return (
    contained >= 0.32 ||
    (horizontalOverlap >= 0.48 &&
      verticalGap <= Math.min(a.height, b.height) * 0.65)
  );
}

function mergeBoxes(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return {
    ...((a.score || 0) >= (b.score || 0) ? a : b),
    id: `merged-${a.id}-${b.id}`,
    x,
    y,
    width: right - x,
    height: bottom - y,
    label: "identification badge",
    score: Math.max(a.score || 0, b.score || 0),
    source: a.source === b.source ? a.source : "hybrid",
  };
}

function pointInBox(point, box) {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
}

function boxCenter(box) {
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}

function mergeGlobalWithTorsoRescues(globalBoxes, torsoBoxes) {
  const retainedGlobal = deduplicateBadgeDetections(globalBoxes, 0.32);
  const rescues = deduplicateBadgeDetections(torsoBoxes, 0.32).filter(
    (candidate) =>
      retainedGlobal.every((global) => {
        const intersection = intersectionArea(candidate, global);
        const smallerArea = Math.min(
          candidate.width * candidate.height,
          global.width * global.height,
        );
        const contained = smallerArea ? intersection / smallerArea : 0;
        return intersectionOverUnion(candidate, global) < 0.24 && contained < 0.5;
      }),
  );
  return [...retainedGlobal, ...rescues];
}

async function classifyTorsoCandidates({
  classifier,
  source,
  imageName,
  width,
  height,
  boxes,
  tileDirectory,
  marginThreshold,
}) {
  const retained = [];
  for (let index = 0; index < boxes.length; index += 1) {
    const box = boxes[index];
    const crop = paddedBoxCrop(box, width, height, 1.15);
    const cropPath = resolve(
      tileDirectory,
      `${safeStem(imageName)}-classifier-${index + 1}.jpg`,
    );
    await sharp(source)
      .rotate()
      .extract(crop)
      .resize({ width: 384, height: 384, fit: "cover" })
      .jpeg({ quality: 90 })
      .toFile(cropPath);
    const classifications = await classifier(cropPath, classifierLabels);
    const scores = Object.fromEntries(
      classifications.map(({ label, score }) => [label, Number(score)]),
    );
    const positiveScore = Math.max(
      scores[classifierLabels[0]],
      scores[classifierLabels[1]],
    );
    const negativeScore = Math.max(
      ...classifierLabels.slice(2).map((label) => scores[label]),
    );
    const margin = positiveScore - negativeScore;
    if (margin >= marginThreshold) {
      retained.push({
        ...box,
        classifierPositiveScore: positiveScore,
        classifierNegativeScore: negativeScore,
        classifierMargin: margin,
      });
    }
  }
  return retained;
}

function paddedBoxCrop(box, width, height, paddingFactor) {
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const cropWidth = Math.max(box.width * (1 + paddingFactor * 2), 96);
  const cropHeight = Math.max(box.height * (1 + paddingFactor * 2), 96);
  const left = Math.max(0, Math.floor(centerX - cropWidth / 2));
  const top = Math.max(0, Math.floor(centerY - cropHeight / 2));
  const right = Math.min(width, Math.ceil(centerX + cropWidth / 2));
  const bottom = Math.min(height, Math.ceil(centerY + cropHeight / 2));
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

async function detectGroundingDinoTorsoCrops({
  detector,
  source,
  imageName,
  width,
  height,
  globalPreviewPath,
  globalPreviewInfo,
  tileDirectory,
  badgePrompt,
  personThreshold,
  cropThreshold,
}) {
  const personOutput = await detector(globalPreviewPath, ["person."], {
    threshold: personThreshold,
    top_k: 30,
  });
  const previewPersons = personOutput
    .map((result, index) =>
      normalizeDetection(
        result,
        globalPreviewInfo.width,
        globalPreviewInfo.height,
        1,
        1,
        `torso-person-${index}`,
      ),
    )
    .filter((box) => {
      const areaRatio =
        (box.width * box.height) /
        (globalPreviewInfo.width * globalPreviewInfo.height);
      const aspect = box.width / box.height;
      return (
        box.label === "person" &&
        areaRatio >= 0.0025 &&
        areaRatio <= 0.82 &&
        aspect >= 0.14 &&
        aspect <= 1.45
      );
    });
  const persons = genericNms(previewPersons, 0.52).slice(0, 24);
  const personScaleX = width / globalPreviewInfo.width;
  const personScaleY = height / globalPreviewInfo.height;
  const cropRegions = deduplicateRegions(
    persons.map((person) => {
      const fullPerson = {
        x: person.x * personScaleX,
        y: person.y * personScaleY,
        width: person.width * personScaleX,
        height: person.height * personScaleY,
      };
      return boundedCrop(
        {
          left: fullPerson.x - fullPerson.width * 0.12,
          top: fullPerson.y + fullPerson.height * 0.08,
          width: fullPerson.width * 1.24,
          height: fullPerson.height * 0.62,
        },
        width,
        height,
      );
    }),
  );
  const collected = [];
  const personRegions = [];
  let rawDetectionCount = personOutput.length;

  for (let index = 0; index < cropRegions.length; index += 1) {
    const crop = cropRegions[index];
    if (crop.width < 48 || crop.height < 64) continue;
    personRegions.push({
      x: crop.left,
      y: crop.top,
      width: crop.width,
      height: crop.height,
    });
    const cropBuffer = await sharp(source)
      .rotate()
      .extract(crop)
      .resize({
        width: 1200,
        height: 1200,
        fit: "inside",
      })
      .jpeg({ quality: 88 })
      .toBuffer();
    const cropPath = resolve(
      tileDirectory,
      `${safeStem(imageName)}-torso-${index + 1}.jpg`,
    );
    await writeFile(cropPath, cropBuffer);
    const cropInfo = await sharp(cropBuffer).metadata();
    const output = await detector(cropPath, badgePrompt, {
      threshold: cropThreshold,
      top_k: 30,
    });
    rawDetectionCount += output.length;
    const filtered = filterBadgeDetections(
      output.map((result, resultIndex) =>
        normalizeDetection(
          result,
          cropInfo.width,
          cropInfo.height,
          1,
          1,
          `torso-${index}-${resultIndex}`,
        ),
      ),
      cropInfo,
    )
      .filter((box) => {
        const aspect = box.width / box.height;
        const areaRatio =
          (box.width * box.height) / (cropInfo.width * cropInfo.height);
        const centerX = (box.x + box.width / 2) / cropInfo.width;
        const centerY = (box.y + box.height / 2) / cropInfo.height;
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
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 1);
    const scaleX = crop.width / cropInfo.width;
    const scaleY = crop.height / cropInfo.height;
    for (const box of filtered) {
      collected.push({
        ...box,
        id: `torso-${index}-${box.id}`,
        x: crop.left + box.x * scaleX,
        y: crop.top + box.y * scaleY,
        width: box.width * scaleX,
        height: box.height * scaleY,
        regionRelativeX: (box.x + box.width / 2) / cropInfo.width,
        regionRelativeY: (box.y + box.height / 2) / cropInfo.height,
        detectionPass: `torso-${index + 1}`,
      });
    }
  }

  return {
    boxes: deduplicateBadgeDetections(collected, 0.32),
    rawDetectionCount,
    passCount: cropRegions.length + 1,
    personCount: persons.length,
    faceCount: 0,
    personRegions,
    contextRegion: unionRegion(cropRegions),
  };
}

async function detectPersonCrops({
  detector,
  source,
  imageName,
  width,
  height,
  globalPreviewPath,
  globalPreviewInfo,
  tileDirectory,
}) {
  const personOutput = await detector(globalPreviewPath, ["person"], {
    threshold: 0.08,
    top_k: 40,
  });
  const faceOutput = await detector(
    globalPreviewPath,
    ["human face", "wall sign", "equipment label"],
    {
      threshold: 0.07,
      top_k: 60,
    },
  );
  const previewPersons = personOutput
    .map((result, index) =>
      normalizeDetection(
        result,
        globalPreviewInfo.width,
        globalPreviewInfo.height,
        1,
        1,
        `person-${index}`,
      ),
    )
    .filter((box) => {
      const areaRatio =
        (box.width * box.height) /
        (globalPreviewInfo.width * globalPreviewInfo.height);
      const aspect = box.width / box.height;
      return areaRatio >= 0.008 && areaRatio <= 0.75 && aspect >= 0.16 && aspect <= 1.35;
    });
  const persons = genericNms(previewPersons, 0.55).slice(0, 24);
  const previewFaces = faceOutput
    .filter((result) => result.label === "human face")
    .map((result, index) =>
      normalizeDetection(
        result,
        globalPreviewInfo.width,
        globalPreviewInfo.height,
        1,
        1,
        `face-${index}`,
      ),
    )
    .filter((box) => {
      const areaRatio =
        (box.width * box.height) /
        (globalPreviewInfo.width * globalPreviewInfo.height);
      const aspect = box.width / box.height;
      return areaRatio >= 0.00018 && areaRatio <= 0.09 && aspect >= 0.52 && aspect <= 1.65;
    });
  const faces = genericNms(previewFaces, 0.38).slice(0, 30);
  const positiveLabels = [
    ...DEFAULT_LABELS,
    "lanyard identification card",
    "plastic photo ID card",
    "hanging security credential",
  ];
  const positiveSet = new Set(positiveLabels);
  const negativeLabels = [
    "face",
    "shirt pocket",
    "clothing logo",
    "shoulder patch",
    "wall sign",
    "equipment label",
    "sheet of paper",
    "document",
    "hazard sign",
    "warning placard",
  ];
  const collected = [];
  const personRegions = [];
  let rawDetectionCount = personOutput.length + faceOutput.length;
  const personScaleX = width / globalPreviewInfo.width;
  const personScaleY = height / globalPreviewInfo.height;
  const faceRegions = faces.map((face) => {
    const fullFace = {
      x: face.x * personScaleX,
      y: face.y * personScaleY,
      width: face.width * personScaleX,
      height: face.height * personScaleY,
    };
    return boundedCrop(
      {
        left: fullFace.x - fullFace.width * 1.75,
        top: fullFace.y + fullFace.height * 0.5,
        width: fullFace.width * 4.5,
        height: fullFace.height * 5.4,
      },
      width,
      height,
    );
  });
  const personCropRegions = persons.map((person) => {
    const fullPerson = {
      x: person.x * personScaleX,
      y: person.y * personScaleY,
      width: person.width * personScaleX,
      height: person.height * personScaleY,
    };
    return boundedCrop(
      {
        left: fullPerson.x - fullPerson.width * 0.18,
        top: fullPerson.y + fullPerson.height * 0.1,
        width: fullPerson.width * 1.36,
        height: fullPerson.height * 0.68,
      },
      width,
      height,
    );
  });
  const cropRegions = deduplicateRegions([
    ...personCropRegions,
    ...faceRegions,
  ]);
  const contextRegion = unionRegion(
    personCropRegions.filter(
      (region) => region.top + region.height / 2 <= height * 0.74,
    ),
  );

  for (let index = 0; index < cropRegions.length; index += 1) {
    const crop = cropRegions[index];
    if (crop.width < 80 || crop.height < 80) continue;
    personRegions.push({
      x: crop.left,
      y: crop.top,
      width: crop.width,
      height: crop.height,
    });
    const cropBuffer = await sharp(source)
      .rotate()
      .extract(crop)
      .resize({
        width: 1200,
        height: 1200,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 86 })
      .toBuffer();
    const cropPath = resolve(
      tileDirectory,
      `${safeStem(imageName)}-person-${index + 1}.jpg`,
    );
    await writeFile(cropPath, cropBuffer);
    const cropInfo = await sharp(cropBuffer).metadata();
    const output = await detector(
      cropPath,
      [...positiveLabels, ...negativeLabels],
      {
        threshold: 0.08,
        top_k: 80,
      },
    );
    rawDetectionCount += output.length;
    const all = output.map((result, resultIndex) =>
      normalizeDetection(
        result,
        cropInfo.width,
        cropInfo.height,
        1,
        1,
        `person-${index}-${resultIndex}`,
      ),
    );
    const negatives = all.filter((box) => !positiveSet.has(box.label));
    const positives = all.filter((box) => positiveSet.has(box.label));
    const classified = positives.filter(
      (box) =>
        !negatives.some(
          (negative) =>
            overlapFraction(box, negative) >= 0.45 &&
            negative.score >= box.score * 0.82,
        ),
    );
    const filtered = filterBadgeDetections(classified, cropInfo);
    const scaleX = crop.width / cropInfo.width;
    const scaleY = crop.height / cropInfo.height;
    for (const box of filtered) {
      collected.push({
        ...box,
        id: `person-${index}-${box.id}`,
        x: crop.left + box.x * scaleX,
        y: crop.top + box.y * scaleY,
        width: box.width * scaleX,
        height: box.height * scaleY,
        regionRelativeX: (box.x + box.width / 2) / cropInfo.width,
        regionRelativeY: (box.y + box.height / 2) / cropInfo.height,
        detectionPass: `person-${index + 1}`,
      });
    }
  }
  return {
    boxes: deduplicateBadgeDetections(collected, 0.32),
    rawDetectionCount,
    passCount: cropRegions.length + 2,
    personCount: persons.length,
    faceCount: faces.length,
    personRegions,
    contextRegion,
  };
}

async function detectTiles({
  detector,
  source,
  imageName,
  width,
  height,
  tileDirectory,
  threshold,
}) {
  const tiles = gridTiles(width, height, 3, 2, 0.18);
  const collected = [];
  let rawDetectionCount = 0;
  for (let index = 0; index < tiles.length; index += 1) {
    const tile = tiles[index];
    const tileBuffer = await sharp(source)
      .rotate()
      .extract(tile)
      .resize({
        width: 1200,
        height: 1200,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 84 })
      .toBuffer();
    const tilePath = resolve(
      tileDirectory,
      `${safeStem(imageName)}-tile-${index + 1}.jpg`,
    );
    await writeFile(tilePath, tileBuffer);
    const tileInfo = await sharp(tileBuffer).metadata();
    const output = await detector(tilePath, DEFAULT_LABELS, {
      threshold,
      top_k: 40,
    });
    rawDetectionCount += output.length;
    const tileCandidates = output.map((result, resultIndex) =>
      normalizeDetection(
        result,
        tileInfo.width,
        tileInfo.height,
        1,
        1,
        `tile-${index}-${resultIndex}`,
      ),
    );
    const filtered = filterBadgeDetections(tileCandidates, tileInfo);
    const scaleX = tile.width / tileInfo.width;
    const scaleY = tile.height / tileInfo.height;
    for (const box of filtered) {
      collected.push({
        ...box,
        id: `tile-${index}-${box.id}`,
        x: tile.left + box.x * scaleX,
        y: tile.top + box.y * scaleY,
        width: box.width * scaleX,
        height: box.height * scaleY,
        detectionPass: `tile-${index + 1}`,
      });
    }
  }
  return {
    boxes: deduplicateBadgeDetections(collected, 0.32),
    rawDetectionCount,
    passCount: tiles.length,
    personRegions: [],
  };
}

function boundedCrop(input, imageWidth, imageHeight) {
  const left = Math.max(0, Math.round(input.left));
  const top = Math.max(0, Math.round(input.top));
  const right = Math.min(imageWidth, Math.round(input.left + input.width));
  const bottom = Math.min(imageHeight, Math.round(input.top + input.height));
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

function deduplicateRegions(regions) {
  const boxes = regions.map((region, index) => ({
    ...region,
    x: region.left,
    y: region.top,
    id: `region-${index}`,
    score: 1,
  }));
  return genericNms(boxes, 0.58).map(({ left, top, width, height }) => ({
    left,
    top,
    width,
    height,
  }));
}

function unionRegion(regions) {
  if (regions.length === 0) return null;
  const left = Math.min(...regions.map((region) => region.left));
  const top = Math.min(...regions.map((region) => region.top));
  const right = Math.max(
    ...regions.map((region) => region.left + region.width),
  );
  const bottom = Math.max(
    ...regions.map((region) => region.top + region.height),
  );
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function genericNms(boxes, threshold) {
  const kept = [];
  for (const candidate of [...boxes].sort((a, b) => b.score - a.score)) {
    if (
      kept.every((box) => {
        const intersection = intersectionArea(box, candidate);
        const smallerArea = Math.min(
          box.width * box.height,
          candidate.width * candidate.height,
        );
        const contained = smallerArea ? intersection / smallerArea : 0;
        return (
          intersectionOverUnion(box, candidate) < threshold &&
          contained < 0.72
        );
      })
    ) {
      kept.push(candidate);
    }
  }
  return kept;
}

function overlapFraction(a, b) {
  const intersection = intersectionArea(a, b);
  const smallerArea = Math.min(a.width * a.height, b.width * b.height);
  return smallerArea ? intersection / smallerArea : 0;
}

function intersectionArea(a, b) {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function intersectionOverUnion(a, b) {
  const intersection = intersectionArea(a, b);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union ? intersection / union : 0;
}

function gridTiles(width, height, columns, rows, overlap) {
  const tileWidth = Math.round(
    width / (columns - overlap * (columns - 1)),
  );
  const tileHeight = Math.round(height / (rows - overlap * (rows - 1)));
  const xStep = columns === 1 ? 0 : (width - tileWidth) / (columns - 1);
  const yStep = rows === 1 ? 0 : (height - tileHeight) / (rows - 1);
  const tiles = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const left = Math.round(column * xStep);
      const top = Math.round(row * yStep);
      tiles.push({
        left,
        top,
        width: Math.min(tileWidth, width - left),
        height: Math.min(tileHeight, height - top),
      });
    }
  }
  return tiles;
}

function rectanglePoints(box) {
  return [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ];
}

function serializeMask(mask) {
  return {
    x: Math.round(mask.x),
    y: Math.round(mask.y),
    width: Math.round(mask.width),
    height: Math.round(mask.height),
    label: mask.label,
    score: mask.score,
    detectionPass: mask.detectionPass || "global",
    regionRelativeX: mask.regionRelativeX ?? null,
    regionRelativeY: mask.regionRelativeY ?? null,
    points: mask.points.map((point) => ({
      x: Math.round(point.x),
      y: Math.round(point.y),
    })),
    autoFitted: mask.autoFitted,
    fitConfidence: mask.fitConfidence,
    fitReason: mask.fitReason,
  };
}

function overlaySvg(
  width,
  height,
  masks,
  scaleX,
  scaleY,
  expectedPoints,
  coveredPointIds,
) {
  const line = Math.max(3, Math.round(Math.max(width, height) / 400));
  const font = Math.max(16, Math.round(Math.max(width, height) / 55));
  const shapes = masks
    .map((mask, index) => {
      const points = mask.points
        .map((point) => `${point.x / scaleX},${point.y / scaleY}`)
        .join(" ");
      const x = mask.x / scaleX;
      const y = Math.max(font, mask.y / scaleY - 6);
      return `
        <polygon points="${points}" fill="#00e89d22" stroke="#00e89d" stroke-width="${line}"/>
        <text x="${x}" y="${y}" fill="#ffffff" stroke="#000000" stroke-width="3"
          paint-order="stroke" font-family="Arial, sans-serif" font-size="${font}"
          font-weight="700">${index + 1} · ${Math.round(mask.score * 100)}%</text>`;
    })
    .join("");
  const groundTruthShapes = expectedPoints
    .map((point) => {
      const covered = coveredPointIds.has(point.id);
      const color = covered ? "#22c55e" : "#ef4444";
      return `<circle cx="${point.x / scaleX}" cy="${point.y / scaleY}" r="${line * 2.8}"
        fill="none" stroke="${color}" stroke-width="${line}" />`;
    })
    .join("");
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${shapes}${groundTruthShapes}</svg>`,
  );
}

function scoreMasks(masks, expectedPoints) {
  const coveredPointIds = new Set(
    expectedPoints
      .filter((point) =>
        masks.some((mask) => pointInPolygon(point, mask.points)),
      )
      .map((point) => point.id),
  );
  const matchedMasks = masks.filter((mask) =>
    expectedPoints.some((point) => pointInPolygon(point, mask.points)),
  );
  return {
    coveredPointIds,
    missedPointIds: expectedPoints
      .filter((point) => !coveredPointIds.has(point.id))
      .map((point) => point.id),
    truePositiveMaskCount: matchedMasks.length,
    falsePositiveMaskCount: masks.length - matchedMasks.length,
    recall: ratio(coveredPointIds.size, expectedPoints.length),
    precision: ratio(matchedMasks.length, masks.length),
  };
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (
    let current = 0, previous = polygon.length - 1;
    current < polygon.length;
    previous = current++
  ) {
    const a = polygon[current];
    const b = polygon[previous];
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x <
        ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || Number.EPSILON) +
          a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function ratio(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(4)) : 1;
}

async function sideBySideReview(original, redacted, imageName, maskCount) {
  const left = await sharp(original).metadata();
  const labelHeight = 54;
  const width = left.width * 2;
  const height = left.height + labelHeight;
  const label = Buffer.from(`
    <svg width="${width}" height="${labelHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#111827"/>
      <text x="18" y="35" fill="#ffffff" font-family="Arial, sans-serif"
        font-size="24" font-weight="700">${escapeXml(imageName)} · ${maskCount} mask${maskCount === 1 ? "" : "s"}</text>
      <text x="${left.width + 18}" y="35" fill="#ffffff" font-family="Arial, sans-serif"
        font-size="24" font-weight="700">Redacted output</text>
    </svg>`);
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: "#111827",
    },
  })
    .composite([
      { input: label, top: 0, left: 0 },
      { input: original, top: labelHeight, left: 0 },
      { input: redacted, top: labelHeight, left: left.width },
    ])
    .jpeg({ quality: 88 })
    .toBuffer();
}

async function createContactSheet(paths, outputPath) {
  const tileWidth = 760;
  const tileHeight = 310;
  const gap = 16;
  const columns = 2;
  const rows = Math.ceil(paths.length / columns);
  const composites = [];
  for (let index = 0; index < paths.length; index += 1) {
    const tile = await sharp(paths[index])
      .resize(tileWidth, tileHeight, {
        fit: "contain",
        background: "#111827",
      })
      .jpeg({ quality: 82 })
      .toBuffer();
    composites.push({
      input: tile,
      left: (index % columns) * (tileWidth + gap),
      top: Math.floor(index / columns) * (tileHeight + gap),
    });
  }
  await sharp({
    create: {
      width: columns * tileWidth + (columns - 1) * gap,
      height: rows * tileHeight + (rows - 1) * gap,
      channels: 3,
      background: "#0b1220",
    },
  })
    .composite(composites)
    .jpeg({ quality: 86 })
    .toFile(outputPath);
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}
