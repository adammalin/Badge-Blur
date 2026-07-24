import {
  findRunEntry,
  indexRunFiles,
  normalizeSourcePath,
} from "./run-storage.js";

export const RUN_MANIFEST_FILE_NAME = "badge-removal-manifest.json";
export const RUN_CHECKPOINT_FILE_NAME = "badge-blur-checkpoint.json";

const CHECKPOINT_DOCUMENT_TYPE = "badge-blur-batch-checkpoint";

export function validateRunImport(fileName, document) {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new Error("The selected file does not contain a Badge Blur run.");
  }

  const checkpoint = document.documentType === CHECKPOINT_DOCUMENT_TYPE;
  const expectedName = checkpoint
    ? RUN_CHECKPOINT_FILE_NAME
    : RUN_MANIFEST_FILE_NAME;
  if (fileName !== expectedName) {
    throw new Error(
      `Choose ${expectedName}; ${fileName || "that file"} is not the expected Badge Blur file.`,
    );
  }
  if (!Number.isInteger(Number(document.schemaVersion))) {
    throw new Error("The Badge Blur schema version is missing or invalid.");
  }
  if (checkpoint && Number(document.schemaVersion) !== 1) {
    throw new Error(
      `Checkpoint schema ${document.schemaVersion} is not supported by this version of Badge Blur.`,
    );
  }
  if (document.localOnly !== true) {
    throw new Error("This is not a local-only Badge Blur run file.");
  }
  if (!isNonEmptyString(document.runId)) {
    throw new Error("The Badge Blur run ID is missing.");
  }
  if (!isNonEmptyString(document.runFolderName)) {
    throw new Error("The Badge Blur run-folder name is missing.");
  }
  if (!isNonEmptyString(document.sourceRootName)) {
    throw new Error("The original source-folder name is missing.");
  }
  if (!Array.isArray(document.files) || document.files.length === 0) {
    throw new Error("The Badge Blur run does not contain any restorable files.");
  }

  const seenPaths = new Set();
  for (const entry of document.files) {
    const sourcePath = normalizeSourcePath(entry?.sourcePath || entry?.input || "");
    if (!isSafeRelativePath(sourcePath)) {
      throw new Error("A source-image path in the run file is missing or unsafe.");
    }
    if (seenPaths.has(sourcePath)) {
      throw new Error(`The run file contains a duplicate source path: ${sourcePath}.`);
    }
    seenPaths.add(sourcePath);
    if (!Array.isArray(entry.reviewedMasks)) {
      throw new Error(`Reviewed masks are missing for ${sourcePath}.`);
    }
    if (
      entry.byteSize != null &&
      (!Number.isFinite(Number(entry.byteSize)) || Number(entry.byteSize) < 0)
    ) {
      throw new Error(`The source file size is invalid for ${sourcePath}.`);
    }
  }

  return {
    checkpoint,
    expectedName,
    sourceRootName: document.sourceRootName.trim(),
    fileCount: document.files.length,
  };
}

export function validateSourceSelection(manifest, selected) {
  if (!manifest || !Array.isArray(manifest.files)) return;
  const selectedIndex = indexRunFiles(
    selected.map(({ file, relativePath }) => ({
      sourcePath: relativePath,
      byteSize: file.size,
    })),
  );
  const missing = [];
  const changed = [];
  for (const entry of manifest.files) {
    const sourcePath = normalizeSourcePath(entry.sourcePath || entry.input || "");
    const match = findRunEntry(selectedIndex, sourcePath);
    if (!match) {
      missing.push(sourcePath);
      continue;
    }
    if (
      entry.byteSize != null &&
      Number(entry.byteSize) !== Number(match.byteSize)
    ) {
      changed.push(sourcePath);
    }
  }
  if (missing.length || changed.length) {
    const details = [
      missing.length ? `${missing.length} referenced image(s) are missing` : "",
      changed.length ? `${changed.length} referenced image(s) have changed` : "",
    ]
      .filter(Boolean)
      .join(" and ");
    throw new Error(
      `That is not the original source folder: ${details}. Choose the folder named ${manifest.sourceRootName}.`,
    );
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isSafeRelativePath(path) {
  if (!path || path.startsWith("/") || /^[A-Za-z]:\//.test(path)) return false;
  return !path.split("/").some((part) => part === ".." || part === "");
}
