import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createServer as createViteServer } from "vite";
import { handleNodeRequest } from "@agentforge/host/http";

const dir = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === "production";

async function main() {
  const app = express();
  const server = http.createServer(app);

  app.use((req, res, next) => {
    void handleNodeRequest(req, res).then((handled) => {
      if (!handled) {
        next();
      }
    }, next);
  });

  if (isProd) {
    const dist = path.join(dir, "dist");
    app.use(express.static(dist));
    app.use((req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") {
        next();
        return;
      }
      if (req.path.startsWith("/api/")) {
        next();
        return;
      }
      res.sendFile(path.join(dist, "index.html"));
    });
  } else {
    const vite = await createViteServer({
      configFile: path.join(dir, "vite.config.ts"),
      server: { middlewareMode: true, hmr: { server } },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  // Webdev is :3000. PORT only exists so a verification run can bring up an isolated second
  // instance (own AGENTFORGE_DATA_DIR) without touching the operator's desk; never LAN-bind.
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, "127.0.0.1", () => {
    console.log(`@agentforge/web:dev: http://127.0.0.1:${port}`);
  });
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
