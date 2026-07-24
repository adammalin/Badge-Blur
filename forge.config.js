import path from "node:path";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const macIcon = path.join(
  projectRoot,
  "packaging",
  "Badge Blur.app",
  "Contents",
  "Resources",
  "BadgeBlur.icns",
);
const windowsIcon = path.join(
  projectRoot,
  "packaging",
  "assets",
  "BadgeBlur.ico",
);

export default {
  packagerConfig: {
    appBundleId: "gov.ornl.badge-blur",
    appCategoryType: "public.app-category.photography",
    appCopyright: "Copyright UT-Battelle LLC",
    asar: false,
    executableName: "Badge Blur",
    icon: process.platform === "darwin" ? macIcon : windowsIcon,
    name: "Badge Blur",
    overwrite: true,
    prune: true,
    ignore: [
      /^\/(?:\.git|\.github|\.cache|benchmark-output|demo-test-images|out|public|release-notes|releases|src|test-data|test-output)(?:\/|$)/,
      /^\/(?:CHANGELOG|README|TEST-REPORT)\.md$/,
      /^\/index\.html$/,
      /^\/vite\.config\.js$/,
      /^\/scripts\/(?!serve\.mjs$|image-runtime\.mjs$)/,
      /^\/packaging\/(?!assets(?:\/|$))/,
    ],
  },
  hooks: {
    postPackage: async (_forgeConfig, packageResult) => {
      if (packageResult.platform !== "darwin") return;
      for (const outputPath of packageResult.outputPaths) {
        const appPath = path.join(outputPath, "Badge Blur.app");
        if (!existsSync(appPath)) {
          throw new Error(`Packaged Mac app was not found: ${appPath}`);
        }
        const result = spawnSync(
          "/usr/bin/codesign",
          ["--force", "--deep", "--sign", "-", appPath],
          { stdio: "inherit" },
        );
        if (result.status !== 0) {
          throw new Error(`Ad-hoc signing failed for ${appPath}`);
        }
      }
    },
  },
  makers: [
    {
      name: "@electron-forge/maker-dmg",
      platforms: ["darwin"],
      config: {
        backgroundColor: "#eff5f0",
        format: "ULFO",
        icon: macIcon,
        name: "Badge Blur",
      },
    },
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin"],
    },
    {
      name: "@electron-forge/maker-squirrel",
      platforms: ["win32"],
      config: {
        name: "BadgeBlur",
        authors: "UT-Battelle LLC",
        description:
          "Local-only desktop app for detecting and redacting identification badges.",
        setupIcon: windowsIcon,
        noMsi: true,
      },
    },
  ],
};
