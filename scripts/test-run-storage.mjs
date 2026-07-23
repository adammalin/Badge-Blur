import assert from "node:assert/strict";
import {
  createUniqueRunDirectory,
  findRunEntry,
  indexRunFiles,
  normalizeSourcePath,
} from "../src/run-storage.js";

const entries = [
  { sourcePath: "Originals/session-a/person.jpg", byteSize: 10 },
  { sourcePath: "Originals/session-b/person.jpg", byteSize: 20 },
  { sourcePath: "Originals/unique.jpg", byteSize: 30 },
];
const index = indexRunFiles(entries);
assert.equal(
  findRunEntry(index, "Originals/session-a/person.jpg"),
  entries[0],
);
assert.equal(
  findRunEntry(index, "MovedFolder/unique.jpg"),
  entries[2],
);
assert.equal(
  findRunEntry(index, "MovedFolder/session-a/person.jpg"),
  entries[0],
);
assert.equal(
  findRunEntry(index, "MovedFolder/person.jpg"),
  null,
);
assert.equal(normalizeSourcePath(".\\Originals\\unique.jpg"), "Originals/unique.jpg");

const existing = new Set([
  "badge-remover-run-20260723-123456-12345678",
]);
const parentDirectory = {
  async getDirectoryHandle(name, options = {}) {
    if (options.create) {
      existing.add(name);
      return { name };
    }
    if (existing.has(name)) return { name };
    const error = new Error("Not found");
    error.name = "NotFoundError";
    throw error;
  },
};
const run = await createUniqueRunDirectory(parentDirectory, {
  now: new Date(2026, 6, 23, 12, 34, 56),
  runId: "12345678-1234-1234-1234-123456789abc",
});
assert.equal(run.name, "badge-remover-run-20260723-123456-12345678-2");
assert.equal(run.directory.name, run.name);
assert(existing.has(run.name));

console.log(
  JSON.stringify({
    exactPathMatch: true,
    movedRootMatch: true,
    ambiguousFilenameRejected: true,
    existingRunFolderPreserved: true,
    createdFolder: run.name,
  }),
);
