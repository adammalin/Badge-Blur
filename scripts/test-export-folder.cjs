const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  resolveDiscoveredExportFolder,
  resolveSelectedRunFolder,
  resolveVerifiedExportFolder,
  resolveVerifiedSourceFolder,
} = require("../electron/export-folder.cjs");

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "badge-blur-export-"));
try {
  const sourceRoot = path.join(temporary, "photos");
  const nestedSource = path.join(sourceRoot, "event", "image.jpg");
  const runFolderName = "badge-remover-run-20260724-170000-a1b2c3d4";
  const runId = "a1b2c3d4-1111-4222-8333-123456789abc";
  const runFolder = path.join(sourceRoot, "exports", runFolderName);
  const checkpointPath = path.join(runFolder, "badge-blur-checkpoint.json");
  fs.mkdirSync(path.dirname(nestedSource), { recursive: true });
  fs.mkdirSync(runFolder, { recursive: true });
  fs.writeFileSync(nestedSource, "photo");
  fs.writeFileSync(
    checkpointPath,
    JSON.stringify({
      documentType: "badge-blur-batch-checkpoint",
      runFolderName,
      runId,
    }),
  );

  assert.equal(
    resolveVerifiedExportFolder({ checkpointPath }),
    fs.realpathSync(runFolder),
  );
  assert.equal(
    resolveVerifiedExportFolder({ checkpointPath, runFolderName, runId }),
    fs.realpathSync(runFolder),
  );
  assert.equal(
    resolveDiscoveredExportFolder({
      searchResults: [runFolder],
      runFolderName,
      runId,
      sourceRootName: path.basename(sourceRoot),
    }),
    fs.realpathSync(runFolder),
  );
  assert.equal(
    resolveDiscoveredExportFolder({
      searchResults: [sourceRoot],
      runFolderName,
      runId,
      sourceRootName: path.basename(sourceRoot),
    }),
    fs.realpathSync(runFolder),
  );
  assert.equal(
    resolveDiscoveredExportFolder({
      searchResults: [runFolder],
      runFolderName,
      runId: "wrong-run-id",
      sourceRootName: path.basename(sourceRoot),
    }),
    null,
  );
  assert.equal(
    resolveVerifiedExportFolder({
      sourcePath: nestedSource,
      sourceRelativePath: "event/image.jpg",
      runFolderName,
    }),
    fs.realpathSync(runFolder),
  );
  assert.equal(
    resolveVerifiedSourceFolder({
      sourcePath: nestedSource,
      sourceRelativePath: "event/image.jpg",
    }),
    fs.realpathSync(sourceRoot),
  );
  assert.equal(
    resolveSelectedRunFolder(runFolder, runFolderName),
    fs.realpathSync(runFolder),
  );
  assert.equal(
    resolveSelectedRunFolder(sourceRoot, runFolderName),
    null,
  );
  assert.equal(
    resolveVerifiedExportFolder({
      sourcePath: nestedSource,
      sourceRelativePath: "../image.jpg",
      runFolderName,
    }),
    null,
  );
  assert.equal(
    resolveVerifiedExportFolder({
      sourcePath: nestedSource,
      sourceRelativePath: "event/image.jpg",
      runFolderName: "../../outside",
    }),
    null,
  );
  fs.unlinkSync(checkpointPath);
  assert.equal(
    resolveVerifiedExportFolder({
      sourcePath: nestedSource,
      sourceRelativePath: "event/image.jpg",
      runFolderName,
    }),
    fs.realpathSync(runFolder),
  );
  fs.rmSync(runFolder, { recursive: true });
  assert.equal(
    resolveVerifiedExportFolder({
      sourcePath: nestedSource,
      sourceRelativePath: "event/image.jpg",
      runFolderName,
    }),
    null,
  );
  assert.equal(
    resolveVerifiedSourceFolder({
      sourcePath: nestedSource,
      sourceRelativePath: "different/image.jpg",
    }),
    null,
  );
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

console.log(
  JSON.stringify({
    directCheckpointVerified: true,
    spotlightRunVerified: true,
    mismatchedRunIdRejected: true,
    manuallySelectedRunVerified: true,
    sourceExportDerived: true,
    traversalRejected: true,
    existingRunWithoutCheckpointAccepted: true,
    missingRunRejected: true,
    mismatchedSourcePathRejected: true,
  }),
);
