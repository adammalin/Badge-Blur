import assert from "node:assert/strict";
import {
  clampViewZoom,
  continuousViewZoom,
  fittedImageSize,
  steppedViewZoom,
} from "../src/view-transform.js";

assert.equal(clampViewZoom(0.01), 0.25);
assert.equal(clampViewZoom(12), 8);
assert.equal(steppedViewZoom(1, 1), 1.25);
assert.equal(steppedViewZoom(1, -1), 0.67);
assert.ok(continuousViewZoom(1, -120) > 1);
assert.ok(continuousViewZoom(1, 120) < 1);

assert.deepEqual(fittedImageSize(400, 800, 1000, 600, "fit"), {
  width: 300,
  height: 600,
  scale: 0.75,
  fitScale: 0.75,
});
assert.deepEqual(fittedImageSize(400, 800, 1000, 600, "fill"), {
  width: 1000,
  height: 2000,
  scale: 2.5,
  fitScale: 0.75,
});
assert.deepEqual(fittedImageSize(400, 800, 1000, 600, "zoom", 2), {
  width: 600,
  height: 1200,
  scale: 1.5,
  fitScale: 0.75,
});

console.log(
  JSON.stringify({
    passed: true,
    steppedZoom: true,
    continuousZoom: true,
    fitAndFillSizing: true,
  }),
);
