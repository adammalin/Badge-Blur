const ALLOWED_WORKER_COUNTS = new Set([1, 2, 4]);

export function normalizeWorkerPreference(value) {
  if (value === "auto") return "auto";
  const count = Number(value);
  return ALLOWED_WORKER_COUNTS.has(count) ? String(count) : "auto";
}

export function chooseAutoWorkerCount(
  {
    hardwareConcurrency = 4,
    deviceMemory = null,
    computeScore = null,
  } = {},
  batchSize = Infinity,
) {
  const cores = Math.max(1, Number(hardwareConcurrency) || 4);
  const memory = Number(deviceMemory) > 0 ? Number(deviceMemory) : null;
  const score = Number(computeScore) > 0 ? Number(computeScore) : null;
  const slowCompute = score != null && score < 2500;

  let count = 1;
  if (!slowCompute) {
    if (memory != null) {
      // Chromium intentionally reports coarse, capped memory values. Treat
      // the highest signal (8 GB) as "memory not obviously constrained."
      if (cores >= 24 && memory >= 8 && (score == null || score >= 5000)) {
        count = 4;
      } else if (cores >= 10 && memory >= 8) {
        count = 2;
      }
    } else if (cores >= 12) {
      // Browsers do not expose deviceMemory on every platform. Without a
      // memory signal, Auto may use two workers but never selects four.
      count = 2;
    }
  }
  return capWorkerCount(count, batchSize);
}

export function resolveWorkerCount(
  preference,
  capabilities = {},
  batchSize = Infinity,
) {
  const normalized = normalizeWorkerPreference(preference);
  if (normalized === "auto") {
    return chooseAutoWorkerCount(capabilities, batchSize);
  }
  return capWorkerCount(Number(normalized), batchSize);
}

export function describeWorkerSelection(preference, resolved, capabilities = {}) {
  const cores = Math.max(1, Number(capabilities.hardwareConcurrency) || 4);
  const memory = Number(capabilities.deviceMemory) > 0
    ? `${Number(capabilities.deviceMemory)} GB memory signal`
    : "memory not reported";
  const mode = normalizeWorkerPreference(preference) === "auto"
    ? `Auto selected ${resolved}`
    : `${resolved} selected`;
  return `${mode} worker${resolved === 1 ? "" : "s"} · ${cores} logical processors · ${memory}`;
}

function capWorkerCount(count, batchSize) {
  const batchCap = Number.isFinite(Number(batchSize))
    ? Math.max(1, Math.floor(Number(batchSize)))
    : 4;
  return Math.max(1, Math.min(count, batchCap, 4));
}
