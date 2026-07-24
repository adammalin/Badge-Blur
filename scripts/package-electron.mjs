import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(
  await import("node:fs/promises").then(({ readFile }) =>
    readFile(path.join(projectRoot, "package.json"), "utf8"),
  ),
);
const target = process.argv[2];
const targetConfig =
  target === "mac"
    ? {
        platform: "darwin",
        arch: "arm64",
        assets: [
          {
            extension: ".dmg",
            output: `Badge-Blur-Mac-arm64-v${packageJson.version}.dmg`,
          },
          {
            extension: ".zip",
            output: `Badge-Blur-Mac-arm64-v${packageJson.version}.zip`,
          },
        ],
      }
    : target === "windows"
      ? {
          platform: "win32",
          arch: "x64",
          assets: [
            {
              extension: ".exe",
              nameIncludes: "Setup",
              output: `Badge-Blur-Windows-x64-Setup-v${packageJson.version}.exe`,
            },
          ],
        }
      : null;

if (!targetConfig) {
  console.error("Usage: node scripts/package-electron.mjs <mac|windows>");
  process.exit(1);
}

const forgeCli = path.join(
  projectRoot,
  "node_modules",
  "@electron-forge",
  "cli",
  "dist",
  "electron-forge.js",
);
const result = spawnSync(
  process.execPath,
  [
    forgeCli,
    "make",
    "--platform",
    targetConfig.platform,
    "--arch",
    targetConfig.arch,
  ],
  {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
  },
);
if (result.status !== 0) process.exit(result.status || 1);

const makeRoot = path.join(projectRoot, "out", "make");
const releaseRoot = path.join(projectRoot, "releases");
mkdirSync(releaseRoot, { recursive: true });
const allFiles = collectFiles(makeRoot);

for (const asset of targetConfig.assets) {
  const artifactCandidates = allFiles.filter((filePath) => {
    const name = path.basename(filePath);
    return (
      name.toLowerCase().endsWith(asset.extension) &&
      (!asset.nameIncludes || name.includes(asset.nameIncludes))
    );
  });
  const versionMatches = artifactCandidates.filter((filePath) =>
    path.basename(filePath).includes(packageJson.version),
  );
  const matches =
    versionMatches.length === 1 ? versionMatches : artifactCandidates;
  if (matches.length !== 1) {
    throw new Error(
      `Expected one ${asset.extension} artifact, found ${matches.length}:\n` +
        matches.join("\n"),
    );
  }

  const destination = path.join(releaseRoot, asset.output);
  if (existsSync(destination)) {
    throw new Error(
      `Release artifact already exists. Move it aside first: ${destination}`,
    );
  }
  copyFileSync(matches[0], destination);
  const digest = sha256(destination);
  writeFileSync(`${destination}.sha256`, `${digest}  ${asset.output}\n`);
  console.log(`Created ${destination}`);
  console.log(`Created ${destination}.sha256`);
}

function collectFiles(root) {
  const files = [];
  for (const entry of readdirSync(root)) {
    const candidate = path.join(root, entry);
    if (statSync(candidate).isDirectory()) {
      files.push(...collectFiles(candidate));
    } else {
      files.push(candidate);
    }
  }
  return files;
}

function sha256(filePath) {
  const hash = createHash("sha256");
  hash.update(readFileSync(filePath));
  return hash.digest("hex");
}
