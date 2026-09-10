import type { KnowledgeBackend } from "./backend";
import { SqliteBuiltinBackend } from "./backends/builtin";

let backend: KnowledgeBackend | null = null;

/**
 * The knowledge backend this host uses. One instance per process: backends are stateless in Phase 0
 * but a remote one will own a client / supervisor, so callers must never construct their own.
 *
 * TODO(phase 3): read the `knowledge.backend` setting and return the WeKnora backend when it is
 * `"weknora"`, falling back to builtin when the sidecar is unhealthy. Hardcoded to builtin for now.
 */
export function getKnowledgeBackend(): KnowledgeBackend {
  backend ??= new SqliteBuiltinBackend();
  return backend;
}
