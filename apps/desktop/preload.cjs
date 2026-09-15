const { contextBridge, ipcRenderer } = require("electron");
const { PUBLIC_PRODUCT_NAME, loadBrandFromResources, loadBrandLogo } = require("./brand-read.cjs");

const brand = loadBrandFromResources(process.resourcesPath, __dirname);
const brandLogo = loadBrandLogo(process.resourcesPath, __dirname);

contextBridge.exposeInMainWorld("agentforge", {
  isElectron: true,
  brand,
  brandLogo,
  updates: {
    supported: brand.productName === PUBLIC_PRODUCT_NAME,
    state: () => ipcRenderer.invoke("updates:state"),
    check: () => ipcRenderer.invoke("updates:check"),
    download: () => ipcRenderer.invoke("updates:download"),
    install: () => ipcRenderer.invoke("updates:install"),
    onStatus: (callback) => {
      const listener = (_event, payload) => {
        callback(payload);
      };
      ipcRenderer.on("updates:status", listener);
      return () => ipcRenderer.removeListener("updates:status", listener);
    },
  },
  invoke: (payload) => ipcRenderer.invoke("host:request", payload),
  abortStream: (requestId) => ipcRenderer.send("host:stream-abort", { requestId }),
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
  pickMedia: () => ipcRenderer.invoke("agentforge:pick-media"),
  /**
   * Restart the app. `{ reset: true }` (Settings -> Start over) also clears the renderer's Chromium
   * storage in the main process before exiting, so nothing from the old install leaks into the
   * fresh one. App-owned files are handled by the host's reset marker, not here.
   *
   * Resolves to `{ ok: false, reason }` when the main process refuses (`installing-update`,
   * `already-exiting`, `forbidden` from any frame that is not the main renderer). On success the
   * process exits before the reply is sent, so the renderer treats a non-object answer as ok.
   */
  relaunch: (options) => ipcRenderer.invoke("app:relaunch", { reset: Boolean(options?.reset) }),
});
