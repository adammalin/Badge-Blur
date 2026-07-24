const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("badgeBlurDesktop", {
  recoverManifestSource: (manifestFile) => {
    const manifestPath = webUtils.getPathForFile(manifestFile);
    return ipcRenderer.invoke("badge-blur:recover-manifest-source", manifestPath);
  },
  readRecoveredSource: (token) =>
    ipcRenderer.invoke("badge-blur:read-recovered-source", token),
  openExportFolder: (checkpointFile) => {
    const checkpointPath = webUtils.getPathForFile(checkpointFile);
    return ipcRenderer.invoke("badge-blur:open-export-folder", checkpointPath);
  },
});
