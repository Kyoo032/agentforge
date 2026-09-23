/**
 * One save dialog per download on the desktop app.
 *
 * On the packaged app `apiFetch` answers a bytes response by writing it through the native save
 * dialog (`api-client.ts`, `saveDesktopBytes`). A studio that then also builds an object URL and
 * clicks an `<a download>` opens a second dialog for the same file. `downloadArtifactFile` in
 * `artifacts-client.ts` has always returned early on `isElectron()`; these three download paths did
 * not. There is no DOM or Electron bridge in this node environment, so the guard's position is
 * pinned by reading the source: after the error check (an error still has to reach the banner),
 * before the browser download.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const components = resolve(dirname(fileURLToPath(import.meta.url)), "../components");

const DOWNLOADS: Array<{ file: string; fn: string; okCheck: string }> = [
  { file: "documents-studio.tsx", fn: "async function onDownload()", okCheck: "if (!res.ok) {" },
  { file: "presentations-studio.tsx", fn: "async function onDownload()", okCheck: "if (!res.ok) {" },
  { file: "edit-studio.tsx", fn: "async function onDownloadExport()", okCheck: "if (!response.ok) {" },
];

describe("desktop downloads do not open the save dialog twice", () => {
  for (const { file, fn, okCheck } of DOWNLOADS) {
    it(`${file} returns after the native save, before the browser download`, () => {
      const text = readFileSync(resolve(components, file), "utf8");
      expect(text).toMatch(/import \{[^}]*\bisElectron\b[^}]*\} from "@\/lib\/api-client";/);
      const start = text.indexOf(fn);
      expect(start, `${fn} not found`).toBeGreaterThan(-1);
      const body = text.slice(start);
      const ok = body.indexOf(okCheck);
      const guard = body.indexOf("if (isElectron()) {");
      const browserDownload = body.indexOf("URL.createObjectURL");
      expect(ok, "error check").toBeGreaterThan(-1);
      expect(guard, "isElectron guard").toBeGreaterThan(ok);
      expect(browserDownload, "browser download").toBeGreaterThan(guard);
      expect(body.slice(guard, browserDownload)).toContain("return;");
    });
  }
});
