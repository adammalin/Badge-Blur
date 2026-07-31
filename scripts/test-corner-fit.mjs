import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { fitMaskCorners } from "./image-runtime.mjs";

const frozenDetections = JSON.parse(
  await readFile(resolve("test-fixtures/corner-fit-boxes.json"), "utf8"),
);

let detected = 0;
let fitted = 0;
let fallback = 0;
const files = [];
const resultsByImage = new Map();

for (const entry of frozenDetections) {
  const source = await readFile(resolve("demo-test-images", entry.imageName));
  const result = await fitMaskCorners(source, entry.imageName, {
    boxes: entry.boxes,
    paddingPercent: 18,
  });
  const refined = result.masks.filter((mask) => mask.refined).length;
  resultsByImage.set(entry.imageName, result.masks);
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

if (detected !== 11 || fitted !== 11 || fallback !== 0) {
  throw new Error(
    `Corner-fit regression: expected 11 detections, 11 fits, and 0 fallbacks; ` +
      `received ${detected}, ${fitted}, and ${fallback}.`,
  );
}

const portraitFit = resultsByImage.get("01-single-frontal-badge.png")?.[0];
if (
  !portraitFit?.refined ||
  portraitFit.points[2].y < 1105 ||
  portraitFit.points[3].y < 1105 ||
  Math.abs(portraitFit.points[2].y - portraitFit.points[3].y) > 4
) {
  throw new Error(
    "Corner-fit regression: the portrait badge bottom followed an internal graphic instead of the outer card edge.",
  );
}

const lowContrastLandscapeFit = resultsByImage.get(
  "04-outdoor-glare-motion-badge.png",
)?.[0];
const landscapeTopAngle = lowContrastLandscapeFit
  ? Math.atan2(
      lowContrastLandscapeFit.points[1].y -
        lowContrastLandscapeFit.points[0].y,
      lowContrastLandscapeFit.points[1].x -
        lowContrastLandscapeFit.points[0].x,
    )
  : 0;
if (
  !lowContrastLandscapeFit?.refined ||
  !/enhanced analysis/.test(lowContrastLandscapeFit.reason) ||
  landscapeTopAngle < 0.5
) {
  throw new Error(
    "Corner-fit regression: the low-contrast landscape badge did not receive the rotated enhanced-analysis fit.",
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
      portraitOuterBottomFit: true,
      lowContrastLandscapeFit: true,
      files,
    },
    null,
    2,
  ),
);
