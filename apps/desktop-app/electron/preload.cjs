const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("assistant", {
  selectProjectFolder: () => ipcRenderer.invoke("project:select-folder"),
  rememberProject: (payload) => ipcRenderer.invoke("project:remember", payload),
  loadLastProject: () => ipcRenderer.invoke("project:load-last"),
  listProjectFiles: (payload) => ipcRenderer.invoke("project:list-files", payload),
  readProjectFile: (payload) => ipcRenderer.invoke("project:read-file", payload),
  readProjectAsset: (payload) => ipcRenderer.invoke("project:read-asset", payload),
  loadProjectTypeInfo: (payload) => ipcRenderer.invoke("project:load-type-info", payload),
  writeProjectFile: (payload) => ipcRenderer.invoke("project:write-file", payload),
  createProjectFile: (payload) => ipcRenderer.invoke("project:create-file", payload),
  getSystemInfo: () => ipcRenderer.invoke("system:get-info"),
});
