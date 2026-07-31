import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { spawn } from "node:child_process";
import sharp from "sharp";
import decodeHeic from "heic-decode";
import { exiftoolPath } from "exiftool-vendored";
import { resolveRedactionStrength } from "../shared/redaction-strength.js";
import {
  exportExtension,
  exportMimeType,
  normalizeExportFormat,
  resolveExportFormat,
} from "../shared/export-format.js";

const MAX_SOURCE_BYTES = 1024 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".tif",
  ".tiff",
  ".webp",
  ".avif",
  ".heic",
  ".heif",
]);

export async function decodePreview(sourceBuffer, sourceName, options = {}) {
  assertSource(sourceBuffer, sourceName);
  const metadata = await inspectSource(sourceBuffer, sourceName);
  const source = await pixelSource(sourceBuffer, metadata);
  const width = clamp(Math.round(Number(options.width) || 1200), 64, 1600);
  const height = clamp(Math.round(Number(options.height) || 1200), 64, 1600);
  const fit = options.fit === "cover" ? "cover" : "inside";
  const preview = await source
    .resize({
      width,
      height,
      fit,
      withoutEnlargement: true,
    })
    .jpeg({
      quality: clamp(Math.round(Number(options.quality) || 84), 55, 92),
      mozjpeg: true,
    })
    .toBuffer();

  return { preview, info: metadata };
}

export async function cropPreview(sourceBuffer, sourceName, options = {}) {
  assertSource(sourceBuffer, sourceName);
  const info = await inspectSource(sourceBuffer, sourceName);
  const region = boundedRegion(options.region, info.width, info.height);
  const width = clamp(Math.round(Number(options.width) || 1200), 64, 1600);
  const height = clamp(Math.round(Number(options.height) || 1200), 64, 1600);
  const fit = options.fit === "cover" ? "cover" : "inside";
  const source = await pixelSource(sourceBuffer, info);
  const image = await source
    .extract(region)
    .resize({ width, height, fit })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
  const outputInfo = await sharp(image).metadata();
  return {
    image,
    info: {
      width: outputInfo.width,
      height: outputInfo.height,
      sourceRegion: region,
    },
  };
}

export async function redactImage(sourceBuffer, sourceName, options) {
  assertSource(sourceBuffer, sourceName);
  const sourceInfo = await inspectSource(sourceBuffer, sourceName);
  const exportPreference = normalizeExportFormat(options.outputFormat);
  const outputFormat = resolveExportFormat(
    exportPreference,
    sourceInfo.sourceFormat,
  );
  const info = {
    ...sourceInfo,
    outputFormat,
    outputExtension: exportExtension(outputFormat),
    outputMimeType: exportMimeType(outputFormat),
    converted:
      sourceInfo.sourceFormat === "heif" ||
      outputFormat !== sourceInfo.sourceFormat,
    exportPreference,
  };
  const masks = Array.isArray(options.masks)
    ? options.masks
    : Array.isArray(options.boxes)
      ? options.boxes
      : [];
  const style = options.style === "gaussian" ? "gaussian" : "mosaic";
  const strength = resolveRedactionStrength(null, options.strength);
  const featherPercent = clamp(Number(options.featherPercent) || 0, 0, 30);
  const source = await pixelSource(sourceBuffer, info);
  const oriented = await source.raw().toBuffer({ resolveWithObject: true });
  const rawInput = () =>
    sharp(oriented.data, {
      raw: {
        width: oriented.info.width,
        height: oriented.info.height,
        channels: oriented.info.channels,
      },
    });
  const overlays = (
    await mapWithConcurrency(masks, 2, async (inputMask) => {
      const mask = normalizedMask(inputMask, info.width, info.height);
      const maskStrength = resolveRedactionStrength(
        inputMask.redactionStrength,
        strength,
      );
      const featherPixels = Math.min(
        96,
        (Math.min(mask.width, mask.height) * featherPercent) / 100,
      );
      const gaussianSigma = clamp(
        (Math.min(mask.width, mask.height) * maskStrength) / 100,
        1.5,
        100,
      );
      const effectSupport =
        style === "gaussian"
          ? Math.max(featherPixels, gaussianSigma)
          : featherPixels;
      const box = maskBounds(
        mask.points,
        info.width,
        info.height,
        effectSupport,
      );
      if (box.width < 1 || box.height < 1) return null;
      let redactedPatch;
      if (style === "gaussian") {
        redactedPatch = await rawInput()
          .extract(box)
          .blur(gaussianSigma)
          .png()
          .toBuffer();
      } else {
        const mosaicDivisor = clamp(
          Math.round(4 + maskStrength * 2),
          8,
          28,
        );
        const reducedWidth = Math.max(
          1,
          Math.round(box.width / mosaicDivisor),
        );
        const reducedHeight = Math.max(
          1,
          Math.round(box.height / mosaicDivisor),
        );
        // Sharp only applies one resize per pipeline. Buffer the downscaled image
        // before enlarging it again so the privacy mosaic cannot be optimized away.
        const reducedPatch = await rawInput()
          .extract(box)
          .resize(reducedWidth, reducedHeight, { fit: "fill" })
          .png()
          .toBuffer();
        redactedPatch = await sharp(reducedPatch)
          .resize(box.width, box.height, { fit: "fill", kernel: "nearest" })
          .blur(0.5)
          .png()
          .toBuffer();
      }
      const polygonMask = await polygonMaskPng(
        mask.points,
        box,
        featherPixels,
        info.width,
        info.height,
      );
      const patch = await sharp(redactedPatch)
        .composite([{ input: polygonMask, blend: "dest-in" }])
        .png()
        .toBuffer();
      return { input: patch, left: box.left, top: box.top };
    })
  ).filter(Boolean);

  let output = rawInput();
  if (overlays.length) output = output.composite(overlays);
  output = output.keepMetadata();
  output = encodeForFormat(output, info.outputFormat);

  const encoded = await output.toBuffer();
  return withPreservedMetadata(encoded, sourceBuffer, sourceName, info);
}

async function mapWithConcurrency(values, concurrency, callback) {
  const results = new Array(values.length);
  let nextIndex = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, values.length) },
      async () => {
        while (nextIndex < values.length) {
          const index = nextIndex;
          nextIndex += 1;
          results[index] = await callback(values[index], index);
        }
      },
    ),
  );
  return results;
}

export async function fitMaskCorners(sourceBuffer, sourceName, options) {
  assertSource(sourceBuffer, sourceName);
  const info = await inspectSource(sourceBuffer, sourceName);
  const inputBoxes = Array.isArray(options.boxes) ? options.boxes : [];
  const paddingPercent = clamp(Number(options.paddingPercent) || 0, 0, 40);
  const fitScale = Math.min(1, 3600 / Math.max(info.width, info.height));
  const source = await pixelSource(sourceBuffer, info);
  const resizedSource = source
    .clone()
    .resize({
      width: Math.max(1, Math.round(info.width * fitScale)),
      height: Math.max(1, Math.round(info.height * fitScale)),
      fit: "fill",
    })
    // Preserve RGB during fitting. Badge edges can be strongly chromatic while
    // having nearly identical luminance, which a grayscale-only pass misses.
    .removeAlpha();
  const prepared = await resizedSource
    .raw({ depth: "uchar" })
    .toBuffer({ resolveWithObject: true });
  const contrastPrepared = await sharp(prepared.data, {
    raw: {
      width: prepared.info.width,
      height: prepared.info.height,
      channels: prepared.info.channels,
    },
  })
    // CLAHE is applied only to this temporary analysis raster. The source
    // pixels and exported image remain untouched.
    .clahe({ width: 48, height: 48, maxSlope: 3 })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const masks = inputBoxes.map((inputBox) => {
    const original = normalizedRectangle(inputBox, info.width, info.height);
    const scaledBox = {
      x: original.x * fitScale,
      y: original.y * fitScale,
      width: original.width * fitScale,
      height: original.height * fitScale,
    };
    const regularFit = fitQuadrilateral(
      prepared.data,
      prepared.info.width,
      prepared.info.height,
      prepared.info.channels,
      scaledBox,
    );
    const contrastFit = fitQuadrilateral(
      contrastPrepared.data,
      contrastPrepared.info.width,
      contrastPrepared.info.height,
      contrastPrepared.info.channels,
      scaledBox,
    );
    const fitted = chooseCornerFit(regularFit, contrastFit);
    if (!fitted.refined) {
      return {
        points: rectanglePoints(original),
        refined: false,
        confidence: fitted.confidence,
        reason: fitted.reason,
        ...(options.debug
          ? { debug: { regularFit, contrastFit, selected: fitted.analysisPass } }
          : {}),
      };
    }

    const candidate = fitted.points.map((point) => ({
      x: point.x / fitScale,
      y: point.y / fitScale,
    }));
    const safePoints = safestCornerBlend(
      rectanglePoints(original),
      candidate,
      paddingPercent,
      info.width,
      info.height,
    );
    const refinement = meanPointDistance(safePoints, rectanglePoints(original));
    if (refinement < Math.min(original.width, original.height) * 0.015) {
      return {
        points: rectanglePoints(original),
        refined: false,
        confidence: fitted.confidence,
        reason: "The safe fit was indistinguishable from the original rectangle.",
      };
    }
    return {
      points: safePoints,
      refined: true,
      confidence: fitted.confidence,
      reason:
        fitted.analysisPass === "contrast"
          ? "Low-contrast badge edges passed the enhanced analysis and coverage checks."
          : "Four continuous badge edges passed the geometry and coverage checks.",
      ...(options.debug
        ? { debug: { regularFit, contrastFit, selected: fitted.analysisPass } }
        : {}),
    };
  });

  return { masks };
}

function chooseCornerFit(regularFit, contrastFit) {
  if (!regularFit.refined && contrastFit.refined) {
    return { ...contrastFit, analysisPass: "contrast" };
  }
  if (regularFit.refined && !contrastFit.refined) {
    return { ...regularFit, analysisPass: "regular" };
  }
  if (regularFit.refined && contrastFit.refined) {
    return contrastFit.confidence > regularFit.confidence + 0.015
      ? { ...contrastFit, analysisPass: "contrast" }
      : { ...regularFit, analysisPass: "regular" };
  }
  return contrastFit.confidence > regularFit.confidence
    ? { ...contrastFit, analysisPass: "contrast" }
    : { ...regularFit, analysisPass: "regular" };
}

export async function detectColorBadgeCandidates(
  sourceBuffer,
  sourceName,
  options = {},
) {
  assertSource(sourceBuffer, sourceName);
  const info = await inspectSource(sourceBuffer, sourceName);
  const scale = Math.min(1, 2400 / Math.max(info.width, info.height));
  const source = await pixelSource(sourceBuffer, info);
  const prepared = await source
    .resize({
      width: Math.max(1, Math.round(info.width * scale)),
      height: Math.max(1, Math.round(info.height * scale)),
      fit: "fill",
    })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const width = prepared.info.width;
  const height = prepared.info.height;
  const colorMask = new Uint8Array(width * height);
  for (let index = 0; index < colorMask.length; index += 1) {
    const offset = index * 3;
    const red = prepared.data[offset];
    const green = prepared.data[offset + 1];
    const blue = prepared.data[offset + 2];
    const greenBadge =
      green >= 70 &&
      green - red >= 20 &&
      green - blue >= 10 &&
      green >= red * 1.18;
    const orangeBadge =
      red >= 135 &&
      green >= 45 &&
      green <= red * 0.82 &&
      blue <= green * 0.9 &&
      red - blue >= 65;
    colorMask[index] = greenBadge || orangeBadge ? 1 : 0;
  }
  const joined = dilateBinary(colorMask, width, height, 2);
  const regions = Array.isArray(options.regions) ? options.regions : [];
  const candidates = connectedColorComponents(
    joined,
    colorMask,
    width,
    height,
  )
    .filter((component) => {
      const aspect = component.width / component.height;
      const fill = component.colorPixels / (component.width * component.height);
      const center = {
        x: (component.x + component.width / 2) / scale,
        y: (component.y + component.height / 2) / scale,
      };
      const insideRegion =
        regions.length === 0 ||
        regions.some(
          (region) =>
            center.x >= region.x &&
            center.x <= region.x + region.width &&
            center.y >= region.y &&
            center.y <= region.y + region.height,
        );
      return (
        insideRegion &&
        component.width >= 4 &&
        component.height >= 2 &&
        component.width <= width * 0.12 &&
        component.height <= height * 0.16 &&
        aspect >= 0.28 &&
        aspect <= 10 &&
        fill >= 0.055
      );
    })
    .map((component) => {
      const componentAspect = component.width / component.height;
      const paddingX = Math.max(2, component.width * 0.16);
      const paddingY = Math.max(
        2,
        component.height * (componentAspect > 1.8 ? 1.05 : 0.2),
      );
      const x = clamp((component.x - paddingX) / scale, 0, info.width);
      const y = clamp((component.y - paddingY) / scale, 0, info.height);
      const right = clamp(
        (component.x + component.width + paddingX) / scale,
        0,
        info.width,
      );
      const bottom = clamp(
        (component.y + component.height + paddingY) / scale,
        0,
        info.height,
      );
      const fill = component.colorPixels / (component.width * component.height);
      const center = {
        x: (component.x + component.width / 2) / scale,
        y: (component.y + component.height / 2) / scale,
      };
      const regionIndex = closestRegionIndex(center, regions);
      const region = regions[regionIndex];
      return {
        x,
        y,
        width: right - x,
        height: bottom - y,
        label: "colored identification badge",
        score: clamp(0.35 + fill, 0.35, 0.92),
        source: "color",
        regionIndex,
        regionRelativeX: region
          ? (center.x - region.x) / region.width
          : null,
        regionRelativeY: region
          ? (center.y - region.y) / region.height
          : null,
      };
    });
  return { candidates, width: info.width, height: info.height };
}

function closestRegionIndex(point, regions) {
  if (regions.length === 0) return -1;
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < regions.length; index += 1) {
    const region = regions[index];
    if (
      point.x < region.x ||
      point.x > region.x + region.width ||
      point.y < region.y ||
      point.y > region.y + region.height
    ) {
      continue;
    }
    const centerX = region.x + region.width / 2;
    const centerY = region.y + region.height / 2;
    const distance =
      Math.abs(point.x - centerX) / region.width +
      Math.abs(point.y - centerY) / region.height;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

export async function createMetadataSidecar(sourceBuffer, sourceName) {
  assertSource(sourceBuffer, sourceName);
  const directory = await mkdtemp(join(tmpdir(), "badge-remover-metadata-"));
  const extension = safeExtension(sourceName);
  const sourcePath = join(directory, `source${extension}`);
  const sidecarPath = join(directory, "metadata.mie");
  try {
    await writeFile(sourcePath, sourceBuffer);
    await runExifTool([
      "-o",
      sidecarPath,
      "-all:all",
      "--Preview:all",
      "--ThumbnailImage",
      "--PreviewImage",
      "--JpgFromRaw",
      "--OtherImage",
      "--EmbeddedImage",
      "--PhotoshopThumbnail",
      "-MIE:Comment=Metadata archive excludes embedded image previews",
      sourcePath,
    ]);
    return await readFile(sidecarPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function dilateBinary(input, width, height, radius) {
  const horizontal = new Uint8Array(input.length);
  const output = new Uint8Array(input.length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      let value = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sampleX = x + offset;
        if (sampleX >= 0 && sampleX < width && input[row + sampleX]) {
          value = 1;
          break;
        }
      }
      horizontal[row + x] = value;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sampleY = y + offset;
        if (
          sampleY >= 0 &&
          sampleY < height &&
          horizontal[sampleY * width + x]
        ) {
          value = 1;
          break;
        }
      }
      output[y * width + x] = value;
    }
  }
  return output;
}

function connectedColorComponents(mask, original, width, height) {
  const visited = new Uint8Array(mask.length);
  const components = [];
  const stack = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    visited[start] = 1;
    stack.push(start);
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let pixels = 0;
    let colorPixels = 0;
    while (stack.length) {
      const index = stack.pop();
      const x = index % width;
      const y = Math.floor(index / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      pixels += 1;
      colorPixels += original[index];
      const neighbors = [
        index - 1,
        index + 1,
        index - width,
        index + width,
      ];
      for (const neighbor of neighbors) {
        if (
          neighbor < 0 ||
          neighbor >= mask.length ||
          visited[neighbor] ||
          !mask[neighbor]
        ) {
          continue;
        }
        const neighborX = neighbor % width;
        if (Math.abs(neighborX - x) > 1) continue;
        visited[neighbor] = 1;
        stack.push(neighbor);
      }
    }
    if (pixels < 8) continue;
    components.push({
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      pixels,
      colorPixels,
    });
  }
  return components;
}

function fitQuadrilateral(data, imageWidth, imageHeight, channels, box) {
  if (box.width < 18 || box.height < 18) {
    return { refined: false, confidence: 0, reason: "Detection is too small to fit." };
  }
  const verticalRange = {
    start: box.y + box.height * 0.08,
    end: box.y + box.height * 0.92,
  };
  const horizontalRange = {
    start: box.x + box.width * 0.08,
    end: box.x + box.width * 0.92,
  };
  const leftOptions = {
    orientation: "vertical",
    sampleStart: verticalRange.start,
    sampleEnd: verticalRange.end,
    positionStart: box.x - box.width * 0.28,
    positionEnd: box.x + box.width * 0.38,
    center: box.y + box.height / 2,
    span: box.width,
    expectedPosition: box.x,
  };
  const rightOptions = {
    orientation: "vertical",
    sampleStart: verticalRange.start,
    sampleEnd: verticalRange.end,
    positionStart: box.x + box.width * 0.62,
    positionEnd: box.x + box.width * 1.28,
    center: box.y + box.height / 2,
    span: box.width,
    expectedPosition: box.x + box.width,
  };
  const topOptions = {
    orientation: "horizontal",
    sampleStart: horizontalRange.start,
    sampleEnd: horizontalRange.end,
    positionStart: box.y - box.height * 0.28,
    positionEnd: box.y + box.height * 0.38,
    center: box.x + box.width / 2,
    span: box.height,
    expectedPosition: box.y,
  };
  const bottomOptions = {
    orientation: "horizontal",
    sampleStart: horizontalRange.start,
    sampleEnd: horizontalRange.end,
    positionStart: box.y + box.height * 0.62,
    positionEnd: box.y + box.height * 1.28,
    center: box.x + box.width / 2,
    span: box.height,
    expectedPosition: box.y + box.height,
  };
  let left = strongestLine(
    data,
    imageWidth,
    imageHeight,
    channels,
    leftOptions,
  );
  let right = strongestLine(
    data,
    imageWidth,
    imageHeight,
    channels,
    rightOptions,
  );
  let top = strongestLine(
    data,
    imageWidth,
    imageHeight,
    channels,
    topOptions,
  );
  let bottom = strongestLine(
    data,
    imageWidth,
    imageHeight,
    channels,
    bottomOptions,
  );

  // A rotated rectangle has x-vs-y slopes on its side edges that are roughly
  // the negative of the y-vs-x slopes on its top/bottom edges. If independent
  // searches disagree badly, keep the stronger pair and re-search the weaker
  // pair around the compatible rotation. This prevents shirt folds, lanyards,
  // and strong internal card graphics from defining an impossible quadrilateral.
  const verticalSlope = (left.slope + right.slope) / 2;
  const horizontalSlope = (top.slope + bottom.slope) / 2;
  const rotationMismatch = Math.abs(verticalSlope + horizontalSlope);
  if (rotationMismatch > 0.42) {
    const verticalStrength = (left.score + right.score) / 2;
    const horizontalStrength = (top.score + bottom.score) / 2;
    if (horizontalStrength >= verticalStrength) {
      left = strongestLine(data, imageWidth, imageHeight, channels, {
        ...leftOptions,
        slopeCenter: -horizontalSlope,
        slopeTolerance: 0.3,
      });
      right = strongestLine(data, imageWidth, imageHeight, channels, {
        ...rightOptions,
        slopeCenter: -horizontalSlope,
        slopeTolerance: 0.3,
      });
    } else {
      top = strongestLine(data, imageWidth, imageHeight, channels, {
        ...topOptions,
        slopeCenter: -verticalSlope,
        slopeTolerance: 0.3,
      });
      bottom = strongestLine(data, imageWidth, imageHeight, channels, {
        ...bottomOptions,
        slopeCenter: -verticalSlope,
        slopeTolerance: 0.3,
      });
    }
  }

  const leftDistance =
    Math.abs(left.position - leftOptions.expectedPosition) / box.width;
  const rightDistance =
    Math.abs(right.position - rightOptions.expectedPosition) / box.width;
  if (Math.abs(left.slope - right.slope) > 0.16) {
    if (leftDistance <= rightDistance) {
      right = strongestLine(data, imageWidth, imageHeight, channels, {
        ...rightOptions,
        slopeCenter: left.slope,
        slopeTolerance: 0.14,
      });
    } else {
      left = strongestLine(data, imageWidth, imageHeight, channels, {
        ...leftOptions,
        slopeCenter: right.slope,
        slopeTolerance: 0.14,
      });
    }
  }
  const topDistance =
    Math.abs(top.position - topOptions.expectedPosition) / box.height;
  const bottomDistance =
    Math.abs(bottom.position - bottomOptions.expectedPosition) / box.height;
  if (Math.abs(top.slope - bottom.slope) > 0.16) {
    if (topDistance <= bottomDistance) {
      bottom = strongestLine(data, imageWidth, imageHeight, channels, {
        ...bottomOptions,
        slopeCenter: top.slope,
        slopeTolerance: 0.14,
      });
    } else {
      top = strongestLine(data, imageWidth, imageHeight, channels, {
        ...topOptions,
        slopeCenter: bottom.slope,
        slopeTolerance: 0.14,
      });
    }
  }
  const alignedHorizontalSlope = (top.slope + bottom.slope) / 2;
  const alignedVerticalSlope = (left.slope + right.slope) / 2;
  const lineHypotheses = [
    { left, right, top, bottom, hypothesis: "independent" },
    {
      left: strongestLine(data, imageWidth, imageHeight, channels, {
        ...leftOptions,
        slopeCenter: -alignedHorizontalSlope,
        slopeTolerance: 0.28,
      }),
      right: strongestLine(data, imageWidth, imageHeight, channels, {
        ...rightOptions,
        slopeCenter: -alignedHorizontalSlope,
        slopeTolerance: 0.28,
      }),
      top,
      bottom,
      hypothesis: "horizontal-edges-anchor-rotation",
    },
    {
      left,
      right,
      top: strongestLine(data, imageWidth, imageHeight, channels, {
        ...topOptions,
        slopeCenter: -alignedVerticalSlope,
        slopeTolerance: 0.28,
      }),
      bottom: strongestLine(data, imageWidth, imageHeight, channels, {
        ...bottomOptions,
        slopeCenter: -alignedVerticalSlope,
        slopeTolerance: 0.28,
      }),
      hypothesis: "vertical-edges-anchor-rotation",
    },
  ];
  const evaluatedHypotheses = lineHypotheses.map((lineSet) =>
    evaluateLineHypothesis(lineSet, box, imageWidth, imageHeight),
  );
  const independentResult = evaluatedHypotheses[0];
  if (independentResult.refined) return independentResult;
  const compatibleResult = evaluatedHypotheses
    .slice(1)
    .filter((result) => result.refined)
    .sort((a, b) => b.quality - a.quality)[0];
  if (compatibleResult) return compatibleResult;
  return evaluatedHypotheses.sort((a, b) => b.quality - a.quality)[0];
}

function evaluateLineHypothesis(
  { left, right, top, bottom, hypothesis },
  box,
  imageWidth,
  imageHeight,
) {
  const lines = [left, right, top, bottom];
  const minimumScore = Math.min(...lines.map((line) => line.score));
  const meanScore = lines.reduce((sum, line) => sum + line.score, 0) / 4;
  const confidence = clamp((minimumScore * 0.6 + meanScore * 0.4) / 70, 0, 1);
  const verticalSlope = (left.slope + right.slope) / 2;
  const horizontalSlope = (top.slope + bottom.slope) / 2;
  const rotationAgreement = clamp(
    1 - Math.abs(verticalSlope + horizontalSlope) / 0.7,
    0.15,
    1,
  );
  const quality = confidence * (0.72 + rotationAgreement * 0.28);
  if (minimumScore < 9 || meanScore < 14) {
    return {
      refined: false,
      confidence,
      quality,
      reason: "Badge edges were not continuous enough to fit safely.",
      _lines: { left, right, top, bottom, hypothesis },
    };
  }

  const points = [
    intersectEdgeLines(left, top),
    intersectEdgeLines(right, top),
    intersectEdgeLines(right, bottom),
    intersectEdgeLines(left, bottom),
  ];
  if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    return {
      refined: false,
      confidence,
      quality,
      reason: "Fitted edges did not intersect.",
      _lines: { left, right, top, bottom, hypothesis },
    };
  }
  if (!isConvexPoints(points)) {
    return {
      refined: false,
      confidence,
      quality,
      reason: "Fitted corners did not form a convex badge.",
      _lines: { left, right, top, bottom, hypothesis },
    };
  }
  const fittedBounds = boundsForPoints(points);
  const widthRatio = fittedBounds.width / box.width;
  const heightRatio = fittedBounds.height / box.height;
  const areaRatio = polygonArea(points) / (box.width * box.height);
  const withinImage = points.every(
    (point) =>
      point.x >= 0 &&
      point.x <= imageWidth &&
      point.y >= 0 &&
      point.y <= imageHeight,
  );
  if (
    !withinImage ||
    widthRatio < 0.52 ||
    widthRatio > 1.55 ||
    heightRatio < 0.52 ||
    heightRatio > 1.55 ||
    areaRatio < 0.35 ||
    areaRatio > 1.8
  ) {
    return {
      refined: false,
      confidence,
      quality,
      reason:
        "Fitted badge shape failed the size safety check " +
        `(width ${widthRatio.toFixed(2)}x, height ${heightRatio.toFixed(2)}x, area ${areaRatio.toFixed(2)}x).`,
      _lines: { left, right, top, bottom, hypothesis },
    };
  }
  return {
    refined: true,
    confidence,
    quality,
    points,
    _lines: { left, right, top, bottom, hypothesis },
  };
}

function strongestLine(data, width, height, channels, options) {
  const {
    orientation,
    sampleStart,
    sampleEnd,
    positionStart,
    positionEnd,
    center,
    span,
    expectedPosition,
    slopeCenter,
    slopeTolerance,
  } = options;
  const sampleCount = 54;
  const positionStep = Math.max(1, span / 72);
  let best = { slope: 0, position: (positionStart + positionEnd) / 2, score: 0 };
  let nearExpectedBest = null;
  const slopeStart = Number.isFinite(slopeCenter)
    ? clamp(slopeCenter - slopeTolerance, -0.82, 0.82)
    : -0.82;
  const slopeEnd = Number.isFinite(slopeCenter)
    ? clamp(slopeCenter + slopeTolerance, -0.82, 0.82)
    : 0.82;
  for (let slope = slopeStart; slope <= slopeEnd + 0.0001; slope += 0.025) {
    for (
      let position = positionStart;
      position <= positionEnd;
      position += positionStep
    ) {
      const values = [];
      for (let sample = 0; sample < sampleCount; sample += 1) {
        const axis =
          sampleStart + ((sampleEnd - sampleStart) * sample) / (sampleCount - 1);
        const offset = position + slope * (axis - center);
        const x = orientation === "vertical" ? offset : axis;
        const y = orientation === "vertical" ? axis : offset;
        values.push(
          normalGradient(
            data,
            width,
            height,
            channels,
            x,
            y,
            orientation,
            slope,
          ),
        );
      }
      values.sort((a, b) => a - b);
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      const percentile60 = values[Math.floor(values.length * 0.6)] || 0;
      const continuity =
        values.filter((value) => value >= 12).length / values.length;
      const edgeScore =
        mean * (0.55 + continuity * 0.45) + percentile60 * 0.25;
      const proximity =
        Math.abs(position - expectedPosition) / Math.max(1, span);
      // Detector bounds are intentionally padded but still provide valuable
      // outer-boundary evidence. Strong internal card graphics should not beat
      // a slightly fainter edge that is materially closer to the detector's
      // corresponding side.
      const score = edgeScore * clamp(1 - proximity * 1.8, 0.3, 1);
      const candidate = {
        slope,
        position,
        score,
        center,
        orientation,
        proximity,
      };
      if (score > best.score) best = candidate;
      if (
        proximity <= 0.09 &&
        (!nearExpectedBest || score > nearExpectedBest.score)
      ) {
        nearExpectedBest = candidate;
      }
    }
  }
  if (
    best.proximity > 0.09 &&
    nearExpectedBest?.score >= best.score * 0.62
  ) {
    return nearExpectedBest;
  }
  return best;
}

function normalGradient(
  data,
  width,
  height,
  channels,
  x,
  y,
  orientation,
  slope,
) {
  const length = Math.hypot(1, slope);
  const normal =
    orientation === "vertical"
      ? { x: 1 / length, y: -slope / length }
      : { x: -slope / length, y: 1 / length };
  const radius = 2.4;
  const first = sampleColor(
    data,
    width,
    height,
    channels,
    x + normal.x * radius,
    y + normal.y * radius,
  );
  const second = sampleColor(
    data,
    width,
    height,
    channels,
    x - normal.x * radius,
    y - normal.y * radius,
  );
  const red = first[0] - second[0];
  const green = first[1] - second[1];
  const blue = first[2] - second[2];
  return Math.sqrt(red * red * 0.299 + green * green * 0.587 + blue * blue * 0.114);
}

function sampleColor(data, width, height, channels, x, y) {
  if (x < 1 || y < 1 || x >= width - 2 || y >= height - 2) return [0, 0, 0];
  const left = Math.floor(x);
  const top = Math.floor(y);
  const dx = x - left;
  const dy = y - top;
  const output = [];
  for (let channel = 0; channel < 3; channel += 1) {
    const sourceChannel = Math.min(channel, channels - 1);
    const topLeft = data[(top * width + left) * channels + sourceChannel];
    const topRight =
      data[(top * width + left + 1) * channels + sourceChannel];
    const bottomLeft =
      data[((top + 1) * width + left) * channels + sourceChannel];
    const bottomRight =
      data[((top + 1) * width + left + 1) * channels + sourceChannel];
    output.push(
      topLeft * (1 - dx) * (1 - dy) +
        topRight * dx * (1 - dy) +
        bottomLeft * (1 - dx) * dy +
        bottomRight * dx * dy,
    );
  }
  return output;
}

function intersectEdgeLines(vertical, horizontal) {
  const verticalConstant =
    vertical.position - vertical.slope * vertical.center;
  const horizontalConstant =
    horizontal.position - horizontal.slope * horizontal.center;
  const denominator = 1 - vertical.slope * horizontal.slope;
  const x =
    (vertical.slope * horizontalConstant + verticalConstant) / denominator;
  return { x, y: horizontal.slope * x + horizontalConstant };
}

function safestCornerBlend(original, fitted, paddingPercent, width, height) {
  const center = original.reduce(
    (sum, point) => ({
      x: sum.x + point.x / original.length,
      y: sum.y + point.y / original.length,
    }),
    { x: 0, y: 0 },
  );
  const protectedCoverage = original.map((point) => ({
    x: center.x + (point.x - center.x) * 0.76,
    y: center.y + (point.y - center.y) * 0.76,
  }));
  const topAngle = Math.abs(
    Math.atan2(fitted[1].y - fitted[0].y, fitted[1].x - fitted[0].x),
  );
  const bottomAngle = Math.abs(
    Math.atan2(fitted[2].y - fitted[3].y, fitted[2].x - fitted[3].x),
  );
  const fittedAreaRatio = polygonArea(fitted) / Math.max(1, polygonArea(original));
  const expandedFitted = expandPoints(
    fitted,
    paddingPercent / 100,
    width,
    height,
  );
  // Axis-aligned detector corners are not meaningful coverage targets for a
  // clearly rotated landscape card. Preserve a geometrically consistent fit
  // when its padded polygon still protects the detector center; otherwise the
  // generic safety blend would pull correct corners back into a loose diamond.
  if (
    Math.min(topAngle, bottomAngle) >= 0.18 &&
    fittedAreaRatio >= 0.35 &&
    fittedAreaRatio <= 1.45 &&
    pointInPolygonOrEdge(center, expandedFitted)
  ) {
    return fitted.map((point) => ({
      x: clamp(point.x, 0, width),
      y: clamp(point.y, 0, height),
    }));
  }
  for (let amount = 1; amount >= 0; amount -= 0.05) {
    const candidate = fitted.map((point, index) => ({
      x: clamp(
        original[index].x + (point.x - original[index].x) * amount,
        0,
        width,
      ),
      y: clamp(
        original[index].y + (point.y - original[index].y) * amount,
        0,
        height,
      ),
    }));
    const expanded = expandPoints(candidate, paddingPercent / 100, width, height);
    if (
      protectedCoverage.every((point) => pointInPolygonOrEdge(point, expanded))
    ) {
      return candidate;
    }
  }
  return original;
}

function expandPoints(points, padding, width, height) {
  const center = points.reduce(
    (sum, point) => ({
      x: sum.x + point.x / points.length,
      y: sum.y + point.y / points.length,
    }),
    { x: 0, y: 0 },
  );
  const factor = 1 + padding * 2;
  return points.map((point) => ({
    x: clamp(center.x + (point.x - center.x) * factor, 0, width),
    y: clamp(center.y + (point.y - center.y) * factor, 0, height),
  }));
}

function pointInPolygonOrEdge(point, points) {
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const cross =
      (point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x);
    const dot =
      (point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y);
    const squaredLength = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    if (Math.abs(cross) < 0.01 && dot >= 0 && dot <= squaredLength) return true;
  }
  let inside = false;
  for (
    let index = 0, previous = points.length - 1;
    index < points.length;
    previous = index++
  ) {
    const a = points[index];
    const b = points[previous];
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function isConvexPoints(points) {
  if (points.length !== 4 || polygonArea(points) < 64) return false;
  const signs = [];
  for (let index = 0; index < 4; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % 4];
    const c = points[(index + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) > 0.01) signs.push(Math.sign(cross));
  }
  return signs.length === 4 && signs.every((sign) => sign === signs[0]);
}

function polygonArea(points) {
  return Math.abs(
    points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length];
      return sum + point.x * next.y - next.x * point.y;
    }, 0) / 2,
  );
}

function normalizedRectangle(box, width, height) {
  const x = clamp(Number(box.x) || 0, 0, width);
  const y = clamp(Number(box.y) || 0, 0, height);
  const right = clamp(x + (Number(box.width) || 0), x, width);
  const bottom = clamp(y + (Number(box.height) || 0), y, height);
  return { x, y, width: right - x, height: bottom - y };
}

function rectanglePoints(box) {
  return [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ];
}

function meanPointDistance(a, b) {
  return (
    a.reduce(
      (sum, point, index) =>
        sum + Math.hypot(point.x - b[index].x, point.y - b[index].y),
      0,
    ) / a.length
  );
}

async function inspectSource(sourceBuffer, sourceName) {
  let metadata;
  try {
    metadata = await sharp(sourceBuffer, { failOn: "warning", pages: 1 }).metadata();
  } catch (error) {
    throw new Error(`Unsupported or damaged image: ${error.message}`);
  }

  const format = normalizedFormat(metadata, sourceName);
  if (!["jpeg", "png", "tiff", "webp", "avif", "heif"].includes(format)) {
    throw new Error(`Unsupported image format: ${format || safeExtension(sourceName)}`);
  }
  if ((metadata.pages || 1) > 1) {
    throw new Error("Multi-page images are not supported because pages would be lost.");
  }
  const bitsPerSample = Array.isArray(metadata.bitsPerSample)
    ? metadata.bitsPerSample
    : [metadata.bitsPerSample].filter(Boolean);
  if (metadata.depth !== "uchar" || bitsPerSample.some((bits) => bits > 8)) {
    throw new Error(
      "This image contains more than 8 bits per channel. It was not processed because that would reduce its pixel depth.",
    );
  }

  const auto = metadata.autoOrient || {};
  const width = auto.width || metadata.width;
  const height = auto.height || metadata.height;
  const outputFormat = format === "heif" ? "tiff" : format;
  return {
    sourceFormat: format,
    outputFormat,
    outputExtension: exportExtension(outputFormat),
    outputMimeType: exportMimeType(outputFormat),
    converted: format === "heif",
    width,
    height,
    pages: metadata.pages || 1,
    depth: metadata.depth,
    orientation: metadata.orientation || 1,
    metadataArchive: true,
  };
}

async function pixelSource(sourceBuffer, info) {
  if (info.sourceFormat !== "heif") {
    return sharp(sourceBuffer, { failOn: "warning", pages: 1 }).rotate();
  }
  const decoded = await decodeHeic({ buffer: sourceBuffer });
  let image = sharp(Buffer.from(decoded.data), {
    raw: {
      width: decoded.width,
      height: decoded.height,
      channels: 4,
    },
  });
  image = applyExifOrientation(image, info.orientation);
  return image;
}

function applyExifOrientation(image, orientation) {
  switch (orientation) {
    case 2:
      return image.flop();
    case 3:
      return image.rotate(180);
    case 4:
      return image.flip();
    case 5:
      return image.rotate(90).flop();
    case 6:
      return image.rotate(90);
    case 7:
      return image.rotate(90).flip();
    case 8:
      return image.rotate(270);
    default:
      return image;
  }
}

async function withPreservedMetadata(encoded, sourceBuffer, sourceName, info) {
  const directory = await mkdtemp(join(tmpdir(), "badge-remover-output-"));
  const sourcePath = join(directory, `source${safeExtension(sourceName)}`);
  const outputPath = join(directory, `output${info.outputExtension}`);
  try {
    await Promise.all([
      writeFile(sourcePath, sourceBuffer),
      writeFile(outputPath, encoded),
    ]);
    await runExifTool([
      "-overwrite_original",
      "-TagsFromFile",
      sourcePath,
      "-all:all",
      "-unsafe",
      "-icc_profile",
      "--Preview:all",
      "--ThumbnailImage",
      "--PreviewImage",
      "--JpgFromRaw",
      "--OtherImage",
      "--EmbeddedImage",
      "--PhotoshopThumbnail",
      "--ImageWidth",
      "--ImageHeight",
      "--ExifImageWidth",
      "--ExifImageHeight",
      "-Orientation#=1",
      outputPath,
    ]);
    return { image: await readFile(outputPath), info };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function encodeForFormat(image, format) {
  switch (format) {
    case "jpeg":
      return image.jpeg({ quality: 95, chromaSubsampling: "4:4:4", mozjpeg: true });
    case "png":
      return image.png({ compressionLevel: 9 });
    case "tiff":
      return image.tiff({ compression: "lzw", predictor: "horizontal" });
    case "webp":
      return image.webp({ quality: 95, smartSubsample: true });
    case "avif":
      return image.avif({ quality: 85, effort: 5, chromaSubsampling: "4:4:4" });
    default:
      throw new Error(`No safe output encoder for ${format}.`);
  }
}

function runExifTool(args) {
  return new Promise(async (resolve, reject) => {
    const executable = await exiftoolPath();
    const child = spawn(executable, args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Metadata preservation failed: ${stderr.trim()}`));
    });
  });
}

function assertSource(sourceBuffer, sourceName) {
  if (!Buffer.isBuffer(sourceBuffer) || sourceBuffer.length === 0) {
    throw new Error("The image is empty.");
  }
  if (sourceBuffer.length > MAX_SOURCE_BYTES) {
    throw new Error("The image exceeds the 1 GB per-file safety limit.");
  }
  const extension = safeExtension(sourceName);
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error(`Unsupported file extension: ${extension || "(none)"}`);
  }
}

function safeExtension(name) {
  const extension = extname(String(name || "")).toLowerCase();
  return SUPPORTED_EXTENSIONS.has(extension) ? extension : ".img";
}

function normalizedFormat(metadata, sourceName) {
  if (metadata.format === "heif") {
    return metadata.compression === "av1" ||
      safeExtension(sourceName) === ".avif" ||
      metadata.mediaType === "image/avif"
      ? "avif"
      : "heif";
  }
  if (metadata.format === "jpeg") return "jpeg";
  if (metadata.format) return metadata.format;
  const extension = safeExtension(sourceName);
  if (extension === ".jpg" || extension === ".jpeg") return "jpeg";
  if (extension === ".tif" || extension === ".tiff") return "tiff";
  if (extension === ".heic" || extension === ".heif") return "heif";
  return extension.slice(1);
}

function normalizedMask(mask, width, height) {
  let points = Array.isArray(mask.points) && mask.points.length === 4
    ? mask.points
    : [
        { x: mask.x, y: mask.y },
        { x: Number(mask.x) + Number(mask.width), y: mask.y },
        {
          x: Number(mask.x) + Number(mask.width),
          y: Number(mask.y) + Number(mask.height),
        },
        { x: mask.x, y: Number(mask.y) + Number(mask.height) },
      ];
  points = points.map((point) => ({
    x: clamp(Number(point.x) || 0, 0, width),
    y: clamp(Number(point.y) || 0, 0, height),
  }));
  const bounds = boundsForPoints(points);
  return { points, width: bounds.width, height: bounds.height };
}

function maskBounds(points, width, height, featherPixels) {
  const bounds = boundsForPoints(points);
  const margin = Math.ceil(featherPixels * 3 + 2);
  const left = clamp(Math.floor(bounds.x - margin), 0, Math.max(0, width - 1));
  const top = clamp(Math.floor(bounds.y - margin), 0, Math.max(0, height - 1));
  const right = clamp(Math.ceil(bounds.x + bounds.width + margin), left + 1, width);
  const bottom = clamp(
    Math.ceil(bounds.y + bounds.height + margin),
    top + 1,
    height,
  );
  return { left, top, width: right - left, height: bottom - top };
}

function boundsForPoints(points) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
  };
}

async function polygonMaskPng(
  points,
  box,
  featherPixels,
  imageWidth,
  imageHeight,
) {
  // Feathering a polygon exactly at the image boundary normally fades its
  // alpha toward transparent because half of the blur kernel lies outside the
  // SVG viewport. Extend edge-touching corners beyond the source image so the
  // mask remains fully opaque all the way to the physical image edge.
  const edgeSupport = Math.ceil(featherPixels * 3 + 2);
  const touchesPhysicalEdge = points.some(
    (point) =>
      point.x <= 0.5 ||
      point.x >= imageWidth - 0.5 ||
      point.y <= 0.5 ||
      point.y >= imageHeight - 0.5,
  );
  const renderMargin = touchesPhysicalEdge ? edgeSupport * 2 : 0;
  const edgeSafePoints = points.map((point) => ({
    x:
      point.x <= 0.5
        ? point.x - edgeSupport
        : point.x >= imageWidth - 0.5
          ? point.x + edgeSupport
          : point.x,
    y:
      point.y <= 0.5
        ? point.y - edgeSupport
        : point.y >= imageHeight - 0.5
          ? point.y + edgeSupport
          : point.y,
  }));
  const polygon = edgeSafePoints
    .map(
      (point) =>
        `${point.x - box.left + renderMargin},${point.y - box.top + renderMargin}`,
    )
    .join(" ");
  const filter = featherPixels > 0
    ? `<defs><filter id="f" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${featherPixels.toFixed(2)}" edgeMode="duplicate"/></filter></defs>`
    : "";
  const filterAttribute = featherPixels > 0 ? ' filter="url(#f)"' : "";
  const renderWidth = box.width + renderMargin * 2;
  const renderHeight = box.height + renderMargin * 2;
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${renderWidth}" height="${renderHeight}" viewBox="0 0 ${renderWidth} ${renderHeight}">${filter}<polygon points="${polygon}" fill="white"${filterAttribute}/></svg>`,
  );
  if (!renderMargin) return svg;
  return sharp(svg)
    .extract({
      left: renderMargin,
      top: renderMargin,
      width: box.width,
      height: box.height,
    })
    .png()
    .toBuffer();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function boundedRegion(region, width, height) {
  const input = region || {};
  const left = clamp(Math.floor(Number(input.left) || 0), 0, width - 1);
  const top = clamp(Math.floor(Number(input.top) || 0), 0, height - 1);
  const right = clamp(
    Math.ceil(left + (Number(input.width) || width)),
    left + 1,
    width,
  );
  const bottom = clamp(
    Math.ceil(top + (Number(input.height) || height)),
    top + 1,
    height,
  );
  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}
