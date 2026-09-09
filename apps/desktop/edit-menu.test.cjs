const assert = require("node:assert/strict");
const {
  applicationMenuTemplate,
  contextMenuTemplate,
  installApplicationMenu,
  attachContextMenu,
} = require("./edit-menu.cjs");

function roles(items) {
  return items.filter((item) => item.role).map((item) => item.role);
}

function editMenu(template) {
  return template.find((item) => item.label === "Edit");
}

// ---------- applicationMenuTemplate ----------

for (const platform of ["win32", "linux"]) {
  const template = applicationMenuTemplate(platform, "DPSBuddy");
  assert.equal(template.length, 1, `${platform}: only an Edit menu`);
  assert.deepEqual(roles(editMenu(template).submenu), ["undo", "redo", "cut", "copy", "paste", "selectAll"]);
}

const mac = applicationMenuTemplate("darwin", "Kemenkeu AI");
assert.equal(mac[0].label, "Kemenkeu AI", "mac: first menu is the app menu");
assert.ok(roles(mac[0].submenu).includes("quit"));
assert.deepEqual(roles(editMenu(mac).submenu), ["undo", "redo", "cut", "copy", "paste", "selectAll"]);
assert.equal(mac[2].label, "Window");

// ---------- contextMenuTemplate ----------

const editableEmpty = contextMenuTemplate({ isEditable: true, selectionText: "" });
assert.ok(roles(editableEmpty).includes("paste"), "editable field always offers paste");
assert.equal(editableEmpty.find((item) => item.role === "cut").enabled, false);
assert.equal(editableEmpty.find((item) => item.role === "copy").enabled, false);
assert.equal(editableEmpty.find((item) => item.role === "paste").enabled, undefined);

const editableSelected = contextMenuTemplate({ isEditable: true, selectionText: "sk-abc" });
assert.equal(editableSelected.find((item) => item.role === "cut").enabled, true);
assert.equal(editableSelected.find((item) => item.role === "copy").enabled, true);

assert.deepEqual(roles(contextMenuTemplate({ isEditable: false, selectionText: "hello" })), ["copy"]);
assert.deepEqual(contextMenuTemplate({ isEditable: false, selectionText: "   " }), []);
assert.deepEqual(contextMenuTemplate({ isEditable: false }), []);
assert.deepEqual(contextMenuTemplate(undefined), []);

// ---------- installApplicationMenu / attachContextMenu with a fake Menu ----------

function makeMenu() {
  const calls = { built: [], set: [], popups: [] };
  const Menu = {
    buildFromTemplate: (template) => {
      calls.built.push(template);
      return { template, popup: (options) => calls.popups.push({ template, options }) };
    },
    setApplicationMenu: (menu) => calls.set.push(menu),
  };
  return { Menu, calls };
}

{
  const { Menu, calls } = makeMenu();
  installApplicationMenu({ Menu, platform: "win32", productName: "DPSBuddy" });
  assert.equal(calls.set.length, 1);
  assert.ok(calls.set[0], "application menu is a real menu, never null");
  assert.deepEqual(roles(editMenu(calls.set[0].template).submenu), [
    "undo",
    "redo",
    "cut",
    "copy",
    "paste",
    "selectAll",
  ]);
}

{
  const { Menu, calls } = makeMenu();
  const listeners = new Map();
  const window = { webContents: { on: (event, fn) => listeners.set(event, fn) } };
  attachContextMenu({ Menu, window });
  const onContextMenu = listeners.get("context-menu");
  assert.equal(typeof onContextMenu, "function");

  onContextMenu({}, { isEditable: true, selectionText: "" });
  assert.equal(calls.popups.length, 1, "editable field pops a menu");
  assert.equal(calls.popups[0].options.window, window);
  assert.ok(roles(calls.popups[0].template).includes("paste"));

  onContextMenu({}, { isEditable: false, selectionText: "" });
  assert.equal(calls.popups.length, 1, "plain page with no selection shows nothing");
}

console.log("edit-menu.test.cjs: ok");
