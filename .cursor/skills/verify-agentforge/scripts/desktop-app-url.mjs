import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Packaged Electron writes host-status.json under userData
 * (`app.setName("Agentforge")` + `extraMetadata.name: "agentforge"`):
 *   Windows: %APPDATA%\Agentforge\host-status.json
 *            (legacy fallback: %APPDATA%\@agentforge\desktop\host-status.json)
 *   Linux:   $XDG_CONFIG_HOME/Agentforge/host-status.json or ~/.config/Agentforge/host-status.json
 *   macOS:   ~/Library/Application Support/Agentforge/host-status.json
 *
 * Older installers wrote app-url.txt (HTTP child). Doctor --desktop must not require that file.
 *
 * @param {{ APPDATA?: string, XDG_CONFIG_HOME?: string }} [env]
 * @param {NodeJS.Platform} [platform]
 * @param {string} [home]
 * @returns {string[]}
 */
export function desktopHostStatusCandidates(
  env = process.env,
  platform = process.platform,
  home = homedir(),
) {
  return desktopUserDataDirs(env, platform, home).map((dir) => join(dir, "host-status.json"));
}

/** @deprecated HTTP child leftover. Packaged Agentforge no longer writes this. */
export function desktopAppUrlCandidates(
  env = process.env,
  platform = process.platform,
  home = homedir(),
) {
  return desktopUserDataDirs(env, platform, home).map((dir) => join(dir, "app-url.txt"));
}

/**
 * @param {{ APPDATA?: string, XDG_CONFIG_HOME?: string }} [env]
 * @param {NodeJS.Platform} [platform]
 * @param {string} [home]
 * @returns {string[]}
 */
export function desktopUserDataDirs(
  env = process.env,
  platform = process.platform,
  home = homedir(),
) {
  if (platform === "win32") {
    const roaming = typeof env.APPDATA === "string" ? env.APPDATA.trim() : "";
    if (roaming) {
      return [
        join(roaming, "Agentforge"),
        join(roaming, "Kemenkeu AI"),
        join(roaming, "AIHub Metranet"),
        join(roaming, "@agentforge", "desktop"),
      ];
    }
  }
  if (platform === "darwin") {
    return [
      join(home, "Library", "Application Support", "Agentforge"),
      join(home, "Library", "Application Support", "Kemenkeu AI"),
      join(home, "Library", "Application Support", "AIHub Metranet"),
    ];
  }
  const xdg = typeof env.XDG_CONFIG_HOME === "string" ? env.XDG_CONFIG_HOME.trim() : "";
  const configHome = xdg || join(home, ".config");
  return [
    join(configHome, "Agentforge"),
    join(configHome, "Kemenkeu AI"),
    join(configHome, "AIHub Metranet"),
  ];
}

/**
 * @param {NodeJS.Platform} [platform]
 * @returns {string}
 */
export function packagedSqliteHint(platform = process.platform) {
  if (platform === "win32") {
    return "%APPDATA%/Agentforge/agentforge.sqlite";
  }
  if (platform === "darwin") {
    return "~/Library/Application Support/Agentforge/agentforge.sqlite";
  }
  return "$XDG_CONFIG_HOME/Agentforge/agentforge.sqlite or ~/.config/Agentforge/agentforge.sqlite";
}
