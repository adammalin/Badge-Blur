const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("badgeBlurDesktop", {
  recoverManifestSource: (manifestFile) => {
    const manifestPath = webUtils.getPathForFile(manifestFile);
    return ipcRenderer.invoke("badge-blur:recover-manifest-source", manifestPath);
  },
  readRecoveredSource: (token) =>
    ipcRenderer.invoke("badge-blur:read-recovered-source", token),
  openExportFolder: ({
    checkpointFile,
    sourceFile,
    sourceRelativePath,
    runFolderName,
  }) => {
    let checkpointPath = "";
    let sourcePath = "";
    try {
      checkpointPath = checkpointFile
        ? webUtils.getPathForFile(checkpointFile)
        : "";
    } catch {
      checkpointPath = "";
    }
    try {
      sourcePath = sourceFile ? webUtils.getPathForFile(sourceFile) : "";
    } catch {
      sourcePath = "";
    }
    return ipcRenderer.invoke("badge-blur:open-export-folder", {
      checkpointPath,
      sourcePath,
      sourceRelativePath,
      runFolderName,
    });
  },
});
