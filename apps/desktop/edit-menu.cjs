/**
 * Edit menu + right-click menu for the Electron shell.
 *
 * Electron only wires Ctrl/Cmd+C/V/X/A to the application menu's Edit roles, and it never
 * shows a native context menu on its own. With `Menu.setApplicationMenu(null)` paste was dead
 * on macOS and right-click did nothing anywhere, so the onboarding API key field could not be
 * pasted into. Templates are pure so they can be tested without Electron.
 */

function editSubmenu() {
  return [
    { role: "undo" },
    { role: "redo" },
    { type: "separator" },
    { role: "cut" },
    { role: "copy" },
    { role: "paste" },
    { role: "selectAll" },
  ];
}

function macAppSubmenu() {
  return [
    { role: "about" },
    { type: "separator" },
    { role: "hide" },
    { role: "hideOthers" },
    { role: "unhide" },
    { type: "separator" },
    { role: "quit" },
  ];
}

/**
 * macOS needs the app menu + Edit for Cmd shortcuts to exist at all. Windows/Linux only get
 * Edit; the window keeps `autoHideMenuBar` so the bar stays out of sight while accelerators work.
 */
function applicationMenuTemplate(platform, productName) {
  const edit = { label: "Edit", submenu: editSubmenu() };
  if (platform === "darwin") {
    return [
      { label: productName, submenu: macAppSubmenu() },
      edit,
      { label: "Window", submenu: [{ role: "minimize" }, { role: "close" }] },
    ];
  }
  return [edit];
}

function hasSelection(params) {
  return typeof params?.selectionText === "string" && params.selectionText.trim().length > 0;
}

/** Right-click menu for a `context-menu` event. Empty array means "show nothing". */
function contextMenuTemplate(params) {
  const selected = hasSelection(params);
  if (params?.isEditable) {
    return [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut", enabled: selected },
      { role: "copy", enabled: selected },
      { role: "paste" },
      { type: "separator" },
      { role: "selectAll" },
    ];
  }
  return selected ? [{ role: "copy" }] : [];
}

function installApplicationMenu({ Menu, platform, productName }) {
  const template = applicationMenuTemplate(platform, productName);
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  return template;
}

function attachContextMenu({ Menu, window }) {
  const onContextMenu = (_event, params) => {
    const template = contextMenuTemplate(params);
    if (template.length === 0) {
      return;
    }
    Menu.buildFromTemplate(template).popup({ window });
  };
  window.webContents.on("context-menu", onContextMenu);
  return onContextMenu;
}

module.exports = {
  applicationMenuTemplate,
  contextMenuTemplate,
  installApplicationMenu,
  attachContextMenu,
};
