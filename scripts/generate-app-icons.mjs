import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import sharp from "sharp";

const projectRoot = resolve(import.meta.dirname, "..");
const sourcePath = resolve(
  projectRoot,
  "packaging/assets/badge-blur-source.png",
);
const publicIconPath = resolve(projectRoot, "public/badge-blur.png");
const macResourcesPath = resolve(
  projectRoot,
  "packaging/Badge Blur.app/Contents/Resources",
);
const macIconPath = resolve(macResourcesPath, "BadgeBlur.icns");
const windowsIconPath = resolve(
  projectRoot,
  "packaging/assets/BadgeBlur.ico",
);

await mkdir(resolve(projectRoot, "public"), { recursive: true });
await mkdir(macResourcesPath, { recursive: true });
await mkdir(resolve(projectRoot, "packaging/assets"), { recursive: true });

await sharp(sourcePath)
  .resize(512, 512, { fit: "contain" })
  .png({ compressionLevel: 9 })
  .toFile(publicIconPath);

const iconsetRoot = await mkdtemp(
  resolve(tmpdir(), "badge-blur-iconset-"),
);
const iconsetPath = resolve(iconsetRoot, "BadgeBlur.iconset");
await mkdir(iconsetPath);

const macIconSizes = [
  ["icon_16x16.png", 16],
  ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32],
  ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128],
  ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256],
  ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512],
  ["icon_512x512@2x.png", 1024],
];

try {
  await Promise.all(
    macIconSizes.map(([name, size]) =>
      sharp(sourcePath)
        .resize(size, size, { fit: "contain" })
        .png({ compressionLevel: 9 })
        .toFile(resolve(iconsetPath, name)),
    ),
  );
  execFileSync("/usr/bin/iconutil", [
    "-c",
    "icns",
    iconsetPath,
    "-o",
    macIconPath,
  ]);
} finally {
  await rm(iconsetRoot, { recursive: true, force: true });
}

const windowsSizes = [256, 128, 64, 48, 32, 16];
const windowsPngs = await Promise.all(
  windowsSizes.map((size) =>
    sharp(sourcePath)
      .resize(size, size, { fit: "contain" })
      .png({ compressionLevel: 9 })
      .toBuffer(),
  ),
);
await writeFile(windowsIconPath, createIco(windowsSizes, windowsPngs));

const sourceInfo = await sharp(await readFile(sourcePath)).metadata();
console.log(
  `Generated Badge Blur icons from ${sourceInfo.width}×${sourceInfo.height} source.`,
);

function createIco(sizes, images) {
  const headerSize = 6;
  const entrySize = 16;
  const directory = Buffer.alloc(headerSize + entrySize * images.length);
  directory.writeUInt16LE(0, 0);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(images.length, 4);

  let offset = directory.length;
  images.forEach((image, index) => {
    const entryOffset = headerSize + index * entrySize;
    const size = sizes[index];
    directory.writeUInt8(size === 256 ? 0 : size, entryOffset);
    directory.writeUInt8(size === 256 ? 0 : size, entryOffset + 1);
    directory.writeUInt8(0, entryOffset + 2);
    directory.writeUInt8(0, entryOffset + 3);
    directory.writeUInt16LE(1, entryOffset + 4);
    directory.writeUInt16LE(32, entryOffset + 6);
    directory.writeUInt32LE(image.length, entryOffset + 8);
    directory.writeUInt32LE(offset, entryOffset + 12);
    offset += image.length;
  });

  return Buffer.concat([directory, ...images]);
}
