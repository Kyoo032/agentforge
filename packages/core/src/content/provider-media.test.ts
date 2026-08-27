import { describe, expect, it } from "vitest";
import {
  imagePartForProvider,
  isUnreachableProviderMediaUrl,
  localMediaId,
  rewriteUnreachableMediaInJson,
  scrubUnreachableMediaArgs,
} from "./provider-media";

describe("localMediaId", () => {
  it("reads ids from relative and loopback media URLs", () => {
    expect(localMediaId("/api/v1/media/f66a438a-781a-478b-8e67-c19be7771c20/file")).toBe(
      "f66a438a-781a-478b-8e67-c19be7771c20",
    );
    expect(
      localMediaId("http://127.0.0.1:3000/api/v1/media/f66a438a-781a-478b-8e67-c19be7771c20/file"),
    ).toBe("f66a438a-781a-478b-8e67-c19be7771c20");
  });

  it("returns null for remote urls", () => {
    expect(localMediaId("https://cdn.example/a.png")).toBeNull();
    expect(localMediaId("data:image/png;base64,abc")).toBeNull();
  });
});

describe("isUnreachableProviderMediaUrl", () => {
  it("flags loopback and relative media", () => {
    expect(isUnreachableProviderMediaUrl("/api/v1/media/f66a438a-781a-478b-8e67-c19be7771c20/file")).toBe(true);
    expect(
      isUnreachableProviderMediaUrl("http://127.0.0.1:3000/api/v1/media/f66a438a-781a-478b-8e67-c19be7771c20/file"),
    ).toBe(true);
    expect(isUnreachableProviderMediaUrl("http://localhost:3000/x.png")).toBe(true);
  });

  it("allows https and data urls", () => {
    expect(isUnreachableProviderMediaUrl("https://cdn.example/a.png")).toBe(false);
    expect(isUnreachableProviderMediaUrl("data:image/png;base64,abc")).toBe(false);
  });
});

describe("imagePartForProvider", () => {
  it("sends https and data urls as images", () => {
    expect(imagePartForProvider("https://cdn.example/a.png")).toEqual({
      type: "image",
      image: "https://cdn.example/a.png",
    });
    expect(imagePartForProvider("data:image/png;base64,abc")).toEqual({
      type: "image",
      image: "data:image/png;base64,abc",
    });
  });

  it("does not send loopback urls to the provider", () => {
    const part = imagePartForProvider("http://127.0.0.1:3000/api/v1/media/f66a438a-781a-478b-8e67-c19be7771c20/file");
    expect(part.type).toBe("text");
  });
});

describe("scrubUnreachableMediaArgs", () => {
  it("drops loopback image_url so the gateway is not asked to download localhost", () => {
    expect(
      scrubUnreachableMediaArgs({
        prompt: "edit this",
        image_url: "http://127.0.0.1:3000/api/v1/media/f66a438a-781a-478b-8e67-c19be7771c20/file",
      }),
    ).toEqual({ prompt: "edit this" });
  });
});

describe("rewriteUnreachableMediaInJson", () => {
  it("rewrites chat image_url parts that point at the local app", () => {
    expect(
      rewriteUnreachableMediaInJson({
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: "http://127.0.0.1:3000/api/v1/media/f66a438a-781a-478b-8e67-c19be7771c20/file",
                },
              },
            ],
          },
        ],
      }),
    ).toEqual({
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "[Image attached in the local app. It is already shown to the user.]" }],
        },
      ],
    });
  });

  it("scrubs loopback urls inside JSON tool-call argument strings", () => {
    const rewritten = rewriteUnreachableMediaInJson({
      arguments: JSON.stringify({
        prompt: "edit this",
        image_url: "http://127.0.0.1:3000/api/v1/media/f66a438a-781a-478b-8e67-c19be7771c20/file",
      }),
    }) as { arguments: string };
    expect(JSON.parse(rewritten.arguments)).toEqual({ prompt: "edit this" });
  });

  it("leaves https image urls alone", () => {
    const body = {
      messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://cdn.example/a.png" } }] }],
    };
    expect(rewriteUnreachableMediaInJson(body)).toEqual(body);
  });
});
