export const EXPORT_FORMATS = Object.freeze([
  "original",
  "jpeg",
  "png",
  "tiff",
  "webp",
]);

export function normalizeExportFormat(value) {
  return EXPORT_FORMATS.includes(value) ? value : "original";
}

export function resolveExportFormat(preference, sourceFormat) {
  const normalized = normalizeExportFormat(preference);
  if (normalized !== "original") return normalized;
  return sourceFormat === "heif" ? "tiff" : sourceFormat;
}

export function exportExtension(format) {
  switch (format) {
    case "jpeg":
      return ".jpg";
    case "png":
      return ".png";
    case "tiff":
      return ".tif";
    case "webp":
      return ".webp";
    case "avif":
      return ".avif";
    default:
      throw new Error(`No export extension for ${format}.`);
  }
}

export function exportMimeType(format) {
  switch (format) {
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "tiff":
      return "image/tiff";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
    default:
      throw new Error(`No export MIME type for ${format}.`);
  }
}
