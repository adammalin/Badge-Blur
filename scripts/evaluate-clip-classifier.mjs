import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { env, pipeline } from "@huggingface/transformers";
import sharp from "sharp";

const reportPath = resolve(process.argv[2] || "");
if (!process.argv[2]) {
  throw new Error("Pass an evaluation-report.json path.");
}
const projectRoot = resolve(import.meta.dirname, "..");
const report = JSON.parse(await readFile(reportPath, "utf8"));
const groundTruth = JSON.parse(
  await readFile(resolve(projectRoot, "test-data/badge-ground-truth.json"), "utf8"),
);
const outputDirectory = resolve(report.outputDirectory, "clip-candidates");
await mkdir(outputDirectory, { recursive: true });

env.localModelPath = `${resolve(projectRoot, ".cache/model-candidates")}/`;
env.allowRemoteModels = false;
env.allowLocalModels = true;

const modelId = "Xenova/clip-vit-base-patch32";
console.log(`Loading local classifier ${modelId}`);
const classifier = await pipeline("zero-shot-image-classification", modelId, {
  dtype: "q8",
  device: "cpu",
});
const labels = [
  "an employee identification badge hanging from a lanyard",
  "a plastic photo ID card or conference name badge",
  "a shirt logo or printed clothing",
  "a pocket, button, zipper, or clothing detail",
  "a wall sign, sheet of paper, or equipment label",
];
const results = [];

for (const file of report.files) {
  const sourcePath = resolve(report.inputDirectory, file.imageName);
  const source = await readFile(sourcePath);
  const expectedPoints = (groundTruth.images[file.imageName] || []).map(
    ([x, y]) => ({ x: x * file.width, y: y * file.height }),
  );
  const torsoMasks = file.masks.filter(
    (mask) => mask.detectionPass && mask.detectionPass !== "global",
  );
  for (let index = 0; index < torsoMasks.length; index += 1) {
    const mask = torsoMasks[index];
    const crop = paddedCrop(mask, file.width, file.height, 1.15);
    const cropPath = resolve(
      outputDirectory,
      `${safeStem(file.imageName)}-${index + 1}.jpg`,
    );
    await sharp(source)
      .rotate()
      .extract(crop)
      .resize({ width: 384, height: 384, fit: "cover" })
      .jpeg({ quality: 90 })
      .toFile(cropPath);
    const classifications = await classifier(cropPath, labels);
    const scores = Object.fromEntries(
      classifications.map(({ label, score }) => [label, Number(score)]),
    );
    const positiveScore = Math.max(scores[labels[0]], scores[labels[1]]);
    const negativeScore = Math.max(...labels.slice(2).map((label) => scores[label]));
    results.push({
      imageName: file.imageName,
      mask,
      cropPath,
      positiveScore,
      negativeScore,
      margin: positiveScore - negativeScore,
      matchesGroundTruth: expectedPoints.some((point) => pointInBox(point, mask)),
      classifications,
    });
    console.log(
      `${file.imageName} ${index + 1}/${torsoMasks.length} ` +
        `badge=${positiveScore.toFixed(3)} negative=${negativeScore.toFixed(3)}`,
    );
  }
}

for (const threshold of [-0.2, -0.1, 0, 0.05, 0.1, 0.15, 0.2, 0.25]) {
  const retained = results.filter((result) => result.margin >= threshold);
  console.log({
    threshold,
    retained: retained.length,
    truePositive: retained.filter((result) => result.matchesGroundTruth).length,
    falsePositive: retained.filter((result) => !result.matchesGroundTruth).length,
  });
}

await writeFile(
  resolve(outputDirectory, "clip-classifier-report.json"),
  JSON.stringify({ modelId, labels, results }, null, 2),
);
await classifier.dispose();

function paddedCrop(mask, width, height, paddingFactor) {
  const centerX = mask.x + mask.width / 2;
  const centerY = mask.y + mask.height / 2;
  const cropWidth = Math.max(mask.width * (1 + paddingFactor * 2), 96);
  const cropHeight = Math.max(mask.height * (1 + paddingFactor * 2), 96);
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

function pointInBox(point, box) {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
}

function safeStem(name) {
  return name.replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "-");
}
