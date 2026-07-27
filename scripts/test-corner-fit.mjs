import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
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

const chromaticSource = await sharp({
  create: {
    width: 300,
    height: 220,
    channels: 3,
    background: { r: 0, g: 100, b: 0 },
  },
})
  .composite([
    {
      input: Buffer.from(
        '<svg width="300" height="220"><rect x="100" y="80" width="100" height="70" fill="rgb(196,0,0)"/></svg>',
      ),
    },
  ])
  .png()
  .toBuffer();
const chromaticFit = await fitMaskCorners(
  chromaticSource,
  "equal-luminance-color-edge.png",
  {
    boxes: [{ x: 88, y: 68, width: 124, height: 94 }],
    paddingPercent: 18,
  },
);
if (!chromaticFit.masks[0]?.refined) {
  throw new Error(
    `Corner-fit regression: chromatic badge edge was not refined: ${chromaticFit.masks[0]?.reason}`,
  );
}
const expectedChromaticCorners = [
  { x: 100, y: 80 },
  { x: 200, y: 80 },
  { x: 200, y: 150 },
  { x: 100, y: 150 },
];
const chromaticCornerError = Math.max(
  ...chromaticFit.masks[0].points.map((point, index) =>
    Math.hypot(
      point.x - expectedChromaticCorners[index].x,
      point.y - expectedChromaticCorners[index].y,
    ),
  ),
);
if (chromaticCornerError > 3) {
  throw new Error(
    `Corner-fit regression: chromatic badge corners missed by ${chromaticCornerError.toFixed(2)}px.`,
  );
}

console.log(
  JSON.stringify(
    {
      detected,
      fitted,
      fallback,
      chromaticEdgeFit: true,
      chromaticCornerError: Number(chromaticCornerError.toFixed(2)),
      files,
    },
    null,
    2,
  ),
);
