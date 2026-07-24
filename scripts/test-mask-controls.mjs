import assert from "node:assert/strict";
import { maskDeleteControlCenter } from "../src/mask-controls.js";

const centered = maskDeleteControlCenter(
  { x: 100, y: 200, width: 80, height: 120 },
  1000,
  800,
  2,
  2,
);
assert.deepEqual(centered, { x: 140, y: 356 });

const clamped = maskDeleteControlCenter(
  { x: 940, y: 760, width: 100, height: 80 },
  1000,
  800,
  2,
  2,
);
assert.deepEqual(clamped, { x: 974, y: 774 });

console.log(
  JSON.stringify({
    passed: true,
    centeredBelowMask: centered,
    edgeClamp: clamped,
  }),
);
