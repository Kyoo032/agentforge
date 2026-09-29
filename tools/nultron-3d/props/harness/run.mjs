// Starts the repo's Electron on shot.cjs (the offscreen page capture used by the props sheet and the pose sheets).
//   node props/harness/run.mjs --page props/harness/sheet.html --out work/props-sheet.png --query "group=held&bg=light"
// Paths are relative to where you run it; see shot.cjs for every flag.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchElectron } from "../../lib/electron.mjs";

process.exit(await launchElectron(join(dirname(fileURLToPath(import.meta.url)), "shot.cjs"), process.argv.slice(2)));
