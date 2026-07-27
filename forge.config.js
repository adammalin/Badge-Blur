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
const macSigningEnabled = process.env.MACOS_SIGNING_ENABLED === "1";
const macNotarizeConfig =
  process.env.APPLE_API_KEY &&
  process.env.APPLE_API_KEY_ID &&
  process.env.APPLE_API_ISSUER
    ? {
        appleApiKey: process.env.APPLE_API_KEY,
        appleApiKeyId: process.env.APPLE_API_KEY_ID,
        appleApiIssuer: process.env.APPLE_API_ISSUER,
      }
    : process.env.APPLE_ID &&
        process.env.APPLE_APP_SPECIFIC_PASSWORD &&
        process.env.APPLE_TEAM_ID
      ? {
          appleId: process.env.APPLE_ID,
          appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
          teamId: process.env.APPLE_TEAM_ID,
        }
      : null;
const windowsCertificateConfigured =
  Boolean(process.env.WINDOWS_CERTIFICATE_FILE) &&
  Boolean(process.env.WINDOWS_CERTIFICATE_PASSWORD);

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
    ...(macSigningEnabled ? { osxSign: {} } : {}),
    ...(macSigningEnabled && macNotarizeConfig
      ? { osxNotarize: macNotarizeConfig }
      : {}),
    ignore: [
      /^\/(?:\.git|\.github|\.cache|benchmark-output|demo-test-images|out|public|release-notes|releases|src|test-data|test-fixtures|test-output)(?:\/|$)/,
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
      if (macSigningEnabled) return;
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
        ...(windowsCertificateConfigured
          ? {
              certificateFile: process.env.WINDOWS_CERTIFICATE_FILE,
              certificatePassword: process.env.WINDOWS_CERTIFICATE_PASSWORD,
            }
          : {}),
      },
    },
  ],
};
