import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fitMaskCorners } from "./image-runtime.mjs";

const report = JSON.parse(
  await readFile(resolve("benchmark-output/benchmark-report.json"), "utf8"),
);
const model = report.models.find(
  (entry) => entry.modelId === "Xenova/owlv2-base-patch16-ensemble",
);
if (!model) throw new Error("OWLv2 benchmark results are missing.");

let detected = 0;
let fitted = 0;
let fallback = 0;
const files = [];

for (const entry of model.files) {
  const source = await readFile(resolve("demo-test-images", entry.imageName));
  const result = await fitMaskCorners(source, entry.imageName, {
    boxes: entry.boxes,
    paddingPercent: 18,
  });
  const refined = result.masks.filter((mask) => mask.refined).length;
  detected += result.masks.length;
  fitted += refined;
  fallback += result.masks.length - refined;
  files.push({
    imageName: entry.imageName,
    detected: result.masks.length,
    fitted: refined,
    fallback: result.masks.length - refined,
  });
}

if (detected !== 11 || fitted !== 10 || fallback !== 1) {
  throw new Error(
    `Corner-fit regression: expected 11 detections, 10 fits, and 1 fallback; ` +
      `received ${detected}, ${fitted}, and ${fallback}.`,
  );
}

console.log(JSON.stringify({ detected, fitted, fallback, files }, null, 2));
