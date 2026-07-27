export function createModelWorker(workerNumber, { onStatus } = {}) {
  const worker = new Worker(
    new URL("./model-inference-worker.js", import.meta.url),
    {
      type: "module",
      name: `badge-blur-inference-${workerNumber}`,
    },
  );
  const requests = new Map();
  let requestSequence = 0;
  let disposed = false;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const fail = (serialized, fallbackMessage) => {
    const error = restoreError(serialized, fallbackMessage);
    rejectReady(error);
    for (const request of requests.values()) request.reject(error);
    requests.clear();
  };

  worker.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || typeof message !== "object") return;
    if (message.type === "ready") {
      onStatus?.(message);
      resolveReady(message);
      return;
    }
    if (message.type === "initialization-error") {
      fail(message.error, "The local model worker could not start.");
      return;
    }
    if (message.type !== "result" && message.type !== "inference-error") {
      return;
    }
    const request = requests.get(message.requestId);
    if (!request) return;
    requests.delete(message.requestId);
    if (message.type === "result") request.resolve(message.result);
    else {
      request.reject(
        restoreError(message.error, "Local model inference failed."),
      );
    }
  });
  worker.addEventListener("error", (event) => {
    fail(
      { message: event.message },
      "The local model worker stopped unexpectedly.",
    );
  });
  worker.addEventListener("messageerror", () => {
    fail(null, "The local model worker returned unreadable data.");
  });

  const invoke = async (model, args) => {
    if (disposed) throw new Error("The local model worker was closed.");
    await ready;
    return new Promise((resolve, reject) => {
      requestSequence += 1;
      const requestId = `${workerNumber}-${requestSequence}`;
      requests.set(requestId, { resolve, reject });
      worker.postMessage({
        type: "inference",
        requestId,
        model,
        arguments: args,
      });
    });
  };

  worker.postMessage({ type: "initialize", workerNumber });

  return {
    workerNumber,
    ready,
    detector: (...args) => invoke("detector", args),
    rescueClassifier: (...args) => invoke("classifier", args),
    async dispose() {
      if (disposed) return;
      disposed = true;
      worker.postMessage({ type: "dispose" });
      worker.terminate();
      fail(null, "The local model worker was closed.");
    },
  };
}

function restoreError(serialized, fallbackMessage) {
  const error = new Error(serialized?.message || fallbackMessage);
  error.name = serialized?.name || "Error";
  if (serialized?.stack) error.stack = serialized.stack;
  return error;
}
