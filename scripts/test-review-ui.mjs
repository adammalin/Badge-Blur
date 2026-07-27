import assert from "node:assert/strict";
import {
  adjacentBadgeId,
  reviewProgressSummary,
  selectedBadgePosition,
} from "../src/review-ui.js";

const boxes = [{ id: "a" }, { id: "b" }, { id: "c" }];
assert.deepEqual(selectedBadgePosition(boxes, "b"), {
  index: 1,
  number: 2,
  total: 3,
});
assert.deepEqual(selectedBadgePosition(boxes, "missing"), {
  index: -1,
  number: null,
  total: 3,
});
assert.equal(adjacentBadgeId(boxes, null, 1), "a");
assert.equal(adjacentBadgeId(boxes, null, -1), "c");
assert.equal(adjacentBadgeId(boxes, "b", 1), "c");
assert.equal(adjacentBadgeId(boxes, "a", -1), "c");
assert.equal(adjacentBadgeId([], "a", 1), null);

const items = [
  {
    boxes: [{ id: "a" }],
    reviewConfirmed: false,
    attention: { reasons: [] },
  },
  {
    boxes: [{ id: "b" }, { id: "c" }],
    reviewConfirmed: true,
    attention: { reasons: [] },
  },
  {
    boxes: [],
    reviewConfirmed: false,
    attention: { reasons: ["mask is implausibly large"] },
  },
];

assert.equal(
  reviewProgressSummary(items, 1),
  "Image 2 of 3 · 1 reviewed · 2 badges on this image · 1 flagged issue",
);
assert.equal(
  reviewProgressSummary(items, 99),
  "Image 3 of 3 · 1 reviewed · 0 badges on this image · 1 flagged issue",
);
assert.equal(reviewProgressSummary([], 0), "No images selected.");

console.log("Review UI helpers passed.");
