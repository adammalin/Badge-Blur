export const CHECKPOINT_DOCUMENT_TYPE = "badge-blur-batch-checkpoint";
export const CHECKPOINT_SCHEMA_VERSION = 1;

export function isBatchCheckpoint(value) {
  return Boolean(
    value &&
      value.documentType === CHECKPOINT_DOCUMENT_TYPE &&
      Number(value.schemaVersion) === CHECKPOINT_SCHEMA_VERSION &&
      Array.isArray(value.files),
  );
}

export function checkpointStatusForItem(item) {
  if (
    item.status === "detected" &&
    item.exportRevision >= item.editRevision &&
    item.exportRevision >= 0
  ) {
    return "completed";
  }
  if (item.processing || item.status === "running") return "active";
  if (item.decodeError || item.status === "error" || item.exportError) {
    return "failed";
  }
  return "pending";
}

export function shouldProcessItem(item) {
  if (item.decodeError) return false;
  return checkpointStatusForItem(item) !== "completed";
}

export function recoveryStatusForEntry(entry) {
  if (entry.checkpointStatus === "completed") return "completed";
  if (
    entry.status === "detected" &&
    Array.isArray(entry.reviewedMasks)
  ) {
    return "export-pending";
  }
  return "detection-pending";
}

export function summarizeCheckpointFiles(files) {
  const summary = {
    completed: 0,
    pending: 0,
    active: 0,
    failed: 0,
  };
  for (const entry of files || []) {
    const status = Object.hasOwn(summary, entry.checkpointStatus)
      ? entry.checkpointStatus
      : "pending";
    summary[status] += 1;
  }
  return summary;
}
