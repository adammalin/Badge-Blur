export function normalizeSourcePath(path) {
  return String(path).replaceAll("\\", "/").replace(/^\.?\//, "");
}

export function sourceRootName(file) {
  const path = normalizeSourcePath(file?.webkitRelativePath || "");
  return path.includes("/") ? path.split("/")[0] : null;
}

export function indexRunFiles(files) {
  const byPath = new Map();
  const byRootlessPath = new Map();
  const ambiguousRootlessPaths = new Set();
  for (const entry of files) {
    const path = normalizeSourcePath(entry.sourcePath || entry.input || "");
    if (!path) continue;
    byPath.set(path, entry);
    const rootless = path.split("/").slice(1).join("/") || path;
    if (byRootlessPath.has(rootless)) ambiguousRootlessPaths.add(rootless);
    else byRootlessPath.set(rootless, entry);
  }
  return { byPath, byRootlessPath, ambiguousRootlessPaths };
}

export function findRunEntry(index, sourcePath) {
  const normalized = normalizeSourcePath(sourcePath);
  const rootless =
    normalized.split("/").slice(1).join("/") || normalized;
  return (
    index.byPath.get(normalized) ||
    (!index.ambiguousRootlessPaths.has(rootless)
      ? index.byRootlessPath.get(rootless)
      : null) ||
    null
  );
}

export async function createUniqueRunDirectory(
  parentDirectory,
  {
    now = new Date(),
    runId = crypto.randomUUID(),
  } = {},
) {
  const timestamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");
  const baseName = `badge-remover-run-${timestamp}-${runId.slice(0, 8)}`;
  for (let suffix = 0; suffix < 100; suffix += 1) {
    const name = suffix === 0 ? baseName : `${baseName}-${suffix + 1}`;
    try {
      await parentDirectory.getDirectoryHandle(name);
    } catch (error) {
      if (error.name !== "NotFoundError") throw error;
      return {
        directory: await parentDirectory.getDirectoryHandle(name, { create: true }),
        name,
        runId,
      };
    }
  }
  throw new Error("Could not create a unique output run folder.");
}
