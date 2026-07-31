import { spawnSync } from "node:child_process";
import process from "node:process";

const tests = [
  "scripts/test-corner-fit.mjs",
  "scripts/test-redaction-strength.mjs",
  "scripts/test-redaction-strength-overrides.mjs",
  "scripts/test-export-formats.mjs",
  "scripts/test-worker-policy.mjs",
  "scripts/test-worker-pool.mjs",
  "scripts/test-classifier-policy.mjs",
  "scripts/test-detection-orientation.mjs",
  "scripts/test-detection-scale-policy.mjs",
  "scripts/test-person-guidance.mjs",
  "scripts/test-review-attention.mjs",
  "scripts/test-review-ui.mjs",
  "scripts/test-view-transform.mjs",
  "scripts/test-run-storage.mjs",
  "scripts/test-run-import.mjs",
  "scripts/test-manifest-source-recovery.cjs",
  "scripts/test-export-folder.cjs",
  "scripts/audit-local-only.mjs",
  "scripts/test-network-policy.cjs",
  "scripts/test-checkpoint.mjs",
  "scripts/test-thumbnail-preview.mjs",
  "scripts/test-mask-controls.mjs",
  "scripts/test-edit-revisions.mjs",
  "scripts/test-export-state.mjs",
  "scripts/test-server-lifecycle.mjs",
];

for (const test of tests) {
  console.log(`\n=== ${test} ===`);
  const result = spawnSync(process.execPath, [test], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`\nAll ${tests.length} deterministic tests passed.`);
