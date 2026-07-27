export function hasUnexportedChanges(item) {
  return (
    item?.status === "detected" &&
    (item.exportRevision < 0 || item.editRevision !== item.exportRevision)
  );
}

export function reusableRedactedPreview(item, revision) {
  return item?.redactedPreviewRevision === revision
    ? item.redactedPreviewBlob || null
    : null;
}
