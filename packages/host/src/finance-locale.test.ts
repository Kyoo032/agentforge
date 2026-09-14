import { afterEach, describe, expect, it } from "vitest";
import type { TenantContext } from "@agentforge/core";
import { financeBriefSystemPrompt, generateFinanceBrief } from "./finance-generate";
import { financeBootLocale, resetFinanceBootLocaleForTests, setFinanceBootLocaleForTests } from "./finance-locale";

const tenant: TenantContext = { organizationId: "org", workspaceId: "ws-finance-i18n", userId: "local", role: "owner" };

const items = [
  { label: "Sales", period: "2025", amount: 120000, currency: "USD", category: "revenue" as const },
  { label: "Hosting", period: "2025", amount: 30000, currency: "USD", category: "cogs" as const },
];

describe("finance locale pipeline", () => {
  const previousLocale = process.env.AGENTFORGE_LOCALE;

  afterEach(() => {
    resetFinanceBootLocaleForTests(previousLocale);
  });

  it("instructs the model to write English or Bahasa Indonesia from the boot locale", () => {
    expect(financeBriefSystemPrompt("en")).toMatch(/Write the title[\s\S]*in English/);
    expect(financeBriefSystemPrompt("id")).toMatch(/Bahasa Indonesia/);
    expect(financeBriefSystemPrompt("id")).not.toMatch(/Write the title[\s\S]*in English/);
  });

  it("reads AGENTFORGE_LOCALE as the frozen boot locale", () => {
    setFinanceBootLocaleForTests("id");
    expect(financeBootLocale()).toBe("id");
    setFinanceBootLocaleForTests("en");
    expect(financeBootLocale()).toBe("en");
  });

  it("returns a stub brief in Bahasa Indonesia when the runtime is stub", async () => {
    const previous = process.env.AGENTFORGE_RUNTIME;
    process.env.AGENTFORGE_RUNTIME = "stub";
    setFinanceBootLocaleForTests("id");
    try {
      const result = await generateFinanceBrief(tenant, {
        prompt: "Rencana kas",
        items,
      });
      expect(result.brief.sections[0]?.heading).toBe("Angka yang sudah dihitung");
      expect(result.brief.assumptions[0]).toMatch(/Pengaturan/);
      expect(result.brief.computed.metrics.some((entry) => entry.label.startsWith("Pendapatan"))).toBe(true);
      expect(result.markdown).toMatch(/Metrik terhitung|Asumsi/);
    } finally {
      if (previous === undefined) {
        delete process.env.AGENTFORGE_RUNTIME;
      } else {
        process.env.AGENTFORGE_RUNTIME = previous;
      }
    }
  });

  it("returns a stub brief in English when the boot locale is en", async () => {
    const previous = process.env.AGENTFORGE_RUNTIME;
    process.env.AGENTFORGE_RUNTIME = "stub";
    setFinanceBootLocaleForTests("en");
    try {
      const result = await generateFinanceBrief(tenant, {
        prompt: "Cash plan",
        items,
      });
      expect(result.brief.sections[0]?.heading).toBe("Computed figures");
      expect(result.brief.assumptions[0]).toMatch(/Settings/);
      expect(result.markdown).toMatch(/Computed metrics|Assumptions/);
    } finally {
      if (previous === undefined) {
        delete process.env.AGENTFORGE_RUNTIME;
      } else {
        process.env.AGENTFORGE_RUNTIME = previous;
      }
    }
  });
});
