const fs = require("node:fs");
const path = require("node:path");

const RUN_FOLDER_PATTERN = /^badge-remover-run-\d{8}-\d{6}-[a-f0-9]{8}$/;
const CHECKPOINT_NAME = "badge-blur-checkpoint.json";
const CHECKPOINT_DOCUMENT_TYPE = "badge-blur-batch-checkpoint";

function resolveVerifiedExportFolder({
  checkpointPath = "",
  sourcePath = "",
  sourceRelativePath = "",
  runFolderName = "",
  runId = "",
} = {}) {
  const direct = verifiedCheckpointFolder(checkpointPath, {
    runFolderName,
    runId,
  });
  if (direct) return direct;

  const sourceRoot = resolveVerifiedSourceFolder({
    sourcePath,
    sourceRelativePath,
  });
  if (
    !sourceRoot ||
    typeof runFolderName !== "string" ||
    !RUN_FOLDER_PATTERN.test(runFolderName)
  ) {
    return null;
  }

  const exportRoot = path.join(sourceRoot, "exports");
  const candidate = path.join(exportRoot, runFolderName);
  if (!isInside(candidate, exportRoot)) return null;
  return verifiedDirectory(candidate);
}

function resolveDiscoveredExportFolder({
  searchResults = [],
  runFolderName = "",
  runId = "",
  sourceRootName = "",
  customExportRootName = "",
} = {}) {
  if (
    !Array.isArray(searchResults) ||
    !RUN_FOLDER_PATTERN.test(runFolderName) ||
    typeof runId !== "string" ||
    !runId
  ) {
    return null;
  }

  const candidates = new Set();
  for (const result of searchResults) {
    if (typeof result !== "string" || !path.isAbsolute(result)) continue;
    const resolved = path.resolve(result);
    const resultName = path.basename(resolved);
    if (resultName === runFolderName) candidates.add(resolved);
    if (sourceRootName && resultName === sourceRootName) {
      candidates.add(path.join(resolved, "exports", runFolderName));
    }
    if (customExportRootName && resultName === customExportRootName) {
      candidates.add(path.join(resolved, runFolderName));
    }
  }

  const verified = new Set(
    [...candidates]
      .map((candidate) => verifiedRunFolder(candidate, { runFolderName, runId }))
      .filter(Boolean),
  );
  return verified.size === 1 ? [...verified][0] : null;
}

function resolveVerifiedSourceFolder({
  sourcePath = "",
  sourceRelativePath = "",
} = {}) {
  if (
    typeof sourcePath !== "string" ||
    !path.isAbsolute(sourcePath) ||
    typeof sourceRelativePath !== "string" ||
    !isSafeRelativePath(sourceRelativePath)
  ) {
    return null;
  }
  try {
    const sourceRealPath = fs.realpathSync(sourcePath);
    if (!fs.statSync(sourceRealPath).isFile()) return null;
    const relativeParts = sourceRelativePath.split("/");
    let sourceRoot = path.dirname(sourceRealPath);
    for (let index = 1; index < relativeParts.length; index += 1) {
      sourceRoot = path.dirname(sourceRoot);
    }
    sourceRoot = fs.realpathSync(sourceRoot);
    const reconstructedSource = path.join(sourceRoot, ...relativeParts);
    return fs.realpathSync(reconstructedSource) === sourceRealPath
      ? sourceRoot
      : null;
  } catch {
    return null;
  }
}

function resolveSelectedRunFolder(folderPath, runFolderName) {
  if (
    typeof runFolderName !== "string" ||
    !RUN_FOLDER_PATTERN.test(runFolderName) ||
    typeof folderPath !== "string" ||
    path.basename(path.resolve(folderPath)) !== runFolderName
  ) {
    return null;
  }
  return verifiedDirectory(folderPath);
}

function verifiedCheckpointFolder(
  checkpointPath,
  { runFolderName = "", runId = "" } = {},
) {
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
    if (!fs.statSync(folder).isDirectory()) return null;
    if (!runFolderName && !runId) return folder;
    return verifiedRunFolder(folder, { runFolderName, runId });
  } catch {
    return null;
  }
}

function verifiedRunFolder(folderPath, { runFolderName, runId }) {
  const folder = verifiedDirectory(folderPath);
  if (
    !folder ||
    path.basename(folder) !== runFolderName ||
    !RUN_FOLDER_PATTERN.test(runFolderName)
  ) {
    return null;
  }
  try {
    const checkpointPath = path.join(folder, CHECKPOINT_NAME);
    if (!fs.statSync(checkpointPath).isFile()) return null;
    const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, "utf8"));
    return checkpoint.documentType === CHECKPOINT_DOCUMENT_TYPE &&
      checkpoint.runFolderName === runFolderName &&
      checkpoint.runId === runId
      ? folder
      : null;
  } catch {
    return null;
  }
}

function verifiedDirectory(folderPath) {
  if (typeof folderPath !== "string" || !path.isAbsolute(folderPath)) {
    return null;
  }
  try {
    const folder = fs.realpathSync(folderPath);
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
  resolveDiscoveredExportFolder,
  resolveSelectedRunFolder,
  resolveVerifiedExportFolder,
  resolveVerifiedSourceFolder,
};
