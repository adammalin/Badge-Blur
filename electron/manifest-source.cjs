const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const RUN_MANIFEST_FILE_NAME = "badge-removal-manifest.json";
const RUN_CHECKPOINT_FILE_NAME = "badge-blur-checkpoint.json";
const SUPPORTED_RUN_FILES = new Set([
  RUN_MANIFEST_FILE_NAME,
  RUN_CHECKPOINT_FILE_NAME,
]);

function recoverManifestSource(manifestPath, { tokenFactory } = {}) {
  if (
    typeof manifestPath !== "string" ||
    !path.isAbsolute(manifestPath) ||
    !SUPPORTED_RUN_FILES.has(path.basename(manifestPath))
  ) {
    throw new Error("Badge Blur could not verify the selected run file.");
  }

  const manifestRealPath = fs.realpathSync(manifestPath);
  const document = JSON.parse(fs.readFileSync(manifestRealPath, "utf8"));
  if (
    !document ||
    typeof document !== "object" ||
    !Array.isArray(document.files) ||
    document.files.length === 0
  ) {
    throw new Error("The selected run file has no restorable source images.");
  }

  const runDirectory = path.dirname(manifestRealPath);
  const exportsDirectory = path.dirname(runDirectory);
  const sourceDirectory = path.dirname(exportsDirectory);
  if (
    path.basename(runDirectory) !== document.runFolderName ||
    path.basename(exportsDirectory).toLowerCase() !== "exports" ||
    path.basename(sourceDirectory) !== document.sourceRootName
  ) {
    throw new Error(
      "The run file is not inside its original source-folder exports directory.",
    );
  }

  const sourceRealPath = fs.realpathSync(sourceDirectory);
  const makeToken =
    typeof tokenFactory === "function" ? tokenFactory : () => crypto.randomUUID();
  const seenPaths = new Set();
  const files = document.files.map((entry) => {
    const relativePath = normalizeRelativePath(
      entry?.sourcePath || entry?.input || "",
    );
    if (!isSafeRelativePath(relativePath) || seenPaths.has(relativePath)) {
      throw new Error("The run file contains an unsafe or duplicate source path.");
    }
    seenPaths.add(relativePath);

    const candidatePath = path.resolve(sourceRealPath, ...relativePath.split("/"));
    const realPath = fs.realpathSync(candidatePath);
    if (!isInsideDirectory(sourceRealPath, realPath)) {
      throw new Error("A referenced source image resolves outside its source folder.");
    }
    const stat = fs.statSync(realPath);
    if (!stat.isFile()) {
      throw new Error(`${relativePath} is not a source image file.`);
    }
    if (entry.byteSize != null && Number(entry.byteSize) !== stat.size) {
      throw new Error(`${relativePath} has changed since this run was exported.`);
    }
    return {
      token: makeToken(relativePath),
      realPath,
      name: path.basename(relativePath),
      relativePath,
      size: stat.size,
      lastModified: stat.mtimeMs,
      type: mimeTypeForName(relativePath),
    };
  });

  return {
    runId: document.runId,
    runFolderName: document.runFolderName,
    sourceRootName: document.sourceRootName,
    files,
  };
}

function normalizeRelativePath(value) {
  return String(value).replaceAll("\\", "/").replace(/^\.?\//, "");
}

function isSafeRelativePath(value) {
  if (!value || value.startsWith("/") || /^[A-Za-z]:\//.test(value)) {
    return false;
  }
  return !value.split("/").some((part) => !part || part === "..");
}

function isInsideDirectory(directory, candidate) {
  const relative = path.relative(directory, candidate);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function mimeTypeForName(name) {
  switch (path.extname(name).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".tif":
    case ".tiff":
      return "image/tiff";
    case ".webp":
      return "image/webp";
    case ".avif":
      return "image/avif";
    case ".heic":
      return "image/heic";
    case ".heif":
      return "image/heif";
    default:
      return "application/octet-stream";
  }
}

module.exports = {
  RUN_CHECKPOINT_FILE_NAME,
  RUN_MANIFEST_FILE_NAME,
  recoverManifestSource,
};
