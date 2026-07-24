const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  resolveVerifiedExportFolder,
} = require("../electron/export-folder.cjs");

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "badge-blur-export-"));
try {
  const sourceRoot = path.join(temporary, "photos");
  const nestedSource = path.join(sourceRoot, "event", "image.jpg");
  const runFolderName = "badge-remover-run-20260724-170000-a1b2c3d4";
  const runFolder = path.join(sourceRoot, "exports", runFolderName);
  const checkpointPath = path.join(runFolder, "badge-blur-checkpoint.json");
  fs.mkdirSync(path.dirname(nestedSource), { recursive: true });
  fs.mkdirSync(runFolder, { recursive: true });
  fs.writeFileSync(nestedSource, "photo");
  fs.writeFileSync(checkpointPath, "{}");

  assert.equal(
    resolveVerifiedExportFolder({ checkpointPath }),
    fs.realpathSync(runFolder),
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
    null,
  );
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

console.log(
  JSON.stringify({
    directCheckpointVerified: true,
    sourceExportDerived: true,
    traversalRejected: true,
    missingCheckpointRejected: true,
  }),
);
