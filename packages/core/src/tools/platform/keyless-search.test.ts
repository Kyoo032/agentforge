import { afterEach, describe, expect, it, vi } from "vitest";
import {
  KEYLESS_ARXIV_GAP_MS,
  KEYLESS_ORIGINS,
  KEYLESS_USER_AGENT,
  resetKeylessSearchState,
  searchKeyless,
} from "./keyless-search";

type MockResponse = {
  status: number;
  body: string;
  location?: string;
};

function responseFor(spec: MockResponse): Response {
  return {
    status: spec.status,
    headers: { get: (name: string) => (name.toLowerCase() === "location" ? (spec.location ?? null) : null) },
    text: async () => spec.body,
  } as unknown as Response;
}

const wikiPage = {
  pages: [
    {
      key: "Photosynthesis",
      title: "Photosynthesis",
      excerpt: 'Plants <span class="searchmatch">make</span> sugar.',
      description: "Biological process",
    },
    { key: "Chlorophyll", title: "Chlorophyll", excerpt: "Green pigment", description: "" },
    { key: "Leaf", title: "Leaf", excerpt: "Plant organ", description: "" },
  ],
};

const openAlexWork = {
  results: [
    {
      display_name: "A paper on leaves",
      doi: "https://doi.org/10.1000/leaf",
      id: "https://openalex.org/W1",
      publication_year: 2024,
      primary_location: { landing_page_url: "http://insecure.example/leaf" },
      abstract_inverted_index: { Leaves: [0], matter: [1] },
    },
  ],
};

function route(url: string): MockResponse {
  if (url.startsWith(`${KEYLESS_ORIGINS.wikipediaEn}/`) || url.startsWith(`${KEYLESS_ORIGINS.wikipediaId}/`)) {
    return { status: 200, body: JSON.stringify(wikiPage) };
  }
  if (url.startsWith(`${KEYLESS_ORIGINS.openAlex}/`)) {
    return { status: 200, body: JSON.stringify(openAlexWork) };
  }
  if (url.startsWith(`${KEYLESS_ORIGINS.arxiv}/`)) {
    return {
      status: 200,
      body: `<feed><entry><id>http://arxiv.org/abs/2401.00001v1</id><title>Preprint  title</title><summary>An abstract.</summary></entry></feed>`,
    };
  }
  if (url.startsWith(`${KEYLESS_ORIGINS.crossref}/`)) {
    return {
      status: 200,
      body: JSON.stringify({
        message: {
          items: [
            { title: ["DOI paper"], URL: "https://doi.org/10.1000/cross", abstract: "<jats:p>Cross abstract</jats:p>" },
          ],
        },
      }),
    };
  }
  return { status: 500, body: "" };
}

describe("searchKeyless", () => {
  afterEach(() => {
    resetKeylessSearchState();
    vi.unstubAllGlobals();
  });

  it("merges Wikipedia and OpenAlex, drops non-HTTPS landing pages, and strips excerpt HTML", async () => {
    const seen: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      seen.push(url);
      const headers = init?.headers as Record<string, string> | undefined;
      expect(init?.redirect).toBe("manual");
      expect(headers?.["User-Agent"]).toBe(KEYLESS_USER_AGENT);
      expect(headers?.Authorization).toBeUndefined();
      return responseFor(route(url));
    });
    const result = await searchKeyless("how plants make sugar", {
      fetchImpl: fetchMock,
      locale: "en",
      now: () => 1_000,
    });
    expect(result.outage).toBe(false);
    expect(result.hits.map((hit) => hit.url)).toEqual([
      "https://en.wikipedia.org/wiki/Photosynthesis",
      "https://en.wikipedia.org/wiki/Chlorophyll",
      "https://en.wikipedia.org/wiki/Leaf",
      "https://doi.org/10.1000/leaf",
    ]);
    expect(result.hits[0]?.description).toBe("Plants make sugar.");
    expect(result.hits[3]?.description).toBe("Leaves matter");
    expect(result.hits.map((hit) => hit.position)).toEqual([1, 2, 3, 4]);
    expect(seen.some((url) => url.startsWith(KEYLESS_ORIGINS.arxiv))).toBe(false);
    expect(seen.some((url) => url.startsWith(KEYLESS_ORIGINS.crossref))).toBe(false);
  });

  it("uses the Indonesian Wikipedia host for an id desk", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => responseFor(route(String(input))));
    await searchKeyless("fotosintesis", { fetchImpl: fetchMock, locale: "id", now: () => 1_000 });
    expect(fetchMock.mock.calls.some((call) => String(call[0]).startsWith(KEYLESS_ORIGINS.wikipediaId))).toBe(true);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).startsWith(KEYLESS_ORIGINS.wikipediaEn))).toBe(false);
  });

  it("does not follow a redirect off the pinned origin", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.startsWith(KEYLESS_ORIGINS.wikipediaEn)) {
        return responseFor({ status: 302, body: "", location: "https://evil.example/steal" });
      }
      return responseFor(route(url));
    });
    const result = await searchKeyless("plants", { fetchImpl: fetchMock, locale: "en", now: () => 1_000 });
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("evil.example"))).toBe(false);
    expect(result.hits.map((hit) => hit.url)).toEqual([
      "https://doi.org/10.1000/leaf",
      "https://arxiv.org/abs/2401.00001v1",
    ]);
  });

  it("follows a same-origin redirect and then reads the body", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/search/page") && !url.includes("redirected=1")) {
        return responseFor({
          status: 302,
          body: "",
          location: `${KEYLESS_ORIGINS.wikipediaEn}/w/rest.php/v1/search/page?q=plants&limit=5&redirected=1`,
        });
      }
      return responseFor(route(url));
    });
    const result = await searchKeyless("plants", { fetchImpl: fetchMock, locale: "en", now: () => 1_000 });
    expect(result.hits[0]?.url).toBe("https://en.wikipedia.org/wiki/Photosynthesis");
  });

  it("calls arXiv and then Crossref when the first pair is thin", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.startsWith(KEYLESS_ORIGINS.wikipediaEn) || url.startsWith(KEYLESS_ORIGINS.openAlex)) {
        return responseFor({ status: 200, body: url.includes("openalex") ? '{"results":[]}' : '{"pages":[]}' });
      }
      return responseFor(route(url));
    });
    const sleeps: number[] = [];
    const result = await searchKeyless("obscure topic", {
      fetchImpl: fetchMock,
      locale: "en",
      now: () => 5_000,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(result.hits.map((hit) => hit.url)).toEqual([
      "https://arxiv.org/abs/2401.00001v1",
      "https://doi.org/10.1000/cross",
    ]);
    expect(sleeps).toEqual([]);
  });

  it("spaces a second arXiv request by three seconds", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.startsWith(KEYLESS_ORIGINS.arxiv)) {
        return responseFor(route(url));
      }
      return responseFor({ status: 503, body: "" });
    });
    const sleeps: number[] = [];
    const options = {
      fetchImpl: fetchMock,
      locale: "en" as const,
      now: () => 20_000,
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
    };
    await searchKeyless("first paper study", options);
    await searchKeyless("second paper study", options);
    expect(sleeps).toEqual([KEYLESS_ARXIV_GAP_MS]);
  });

  it("asks arXiv even when Wikipedia is full, if the query is scholarly", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => responseFor(route(String(input))));
    const result = await searchKeyless("battery preprint study", {
      fetchImpl: fetchMock,
      locale: "en",
      now: () => 1_000,
    });
    expect(result.hits[0]?.url).toBe("https://doi.org/10.1000/leaf");
    expect(result.hits.some((hit) => hit.url.includes("arxiv.org"))).toBe(true);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).startsWith(KEYLESS_ORIGINS.crossref))).toBe(false);
  });

  it("caches a completed search and skips the network", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => responseFor(route(String(input))));
    const options = { fetchImpl: fetchMock, locale: "en" as const, now: () => 1_000 };
    await searchKeyless("plants", options);
    const calls = fetchMock.mock.calls.length;
    const again = await searchKeyless("  Plants  ", options);
    expect(fetchMock.mock.calls.length).toBe(calls);
    expect(again.hits[0]?.title).toBe("Photosynthesis");
  });

  it("reports an outage when every source fails, and does not cache it", async () => {
    const fetchMock = vi.fn(async () => responseFor({ status: 503, body: "" }));
    const options = {
      fetchImpl: fetchMock,
      locale: "en" as const,
      now: () => 1_000,
      sleep: async () => {},
    };
    const failed = await searchKeyless("plants", options);
    expect(failed).toMatchObject({ outage: true, hits: [] });
    const calls = fetchMock.mock.calls.length;
    await searchKeyless("plants", options);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(calls);
  });

  it("masks an email before the query leaves", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => responseFor(route(String(input))));
    await searchKeyless("notes for ada@example.com", { fetchImpl: fetchMock, locale: "en", now: () => 1_000 });
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain("ada@example.com");
    }
  });
});
