import assert from "node:assert/strict";
import {
  applyForCurrentEditRevision,
  isCurrentEditRevision,
} from "../src/edit-revisions.js";

const item = { editRevision: 4 };
const applied = [];

assert.equal(isCurrentEditRevision(item, 4), true);
assert.equal(isCurrentEditRevision(item, 3), false);
assert.equal(
  applyForCurrentEditRevision(item, 3, () => applied.push("stale")),
  false,
);
assert.deepEqual(applied, []);
assert.equal(
  applyForCurrentEditRevision(item, 4, () => applied.push("current")),
  true,
);
assert.deepEqual(applied, ["current"]);

item.editRevision += 1;
assert.equal(
  applyForCurrentEditRevision(item, 4, () => applied.push("late")),
  false,
);
assert.deepEqual(applied, ["current"]);

console.log(
  JSON.stringify({
    passed: true,
    currentRevision: item.editRevision,
    staleResultsRejected: 2,
    currentResultsApplied: applied.length,
  }),
);
