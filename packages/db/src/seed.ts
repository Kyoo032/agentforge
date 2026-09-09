import { config } from "dotenv";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { listTools, registerPlatformTools } from "@agentforge/core";
import { registerUniversityTools } from "@agentforge/university";
import { db } from "./client";
import { ensureLocalOwner } from "./ensure-local-owner";
import { tools } from "./schema";

config({ path: resolve(process.cwd(), "../../.env") });
config({ path: resolve(process.cwd(), ".env") });

async function seed() {
  registerPlatformTools();
  registerUniversityTools();

  for (const tool of listTools()) {
    const found = await db.select().from(tools).where(eq(tools.key, tool.key)).limit(1);
    if (found[0]) {
      continue;
    }
    await db.insert(tools).values({
      organizationId: null,
      key: tool.key,
      name: tool.name,
      description: tool.description,
      jsonSchema: tool.schema instanceof Object ? { type: "object" } : {},
      handlerKey: tool.handlerKey,
    });
  }

  await ensureLocalOwner(db);
  console.log("Seeded local owner, Default workspace, and tools.");
  process.exit(0);
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
