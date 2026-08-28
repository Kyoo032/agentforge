import Link from "next/link";
import { isDefaultChatAgent } from "@agentforge/core";
import { agentService, getTenant } from "@/lib/tenant";

export default async function AgentsPage() {
  const tenant = await getTenant();
  const agents = (await agentService.list(tenant)).filter(
    (agent) =>
      !isDefaultChatAgent(agent) &&
      !/office[- ]hours/i.test(agent.slug) &&
      !/office hours/i.test(agent.name),
  );

  return (
    <main className="mx-auto max-w-5xl px-6 py-10 text-ink">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Agents</h1>
          <p className="mt-2 max-w-2xl text-sm text-ink/60">
            Agents in this workspace. Chat already talks to the gateway — build here when you want a specialist with
            its own instructions and tools.
          </p>
        </div>
        <Link
          href="/studio/new"
          className="shrink-0 rounded-md bg-navy px-3 py-2 text-sm font-medium text-white"
          data-testid="new-agent-link"
        >
          Build
        </Link>
      </div>
      {agents.length === 0 ? (
        <p className="mt-8 text-sm text-ink/60">
          None yet.{" "}
          <Link href="/chat" className="underline">
            Open chat
          </Link>{" "}
          or{" "}
          <Link href="/studio/new" className="underline">
            build an agent
          </Link>
          .
        </p>
      ) : (
        <ul className="mt-8 grid gap-4" data-testid="agent-catalog">
          {agents.map((agent) => (
            <li
              key={agent.id}
              className="rounded-xl border border-mist bg-paper p-5"
              data-testid="agent-card"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-medium text-ink">{agent.name}</h2>
                  <p className="mt-1 text-sm text-ink/60">{agent.description || "No description"}</p>
                  <p className="mt-2 text-xs uppercase tracking-wide text-ink/50">
                    {agent.visibility}
                    {agent.currentVersionId ? " · published" : " · draft"}
                  </p>
                </div>
                <div className="flex gap-3 text-sm text-ink">
                  <Link href={`/agents/${agent.id}`} className="underline" data-testid="open-chat">
                    Chat
                  </Link>
                  <Link href={`/studio/${agent.id}`} className="underline">
                    Studio
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
