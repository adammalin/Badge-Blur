import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { env, pipeline } from "@huggingface/transformers";
import { DEFAULT_LABELS, DEFAULT_THRESHOLD, MODEL_ID } from "../src/detector-config.js";
import { decodePreview } from "./image-runtime.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const inputDirectory = resolve(
  argumentValue("--input") || resolve(projectRoot, "demo-test-images"),
);
const limit = Math.max(2, Number(argumentValue("--limit")) || 4);
const imageNames = (await readdir(inputDirectory))
  .filter((name) => /\.(jpe?g|png|tiff?|webp|avif|heic|heif)$/i.test(name))
  .sort((a, b) => a.localeCompare(b))
  .slice(0, limit);
if (imageNames.length < 2) {
  throw new Error("The worker benchmark needs at least two supported images.");
}

env.localModelPath = `${resolve(projectRoot, "public/models")}/`;
env.allowRemoteModels = false;
env.allowLocalModels = true;

const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "badge-worker-benchmark-"));
const previewPaths = [];
try {
  for (const imageName of imageNames) {
    const source = await (await import("node:fs/promises")).readFile(
      resolve(inputDirectory, imageName),
    );
    const decoded = await decodePreview(source, imageName);
    const path = resolve(temporaryDirectory, `${previewPaths.length}.jpg`);
    await writeFile(path, decoded.preview);
    previewPaths.push(path);
  }

  console.log(`Loading worker 1 (${MODEL_ID})`);
  const workers = [await loadDetector()];
  await runDetector(workers[0], previewPaths[0]);
  const oneWorker = await timedRun(workers, previewPaths);

  console.log("Loading worker 2");
  workers.push(await loadDetector());
  await runDetector(workers[1], previewPaths[0]);
  const twoWorkers = await timedRun(workers, previewPaths);

  for (const worker of workers) await worker.dispose?.();
  console.log(
    JSON.stringify(
      {
        imageCount: previewPaths.length,
        oneWorkerSeconds: seconds(oneWorker),
        twoWorkerSeconds: seconds(twoWorkers),
        speedup: Number((oneWorker / twoWorkers).toFixed(2)),
        fasterMode: twoWorkers < oneWorker ? 2 : 1,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

async function loadDetector() {
  return pipeline("zero-shot-object-detection", MODEL_ID, {
    dtype: "q8",
    device: "cpu",
  });
}

async function timedRun(workers, paths) {
  let nextIndex = 0;
  const startedAt = performance.now();
  await Promise.all(
    workers.map(async (worker) => {
      while (nextIndex < paths.length) {
        const index = nextIndex;
        nextIndex += 1;
        await runDetector(worker, paths[index]);
      }
    }),
  );
  return performance.now() - startedAt;
}

async function runDetector(worker, path) {
  return worker(path, DEFAULT_LABELS, {
    threshold: DEFAULT_THRESHOLD,
    top_k: 40,
  });
}

function seconds(milliseconds) {
  return Number((milliseconds / 1000).toFixed(2));
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}
