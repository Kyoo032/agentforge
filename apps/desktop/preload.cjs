const { contextBridge, ipcRenderer } = require("electron");
const { loadBrandFromResources, loadBrandLogo } = require("./brand-read.cjs");

const brand = loadBrandFromResources(process.resourcesPath, __dirname);
const brandLogo = loadBrandLogo(process.resourcesPath, __dirname);

contextBridge.exposeInMainWorld("agentforge", {
  isElectron: true,
  brand,
  brandLogo,
  invoke: (payload) => ipcRenderer.invoke("host:request", payload),
  stream: (requestId, onChunk) =>
    new Promise((resolve, reject) => {
      const onChunkMsg = (_event, message) => {
        if (message.requestId === requestId) {
          onChunk(message.chunk);
        }
      };
      const cleanup = () => {
        ipcRenderer.removeListener("host:stream-chunk", onChunkMsg);
        ipcRenderer.removeListener("host:stream-end", onEnd);
        ipcRenderer.removeListener("host:stream-error", onError);
      };
      const onEnd = (_event, message) => {
        if (message.requestId !== requestId) {
          return;
        }
        cleanup();
        resolve();
      };
      const onError = (_event, message) => {
        if (message.requestId !== requestId) {
          return;
        }
        cleanup();
        reject(new Error(message.message || "stream failed"));
      };
      ipcRenderer.on("host:stream-chunk", onChunkMsg);
      ipcRenderer.on("host:stream-end", onEnd);
      ipcRenderer.on("host:stream-error", onError);
    }),
  saveBytes: (filename, bytes) => ipcRenderer.invoke("host:save-bytes", { filename, bytes }),
});
