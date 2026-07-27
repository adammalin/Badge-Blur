import assert from "node:assert/strict";
import {
  hasUnexportedChanges,
  reusableRedactedPreview,
} from "../src/export-state.js";

const currentBlob = { name: "current-redaction" };
const item = {
  status: "detected",
  editRevision: 3,
  exportRevision: 2,
  redactedPreviewRevision: 3,
  redactedPreviewBlob: currentBlob,
};

assert.equal(hasUnexportedChanges(item), true);
assert.equal(reusableRedactedPreview(item, 3), currentBlob);
assert.equal(reusableRedactedPreview(item, 2), null);

item.exportRevision = 3;
assert.equal(hasUnexportedChanges(item), false);
item.editRevision = 4;
assert.equal(hasUnexportedChanges(item), true);
assert.equal(reusableRedactedPreview(item, 4), null);

item.status = "queued";
assert.equal(hasUnexportedChanges(item), false);

console.log("Export revision and redacted-preview reuse helpers passed.");
