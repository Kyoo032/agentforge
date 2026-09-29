/**
 * Where the first-paint rule of the rail (`lib/shell-modes.ts`) is wired in, and what the skeleton it
 * draws looks like. The renderer's tests have no DOM, so the wiring is read from the sources and the
 * skeleton, which is a pure component, is rendered to markup. The frames themselves are driven in a
 * real browser (`.cursor/skills/verify-agentforge/features/rail.md`).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RailModesSkeleton } from "@/components/rail-modes-skeleton";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => readFileSync(join(webRoot, relative), "utf8").replace(/\r\n/g, "\n");

const app = read("src/App.tsx");
const rail = read("components/app-rail.tsx");
const shell = read("components/app-shell.tsx");
const redirect = read("components/mode-redirect.tsx");
const skeleton = read("components/rail-modes-skeleton.tsx");

describe("Shell no longer starts from every mode", () => {
  it("starts from the remembered desk or an unknown one", () => {
    expect(app).toContain("initialShellModes(readShellModesCache(modesCacheKey, browserShellModesStore()))");
    expect(app).not.toContain("useState<ProductMode[]>([...WORK_PRODUCT_MODES])");
  });

  it("uses every mode in exactly one place, the redirect of `/`, which always lands on Chat", () => {
    expect(app.match(/WORK_PRODUCT_MODES/g)).toHaveLength(2); // the import and HomeRedirect
    const home = app.slice(app.indexOf("function HomeRedirect"));
    expect(home).toContain("firstVisibleHref([...WORK_PRODUCT_MODES])");
  });

  it("takes the modes from the host's answer, and remembers them for the next first frame", () => {
    expect(app).toContain("const named = shellModesFromHost(desk.productModes)");
    expect(app).toContain("setShellModes(named)");
    expect(app).toContain("writeShellModesCache(modesCacheKey, named.modes, browserShellModesStore())");
    expect(app).not.toContain("setVisibleModes");
  });

  it("scopes what it remembers to the tenant, so one hosted account never reads another's", () => {
    expect(app).toContain("shellModesCacheKey(session.identity?.tenantId)");
  });

  it("tells the shell where the list came from", () => {
    expect(app).toContain("modesSource={shellModes.source}");
  });

  it("keeps the tour waiting for the host's answer", () => {
    expect(app).toContain("<GuideTour visibleModes={visibleModes} ready={workspaceId !== null} />");
  });
});

describe("only the host's answer may redirect", () => {
  it("passes settled = the source is the host, from the shell to the redirect", () => {
    expect(shell).toContain("<ModeRedirect visibleModes={visibleModes} settled={modeRedirectAllowed(modesSource)} />");
    expect(shell).toContain('modesSource = "host"');
    expect(redirect).toContain("const target = settled ? redirectIfHiddenMode(pathname, visibleModes) : null;");
    expect(redirect).toContain("settled = true");
  });
});

describe("the rail draws a skeleton, not a guess", () => {
  it("draws the job-mode group and the skeleton while nothing is known, and never a mode that was not given", () => {
    expect(rail).toContain("const modesPending = railModesPending(modesSource);");
    expect(rail).toContain("{jobModes.length > 0 || modesPending ? (");
    expect(rail).toContain("{modesPending ? <RailModesSkeleton collapsed={collapsed} rows={SKELETON_MODE_ROWS} /> : null}");
    expect(rail).toContain("aria-busy={modesPending || undefined}");
    expect(rail).toContain('modesSource = "host"');
  });

  it("swaps real rows in where the skeleton stood, without an entrance that would blank the group", () => {
    expect(rail).toContain("const [startedPending] = useState(modesPending);");
    expect(rail).toContain("enter={!startedPending}");
    expect(rail).toMatch(/\$\{enter \? "enter-slide " : ""\}hover-wiggle/);
    expect(rail).toContain("enter = true,");
  });

  it("still filters the catalog by the given list only", () => {
    expect(rail).toContain("PRODUCT_MODES.filter((mode) => visibleModes.includes(mode.id))");
  });

  it("does not loop: a skeleton that lasts one round trip is not decoration", () => {
    const code = skeleton.replace(/\/\*[\s\S]*?\*\//g, ""); // the comment says why, in the very words
    expect(code).not.toMatch(/animate-|animation|infinite|pulse|shimmer|enter-/i);
  });
});

describe("RailModesSkeleton", () => {
  const rows = (html: string) => html.match(/data-testid="rail-modes-skeleton-row"/g)?.length ?? 0;

  it("draws the rows it is asked for, hidden from assistive tech, with no mode testid", () => {
    const html = renderToStaticMarkup(<RailModesSkeleton collapsed={false} rows={4} />);
    expect(rows(html)).toBe(4);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('data-testid="rail-modes-skeleton"');
    expect(html).not.toMatch(/data-testid="mode-/);
    expect(html).not.toContain("<a ");
  });

  it("keeps the height of a real row, so nothing below it moves when the answer lands", () => {
    const html = renderToStaticMarkup(<RailModesSkeleton collapsed={false} rows={2} />);
    expect(html.match(/\bh-8\b/g)).toHaveLength(2);
    expect(html.match(/\bh-6 w-6\b/g)).toHaveLength(2);
  });

  it("is an icon column when the rail is collapsed", () => {
    const html = renderToStaticMarkup(<RailModesSkeleton collapsed rows={3} />);
    expect(rows(html)).toBe(3);
    expect(html.match(/justify-center/g)).toHaveLength(3);
    expect(html).not.toContain("h-2.5");
  });

  it("draws a label bar per row when expanded", () => {
    const html = renderToStaticMarkup(<RailModesSkeleton collapsed={false} rows={4} />);
    expect(html.match(/h-2\.5/g)).toHaveLength(4);
    expect(html).toContain("width:58%");
  });

  it("draws nothing for zero rows", () => {
    expect(rows(renderToStaticMarkup(<RailModesSkeleton collapsed={false} rows={0} />))).toBe(0);
  });
});
