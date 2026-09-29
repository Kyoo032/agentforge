// Writes the batch job list for the modeller's render.mjs: every state, front and 3/4, into poses/frames/.
//   node poses/tools/make-jobs.mjs > poses/frames/jobs.json && node render.mjs --batch poses/frames/jobs.json --quiet
import { STATE_NAMES } from "../../rig.js";
const size = Number(process.argv[2] ?? 512);
const jobs = [];
for (const state of STATE_NAMES) {
  jobs.push({ out: `poses/frames/front/${state}.png`, view: "full", state, size, ss: 2, bg: "#eef1f6" });
  jobs.push({ out: `poses/frames/34/${state}.png`, view: "full", state, size, ss: 2, bg: "#eef1f6", yaw: -30, pitch: 4 });
}
console.log(JSON.stringify(jobs, null, 1));
