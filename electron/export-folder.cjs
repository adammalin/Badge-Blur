const fs = require("node:fs");
const path = require("node:path");

const RUN_FOLDER_PATTERN = /^badge-remover-run-\d{8}-\d{6}-[a-f0-9]{8}$/;
const CHECKPOINT_NAME = "badge-blur-checkpoint.json";

function resolveVerifiedExportFolder({
  checkpointPath = "",
  sourcePath = "",
  sourceRelativePath = "",
  runFolderName = "",
} = {}) {
  const direct = verifiedCheckpointFolder(checkpointPath);
  if (direct) return direct;

  if (
    typeof sourcePath !== "string" ||
    !path.isAbsolute(sourcePath) ||
    typeof sourceRelativePath !== "string" ||
    !isSafeRelativePath(sourceRelativePath) ||
    typeof runFolderName !== "string" ||
    !RUN_FOLDER_PATTERN.test(runFolderName)
  ) {
    return null;
  }

  const relativeParts = sourceRelativePath.split("/");
  let sourceRoot = path.dirname(path.resolve(sourcePath));
  for (let index = 1; index < relativeParts.length; index += 1) {
    sourceRoot = path.dirname(sourceRoot);
  }
  const exportRoot = path.join(sourceRoot, "exports");
  const candidate = path.join(exportRoot, runFolderName);
  if (!isInside(candidate, exportRoot)) return null;
  return verifiedCheckpointFolder(path.join(candidate, CHECKPOINT_NAME));
}

function verifiedCheckpointFolder(checkpointPath) {
  if (
    typeof checkpointPath !== "string" ||
    !path.isAbsolute(checkpointPath) ||
    path.basename(checkpointPath) !== CHECKPOINT_NAME
  ) {
    return null;
  }
  try {
    const checkpointRealPath = fs.realpathSync(checkpointPath);
    if (
      path.basename(checkpointRealPath) !== CHECKPOINT_NAME ||
      !fs.statSync(checkpointRealPath).isFile()
    ) {
      return null;
    }
    const folder = fs.realpathSync(path.dirname(checkpointRealPath));
    return fs.statSync(folder).isDirectory() ? folder : null;
  } catch {
    return null;
  }
}

function isSafeRelativePath(value) {
  if (
    !value ||
    value.includes("\\") ||
    value.startsWith("/") ||
    value.endsWith("/")
  ) {
    return false;
  }
  const parts = value.split("/");
  return parts.every((part) => part && part !== "." && part !== "..");
}

function isInside(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

module.exports = {
  CHECKPOINT_NAME,
  RUN_FOLDER_PATTERN,
  resolveVerifiedExportFolder,
};
