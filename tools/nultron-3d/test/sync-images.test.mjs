// node --test test/sync-images.test.mjs   (run from tools/nultron-3d; plain node, no Electron, no render)
// The fixtures are the app's own shipped images, copied to a temp folder, so the tests need no render and stay true to the contract.
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { readAppContract } from "../lib/app-contract.mjs";
import { APP_IMAGES_DIR, REPO_ROOT } from "../lib/electron.mjs";
import { checkImageSet } from "../lib/manifest-check.mjs";
import { imageInfo } from "../lib/webp.mjs";
import { syncImages } from "../sync-images.mjs";

const contract = readAppContract(REPO_ROOT);
const quiet = () => {};
let scratch;

/** A copy of the shipped set that a test may break. */
function freshSet(name) {
  const dir = join(scratch, name);
  cpSync(APP_IMAGES_DIR, dir, { recursive: true });
  return dir;
}
const readManifest = (dir) => JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
const writeManifest = (dir, m) => writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(m, null, 2)}\n`);

before(() => {
  scratch = mkdtempSync(join(tmpdir(), "nultron-sync-"));
});
after(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

describe("the app contract, read from the app's source", () => {
  it("lists 21 states, six with a one-shot clip and thirteen that loop while busy", () => {
    assert.equal(contract.states.length, 21);
    assert.equal(contract.onceStates.length, 6);
    assert.equal(contract.busyStates.length, 13);
    assert.equal(contract.loopFrames, 4);
    assert.equal(contract.beatMs, contract.motionToken);
  });
});

describe("checkImageSet", () => {
  it("passes the set the app ships today with no error and no warning", () => {
    const result = checkImageSet(APP_IMAGES_DIR, contract);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
    assert.equal(
      result.files.length,
      contract.states.length * 2 + contract.onceStates.length + contract.busyStates.length,
    );
  });

  it("reads WebP sizes and alpha from the header", () => {
    const info = imageInfo(readFileSync(join(APP_IMAGES_DIR, "full", "idle.webp")));
    assert.deepEqual(info, { format: "webp", width: 512, height: 512, alpha: true });
  });

  it("refuses a state the app does not know", () => {
    const dir = freshSet("unknown-state");
    const m = readManifest(dir);
    m.full.states.dance = "full/idle.webp";
    writeManifest(dir, m);
    assert.match(checkImageSet(dir, contract).errors.join("\n"), /"dance" is not a mascot state/);
  });

  it("refuses a loop that is not exactly four frames", () => {
    const dir = freshSet("loop-frames");
    const m = readManifest(dir);
    m.loops.thinking.frames = 3;
    writeManifest(dir, m);
    assert.match(checkImageSet(dir, contract).errors.join("\n"), /loops\/thinking: 3 frames, must be exactly 4/);
  });

  it("refuses a clip outside 600 to 1200 ms, and a clip on a state that does not play once", () => {
    const dir = freshSet("clip-ms");
    const m = readManifest(dir);
    m.clips.wave.fps = 30;
    m.clips.idle = { ...m.clips.wave, src: "clips/idle.webp" };
    writeManifest(dir, m);
    const errors = checkImageSet(dir, contract).errors.join("\n");
    assert.match(errors, /clips\/wave: 467 ms, must be 600 to 1200/);
    assert.match(errors, /"idle" has a clip but is not a "once" state/);
  });

  it("refuses a missing file, a picture of the wrong size and a wrong byte total", () => {
    const dir = freshSet("files");
    rmSync(join(dir, "head", "love.webp"));
    cpSync(join(dir, "head", "idle.webp"), join(dir, "full", "wave.webp"), { force: true });
    const errors = checkImageSet(dir, contract).errors.join("\n");
    assert.match(errors, /missing file head\/love\.webp/);
    assert.match(errors, /full\/wave\.webp is 256x256, manifest says 512x512/);
    assert.match(errors, /manifest\.bytes is \d+ but the files add up to \d+/);
  });

  it("only warns when a state simply has no clip or loop", () => {
    const dir = freshSet("optional");
    const m = readManifest(dir);
    delete m.loops.charging;
    m.bytes -= statSync(join(dir, "loops", "charging.webp")).size;
    writeManifest(dir, m);
    const result = checkImageSet(dir, contract);
    assert.deepEqual(result.errors, []);
    assert.match(result.warnings.join("\n"), /"charging" is a "loop-busy" state with no loop/);
  });
});

describe("syncImages", () => {
  it("copies what changed, keeps what is identical, removes what is no longer named, and leaves README.md", () => {
    const render = freshSet("render");
    // the "new render": one still replaced by another state's picture of the same size, one stray file gone from the manifest
    cpSync(join(render, "full", "wave.webp"), join(render, "full", "love.webp"), { force: true });
    const m = readManifest(render);
    const newBytes =
      m.bytes - statSync(join(APP_IMAGES_DIR, "full", "love.webp")).size + statSync(join(render, "full", "love.webp")).size;
    m.bytes = newBytes;
    writeManifest(render, m);

    const app = join(scratch, "app");
    cpSync(APP_IMAGES_DIR, app, { recursive: true });
    writeFileSync(join(app, "README.md"), "keep me\n");
    mkdirSync(join(app, "full"), { recursive: true });
    writeFileSync(join(app, "full", "old-pose.webp"), "stale");

    const before = statSync(join(app, "full", "idle.webp")).mtimeMs;
    const result = syncImages({ dir: render, appImages: app, log: quiet });
    assert.equal(result.ok, true, result.errors.join("; "));
    assert.deepEqual(result.plan.copy.map((c) => c.rel), ["full/love.webp"]);
    assert.deepEqual(result.plan.remove, ["full/old-pose.webp"]);
    assert.equal(result.plan.keep.length, checkImageSet(APP_IMAGES_DIR, contract).files.length - 1);
    assert.equal(existsSync(join(app, "full", "old-pose.webp")), false);
    assert.equal(readFileSync(join(app, "README.md"), "utf8"), "keep me\n");
    assert.equal(statSync(join(app, "full", "idle.webp")).mtimeMs, before, "an identical file is not rewritten");
    assert.ok(readFileSync(join(app, "full", "love.webp")).equals(readFileSync(join(render, "full", "love.webp"))));
    assert.equal(readManifest(app).bytes, newBytes);
  });

  it("writes nothing when the set fails its check, or with check: true", () => {
    const broken = freshSet("broken");
    rmSync(join(broken, "loops", "writing.webp"));
    const app = join(scratch, "app-untouched");
    cpSync(APP_IMAGES_DIR, app, { recursive: true });
    const failed = syncImages({ dir: broken, appImages: app, log: quiet });
    assert.equal(failed.ok, false);
    assert.ok(readFileSync(join(app, "loops", "writing.webp")).length > 0, "the app copy is intact");

    const render = freshSet("render-check");
    rmSync(join(app, "clips", "wave.webp"));
    const dry = syncImages({ dir: render, appImages: app, check: true, log: quiet });
    assert.equal(dry.ok, true);
    assert.deepEqual(dry.plan.copy.map((c) => [c.rel, c.isNew]), [["clips/wave.webp", true]]);
    assert.equal(existsSync(join(app, "clips", "wave.webp")), false, "check mode did not write");
  });
});
