const fs = require("node:fs");
const path = require("node:path");

const DOCUMENT_TYPE = "badge-blur-preferences";
const SCHEMA_VERSION = 1;
const FILE_NAME = "badge-blur-preferences.json";
const VERSION_PATTERN = /^[a-zA-Z0-9._-]{1,32}$/;

async function readOnboardingTourVersion(userDataPath) {
  try {
    const document = JSON.parse(
      await fs.promises.readFile(preferencePath(userDataPath), "utf8"),
    );
    if (
      document?.documentType !== DOCUMENT_TYPE ||
      Number(document?.schemaVersion) !== SCHEMA_VERSION ||
      !VERSION_PATTERN.test(String(document?.onboardingTourVersion || ""))
    ) {
      return null;
    }
    return String(document.onboardingTourVersion);
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function writeOnboardingTourVersion(userDataPath, version) {
  const normalizedVersion = String(version || "");
  if (!VERSION_PATTERN.test(normalizedVersion)) {
    throw new Error("The onboarding tour version is invalid.");
  }
  await fs.promises.mkdir(userDataPath, { recursive: true });
  const destination = preferencePath(userDataPath);
  const temporary = `${destination}.${process.pid}.tmp`;
  const document = {
    documentType: DOCUMENT_TYPE,
    schemaVersion: SCHEMA_VERSION,
    onboardingTourVersion: normalizedVersion,
  };
  await fs.promises.writeFile(
    temporary,
    `${JSON.stringify(document, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  await fs.promises.rename(temporary, destination);
  return normalizedVersion;
}

function preferencePath(userDataPath) {
  return path.join(path.resolve(userDataPath), FILE_NAME);
}

module.exports = {
  readOnboardingTourVersion,
  writeOnboardingTourVersion,
};
