const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  RUN_MANIFEST_FILE_NAME,
  recoverManifestSource,
} = require("../electron/manifest-source.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "badge-blur-recovery-"));
try {
  const sourceRoot = path.join(root, "ai_test_images");
  const runFolderName = "badge-remover-run-20260724-160435-958a32ff";
  const runDirectory = path.join(sourceRoot, "exports", runFolderName);
  fs.mkdirSync(path.join(sourceRoot, "nested"), { recursive: true });
  fs.mkdirSync(runDirectory, { recursive: true });
  const first = path.join(sourceRoot, "one.png");
  const second = path.join(sourceRoot, "nested", "two.jpg");
  fs.writeFileSync(first, Buffer.from("one"));
  fs.writeFileSync(second, Buffer.from("two-two"));
  const manifest = {
    schemaVersion: 10,
    runId: "958a32ff-a7d2-4ea2-af34-92601dcc9a89",
    runFolderName,
    sourceRootName: "ai_test_images",
    localOnly: true,
    files: [
      {
        sourcePath: "one.png",
        byteSize: fs.statSync(first).size,
        reviewedMasks: [],
      },
      {
        sourcePath: "nested/two.jpg",
        byteSize: fs.statSync(second).size,
        reviewedMasks: [],
      },
    ],
  };
  const manifestPath = path.join(runDirectory, RUN_MANIFEST_FILE_NAME);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));

  let token = 0;
  const recovery = recoverManifestSource(manifestPath, {
    tokenFactory: () => `token-${++token}`,
  });
  assert.equal(recovery.runId, manifest.runId);
  assert.equal(recovery.sourceRootName, "ai_test_images");
  assert.deepEqual(
    recovery.files.map(({ token: fileToken, relativePath, size }) => ({
      fileToken,
      relativePath,
      size,
    })),
    [
      { fileToken: "token-1", relativePath: "one.png", size: 3 },
      { fileToken: "token-2", relativePath: "nested/two.jpg", size: 7 },
    ],
  );

  const copiedManifest = path.join(root, RUN_MANIFEST_FILE_NAME);
  fs.writeFileSync(copiedManifest, JSON.stringify(manifest));
  assert.throws(
    () => recoverManifestSource(copiedManifest),
    /not inside its original source-folder exports directory/,
  );

  fs.writeFileSync(second, Buffer.from("changed-size"));
  assert.throws(
    () => recoverManifestSource(manifestPath),
    /has changed/,
  );

  console.log(
    JSON.stringify({
      inferredOriginalSourceFolder: true,
      exactRunRelationshipRequired: true,
      sourceSizeVerified: true,
      lazyReadTokensCreated: true,
    }),
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
