import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

const projectRoot = resolve(import.meta.dirname, "..");
const packageJsonPath = resolve(projectRoot, "package.json");
const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
const expectedTag = `v${packageJson.version}`;
const suppliedTag = process.argv[2] || expectedTag;

if (!/^v\d+\.\d+\.\d+$/.test(suppliedTag)) {
  fail(`Release tag must use vMAJOR.MINOR.PATCH; received ${suppliedTag}.`);
}

if (suppliedTag !== expectedTag) {
  fail(
    `Release tag ${suppliedTag} does not match package.json version ${packageJson.version}.`,
  );
}

const releaseNotesPath = resolve(
  projectRoot,
  "release-notes",
  `${suppliedTag}.md`,
);
let releaseNotes;
try {
  releaseNotes = await readFile(releaseNotesPath, "utf8");
} catch (error) {
  if (error?.code === "ENOENT") {
    fail(`Release notes are missing: release-notes/${suppliedTag}.md.`);
  }
  throw error;
}

if (!releaseNotes.trim()) {
  fail(`Release notes are empty: release-notes/${suppliedTag}.md.`);
}

if (!releaseNotes.includes(packageJson.version)) {
  fail(
    `Release notes for ${suppliedTag} do not mention version ${packageJson.version}.`,
  );
}

console.log(
  `Release metadata verified: ${suppliedTag} matches package.json and its release notes.`,
);

function fail(message) {
  console.error(message);
  process.exit(1);
}
