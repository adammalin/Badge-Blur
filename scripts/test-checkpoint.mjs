import assert from "node:assert/strict";
import {
  CHECKPOINT_DOCUMENT_TYPE,
  CHECKPOINT_SCHEMA_VERSION,
  checkpointStatusForItem,
  isBatchCheckpoint,
  recoveryStatusForEntry,
  shouldProcessItem,
  summarizeCheckpointFiles,
} from "../src/checkpoint.js";

const completed = {
  status: "detected",
  processing: false,
  decodeError: null,
  exportError: null,
  editRevision: 3,
  exportRevision: 3,
};
const active = {
  ...completed,
  status: "running",
  processing: true,
  exportRevision: -1,
};
const failed = {
  ...completed,
  status: "error",
  exportRevision: -1,
};
const pending = {
  ...completed,
  status: "queued",
  exportRevision: -1,
};

assert.equal(checkpointStatusForItem(completed), "completed");
assert.equal(checkpointStatusForItem(active), "active");
assert.equal(checkpointStatusForItem(failed), "failed");
assert.equal(checkpointStatusForItem(pending), "pending");
assert.equal(shouldProcessItem(completed), false);
assert.equal(shouldProcessItem(active), true);
assert.equal(shouldProcessItem(failed), true);
assert.equal(shouldProcessItem({ ...pending, decodeError: "unsupported" }), false);

const checkpoint = {
  documentType: CHECKPOINT_DOCUMENT_TYPE,
  schemaVersion: CHECKPOINT_SCHEMA_VERSION,
  files: [
    { checkpointStatus: "completed" },
    { checkpointStatus: "pending" },
    { checkpointStatus: "active" },
    { checkpointStatus: "failed" },
  ],
};
assert.equal(isBatchCheckpoint(checkpoint), true);
assert.equal(isBatchCheckpoint({ files: [] }), false);
assert.deepEqual(summarizeCheckpointFiles(checkpoint.files), {
  completed: 1,
  pending: 1,
  active: 1,
  failed: 1,
});
assert.equal(
  recoveryStatusForEntry({
    checkpointStatus: "completed",
    status: "detected",
    reviewedMasks: [],
  }),
  "completed",
);
assert.equal(
  recoveryStatusForEntry({
    checkpointStatus: "active",
    status: "detected",
    reviewedMasks: [{ x: 1 }],
  }),
  "export-pending",
);
assert.equal(
  recoveryStatusForEntry({
    checkpointStatus: "active",
    status: "running",
    reviewedMasks: [],
  }),
  "detection-pending",
);

console.log(
  JSON.stringify({
    passed: true,
    completedSkipped: true,
    activeRetried: true,
    failedRetried: true,
    summary: summarizeCheckpointFiles(checkpoint.files),
  }),
);
