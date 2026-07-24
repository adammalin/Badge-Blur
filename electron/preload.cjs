const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("badgeBlurDesktop", {
  openExportFolder: (checkpointFile) => {
    const checkpointPath = webUtils.getPathForFile(checkpointFile);
    return ipcRenderer.invoke("badge-blur:open-export-folder", checkpointPath);
  },
});
