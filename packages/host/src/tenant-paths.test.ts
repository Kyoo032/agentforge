/**
 * Phase 3 lane D — the storage half.
 *
 * Three questions, per the lane's test plan: two tenants get disjoint paths, a path never escapes
 * its tenant's prefix, and desktop mode keeps the exact layout it has today.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ApiError, LOCAL_TENANT_ID } from "@agentforge/core";

const dataDir = mkdtempSync(path.join(tmpdir(), "agentforge-tenant-paths-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
delete process.env.MEDIA_ROOT;

const {
  TENANTS_DIR,
  assertPathSegment,
  assertTenantId,
  isInside,
  isInsideTenantRoot,
  tenantDataDir,
  tenantDeniedRoots,
  tenantRelativePath,
  tenantScopedRoot,
  tenantSegments,
  resolveInsideTenantRoot,
} = await import("./tenant-paths");
const { mediaRelativePath, mediaFilePath, mediaRoot, tenantMediaRoot } = await import("./media-root");
const { editAllowlist, editScratchRoot, assertInsidePath } = await import("./edit/ffmpeg/paths");
const { matterDir } = await import("./legal/store-files");

const A = "tenant-alpha";
const B = "tenant-beta";
const ORG = "11111111-1111-4111-8111-111111111111";
const DESK = "22222222-2222-4222-8222-222222222222";
const PROJECT = "33333333-3333-4333-8333-333333333333";

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("tenant id and segment validation", () => {
  it("refuses anything that could become a path outside the tenant", () => {
    for (const bad of ["..", ".", "a/b", "a\\b", "/abs", "C:", "a\0b", "", "x".repeat(81), TENANTS_DIR]) {
      expect(() => assertTenantId(bad)).toThrow(ApiError);
      expect(() => assertPathSegment(bad, "Segment")).toThrow(ApiError);
    }
    expect(assertTenantId(A)).toBe(A);
    expect(assertPathSegment(ORG, "Org")).toBe(ORG);
  });

  it("refuses a filename that carries a separator", () => {
    expect(() => tenantRelativePath(A, [ORG], "../escape.png")).toThrow(ApiError);
    expect(() => tenantRelativePath(A, [ORG], "sub/dir.png")).toThrow(ApiError);
    expect(() => tenantRelativePath(A, [ORG], "..")).toThrow(ApiError);
    expect(() => tenantRelativePath(A, ["../other"], "x.png")).toThrow(ApiError);
  });

  it("reserves the `tenants` directory so no id can alias another tenant's subtree", () => {
    expect(() => assertTenantId(TENANTS_DIR)).toThrow(ApiError);
    expect(() => tenantRelativePath(LOCAL_TENANT_ID, [TENANTS_DIR], "x.png")).toThrow(ApiError);
  });
});

describe("two tenants get disjoint paths", () => {
  it("separates the data dir, the media root and every derived root", () => {
    expect(tenantDataDir(A)).not.toBe(tenantDataDir(B));
    expect(tenantMediaRoot(A)).not.toBe(tenantMediaRoot(B));
    expect(isInside(tenantDataDir(A), tenantDataDir(B))).toBe(false);
    expect(isInside(tenantMediaRoot(A), tenantMediaRoot(B))).toBe(false);

    expect(editScratchRoot({ tenantId: A, projectId: PROJECT })).not.toBe(
      editScratchRoot({ tenantId: B, projectId: PROJECT }),
    );
    expect(matterDir(path.join(dataDir, "legal"), A, DESK, "matter-1")).not.toBe(
      matterDir(path.join(dataDir, "legal"), B, DESK, "matter-1"),
    );
  });

  it("writes storage_path values that cannot collide", () => {
    // Same organization and same file name on purpose: only the tenant prefix separates them.
    expect(mediaRelativePath(A, [ORG], "x.png")).toBe(`${TENANTS_DIR}/${A}/${ORG}/x.png`);
    expect(mediaRelativePath(B, [ORG], "x.png")).toBe(`${TENANTS_DIR}/${B}/${ORG}/x.png`);
  });

  it("refuses to resolve one tenant's storage_path for another tenant", () => {
    const relative = mediaRelativePath(B, [ORG], "x.png");
    expect(() => mediaFilePath(A, relative)).toThrow(ApiError);
    expect(mediaFilePath(B, relative)).toBe(path.resolve(mediaRoot(), relative));
  });
});

describe("a path never escapes its tenant prefix", () => {
  it("rejects traversal out of the tenant root", () => {
    const root = tenantMediaRoot(A);
    expect(isInsideTenantRoot(mediaRoot(), A, path.join(root, "..", "..", "etc"))).toBe(false);
    expect(isInsideTenantRoot(mediaRoot(), A, path.join(root, "ok.png"))).toBe(true);
    expect(() => mediaFilePath(A, "../../etc/passwd")).toThrow(ApiError);
  });

  it("stops the local tenant reaching a hosted tenant, although its root contains theirs", () => {
    // This is the one case the prefix rule costs us: `local-tenant`'s root IS the install root,
    // so `tenants/<other>` sits inside it and a plain prefix test would wave it through.
    const hosted = tenantMediaRoot(B);
    expect(isInside(mediaRoot(), hosted)).toBe(true);
    expect(isInsideTenantRoot(mediaRoot(), LOCAL_TENANT_ID, hosted)).toBe(false);
    expect(tenantDeniedRoots(mediaRoot(), LOCAL_TENANT_ID)).toEqual([path.join(mediaRoot(), TENANTS_DIR)]);
    expect(tenantDeniedRoots(mediaRoot(), A)).toEqual([]);
    expect(() => mediaFilePath(LOCAL_TENANT_ID, mediaRelativePath(B, [ORG], "x.png"))).toThrow(ApiError);
  });

  it("denies another tenant's media through the ffmpeg allowlist", () => {
    const localFile = path.join(mediaRoot(), ORG, "local.mp4");
    const hostedFile = path.join(tenantMediaRoot(B), ORG, "hosted.mp4");
    for (const file of [localFile, hostedFile]) {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, "x");
    }
    const localAllow = editAllowlist({ tenantId: LOCAL_TENANT_ID, projectId: PROJECT });
    const hostedAllow = editAllowlist({ tenantId: B, projectId: PROJECT });

    expect(assertInsidePath(localFile, localAllow)).toBe(localFile);
    expect(() => assertInsidePath(hostedFile, localAllow)).toThrow(ApiError);
    expect(assertInsidePath(hostedFile, hostedAllow)).toBe(hostedFile);
    expect(() => assertInsidePath(localFile, hostedAllow)).toThrow(ApiError);
  });

  it("refuses a malformed project id before it reaches the filesystem", () => {
    expect(() => editScratchRoot({ tenantId: A, projectId: "../../etc" })).toThrow(ApiError);
    expect(() => matterDir(path.join(dataDir, "legal"), A, "../../etc", "m")).toThrow(ApiError);
  });
});

describe("desktop mode: the local tenant keeps the pre-Phase-3 layout", () => {
  it("adds no segments at all", () => {
    expect(tenantSegments(LOCAL_TENANT_ID)).toEqual([]);
    expect(tenantSegments(A)).toEqual([TENANTS_DIR, A]);
    expect(tenantScopedRoot(dataDir, LOCAL_TENANT_ID)).toBe(dataDir);
  });

  it("leaves every path a pre-Phase-3 build would have produced unchanged", () => {
    expect(tenantDataDir(LOCAL_TENANT_ID)).toBe(path.resolve(dataDir));
    expect(tenantMediaRoot(LOCAL_TENANT_ID)).toBe(mediaRoot());
    // `media.ts:47` before this change: `${organizationId}/${id}.${ext}`.
    expect(mediaRelativePath(LOCAL_TENANT_ID, [ORG], "x.png")).toBe(`${ORG}/x.png`);
    // `edit/ffmpeg/paths.ts:42` before this change: `<dataDir>/edit/<projectId>`.
    expect(editScratchRoot({ tenantId: LOCAL_TENANT_ID, projectId: PROJECT })).toBe(
      path.join(path.resolve(dataDir), "edit", PROJECT),
    );
    // `legal/store-files.ts:45` before this change: `<rootDir>/<workspaceId>/<matterId>`.
    const legal = path.join(dataDir, "legal");
    expect(matterDir(legal, LOCAL_TENANT_ID, DESK, "matter-1")).toBe(path.join(legal, DESK, "matter-1"));
  });

  it("still resolves a storage_path written before Phase 3", () => {
    const legacy = `${ORG}/old.png`;
    expect(mediaFilePath(LOCAL_TENANT_ID, legacy)).toBe(path.resolve(mediaRoot(), legacy));
  });
});

/**
 * Verifier finding N2 on PR #80: `path.resolve` walks `..` but follows no symlinks, so a link
 * planted inside a tenant's subtree passed a purely lexical containment test while pointing at
 * another tenant's file. Only someone with disk access can plant one, but the ffmpeg guard already
 * resolved and denied exactly this, so the media and dataset guards should not be the weaker pair.
 */
describe("a symlink cannot smuggle a path out of its tenant prefix", () => {
  it("refuses a link under tenant A that points into tenant B", () => {
    const victim = path.join(tenantMediaRoot(B), ORG, "secret.png");
    mkdirSync(path.dirname(victim), { recursive: true });
    writeFileSync(victim, "B's bytes");

    const attackerDir = path.join(tenantMediaRoot(A), ORG);
    mkdirSync(attackerDir, { recursive: true });
    const link = path.join(attackerDir, "link.png");
    symlinkSync(victim, link);

    // Lexically it looks like A's own file, which is the whole trap.
    expect(isInsideTenantRoot(mediaRoot(), A, link)).toBe(true);
    // Resolved, it is B's, so A is refused and the 404 is the same one a missing row gets.
    expect(resolveInsideTenantRoot(mediaRoot(), A, link)).toBeNull();
    expect(() => mediaFilePath(A, `${TENANTS_DIR}/${A}/${ORG}/link.png`)).toThrow(ApiError);
    // B reaches its own file through the link, and gets the real path back rather than the link.
    expect(mediaFilePath(B, `${TENANTS_DIR}/${B}/${ORG}/secret.png`)).toBe(realpathSync(victim));
  });

  it("refuses a link that points clean out of the media root", () => {
    const outside = path.join(dataDir, "outside.png");
    writeFileSync(outside, "not media at all");
    const dir = path.join(tenantMediaRoot(A), ORG);
    mkdirSync(dir, { recursive: true });
    const link = path.join(dir, "escape.png");
    symlinkSync(outside, link);

    expect(resolveInsideTenantRoot(mediaRoot(), A, link)).toBeNull();
  });

  it("still allows a path whose file does not exist yet, which cannot be a link", () => {
    // The fallback that keeps `mediaFilePath` answering 404 for a missing row rather than throwing
    // on a directory that was never created.
    const notYet = path.join(tenantMediaRoot(A), ORG, "unwritten.png");
    expect(resolveInsideTenantRoot(mediaRoot(), A, notYet)).not.toBeNull();
    const noParent = path.join(tenantMediaRoot(A), "never", "made", "x.png");
    expect(resolveInsideTenantRoot(mediaRoot(), A, noParent)).not.toBeNull();
    expect(resolveInsideTenantRoot(mediaRoot(), B, noParent)).toBeNull();
  });
});
