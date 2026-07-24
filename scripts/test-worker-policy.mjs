import assert from "node:assert/strict";
import {
  chooseAutoWorkerCount,
  normalizeWorkerPreference,
  resolveWorkerCount,
} from "../src/worker-policy.js";

assert.equal(normalizeWorkerPreference("4"), "4");
assert.equal(normalizeWorkerPreference("3"), "auto");
assert.equal(
  chooseAutoWorkerCount({ hardwareConcurrency: 4, deviceMemory: 8 }, 100),
  1,
);
assert.equal(
  chooseAutoWorkerCount({ hardwareConcurrency: 12, deviceMemory: 8 }, 100),
  2,
);
assert.equal(
  chooseAutoWorkerCount({ hardwareConcurrency: 24, deviceMemory: 8 }, 100),
  4,
);
assert.equal(
  chooseAutoWorkerCount({ hardwareConcurrency: 24, deviceMemory: null }, 100),
  2,
);
assert.equal(
  chooseAutoWorkerCount({
    hardwareConcurrency: 24,
    deviceMemory: 64,
    computeScore: 1000,
  }, 100),
  1,
);
assert.equal(
  resolveWorkerCount("4", { hardwareConcurrency: 24 }, 2),
  2,
);
assert.equal(
  resolveWorkerCount("auto", { hardwareConcurrency: 24 }, 1),
  1,
);

console.log(JSON.stringify({ passed: true, cases: 8 }));
