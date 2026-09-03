"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

type KnowledgeTab = "sources" | "soul" | "memory";

type SourceRow = {
  id: string;
  name: string;
  type: string;
  chunks: number;
  status: "Indexed" | "Indexing" | "Failed";
};

type Memory = { id: string; text: string; pinned: boolean };

export function KnowledgePage() {
  const [tab, setTab] = useState<KnowledgeTab>("sources");
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [soul, setSoul] = useState({ name: "Forge", role: "", voice: "", rules: [] as string[] });
  const [memories, setMemories] = useState<Memory[]>([]);
  const [urlDraft, setUrlDraft] = useState("");
  const [pasteDraft, setPasteDraft] = useState("");
  const [ruleDraft, setRuleDraft] = useState("");
  const [memoryDraft, setMemoryDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const payload = await apiFetch("/api/v1/knowledge").then((res) => res.json());
    if (payload.soul) {
      setSoul(payload.soul);
    }
    setMemories(payload.memories ?? []);
    setSources(payload.sources ?? []);
  }

  useEffect(() => {
    void reload().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Could not load knowledge");
    });
  }, []);

  async function addUrl() {
    const url = urlDraft.trim();
    if (!url) {
      return;
    }
    setError(null);
    const res = await apiFetch("/api/v1/knowledge/sources/url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error?.message ?? "Could not add URL");
      return;
    }
    setUrlDraft("");
    await reload();
  }

  async function addPaste() {
    const text = pasteDraft.trim();
    if (!text) {
      return;
    }
    setError(null);
    const res = await apiFetch("/api/v1/knowledge/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Pasted notes", text }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error?.message ?? "Could not add notes");
      return;
    }
    setPasteDraft("");
    await reload();
  }

  async function saveSoul() {
    setError(null);
    const res = await apiFetch("/api/v1/knowledge/soul", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(soul),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error?.message ?? "Could not save soul");
      return;
    }
    await reload();
  }

  async function addMemory() {
    const text = memoryDraft.trim();
    if (!text) {
      return;
    }
    await apiFetch("/api/v1/knowledge/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, pinned: true }),
    });
    setMemoryDraft("");
    await reload();
  }

  return (
    <main className="px-[30px] pb-10 pt-[26px] text-inkbase" data-testid="knowledge-page">
      <div className="mb-5 flex flex-wrap items-end gap-4">
        <div>
          <div className="kicker">Workspace › Knowledge</div>
          <h3 className="mt-2 text-[25px]">Knowledge</h3>
          <p className="mt-1 text-[13px] text-[color-mix(in_srgb,var(--color-text)_52%,transparent)]">
            What this agent knows, how it behaves, and what it remembers between sessions.
          </p>
        </div>
        <div className="seg ml-auto" data-testid="knowledge-tabs">
          {(["sources", "soul", "memory"] as const).map((id) => (
            <button
              key={id}
              type="button"
              className="seg-opt capitalize"
              data-on={tab === id ? "true" : "false"}
              data-testid={`knowledge-tab-${id}`}
              onClick={() => setTab(id)}
            >
              {id}
            </button>
          ))}
        </div>
      </div>
      {error ? <p className="mb-4 text-sm text-red-700">{error}</p> : null}

      {tab === "sources" ? (
        <div className="flex flex-col gap-4" data-testid="knowledge-sources">
          <section className="blueprint p-[18px]">
            <p className="panel-label">Add a source</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <input className="input min-w-[240px] flex-1" placeholder="https://…" value={urlDraft} onChange={(event) => setUrlDraft(event.target.value)} data-testid="knowledge-url" />
              <button type="button" className="btn btn-primary" onClick={() => void addUrl()} data-testid="knowledge-add-url">
                Add URL
              </button>
            </div>
            <textarea className="input mt-3" rows={4} placeholder="Paste notes…" value={pasteDraft} onChange={(event) => setPasteDraft(event.target.value)} data-testid="knowledge-paste" />
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => void addPaste()} data-testid="knowledge-add-paste">
                Index paste
              </button>
              <label className="btn btn-secondary cursor-pointer">
                Upload file
                <input
                  className="sr-only"
                  type="file"
                  accept=".txt,.md,.csv,.json,text/plain,text/markdown,text/csv,application/json"
                  data-testid="knowledge-file"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) {
                      return;
                    }
                    void (async () => {
                      setError(null);
                      const form = new FormData();
                      form.set("file", file);
                      const res = await apiFetch("/api/v1/knowledge/sources", { method: "POST", body: form });
                      const data = await res.json().catch(() => null);
                      if (!res.ok) {
                        setError(data?.error?.message ?? "Could not index file");
                        return;
                      }
                      await reload();
                    })();
                  }}
                />
              </label>
            </div>
          </section>
          <ul className="blueprint divide-y divide-[color-mix(in_srgb,var(--color-text)_8%,transparent)]">
            {sources.map((row) => (
              <li key={row.id} className="flex items-center gap-3 px-4 py-3" data-testid="knowledge-source-row">
                <span className="min-w-0 flex-1 truncate">{row.name}</span>
                <span className="tag tag-neutral">{row.type}</span>
                <span className="text-[12px]">{row.chunks} chunks</span>
                <span className={row.status === "Indexed" ? "tag tag-accent" : "tag tag-outline"}>{row.status}</span>
                <button
                  type="button"
                  className="btn btn-ghost text-[12px]"
                  onClick={() => void apiFetch(`/api/v1/knowledge/sources/${row.id}`, { method: "DELETE" }).then(() => reload())}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tab === "soul" ? (
        <div className="flex flex-col gap-3" data-testid="knowledge-soul">
          <label className="panel-label">Name</label>
          <input className="input" value={soul.name} onChange={(event) => setSoul({ ...soul, name: event.target.value })} data-testid="knowledge-soul-name" />
          <label className="panel-label">Role</label>
          <input className="input" value={soul.role} onChange={(event) => setSoul({ ...soul, role: event.target.value })} data-testid="knowledge-soul-role" />
          <label className="panel-label">Voice</label>
          <textarea className="input" rows={3} value={soul.voice} onChange={(event) => setSoul({ ...soul, voice: event.target.value })} data-testid="knowledge-soul-voice" />
          <ul className="text-sm">
            {soul.rules.map((rule, index) => (
              <li key={`${rule}-${index}`}>{rule}</li>
            ))}
          </ul>
          <div className="flex gap-2">
            <input className="input flex-1" value={ruleDraft} onChange={(event) => setRuleDraft(event.target.value)} placeholder="Add a rule" />
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                if (ruleDraft.trim()) {
                  setSoul({ ...soul, rules: [...soul.rules, ruleDraft.trim()] });
                  setRuleDraft("");
                }
              }}
            >
              Add rule
            </button>
          </div>
          <button type="button" className="btn btn-primary w-fit" onClick={() => void saveSoul()} data-testid="knowledge-soul-save">
            Save soul
          </button>
        </div>
      ) : null}

      {tab === "memory" ? (
        <div className="flex flex-col gap-3" data-testid="knowledge-memory">
          <div className="flex gap-2">
            <input className="input flex-1" value={memoryDraft} onChange={(event) => setMemoryDraft(event.target.value)} data-testid="knowledge-memory-input" placeholder="Pin a memory" />
            <button type="button" className="btn btn-primary" onClick={() => void addMemory()} data-testid="knowledge-memory-add">
              Pin
            </button>
          </div>
          <ul>
            {memories.map((item) => (
              <li key={item.id} className="flex items-center gap-2 border-b border-divider py-2" data-testid="knowledge-memory-row">
                <span className="flex-1">{item.text}</span>
                {item.pinned ? <span className="tag tag-accent">Pinned</span> : null}
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void apiFetch(`/api/v1/knowledge/memories/${item.id}`, { method: "DELETE" }).then(() => reload())}
                >
                  Forget
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </main>
  );
}
