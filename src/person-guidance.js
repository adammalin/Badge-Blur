export function torsoRegionForPerson(person, imageWidth, imageHeight) {
  return clampRegion(
    {
      left: person.x + person.width * 0.04,
      top: person.y + person.height * 0.07,
      width: person.width * 0.92,
      height: person.height * 0.64,
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
