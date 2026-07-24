export async function runWorkerPool(workers, itemCount, processItem) {
  if (!Array.isArray(workers) || workers.length === 0) {
    throw new Error("At least one worker is required.");
  }
  const count = Math.max(0, Math.floor(Number(itemCount) || 0));
  const assignments = new Array(count);
  let nextIndex = 0;

  await Promise.all(
    workers.map(async (worker, workerIndex) => {
      while (nextIndex < count) {
        const index = nextIndex;
        nextIndex += 1;
        assignments[index] = workerIndex + 1;
        await processItem(worker, index, workerIndex);
      }
    }),
  );
  return assignments;
}
