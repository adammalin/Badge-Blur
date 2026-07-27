import assert from "node:assert/strict";
import {
  complementaryBadgePrompt,
  isComplementaryBadgeOrientation,
  isPlausibleBadgeBox,
} from "../src/detection-utils.js";

const wide = { width: 120, height: 70 };
const tall = { width: 65, height: 120 };
const fallback = "identification badge.";

assert.equal(
  complementaryBadgePrompt([wide], fallback),
  "vertical employee identification badge.",
);
assert.equal(
  complementaryBadgePrompt([tall], fallback),
  "horizontal employee identification badge.",
);
assert.equal(isComplementaryBadgeOrientation(tall, [wide]), true);
assert.equal(isComplementaryBadgeOrientation(wide, [tall]), true);
assert.equal(isComplementaryBadgeOrientation(wide, [wide]), false);
assert.equal(isComplementaryBadgeOrientation(tall, [tall]), false);

assert.equal(
  isPlausibleBadgeBox(
    { x: 300, y: 300, width: 110, height: 50 },
    { width: 1000, height: 1000 },
  ),
  true,
);
assert.equal(
  isPlausibleBadgeBox(
    { x: 300, y: 300, width: 40, height: 130 },
    { width: 1000, height: 1000 },
  ),
  true,
);

console.log("Horizontal and vertical badge orientation helpers passed.");
