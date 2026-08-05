const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  readOnboardingTourVersion,
  writeOnboardingTourVersion,
} = require("../electron/onboarding-preferences.cjs");

(async () => {
  const directory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "badge-blur-onboarding-")
  );
  try {
    assert.equal(await readOnboardingTourVersion(directory), null);
    assert.equal(await writeOnboardingTourVersion(directory, "1"), "1");
    assert.equal(await readOnboardingTourVersion(directory), "1");
    await assert.rejects(
      () => writeOnboardingTourVersion(directory, "../../unsafe"),
      /version is invalid/,
    );
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
  console.log("Onboarding preference persistence passed.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
