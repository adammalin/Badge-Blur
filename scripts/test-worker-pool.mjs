import assert from "node:assert/strict";
import { runWorkerPool } from "../src/worker-pool.js";

const workers = [{ id: 1 }, { id: 2 }];
const processed = [];
let active = 0;
let maximumActive = 0;
const assignments = await runWorkerPool(
  workers,
  6,
  async (worker, index, workerIndex) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 8 + (index % 2) * 4));
    processed.push({ index, workerId: worker.id, workerIndex });
    active -= 1;
  },
);

assert.equal(processed.length, 6);
assert.equal(maximumActive, 2);
assert.deepEqual([...processed.map(({ index }) => index)].sort((a, b) => a - b), [
  0, 1, 2, 3, 4, 5,
]);
assert.ok(assignments.every((workerNumber) => workerNumber === 1 || workerNumber === 2));
assert.rejects(() => runWorkerPool([], 1, async () => {}), /At least one worker/);

console.log(
  JSON.stringify({
    passed: true,
    itemCount: processed.length,
    maximumActive,
    assignments,
  }),
);
