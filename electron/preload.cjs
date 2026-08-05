const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("badgeBlurDesktop", {
  getOnboardingTourVersion: () =>
    ipcRenderer.invoke("badge-blur:get-onboarding-tour-version"),
  setOnboardingTourVersion: (version) =>
    ipcRenderer.invoke("badge-blur:set-onboarding-tour-version", version),
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
    runId,
    sourceRootName,
    customExportRootName,
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
      runId,
      sourceRootName,
      customExportRootName,
    });
  },
});
