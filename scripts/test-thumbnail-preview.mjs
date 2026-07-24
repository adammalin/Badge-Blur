import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { decodePreview } from "./image-runtime.mjs";

const sourcePath = resolve(
  "demo-test-images",
  "01-single-frontal-badge.png",
);
const source = await readFile(sourcePath);
const thumbnail = await decodePreview(source, sourcePath, {
  width: 240,
  height: 156,
  fit: "cover",
  quality: 72,
});
const metadata = await sharp(thumbnail.preview).metadata();

assert.equal(metadata.width, 240);
assert.equal(metadata.height, 156);
assert.equal(metadata.format, "jpeg");
assert.equal(thumbnail.info.width, 1024);
assert.equal(thumbnail.info.height, 1536);

console.log(
  JSON.stringify({
    passed: true,
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
  }),
);
