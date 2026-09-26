/**
 * The first-run screen, rendered.
 *
 * A fresh desk opens on a short hello. A desk the host already closed opens on the key, with the
 * catalog sentence for that status. The gateway address never reaches the markup: the payload may
 * carry it, and this screen does not print it.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_PRODUCT_NAME, GATEWAY_NAME } from "@agentforge/core/gateway";
import { OnboardingScreen } from "@/components/onboarding-screen";
import { applyLocale, resetLocaleForTests, t } from "./i18n";
import type { GatewayGatePayload } from "./gateway-gate";

afterEach(() => {
  resetLocaleForTests();
});

const CLOSED: GatewayGatePayload = {
  status: "invalid_key",
  allowed: false,
  grace: false,
  endpoint: "https://api.tokotokenai.com/v1",
  endpointLocked: true,
  checkedAt: "2026-09-26T00:00:00.000Z",
  lastOkAt: null,
};

function render(gateway?: GatewayGatePayload | null): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <OnboardingScreen onDone={() => {}} gateway={gateway} />
    </MemoryRouter>,
  );
}

describe("onboarding screen", () => {
  it("opens a fresh desk on a plain welcome in the in-app name", () => {
    const markup = render(null);
    expect(markup).toContain('data-testid="onboarding-welcome"');
    expect(markup).toContain(`Welcome to ${DEFAULT_PRODUCT_NAME}`);
    expect(markup).toContain("Ask a question, write a document, look at numbers, or make a picture.");
    expect(markup).toContain("text-gradient");
    expect(markup).toContain("hero-aurora");
    expect(markup).toContain('data-testid="onboarding-next"');
    expect(markup).not.toContain('data-testid="onboarding-form"');
    expect(markup).not.toContain("Nultron");
    expect(markup).not.toMatch(/tokotokenai|https?:\/\//);
  });

  it("opens a closed gate on the key, with the friendly reason and no address", () => {
    const markup = render(CLOSED);
    expect(markup).toContain('data-testid="onboarding-form"');
    expect(markup).toContain('data-testid="onboarding-key"');
    expect(markup).toContain('data-testid="onboarding-continue"');
    expect(markup).toContain('data-testid="onboarding-recheck"');
    expect(markup).toContain('data-testid="onboarding-gate-reason"');
    expect(markup).toContain(`That key didn&#x27;t work. Check it at ${GATEWAY_NAME} and paste it again.`);
    expect(markup).toContain('aria-current="step"');
    expect(markup).not.toContain('data-testid="onboarding-gateway-host"');
    expect(markup).not.toContain('data-testid="onboarding-welcome"');
    expect(markup).not.toMatch(/tokotokenai|https?:\/\//);
  });

  it("speaks Indonesian on an id desk, still under the in-app name", () => {
    applyLocale("id");
    const markup = render(null);
    expect(markup).toContain(`Selamat datang di ${DEFAULT_PRODUCT_NAME}`);
    expect(markup).toContain(t("onboarding.intro", { productName: DEFAULT_PRODUCT_NAME }));
    expect(markup).not.toContain("Nultron");
  });
});
