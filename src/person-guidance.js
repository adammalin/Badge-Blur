export function torsoRegionForPerson(person, imageWidth, imageHeight) {
  return clampRegion(
    {
      left: person.x + person.width * 0.1,
      top: person.y + person.height * 0.05,
      width: person.width * 0.8,
      // Keep global detections on the chest-to-waist area. Dedicated lanyard
      // rescue runs can still search lower inside this person crop.
      height: person.height * 0.72,
    },
    imageWidth,
    imageHeight,
  );
}

export function candidateInsideTorso(candidate, regions) {
  if (!Array.isArray(regions) || regions.length === 0) return false;
  const centerX = candidate.x + candidate.width / 2;
  const centerY = candidate.y + candidate.height / 2;
  const candidateArea = Math.max(1, candidate.width * candidate.height);
  return regions.some((region) => {
    const right = region.left + region.width;
    const bottom = region.top + region.height;
    const centerInside =
      centerX >= region.left &&
      centerX <= right &&
      centerY >= region.top &&
      centerY <= bottom;
    if (!centerInside) return false;
    const overlapWidth = Math.max(
      0,
      Math.min(candidate.x + candidate.width, right) -
        Math.max(candidate.x, region.left),
    );
    const overlapHeight = Math.max(
      0,
      Math.min(candidate.y + candidate.height, bottom) -
        Math.max(candidate.y, region.top),
    );
    return (overlapWidth * overlapHeight) / candidateArea >= 0.75;
  });
}

export function candidateLooksLikeCroppedForeground(
  candidate,
  imageWidth,
  imageHeight,
) {
  const imageArea = Math.max(1, imageWidth * imageHeight);
  const areaRatio =
    Math.max(1, candidate.width * candidate.height) / imageArea;
  const edgeMarginX = imageWidth * 0.015;
  const edgeMarginY = imageHeight * 0.015;
  const touchesCropEdge =
    candidate.x <= edgeMarginX ||
    candidate.x + candidate.width >= imageWidth - edgeMarginX ||
    candidate.y + candidate.height >= imageHeight - edgeMarginY;
  const aspect = candidate.width / Math.max(1, candidate.height);
  return (
    touchesCropEdge &&
    areaRatio >= 0.015 &&
    areaRatio <= 0.14 &&
    aspect >= 0.38 &&
    aspect <= 1.55
  );
}

export function lanyardBadgeSearchRegion(
  lanyard,
  imageWidth,
  imageHeight,
) {
  const centerX = lanyard.x + lanyard.width / 2;
  const searchWidth = Math.max(lanyard.width * 2.2, imageWidth * 0.18);
  const top = lanyard.y + lanyard.height * 0.38;
  const bottom = Math.max(
    lanyard.y + lanyard.height * 1.45,
    top + imageHeight * 0.18,
  );
  return clampRegion(
    {
      left: centerX - searchWidth / 2,
      top,
      width: searchWidth,
      height: bottom - top,
    },
    imageWidth,
    imageHeight,
  );
}

export function candidateCenterInsideRegion(candidate, region) {
  const centerX = candidate.x + candidate.width / 2;
  const centerY = candidate.y + candidate.height / 2;
  return (
    centerX >= region.left &&
    centerX <= region.left + region.width &&
    centerY >= region.top &&
    centerY <= region.top + region.height
  );
}

function clampRegion(region, imageWidth, imageHeight) {
  const left = clamp(region.left, 0, imageWidth);
  const top = clamp(region.top, 0, imageHeight);
  const right = clamp(region.left + region.width, left, imageWidth);
  const bottom = clamp(region.top + region.height, top, imageHeight);
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}
