import assert from "node:assert/strict";
import sharp from "sharp";
import { redactImage } from "./image-runtime.mjs";
import {
  exportExtension,
  normalizeExportFormat,
  resolveExportFormat,
} from "../shared/export-format.js";

const source = await sharp({
  create: {
    width: 320,
    height: 220,
    channels: 3,
    background: "#d8e6dc",
  },
})
  .composite([
    {
      input: Buffer.from(
        '<svg width="320" height="220"><rect x="95" y="60" width="130" height="100" fill="white"/><text x="160" y="120" text-anchor="middle" font-size="24">BADGE</text></svg>',
      ),
    },
  ])
  .png()
  .toBuffer();

const formats = ["jpeg", "png", "tiff", "webp"];
for (const outputFormat of formats) {
  const result = await redactImage(source, "format-source.png", {
    masks: [{ x: 95, y: 60, width: 130, height: 100 }],
    style: "gaussian",
    strength: 4,
    featherPercent: 8,
    outputFormat,
  });
  const metadata = await sharp(result.image).metadata();
  assert.equal(metadata.format, outputFormat);
  assert.equal(result.info.outputFormat, outputFormat);
  assert.equal(result.info.outputExtension, exportExtension(outputFormat));
  assert.equal(result.info.exportPreference, outputFormat);
}

assert.equal(normalizeExportFormat("unknown"), "original");
assert.equal(resolveExportFormat("original", "png"), "png");
assert.equal(resolveExportFormat("original", "heif"), "tiff");

console.log(
  JSON.stringify({
    passed: true,
    formats,
    heifOriginalFallback: "tiff",
  }),
);
