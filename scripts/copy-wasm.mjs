import { cp, mkdir, readdir } from "node:fs/promises";
import path from "node:path";

const source = path.resolve("node_modules/onnxruntime-web/dist");
const destination = path.resolve("public/vendor/onnx");
await mkdir(destination, { recursive: true });

const files = await readdir(source);
const wasmFiles = files.filter(
  (file) => file.endsWith(".wasm") || file.endsWith(".mjs"),
);

for (const file of wasmFiles) {
  await cp(path.join(source, file), path.join(destination, file));
}

console.log(`Copied ${wasmFiles.length} ONNX Runtime assets.`);
