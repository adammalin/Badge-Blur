export function associateBadgesToPeople(personGuides, boxes) {
  const guides = Array.isArray(personGuides) ? personGuides : [];
  const masks = Array.isArray(boxes) ? boxes : [];
  const matches = new Map();

  for (const box of masks) {
    const center = boxCenter(box);
    let bestGuide = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const guide of guides) {
      const region = guide.torso || guide.region || guide;
      if (!pointInsideRegion(center, region)) continue;
      const regionCenter = {
        x: region.left + region.width / 2,
        y: region.top + region.height / 2,
      };
      const distance =
        Math.abs(center.x - regionCenter.x) / Math.max(1, region.width) +
        Math.abs(center.y - regionCenter.y) / Math.max(1, region.height);
      if (distance < bestDistance) {
        bestGuide = guide;
        bestDistance = distance;
      }
    }
    if (!bestGuide) continue;
    const key = bestGuide.id;
    const assigned = matches.get(key) || [];
    assigned.push(box.id);
    matches.set(key, assigned);
  }

  return {
    matchedPersonIds: [...matches.keys()],
    unmatchedPersonIds: guides
      .filter((guide) => !matches.has(guide.id))
      .map((guide) => guide.id),
    badgeIdsByPerson: Object.fromEntries(matches),
  };
}

export function assessReviewAttention({
  status,
  width,
  height,
  boxes,
  personGuides,
}) {
  const masks = Array.isArray(boxes) ? boxes : [];
  const guides = (Array.isArray(personGuides) ? personGuides : []).filter(
    (guide) => guide.attentionEligible !== false,
  );
  const association = associateBadgesToPeople(guides, masks);
  const reasons = [];
  let score = 0;

  if (status === "error") {
    reasons.push("Image processing failed");
    score = 100;
  }

  const imageArea = Math.max(1, Number(width) * Number(height));
  const implausiblyLargeCount = masks.filter(
    (box) =>
      box.source !== "manual" &&
      (box.width * box.height) / imageArea >= 0.08,
  ).length;
  if (implausiblyLargeCount > 0) {
    reasons.push(
      `${implausiblyLargeCount} ${implausiblyLargeCount === 1 ? "mask is" : "masks are"} implausibly large`,
    );
    score = Math.max(score, 95);
  }

  return {
    score,
    level: score >= 80 ? "high" : score >= 50 ? "medium" : "none",
    reasons,
    personCount: guides.length,
    matchedPersonCount: association.matchedPersonIds.length,
    // People are context for constraining detections, not evidence that a
    // badge must be visible. Keep this legacy field neutral in saved runs.
    unmatchedPersonCount: 0,
    association,
  };
}

function pointInsideRegion(point, region) {
  if (!region) return false;
  return (
    point.x >= region.left &&
    point.x <= region.left + region.width &&
    point.y >= region.top &&
    point.y <= region.top + region.height
  );
}

function boxCenter(box) {
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}
