"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type AgentPayload = {
  agent: {
    id: string;
    name: string;
    description: string;
    visibility: "private" | "workspace";
    currentVersionId: string | null;
  };
  versions: Array<{ id: string; version: number }>;
  draftBindings: Array<{ toolKey: string }>;
};

export default function StudioAgentPage() {
  const params = useParams<{ agentId: string }>();
  const [data, setData] = useState<AgentPayload | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function reload() {
    const payload = await fetch(`/api/v1/agents/${params.agentId}`).then((res) => res.json());
    setData(payload);
  }

  useEffect(() => {
    void reload();
  }, [params.agentId]);

  async function share(visibility: "private" | "workspace") {
    await fetch(`/api/v1/agents/${params.agentId}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visibility }),
    });
    setMessage(visibility === "workspace" ? "Shared with workspace" : "Now private");
    await reload();
  }

  if (!data?.agent) {
    return <main className="px-6 py-10">Loading…</main>;
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10 text-ink">
      <h1 className="text-3xl font-semibold text-ink" data-testid="studio-agent-name">
        {data.agent.name}
      </h1>
      <p className="mt-2 text-ink/60">{data.agent.description}</p>
      <p className="mt-4 text-sm text-ink" data-testid="visibility">
        Visibility: {data.agent.visibility}
      </p>
      <p className="text-sm text-ink">Published: {data.agent.currentVersionId ? "yes" : "no"}</p>
      <p className="mt-2 text-sm text-ink">Tools: {data.draftBindings.map((binding) => binding.toolKey).join(", ") || "none"}</p>
      <div className="mt-6 flex gap-3">
        <button
          type="button"
          className="rounded-md bg-navy px-4 py-2 text-white"
          onClick={() => void share("workspace")}
          data-testid="share-workspace"
        >
          Share with workspace
        </button>
        <button type="button" className="rounded-md border border-mist px-4 py-2 text-ink" onClick={() => void share("private")}>
          Make private
        </button>
        <Link href={`/agents/${data.agent.id}`} className="rounded-md px-4 py-2 underline">
          Open chat
        </Link>
      </div>
      {message ? <p className="mt-4 text-sm">{message}</p> : null}
    </main>
  );
}
