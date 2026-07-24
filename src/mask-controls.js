export function maskDeleteControlCenter(
  box,
  sourceWidth,
  sourceHeight,
  sourcePerCssX,
  sourcePerCssY,
) {
  const radiusX = 13 * sourcePerCssX;
  const radiusY = 13 * sourcePerCssY;
  return {
    x: clamp(box.x + box.width / 2, radiusX, sourceWidth - radiusX),
    y: clamp(
      box.y + box.height + 18 * sourcePerCssY,
      radiusY,
      sourceHeight - radiusY,
    ),
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
