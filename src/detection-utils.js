export function filterBadgeDetections(boxes, image, options = {}) {
  const plausible = boxes.filter((box) =>
    isPlausibleBadgeBox(box, image, options),
  );
  return deduplicateBadgeDetections(
    removeLikelyLanyardExtensions(removeLowConfidenceContainers(plausible)),
    0.32,
  );
}

export function deduplicateBadgeDetections(boxes, threshold = 0.32) {
  return nonMaximumSuppression(
    removeLikelyLanyardExtensions(removeLowConfidenceContainers(boxes)),
    threshold,
  );
}

export function complementaryBadgePrompt(existingBadges, fallbackPrompt) {
  if (!existingBadges.length) return fallbackPrompt;
  const hasWideBadge = existingBadges.some(
    (box) => box.width / Math.max(1, box.height) >= 1.1,
  );
  const hasTallBadge = existingBadges.some(
    (box) => box.width / Math.max(1, box.height) <= 0.9,
  );
  if (hasWideBadge && !hasTallBadge) {
    return "vertical employee identification badge.";
  }
  if (hasTallBadge && !hasWideBadge) {
    return "horizontal employee identification badge.";
  }
  return fallbackPrompt;
}

export function isComplementaryBadgeOrientation(candidate, existingBadges) {
  if (!existingBadges.length) return true;
  const candidateAspect = candidate.width / Math.max(1, candidate.height);
  const hasWideBadge = existingBadges.some(
    (box) => box.width / Math.max(1, box.height) >= 1.1,
  );
  const hasTallBadge = existingBadges.some(
    (box) => box.width / Math.max(1, box.height) <= 0.9,
  );
  if (hasWideBadge && !hasTallBadge) return candidateAspect <= 0.95;
  if (hasTallBadge && !hasWideBadge) return candidateAspect >= 1.05;
  return true;
}

export function isPlausibleBadgeBox(box, image, options = {}) {
  const area = box.width * box.height;
  const imageArea = image.width * image.height;
  const areaRatio = area / imageArea;
  const aspectRatio = box.width / box.height;
  const heightRatio = box.height / image.height;
  const centerX = (box.x + box.width / 2) / image.width;
  const centerY = (box.y + box.height / 2) / image.height;

  return (
    box.width > 4 &&
    box.height > 4 &&
    area > 40 &&
    areaRatio >= 0.00008 &&
    areaRatio <= (Number(options.maxAreaRatio) || 0.04) &&
    aspectRatio >= 0.25 &&
    aspectRatio <= 2.2 &&
    (heightRatio <= 0.25 || aspectRatio >= 0.75) &&
    centerX >= 0.06 &&
    centerX <= 0.94 &&
    centerY >= 0.18 &&
    centerY <= 0.95
  );
}

function removeLowConfidenceContainers(boxes) {
  return boxes.filter((candidate) => {
    const candidateArea = candidate.width * candidate.height;
    return !boxes.some((other) => {
      if (other.id === candidate.id || other.score < candidate.score) return false;
      const otherArea = other.width * other.height;
      if (otherArea >= candidateArea * 0.55) return false;
      const intersection = intersectionArea(candidate, other);
      return intersection / otherArea >= 0.75;
    });
  });
}

function removeLikelyLanyardExtensions(boxes) {
  return boxes.filter((candidate) => {
    return !boxes.some((other) => {
      if (other.id === candidate.id || other.score < candidate.score) return false;
      const candidateBottom = candidate.y + candidate.height;
      const verticalGap = other.y - candidateBottom;
      const horizontalOverlap =
        Math.max(
          0,
          Math.min(candidate.x + candidate.width, other.x + other.width) -
            Math.max(candidate.x, other.x),
        ) / Math.min(candidate.width, other.width);
      return (
        candidate.y < other.y &&
        verticalGap >= -other.height * 0.15 &&
        verticalGap <= candidate.height * 0.35 &&
        horizontalOverlap >= 0.72 &&
        candidate.height >= other.height * 1.45 &&
        candidate.width <= other.width * 1.45
      );
    });
  });
}

function intersectionArea(a, b) {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function nonMaximumSuppression(boxes, threshold) {
  const sorted = [...boxes].sort((a, b) => b.score - a.score);
  const kept = [];
  for (const candidate of sorted) {
    if (
      kept.every((box) => {
        const intersection = intersectionArea(box, candidate);
        const smallerArea = Math.min(
          box.width * box.height,
          candidate.width * candidate.height,
        );
        const containedOverlap = smallerArea ? intersection / smallerArea : 0;
        return (
          intersectionOverUnion(box, candidate) < threshold &&
          containedOverlap < 0.5
        );
      })
    ) {
      kept.push(candidate);
    }
  }
  return kept;
}

function intersectionOverUnion(a, b) {
  const intersection = intersectionArea(a, b);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union ? intersection / union : 0;
}
