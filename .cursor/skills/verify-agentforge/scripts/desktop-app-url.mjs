import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Packaged Electron writes app-url.txt under userData
 * (`app.setName("Agentforge")` + `extraMetadata.name: "agentforge"`):
 *   Windows: %APPDATA%\Agentforge\app-url.txt
 *            (legacy fallback: %APPDATA%\@agentforge\desktop\app-url.txt)
 *   Linux:   $XDG_CONFIG_HOME/Agentforge/app-url.txt or ~/.config/Agentforge/app-url.txt
 *   macOS:   ~/Library/Application Support/Agentforge/app-url.txt
 *
 * @param {{ APPDATA?: string, XDG_CONFIG_HOME?: string }} [env]
 * @param {NodeJS.Platform} [platform]
 * @param {string} [home]
 * @returns {string[]}
 */
export function desktopAppUrlCandidates(
  env = process.env,
  platform = process.platform,
  home = homedir(),
) {
  if (platform === "win32") {
    const roaming = typeof env.APPDATA === "string" ? env.APPDATA.trim() : "";
    if (roaming) {
      return [
        join(roaming, "Agentforge", "app-url.txt"),
        // Pre-setName installs used the scoped npm package folder.
        join(roaming, "@agentforge", "desktop", "app-url.txt"),
      ];
    }
  }
  if (platform === "darwin") {
    return [join(home, "Library", "Application Support", "Agentforge", "app-url.txt")];
  }
  const xdg = typeof env.XDG_CONFIG_HOME === "string" ? env.XDG_CONFIG_HOME.trim() : "";
  const configHome = xdg || join(home, ".config");
  return [join(configHome, "Agentforge", "app-url.txt")];
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
