export function torsoRegionForPerson(person, imageWidth, imageHeight) {
  return clampRegion(
    {
      left: person.x + person.width * 0.05,
      top: person.y + person.height * 0.03,
      width: person.width * 0.9,
      // Lanyard cards often hang below the anatomical torso. Keep the region
      // tied to the detected person while extending nearly to the bottom of
      // cropped foreground people, where a large card can otherwise be lost.
      height: person.height * 0.94,
    },
    imageWidth,
    imageHeight,
  );
}

export function candidateInsideTorso(candidate, regions) {
  if (!Array.isArray(regions) || regions.length === 0) return true;
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
    return (overlapWidth * overlapHeight) / candidateArea >= 0.6;
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
