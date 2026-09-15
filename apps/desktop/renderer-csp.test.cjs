const assert = require("node:assert/strict");
const { RENDERER_CSP, injectCspMeta } = require("./renderer-csp.cjs");

// ---------- the policy itself ----------

const directives = new Map(
  RENDERER_CSP.split("; ").map((directive) => {
    const [name, ...values] = directive.split(" ");
    return [name, values];
  }),
);

assert.deepEqual(directives.get("default-src"), ["'self'"]);
assert.deepEqual(directives.get("script-src"), ["'self'"], "no inline script, no eval, no remote script");
assert.deepEqual(directives.get("object-src"), ["'none'"]);
assert.deepEqual(directives.get("frame-src"), ["'none'"]);
assert.deepEqual(directives.get("base-uri"), ["'none'"]);
assert.deepEqual(directives.get("form-action"), ["'none'"]);
assert.ok(directives.get("style-src").includes("'unsafe-inline'"), "inline style attributes are used by the UI");
assert.ok(!directives.get("script-src").includes("'unsafe-inline'"), "the script half never gets that allowance");
assert.ok(!RENDERER_CSP.includes("'unsafe-eval'"));
assert.ok(!RENDERER_CSP.includes("http:"), "the packaged renderer never reaches a remote origin");
assert.ok(!RENDERER_CSP.includes("*"), "no wildcard source");

for (const [name, sources] of [
  ["img-src", ["'self'", "data:", "blob:", "agentforge:"]],
  ["media-src", ["'self'", "blob:", "agentforge:"]],
  ["connect-src", ["'self'", "agentforge:"]],
]) {
  assert.deepEqual(directives.get(name), sources, `${name} carries exactly the sources the app uses`);
}

// ---------- injectCspMeta: what the pack step bakes into the shipped index.html ----------

const INDEX = [
  "<!doctype html>",
  '<html lang="en">',
  "  <head>",
  '    <meta charset="UTF-8" />',
  "    <title>DPSBuddy</title>",
  '    <script type="module" crossorigin src="./assets/index-abc.js"></script>',
  "  </head>",
  '  <body class="min-h-screen">',
  '    <div id="root"></div>',
  "  </body>",
  "</html>",
].join("\n");

const injected = injectCspMeta(INDEX);

assert.ok(injected.includes(`content="${RENDERER_CSP}"`), "the shipped page carries the whole policy");
assert.ok(
  injected.indexOf("Content-Security-Policy") < injected.indexOf("<title>"),
  "the policy is the first thing in <head>: a meta policy cannot govern what the parser already met",
);
assert.ok(
  injected.indexOf("Content-Security-Policy") < injected.indexOf("./assets/index-abc.js"),
  "in particular it precedes the bundle it is meant to constrain",
);
assert.ok(injected.includes('<div id="root"></div>'), "nothing else in the document is disturbed");
assert.ok(injected.includes('<meta charset="UTF-8" />'), "the existing head tags survive");

assert.equal(
  (injectCspMeta(injected).match(/Content-Security-Policy/g) ?? []).length,
  1,
  "re-staging replaces the policy instead of stacking a second one",
);
assert.equal(injectCspMeta(injected), injected, "and lands on exactly the same document");

assert.ok(
  injectCspMeta(INDEX, "default-src 'none'").includes(`content="default-src 'none'"`),
  "the policy is a parameter, so a flavor could carry its own",
);
assert.ok(injectCspMeta("<html><HEAD><title>x</title></HEAD></html>").includes("Content-Security-Policy"));
assert.ok(injectCspMeta('<html><head data-x="1"><title>x</title></head></html>').includes("Content-Security-Policy"));

assert.throws(
  () => injectCspMeta("<html><body>no head</body></html>"),
  /no <head>/,
  "a renderer with no <head> must fail the pack, not ship unprotected",
);

console.log("renderer-csp.test.cjs: ok");
