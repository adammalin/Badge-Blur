import assert from "node:assert/strict";
import {
  RUN_CHECKPOINT_FILE_NAME,
  RUN_MANIFEST_FILE_NAME,
  validateRunImport,
  validateSourceSelection,
} from "../src/run-import.js";

const manifest = {
  schemaVersion: 10,
  appVersion: "0.20.0",
  runId: "958a32ff-a7d2-4ea2-af34-92601dcc9a89",
  runFolderName: "badge-remover-run-20260724-160435-958a32ff",
  sourceRootName: "ai_test_images",
  localOnly: true,
  files: [
    {
      input: "one.png",
      sourcePath: "one.png",
      byteSize: 100,
      reviewedMasks: [],
    },
    {
      input: "nested/two.jpg",
      sourcePath: "nested/two.jpg",
      byteSize: 200,
      reviewedMasks: [{ id: "mask-1" }],
    },
  ],
};

assert.deepEqual(validateRunImport(RUN_MANIFEST_FILE_NAME, manifest), {
  checkpoint: false,
  expectedName: RUN_MANIFEST_FILE_NAME,
  sourceRootName: "ai_test_images",
  fileCount: 2,
});
assert.throws(
  () => validateRunImport("badge-training-annotations.coco.json", manifest),
  /Choose badge-removal-manifest\.json/,
);
assert.throws(
  () => validateRunImport(RUN_MANIFEST_FILE_NAME, { files: [] }),
  /schema version/,
);
assert.throws(
  () =>
    validateRunImport(RUN_MANIFEST_FILE_NAME, {
      ...manifest,
      files: [{ ...manifest.files[0], sourcePath: "../one.png" }],
    }),
  /unsafe/,
);

const checkpoint = {
  ...manifest,
  documentType: "badge-blur-batch-checkpoint",
  schemaVersion: 1,
};
assert.equal(
  validateRunImport(RUN_CHECKPOINT_FILE_NAME, checkpoint).checkpoint,
  true,
);
assert.throws(
  () => validateRunImport(RUN_MANIFEST_FILE_NAME, checkpoint),
  /Choose badge-blur-checkpoint\.json/,
);

const selected = [
  {
    relativePath: "one.png",
    file: { size: 100 },
  },
  {
    relativePath: "nested/two.jpg",
    file: { size: 200 },
  },
];
assert.doesNotThrow(() => validateSourceSelection(manifest, selected));
assert.throws(
  () => validateSourceSelection(manifest, selected.slice(0, 1)),
  /1 referenced image\(s\) are missing/,
);
assert.throws(
  () =>
    validateSourceSelection(manifest, [
      selected[0],
      { ...selected[1], file: { size: 201 } },
    ]),
  /1 referenced image\(s\) have changed/,
);

console.log(
  JSON.stringify({
    exactManifestNameRequired: true,
    checkpointNameRequired: true,
    unsafePathsRejected: true,
    sourceFilesVerified: true,
  }),
);
