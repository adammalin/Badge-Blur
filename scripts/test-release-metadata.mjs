import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import process from "node:process";

const validator = "scripts/validate-release-metadata.mjs";
const current = spawnSync(process.execPath, [validator], {
  cwd: process.cwd(),
  encoding: "utf8",
});

assert.equal(
  current.status,
  0,
  `Current release metadata should pass:\n${current.stdout}${current.stderr}`,
);
assert.match(current.stdout, /Release metadata verified:/);

const mismatched = spawnSync(process.execPath, [validator, "v0.0.0"], {
  cwd: process.cwd(),
  encoding: "utf8",
});

assert.notEqual(mismatched.status, 0, "A mismatched release tag must fail.");
assert.match(mismatched.stderr, /does not match package\.json version/);

console.log("Release metadata validation tests passed.");
