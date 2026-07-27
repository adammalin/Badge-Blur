export const MIN_VIEW_ZOOM = 0.25;
export const MAX_VIEW_ZOOM = 8;

const ZOOM_STOPS = [0.25, 0.33, 0.5, 0.67, 1, 1.25, 1.5, 2, 3, 4, 6, 8];

export function clampViewZoom(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.min(MAX_VIEW_ZOOM, Math.max(MIN_VIEW_ZOOM, numeric));
}

export function steppedViewZoom(current, direction) {
  const zoom = clampViewZoom(current);
  if (direction > 0) {
    return ZOOM_STOPS.find((stop) => stop > zoom + 0.001) ?? MAX_VIEW_ZOOM;
  }
  return (
    [...ZOOM_STOPS].reverse().find((stop) => stop < zoom - 0.001) ??
    MIN_VIEW_ZOOM
  );
}

export function continuousViewZoom(current, wheelDelta) {
  return clampViewZoom(current * Math.exp(-Number(wheelDelta || 0) * 0.002));
}

export function fittedImageSize(
  sourceWidth,
  sourceHeight,
  viewportWidth,
  viewportHeight,
  mode = "fit",
  zoom = 1,
) {
  const width = Math.max(1, Number(sourceWidth) || 1);
  const height = Math.max(1, Number(sourceHeight) || 1);
  const availableWidth = Math.max(1, Number(viewportWidth) || 1);
  const availableHeight = Math.max(1, Number(viewportHeight) || 1);
  const fitScale = Math.min(
    availableWidth / width,
    availableHeight / height,
  );
  const scale =
    mode === "fill"
      ? availableWidth / width
      : mode === "zoom"
        ? fitScale * clampViewZoom(zoom)
        : fitScale;
  return {
    width: width * scale,
    height: height * scale,
    scale,
    fitScale,
  };
}
