import { mkdir, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { env, pipeline } from "@huggingface/transformers";
import sharp from "sharp";

const models = [
  {
    modelId: "Xenova/owlvit-base-patch32",
    modelRoot: ".cache/model-baselines",
    labels: [
      "plastic ID card",
      "photo identification card",
      "rectangular badge holder",
      "security badge",
      "employee ID badge",
      "conference badge",
      "name tag",
    ],
    threshold: 0.02,
    minAreaRatio: 0.00025,
    maxAreaRatio: 0.03,
    minAspectRatio: 0.36,
    restrictTallBoxes: false,
  },
  {
    modelId: "Xenova/owlv2-base-patch16-ensemble",
    modelRoot: ".cache/model-baselines",
    labels: ["ID badge", "employee badge", "conference badge"],
    threshold: 0.15,
    minAreaRatio: 0.0015,
    maxAreaRatio: 0.05,
    minAspectRatio: 0.45,
    restrictTallBoxes: true,
  },
  {
    modelId: "onnx-community/grounding-dino-tiny-ONNX",
    modelRoot: "public/models",
    labels: [
      "identification badge. employee ID card. conference badge. security credential. name tag.",
    ],
    threshold: 0.2,
    minAreaRatio: 0.00008,
    maxAreaRatio: 0.04,
    minAspectRatio: 0.25,
    maxAspectRatio: 2.2,
    minCenterY: 0.18,
    maxCenterX: 0.94,
    restrictTallBoxes: true,
  },
];
const testDirectory = resolve("demo-test-images");
const outputRoot = resolve("benchmark-output");
const imageNames = (await readdir(testDirectory))
  .filter((name) => name.endsWith(".png"))
  .sort();

env.allowRemoteModels = false;
env.allowLocalModels = true;

await mkdir(outputRoot, { recursive: true });
const report = {
  generatedAt: new Date().toISOString(),
  models: [],
};

for (const modelConfig of models) {
  const { modelId, labels, threshold } = modelConfig;
  env.localModelPath = `${resolve(modelConfig.modelRoot)}/`;
  console.log(`Loading ${modelId}`);
  const detector = await pipeline("zero-shot-object-detection", modelId, {
    dtype: "q8",
    device: "cpu",
  });
  const modelDirectory = resolve(outputRoot, modelId.split("/").at(-1));
  await mkdir(modelDirectory, { recursive: true });
  const modelReport = { ...modelConfig, files: [] };

  for (const imageName of imageNames) {
    const inputPath = resolve(testDirectory, imageName);
    const metadata = await sharp(inputPath).metadata();
    const output = await detector(inputPath, labels, {
      threshold,
      top_k: 40,
    });
    const candidates = output
      .map(normalizeDetection)
      .filter((box) =>
        isPlausibleBadgeBox(box, metadata.width, metadata.height, modelConfig),
      );
    const boxes = nonMaximumSuppression(
      removeLikelyLanyardExtensions(
        removeLowConfidenceContainers(candidates),
      ),
      0.32,
    );
    const overlay = createOverlay(metadata.width, metadata.height, boxes);
    await sharp(inputPath)
      .composite([{ input: Buffer.from(overlay), top: 0, left: 0 }])
      .png()
      .toFile(resolve(modelDirectory, imageName));
    modelReport.files.push({
      imageName,
      width: metadata.width,
      height: metadata.height,
      rawDetectionCount: output.length,
      filteredDetectionCount: boxes.length,
      boxes,
    });
    console.log(`${modelId} · ${imageName} · ${boxes.length} boxes`);
  }

  report.models.push(modelReport);
  await detector.dispose();
}

await writeFile(
  resolve(outputRoot, "benchmark-report.json"),
  JSON.stringify(report, null, 2),
);
console.log(`Report: ${resolve(outputRoot, "benchmark-report.json")}`);

function normalizeDetection(result) {
  const { xmin, ymin, xmax, ymax } = result.box;
  return {
    x: xmin,
    y: ymin,
    width: xmax - xmin,
    height: ymax - ymin,
    label: result.label,
    score: Number(result.score),
  };
}

function isPlausibleBadgeBox(box, width, height, modelConfig) {
  const area = box.width * box.height;
  const areaRatio = area / (width * height);
  const aspectRatio = box.width / box.height;
  const heightRatio = box.height / height;
  const centerX = (box.x + box.width / 2) / width;
  const centerY = (box.y + box.height / 2) / height;
  return (
    box.width > 8 &&
    box.height > 8 &&
    area > 150 &&
    areaRatio >= modelConfig.minAreaRatio &&
    areaRatio <= modelConfig.maxAreaRatio &&
    aspectRatio >= modelConfig.minAspectRatio &&
    aspectRatio <= (modelConfig.maxAspectRatio ?? 1.4) &&
    (!modelConfig.restrictTallBoxes ||
      heightRatio <= (modelConfig.maxHeightRatio ?? 0.25) ||
      aspectRatio >= (modelConfig.wideBoxRatio ?? 0.75)) &&
    centerX >= 0.06 &&
    centerX <= (modelConfig.maxCenterX ?? 0.9) &&
    centerY >= (modelConfig.minCenterY ?? 0.28) &&
    centerY <= 0.92
  );
}

function removeLowConfidenceContainers(boxes) {
  return boxes.filter((candidate) => {
    const candidateArea = candidate.width * candidate.height;
    return !boxes.some((other) => {
      if (other === candidate || other.score < candidate.score) return false;
      const otherArea = other.width * other.height;
      if (otherArea >= candidateArea * 0.55) return false;
      return intersectionArea(candidate, other) / otherArea >= 0.75;
    });
  });
}

function removeLikelyLanyardExtensions(boxes) {
  return boxes.filter((candidate) => {
    return !boxes.some((other) => {
      if (other === candidate || other.score < candidate.score) return false;
      const candidateBottom = candidate.y + candidate.height;
      const verticalGap = other.y - candidateBottom;
      const horizontalOverlap =
        Math.max(
          0,
          Math.min(candidate.x + candidate.width, other.x + other.width) -
            Math.max(candidate.x, other.x),
        ) / Math.min(candidate.width, other.width);
      return (
        candidate.y < other.y &&
        verticalGap >= -other.height * 0.15 &&
        verticalGap <= candidate.height * 0.35 &&
        horizontalOverlap >= 0.72 &&
        candidate.height >= other.height * 1.45 &&
        candidate.width <= other.width * 1.45
      );
    });
  });
}

function nonMaximumSuppression(boxes, thresholdValue) {
  const sorted = [...boxes].sort((a, b) => b.score - a.score);
  const kept = [];
  for (const candidate of sorted) {
    if (
      kept.every((box) => {
        const intersection = intersectionArea(box, candidate);
        const smallerArea = Math.min(
          box.width * box.height,
          candidate.width * candidate.height,
        );
        const containedOverlap = smallerArea ? intersection / smallerArea : 0;
        return (
          intersectionOverUnion(box, candidate) < thresholdValue &&
          containedOverlap < 0.5
        );
      })
    ) {
      kept.push(candidate);
    }
  }
  return kept;
}

function intersectionOverUnion(a, b) {
  const intersection = intersectionArea(a, b);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union ? intersection / union : 0;
}

function intersectionArea(a, b) {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function createOverlay(width, height, boxes) {
  const scale = Math.max(width, height) / 1200;
  const strokeWidth = Math.max(3, 4 * scale);
  const rectangles = boxes
    .map(
      (box, index) => `
        <rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}"
          fill="rgba(229,57,53,0.12)" stroke="#e53935" stroke-width="${strokeWidth}" />
        <text x="${box.x + 6}" y="${Math.max(24, box.y - 8)}"
          fill="#ffffff" stroke="#000000" stroke-width="${Math.max(1, scale)}"
          paint-order="stroke" font-size="${Math.max(18, 22 * scale)}"
          font-family="Arial, sans-serif">${index + 1}: ${escapeXml(box.label)}
          ${Math.round(box.score * 100)}%</text>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    ${rectangles}
  </svg>`;
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
