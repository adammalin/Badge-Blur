export function selectedBadgePosition(boxes, selectedBoxId) {
  const safeBoxes = Array.isArray(boxes) ? boxes : [];
  const index = safeBoxes.findIndex((box) => box.id === selectedBoxId);
  return {
    index,
    number: index >= 0 ? index + 1 : null,
    total: safeBoxes.length,
  };
}

export function adjacentBadgeId(boxes, selectedBoxId, direction) {
  const safeBoxes = Array.isArray(boxes) ? boxes : [];
  if (safeBoxes.length === 0) return null;
  const currentIndex = safeBoxes.findIndex((box) => box.id === selectedBoxId);
  if (currentIndex < 0) {
    return direction < 0
      ? safeBoxes[safeBoxes.length - 1].id
      : safeBoxes[0].id;
  }
  const offset = direction < 0 ? -1 : 1;
  const nextIndex = (currentIndex + offset + safeBoxes.length) % safeBoxes.length;
  return safeBoxes[nextIndex].id;
}

export function reviewProgressSummary(items, activeIndex) {
  const safeItems = Array.isArray(items) ? items : [];
  if (safeItems.length === 0) return "No images selected.";

  const boundedIndex = Math.min(
    Math.max(Number(activeIndex) || 0, 0),
    safeItems.length - 1,
  );
  const activeItem = safeItems[boundedIndex];
  const badgeCount = Array.isArray(activeItem?.boxes)
    ? activeItem.boxes.length
    : 0;
  const reviewedCount = safeItems.filter((item) => item.reviewConfirmed).length;
  const attentionCount = safeItems.filter(
    (item) =>
      !item.reviewConfirmed &&
      Array.isArray(item.attention?.reasons) &&
      item.attention.reasons.length > 0,
  ).length;

  return [
    `Image ${boundedIndex + 1} of ${safeItems.length}`,
    `${reviewedCount} reviewed`,
    `${badgeCount} ${badgeCount === 1 ? "badge" : "badges"} on this image`,
    attentionCount
      ? `${attentionCount} flagged ${attentionCount === 1 ? "issue" : "issues"}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
