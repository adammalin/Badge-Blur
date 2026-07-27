export function isCurrentEditRevision(item, revision) {
  return revision === item.editRevision;
}

export function applyForCurrentEditRevision(item, revision, apply) {
  if (!isCurrentEditRevision(item, revision)) return false;
  apply();
  return true;
}
