const assert = require("node:assert/strict");
const {
  navigationDecision,
  rendererOrigin,
  isTrustedSender,
  safeSaveFilename,
  isMediaProtocolKey,
} = require("./navigation.cjs");

// ---------- packaged: the one file:// document ----------

const packaged = rendererOrigin({
  packaged: true,
  rendererIndex: "C:\\Program Files\\DPSBuddy\\resources\\renderer\\index.html",
});

assert.equal(
  navigationDecision("file:///C:/Program%20Files/DPSBuddy/resources/renderer/index.html", packaged),
  "allow",
  "packaged: reloading the renderer itself",
);
assert.equal(
  navigationDecision("file:///C:/Program Files/DPSBuddy/resources/renderer/index.html#/chat", packaged),
  "allow",
  "packaged: a HashRouter route is the same document",
);
assert.equal(
  navigationDecision("file:///C:/Program Files/DPSBuddy/resources/renderer/index.html?x=1", packaged),
  "allow",
  "packaged: a query string is the same document",
);
assert.equal(
  navigationDecision("file:///C:/Users/rizky/AppData/Roaming/DPSBuddy/settings.enc", packaged),
  "block",
  "packaged: never navigate to another local file",
);
assert.equal(navigationDecision("file:///etc/passwd", packaged), "block");

// ---------- external links from model output ----------

assert.equal(navigationDecision("https://example.test/report", packaged), "external");
assert.equal(navigationDecision("http://example.test/report", packaged), "external");
assert.equal(
  navigationDecision("http://127.0.0.1:3000/chat", packaged),
  "external",
  "packaged: the dev server is not this app's document either",
);

// ---------- everything else is refused ----------

assert.equal(navigationDecision("agentforge://media/abc", packaged), "block", "media is fetched, never navigated to");
assert.equal(navigationDecision("about:blank", packaged), "block");
assert.equal(navigationDecision("javascript:alert(1)", packaged), "block");
assert.equal(navigationDecision("mailto:someone@example.test", packaged), "block");
assert.equal(navigationDecision("data:text/html,<h1>hi</h1>", packaged), "block");
assert.equal(navigationDecision("not a url", packaged), "block");
assert.equal(navigationDecision("", packaged), "block");

// ---------- webdev: the dev server origin ----------

const webdev = rendererOrigin({ packaged: false, webdevUrl: "http://127.0.0.1:3000" });

assert.equal(navigationDecision("http://127.0.0.1:3000/chat", webdev), "allow");
assert.equal(navigationDecision("http://127.0.0.1:3000/", webdev), "allow");
assert.equal(
  navigationDecision("https://127.0.0.1:3000/chat", webdev),
  "external",
  "a different scheme is a different origin",
);
assert.equal(
  navigationDecision("http://localhost:3000/chat", webdev),
  "external",
  "localhost is not the pinned origin",
);
assert.equal(navigationDecision("https://example.test", webdev), "external");
assert.equal(navigationDecision("file:///C:/anything.html", webdev), "block", "webdev has no file:// document");

// ---------- a missing / unusable origin never widens the rule ----------

assert.equal(
  navigationDecision("https://example.test", rendererOrigin({ packaged: false, webdevUrl: "" })),
  "external",
);
assert.equal(navigationDecision("file:///C:/x.html", rendererOrigin({ packaged: true, rendererIndex: "" })), "block");
assert.equal(navigationDecision("https://example.test", undefined), "external");
assert.equal(navigationDecision("file:///C:/x.html", undefined), "block");

// ---------- isTrustedSender: which frame may drive a privileged ipcMain handler ----------

/** Minimal stand-ins: the predicate only ever compares identities and asks whether the window is gone. */
function fakeWindow({ destroyed = false, mainFrame = { id: "main" } } = {}) {
  return { isDestroyed: () => destroyed, webContents: { mainFrame } };
}

const liveWindow = fakeWindow();

assert.equal(
  isTrustedSender({ senderFrame: liveWindow.webContents.mainFrame }, liveWindow),
  true,
  "the renderer's own main frame is the one trusted caller",
);
assert.equal(
  isTrustedSender({ senderFrame: { id: "iframe" } }, liveWindow),
  false,
  "a subframe must not reach the host, the save dialog or the relaunch",
);
assert.equal(
  isTrustedSender({ senderFrame: liveWindow.webContents.mainFrame }, fakeWindow({ destroyed: true })),
  false,
  "a destroyed window trusts nobody",
);
assert.equal(isTrustedSender({ senderFrame: { id: "main" } }, null), false, "no window: deny");
assert.equal(isTrustedSender({ senderFrame: { id: "main" } }, undefined), false);
assert.equal(isTrustedSender(undefined, liveWindow), false, "no event: deny");
assert.equal(isTrustedSender({}, liveWindow), false, "an event with no sender frame is not the main frame");
assert.equal(
  isTrustedSender({ senderFrame: undefined }, fakeWindow({ mainFrame: undefined })),
  false,
  "undefined === undefined must not read as trusted",
);
assert.equal(isTrustedSender({ senderFrame: { id: "main" } }, { webContents: {} }), false, "no isDestroyed: deny");
assert.equal(
  isTrustedSender(
    {
      get senderFrame() {
        throw new Error("frame disposed");
      },
    },
    liveWindow,
  ),
  false,
  "reading senderFrame throws once the frame is gone; that is a refusal, not a crash",
);

// ---------- safeSaveFilename: the default name host:save-bytes may pre-fill ----------

assert.equal(safeSaveFilename("report.pdf"), "report.pdf");
assert.equal(safeSaveFilename("my chart (2).png"), "my chart (2).png", "spaces and parens are ordinary names");
assert.equal(safeSaveFilename("laporan-keuangan.xlsx"), "laporan-keuangan.xlsx");
assert.equal(safeSaveFilename("  spaced.txt  "), "spaced.txt", "trimmed, not refused");

assert.equal(safeSaveFilename(""), null);
assert.equal(safeSaveFilename("   "), null);
assert.equal(safeSaveFilename(null), null);
assert.equal(safeSaveFilename(undefined), null);
assert.equal(safeSaveFilename({}), null, "an object stringifies to something with no basename we want");
assert.equal(safeSaveFilename("."), null);
assert.equal(safeSaveFilename(".."), null);
assert.equal(safeSaveFilename("/"), null);

assert.equal(
  safeSaveFilename("..\\..\\Startup\\run.exe"),
  "run.exe",
  "a Windows traversal is cut back to its leaf on every OS, not just on win32",
);
assert.equal(
  safeSaveFilename("../../etc/passwd"),
  "passwd",
  "the leaf of a POSIX traversal survives, the path does not",
);
assert.equal(safeSaveFilename("C:\\Windows\\System32\\evil.dll"), "evil.dll", "the drive and directories are dropped");
assert.equal(safeSaveFilename("a/b.txt"), "b.txt");
assert.equal(safeSaveFilename("C:report.pdf"), "report.pdf", "a drive-relative prefix is dropped with the drive");
assert.equal(safeSaveFilename("notes.txt:stream"), null, "NTFS alternate data stream");
assert.equal(safeSaveFilename("bad\u0000name.txt"), null, "control characters are not names");
assert.equal(safeSaveFilename("line\nbreak.txt"), null);

for (const reserved of ["CON", "con", "PRN", "aux", "NUL", "COM1", "com9", "LPT1", "lpt9"]) {
  assert.equal(safeSaveFilename(reserved), null, `${reserved} is a Windows device, not a file`);
  assert.equal(safeSaveFilename(`${reserved}.txt`), null, `${reserved}.txt still resolves to the device`);
}
assert.equal(safeSaveFilename("CONTRACT.pdf"), "CONTRACT.pdf", "only the exact device names are reserved");
assert.equal(safeSaveFilename("COM10.log"), "COM10.log", "COM10 is not a device");
assert.equal(safeSaveFilename("console.log"), "console.log");

// ---------- isMediaProtocolKey: what may be templated into a host route ----------

assert.equal(isMediaProtocolKey("11111111-1111-4111-8111-111111111111"), true, "a crypto.randomUUID() media id");
assert.equal(isMediaProtocolKey("daisy-macro.mp4"), true, "a bundled example clip");
assert.equal(isMediaProtocolKey("talk-bookstore-dialogue.mp4"), true);
assert.equal(isMediaProtocolKey("a"), true);
assert.equal(isMediaProtocolKey("A_b.C-9"), true);

assert.equal(isMediaProtocolKey(""), false);
assert.equal(isMediaProtocolKey("."), false);
assert.equal(isMediaProtocolKey(".."), false);
assert.equal(isMediaProtocolKey("../../api/v1/settings"), false, "no traversal into another host route");
assert.equal(isMediaProtocolKey("abc/def"), false);
assert.equal(isMediaProtocolKey("abc def"), false);
assert.equal(isMediaProtocolKey("abc?x=1"), false);
assert.equal(isMediaProtocolKey("abc#frag"), false);
assert.equal(isMediaProtocolKey("abc%2f"), false, "a percent sign never reaches a real id");
assert.equal(isMediaProtocolKey("x".repeat(128)), true);
assert.equal(isMediaProtocolKey("x".repeat(129)), false);
assert.equal(isMediaProtocolKey(undefined), false);
assert.equal(isMediaProtocolKey(null), false);
assert.equal(isMediaProtocolKey(123), false);

console.log("navigation.test.cjs: ok");
