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
const lowStrengthResult = await redactImage(source, "synthetic-badge.png", {
  masks: [mask],
  style: "gaussian",
  strength: 2,
  featherPercent: 8,
});
const perMaskOverrideResult = await redactImage(
  source,
  "synthetic-badge.png",
  {
    masks: [{ ...mask, redactionStrength: 12 }],
    style: "gaussian",
    strength: 2,
    featherPercent: 8,
  },
);

const edgeWidth = 360;
const edgeHeight = 240;
const edgeSource = await sharp({
  create: {
    width: edgeWidth,
    height: edgeHeight,
    channels: 3,
    background: "#ffffff",
  },
})
  .composite([
    {
      input: Buffer.from(`
        <svg xmlns="http://www.w3.org/2000/svg" width="${edgeWidth}" height="${edgeHeight}">
          <defs><pattern id="p" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="6" height="12" fill="#000000"/><rect x="6" width="6" height="12" fill="#ffffff"/></pattern></defs>
          <rect x="0" y="30" width="190" height="210" fill="url(#p)"/>
        </svg>
      `),
    },
  ])
  .png()
  .toBuffer();
const edgeResult = await redactImage(edgeSource, "edge-badge.png", {
  masks: [{
    points: [
      { x: 0, y: 30 },
      { x: 190, y: 30 },
      { x: 190, y: 240 },
      { x: 0, y: 240 },
    ],
  }],
  style: "gaussian",
  strength: 8,
  featherPercent: 20,
});

const sourcePixels = await rawGreyscale(source);
const outputPixels = await rawGreyscale(result.image);
const mosaicPixels = await rawGreyscale(mosaicResult.image);
const lowStrengthPixels = await rawGreyscale(lowStrengthResult.image);
const perMaskOverridePixels = await rawGreyscale(perMaskOverrideResult.image);
const edgeSourcePixels = await rawGreyscale(edgeSource);
const edgeOutputPixels = await rawGreyscale(edgeResult.image);
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
const lowStrengthEdges = meanEdgeEnergy(
  lowStrengthPixels,
  width,
  innerRegion,
);
const perMaskOverrideEdges = meanEdgeEnergy(
  perMaskOverridePixels,
  width,
  innerRegion,
);
const physicalEdgeRegion = { left: 0, top: 70, width: 24, height: 100 };
const sourcePhysicalEdgeEnergy = meanEdgeEnergy(
  edgeSourcePixels,
  edgeWidth,
  physicalEdgeRegion,
);
const outputPhysicalEdgeEnergy = meanEdgeEnergy(
  edgeOutputPixels,
  edgeWidth,
  physicalEdgeRegion,
);
const physicalEdgeDifference = meanAbsoluteDifference(
  edgeSourcePixels,
  edgeOutputPixels,
  edgeWidth,
  physicalEdgeRegion,
);
const physicalBottomRegion = { left: 45, top: 216, width: 100, height: 24 };
const sourcePhysicalBottomEnergy = meanEdgeEnergy(
  edgeSourcePixels,
  edgeWidth,
  physicalBottomRegion,
);
const outputPhysicalBottomEnergy = meanEdgeEnergy(
  edgeOutputPixels,
  edgeWidth,
  physicalBottomRegion,
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
assert.ok(
  perMaskOverrideEdges < lowStrengthEdges * 0.7,
  `Expected a per-mask strength override to blur more strongly; default=${lowStrengthEdges.toFixed(2)}, override=${perMaskOverrideEdges.toFixed(2)}`,
);
assert.ok(
  outputPhysicalEdgeEnergy < sourcePhysicalEdgeEnergy * 0.25,
  `Expected full-strength blur at the physical image edge; source=${sourcePhysicalEdgeEnergy.toFixed(2)}, output=${outputPhysicalEdgeEnergy.toFixed(2)}`,
);
assert.ok(
  physicalEdgeDifference > 20,
  `Expected material redaction through the physical image edge; mean difference=${physicalEdgeDifference.toFixed(2)}`,
);
assert.ok(
  outputPhysicalBottomEnergy < sourcePhysicalBottomEnergy * 0.25,
  `Expected full-strength blur at the bottom image edge; source=${sourcePhysicalBottomEnergy.toFixed(2)}, output=${outputPhysicalBottomEnergy.toFixed(2)}`,
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
      perMaskOverride: {
        batchDefault: 2,
        maskStrength: 12,
        defaultEdgeEnergy: Number(lowStrengthEdges.toFixed(2)),
        overrideEdgeEnergy: Number(perMaskOverrideEdges.toFixed(2)),
      },
      physicalImageEdge: {
        detailRemainingPercent: Number(
          ((outputPhysicalEdgeEnergy / sourcePhysicalEdgeEnergy) * 100).toFixed(1),
        ),
        meanDifference: Number(physicalEdgeDifference.toFixed(2)),
        bottomDetailRemainingPercent: Number(
          ((outputPhysicalBottomEnergy / sourcePhysicalBottomEnergy) * 100).toFixed(1),
        ),
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
