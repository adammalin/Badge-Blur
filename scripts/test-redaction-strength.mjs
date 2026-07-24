import assert from "node:assert/strict";
import sharp from "sharp";
import { redactImage } from "./image-runtime.mjs";

const width = 960;
const height = 640;
const mask = {
  points: [
    { x: 280, y: 170 },
    { x: 700, y: 190 },
    { x: 680, y: 500 },
    { x: 260, y: 480 },
  ],
};

const source = await sharp({
  create: {
    width,
    height,
    channels: 3,
    background: "#e8eee9",
  },
})
  .composite([
    {
      input: Buffer.from(`
        <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
          <rect x="240" y="140" width="500" height="390" rx="18" fill="#ffffff" stroke="#111111" stroke-width="8"/>
          <rect x="240" y="140" width="500" height="105" rx="18" fill="#007833"/>
          <g fill="#111111" font-family="Arial" text-anchor="middle">
            <text x="490" y="325" font-size="64" font-weight="700">JANE DOE</text>
            <text x="490" y="390" font-size="34">ID 123456789</text>
            <text x="490" y="445" font-size="28">VISITOR</text>
          </g>
          <path d="M0 40 H960 M0 600 H960" stroke="#355e4b" stroke-width="12"/>
        </svg>
      `),
    },
  ])
  .png()
  .toBuffer();

const result = await redactImage(source, "synthetic-badge.png", {
  masks: [mask],
  style: "gaussian",
  strength: 3,
  featherPercent: 8,
});
const mosaicResult = await redactImage(source, "synthetic-badge.png", {
  masks: [mask],
  style: "mosaic",
  strength: 6,
  featherPercent: 8,
});

const sourcePixels = await rawGreyscale(source);
const outputPixels = await rawGreyscale(result.image);
const mosaicPixels = await rawGreyscale(mosaicResult.image);
const innerRegion = { left: 330, top: 250, width: 300, height: 190 };
const outsideRegion = { left: 20, top: 20, width: 160, height: 80 };
const sourceInnerEdges = meanEdgeEnergy(sourcePixels, width, innerRegion);
const outputInnerEdges = meanEdgeEnergy(outputPixels, width, innerRegion);
const insideDifference = meanAbsoluteDifference(
  sourcePixels,
  outputPixels,
  width,
  innerRegion,
);
const outsideDifference = meanAbsoluteDifference(
  sourcePixels,
  outputPixels,
  width,
  outsideRegion,
);
const mosaicInnerEdges = meanEdgeEnergy(mosaicPixels, width, innerRegion);
const mosaicInsideDifference = meanAbsoluteDifference(
  sourcePixels,
  mosaicPixels,
  width,
  innerRegion,
);
const mosaicOutsideDifference = meanAbsoluteDifference(
  sourcePixels,
  mosaicPixels,
  width,
  outsideRegion,
);

assert.ok(
  outputInnerEdges < sourceInnerEdges * 0.35,
  `Expected badge detail to fall by at least 65%; source=${sourceInnerEdges.toFixed(2)}, output=${outputInnerEdges.toFixed(2)}`,
);
assert.ok(
  insideDifference > 15,
  `Expected a material pixel change inside the badge; mean difference=${insideDifference.toFixed(2)}`,
);
assert.ok(
  outsideDifference < 0.1,
  `Pixels well outside the mask changed unexpectedly; mean difference=${outsideDifference.toFixed(4)}`,
);
assert.ok(
  mosaicInnerEdges < sourceInnerEdges * 0.5,
  `Expected the optional mosaic to remove at least 50% of badge detail; source=${sourceInnerEdges.toFixed(2)}, output=${mosaicInnerEdges.toFixed(2)}`,
);
assert.ok(
  mosaicInsideDifference > 15,
  `Expected a material mosaic change inside the badge; mean difference=${mosaicInsideDifference.toFixed(2)}`,
);
assert.ok(
  mosaicOutsideDifference < 0.1,
  `Mosaic pixels well outside the mask changed unexpectedly; mean difference=${mosaicOutsideDifference.toFixed(4)}`,
);

console.log(
  JSON.stringify(
    {
      passed: true,
      style: "gaussian",
      strength: 3,
      sourceInnerEdgeEnergy: Number(sourceInnerEdges.toFixed(2)),
      outputInnerEdgeEnergy: Number(outputInnerEdges.toFixed(2)),
      detailRemainingPercent: Number(
        ((outputInnerEdges / sourceInnerEdges) * 100).toFixed(1),
      ),
      insideMeanDifference: Number(insideDifference.toFixed(2)),
      outsideMeanDifference: Number(outsideDifference.toFixed(4)),
      optionalMosaic: {
        strength: 6,
        detailRemainingPercent: Number(
          ((mosaicInnerEdges / sourceInnerEdges) * 100).toFixed(1),
        ),
        insideMeanDifference: Number(mosaicInsideDifference.toFixed(2)),
        outsideMeanDifference: Number(mosaicOutsideDifference.toFixed(4)),
      },
    },
    null,
    2,
  ),
);

async function rawGreyscale(input) {
  return sharp(input).greyscale().raw().toBuffer();
}

function meanEdgeEnergy(pixels, imageWidth, region) {
  let total = 0;
  let samples = 0;
  for (let y = region.top + 1; y < region.top + region.height; y += 1) {
    for (let x = region.left + 1; x < region.left + region.width; x += 1) {
      const index = y * imageWidth + x;
      total += Math.abs(pixels[index] - pixels[index - 1]);
      total += Math.abs(pixels[index] - pixels[index - imageWidth]);
      samples += 2;
    }
  }
  return total / samples;
}

function meanAbsoluteDifference(a, b, imageWidth, region) {
  let total = 0;
  let samples = 0;
  for (let y = region.top; y < region.top + region.height; y += 1) {
    for (let x = region.left; x < region.left + region.width; x += 1) {
      const index = y * imageWidth + x;
      total += Math.abs(a[index] - b[index]);
      samples += 1;
    }
  }
  return total / samples;
}
