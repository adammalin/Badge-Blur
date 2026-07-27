import { env, pipeline } from "@huggingface/transformers";
import {
  CLASSIFIER_MODEL_ID,
  MODEL_ID,
} from "./detector-config.js";

const logicalProcessors = navigator.hardwareConcurrency || 4;
const inferenceThreads = Math.max(
  1,
  Math.min(2, logicalProcessors - 4),
);

env.localModelPath = "/models/";
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.backends.onnx.wasm.wasmPaths = "/vendor/onnx/";
env.backends.onnx.wasm.numThreads = inferenceThreads;

let detector = null;
let classifier = null;

self.addEventListener("message", async (event) => {
  const message = event.data;
  if (!message || typeof message !== "object") return;

  if (message.type === "initialize") {
    try {
      detector = await pipeline("zero-shot-object-detection", MODEL_ID, {
        dtype: "q8",
        device: "wasm",
      });
      classifier = await pipeline(
        "zero-shot-image-classification",
        CLASSIFIER_MODEL_ID,
        {
          dtype: "q8",
          device: "wasm",
        },
      );
      self.postMessage({
        type: "ready",
        workerNumber: message.workerNumber,
        inferenceThreads,
      });
    } catch (error) {
      self.postMessage({
        type: "initialization-error",
        error: serializeError(error),
      });
    }
    return;
  }

  if (message.type === "dispose") {
    await Promise.allSettled([
      detector?.dispose?.(),
      classifier?.dispose?.(),
    ]);
    detector = null;
    classifier = null;
    self.close();
    return;
  }

  if (message.type !== "inference" || !message.requestId) return;
  try {
    if (!detector || !classifier) {
      throw new Error("The local model worker is not ready.");
    }
    const model =
      message.model === "detector" ? detector : classifier;
    const result = await model(...message.arguments);
    self.postMessage({
      type: "result",
      requestId: message.requestId,
      result,
    });
  } catch (error) {
    self.postMessage({
      type: "inference-error",
      requestId: message.requestId,
      error: serializeError(error),
    });
  }
});

function serializeError(error) {
  return {
    name: error?.name || "Error",
    message: error?.message || String(error),
    stack: error?.stack || null,
  };
}
