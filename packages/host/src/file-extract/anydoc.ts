/**
 * The only place `@firecrawl/anydoc` is touched.
 *
 * PRIVACY — this is the whole point of the file being this small. anydoc converts everything itself,
 * on this machine, with one exception: its `ocr: 'hosted'` option, which uploads the document to
 * Firecrawl Parse. This module never constructs an options object at all, so that option cannot be
 * reached from here — `toMarkdownBytes` is called with exactly two arguments, bytes and format. It
 * also never reads a `FIRECRAWL_*` key or url variable; a scanned PDF fails locally instead.
 * `file-extract/privacy.test.ts` asserts both, and `file-extract/no-hosted-ocr.test.ts` greps the
 * repository so a future call site cannot quietly add the option back.
 *
 * TIMING — `toMarkdownBytes` is a napi-rs async task: the conversion runs on the libuv thread pool
 * and the returned promise settles on the event loop, so a slow document cannot block the request
 * thread and no worker thread is needed. The deadline below exists so a *pathological* document
 * cannot hold the request open, not to keep the loop free.
 */
import { createRequire } from "node:module";
import { componentManifest } from "../components/manifest";
import { componentRequireAnchor, componentRoot, hasComponentMarker } from "../components/paths";
import { FileExtractError } from "./errors";

/** Spelled once, and only here: the loader below is the single require site for the converter. */
const MODULE_ID = "@firecrawl/anydoc";

/** The format names anydoc uses. Kept as a string union so this file needs no value import. */
export type AnydocFormat =
  | "doc"
  | "docx"
  | "odt"
  | "pdf"
  | "ppt"
  | "pptx"
  | "rtf"
  | "epub"
  | "xlsx"
  | "ods"
  | "odp"
  | "csv";

/** The three entry points this pipeline uses, and nothing else anydoc exports. */
export type AnydocModule = {
  formatFromBytes(bytes: Uint8Array): AnydocFormat | null;
  formatFromExtension(extension: string): AnydocFormat | null;
  toMarkdownBytes(bytes: Uint8Array, format?: AnydocFormat | null): Promise<string>;
};

/** How the module is obtained. Injectable so a test can make the native binding fail to load. */
export type AnydocLoader = () => AnydocModule;

/** Where a resolved module came from — the same two words `componentStatus()` reports. */
export type AnydocSource = "bundled" | "downloaded";

export type AnydocResolution = { readonly module: AnydocModule; readonly source: AnydocSource };

/** The two places the module can be, in the order they are tried. Injectable for tests. */
export type AnydocResolvers = { readonly bundled: () => AnydocModule; readonly downloaded: () => AnydocModule };

let cached: AnydocResolution | null = null;
let cachedFailure: Error | null = null;

/**
 * The copy that shipped with the app: `node_modules` in dev, the `asarUnpack`ed folder when packed.
 *
 * `createRequire` rather than a static import: the binding is a platform `.node` file, and a packed
 * build for an unsupported platform must degrade to the existing extractors instead of failing to
 * start. Either way this stays a *runtime* require, which is what lets esbuild bundle this file into
 * `apps/desktop/host.cjs` without trying to inline a `.node`.
 *
 * The guard is the same one `sql-runner.ts` uses, and it is load-bearing: under tsx (ESM) this file
 * has `import.meta.url`, but inside the esbuild CommonJS bundle `import.meta` is replaced with `{}`,
 * so `createRequire(import.meta.url)` would be `createRequire(undefined)` and throw — the packaged
 * app would silently fall back to the old extractors forever. There it has `require` instead, which
 * Electron already resolves across the asar / asar.unpacked boundary.
 */
export function loadBundledAnydoc(): AnydocModule {
  const resolver = typeof require === "function" ? require : createRequire(import.meta.url);
  return resolver(MODULE_ID) as AnydocModule;
}

/**
 * The copy the first-run installer put in the data dir. Only ever tried when the completion marker
 * is there: a half-unpacked directory must look missing, not broken.
 */
export function loadDownloadedAnydoc(): AnydocModule {
  const { version } = componentManifest("anydoc");
  const root = componentRoot("anydoc", version);
  if (!hasComponentMarker("anydoc", version, root)) {
    throw new Error(`No installed anydoc component at ${root}`);
  }
  return loadAnydocFrom(root);
}

/**
 * Load from an unpacked component root without asking for the marker. Only the installer's probe
 * stage uses this: the marker is written *after* the probe passes, so the probe cannot require it.
 */
export function loadAnydocFrom(root: string): AnydocModule {
  return createRequire(componentRequireAnchor(root))(MODULE_ID) as AnydocModule;
}

const DEFAULT_RESOLVERS: AnydocResolvers = { bundled: loadBundledAnydoc, downloaded: loadDownloadedAnydoc };

/** Bundled, then downloaded, then null. Pure: no memoisation, so a probe can call it after an install. */
export function resolveAnydoc(resolvers: AnydocResolvers = DEFAULT_RESOLVERS): AnydocResolution | null {
  for (const source of ["bundled", "downloaded"] as const) {
    try {
      return { module: resolvers[source](), source };
    } catch {
      // Try the next place; the caller decides what "nowhere" means.
    }
  }
  return null;
}

/**
 * The memoised loader the extraction pipeline uses. The outcome is remembered both ways so a missing
 * binding is not re-resolved per upload — which is why a successful install calls
 * `resetAnydocCache()`: without it, the remembered failure would outlive the thing that fixed it.
 */
export function loadAnydoc(): AnydocModule {
  if (cached) {
    return cached.module;
  }
  if (cachedFailure) {
    throw cachedFailure;
  }
  const resolved = resolveAnydoc();
  if (!resolved) {
    cachedFailure = new Error("Cannot find native binding for @firecrawl/anydoc");
    throw cachedFailure;
  }
  cached = resolved;
  return cached.module;
}

/** Where the memoised module came from, or null when nothing has been loaded successfully. */
export function loadedAnydocSource(): AnydocSource | null {
  return cached?.source ?? null;
}

/** Called by the component installer once files land, so the remembered failure does not stick. */
export function resetAnydocCache(): void {
  cached = null;
  cachedFailure = null;
}

/**
 * Convert bytes to Markdown under a deadline.
 *
 * The call is `toMarkdownBytes(bytes, format)` — two arguments, deliberately. Do not add a third:
 * the third parameter is the options bag that carries hosted OCR.
 */
export async function toMarkdownUnderDeadline(
  anydoc: AnydocModule,
  bytes: Uint8Array,
  format: AnydocFormat | null,
  timeoutMs: number,
): Promise<string> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new FileExtractError("timeout")), Math.max(1, timeoutMs));
  });
  try {
    return await Promise.race([anydoc.toMarkdownBytes(bytes, format), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
