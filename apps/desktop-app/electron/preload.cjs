const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("assistant", {
  selectProjectFolder: () => ipcRenderer.invoke("project:select-folder"),
  selectGenerationParentFolder: () => ipcRenderer.invoke("project:select-generation-parent"),
  selectGenerationAssets: () => ipcRenderer.invoke("project:select-generation-assets"),
  inspectGenerationAssets: (payload) =>
    ipcRenderer.invoke("project:inspect-generation-assets", payload),
  getDroppedFilePath: (file) => ipcRenderer.invoke("project:get-dropped-file-path", file),
  rememberProject: (payload) => ipcRenderer.invoke("project:remember", payload),
  loadLastProject: () => ipcRenderer.invoke("project:load-last"),
  listProjectFiles: (payload) => ipcRenderer.invoke("project:list-files", payload),
  readProjectFile: (payload) => ipcRenderer.invoke("project:read-file", payload),
  readProjectAsset: (payload) => ipcRenderer.invoke("project:read-asset", payload),
  loadProjectTypeInfo: (payload) => ipcRenderer.invoke("project:load-type-info", payload),
  writeProjectFile: (payload) => ipcRenderer.invoke("project:write-file", payload),
  createProjectFile: (payload) => ipcRenderer.invoke("project:create-file", payload),
  deleteProjectFile: (payload) => ipcRenderer.invoke("project:delete-file", payload),
  writeGeneratedProject: (payload) => ipcRenderer.invoke("project:write-generated", payload),
  getSystemInfo: () => ipcRenderer.invoke("system:get-info"),
});
