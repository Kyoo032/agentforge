# Nultron brand and mascot: review sheets (2026-09-29)

The sheets shared with Rizky while the Nultron mascot and app logo were designed, in the order they were shown. The 3D scene and its renderer are in `tools/nultron-3d`, the logo master in `apps/desktop/branding/agentforge/source/`; this folder is the review record.

| File | What it shows | Outcome |
|---|---|---|
| `01-flat-rig-vs-reference.png` | Hand-drawn SVG rig next to the reference front view | Rejected: "should be more 3D and realistic" |
| `02-flat-rig-states.png` | The 21 states of the SVG rig on light and dark | Rejected with 01 |
| `03-flat-mini-choice.png` | Small head, flat two-tone vs soft-shaded, 16-128 px | Rejected with 01 |
| `04-flat-brand-sheet.png` | App icon, wordmark and lockups from the SVG rig | Rejected with 01 |
| `05-3d-work-in-progress.png` | First three.js render: icon tile and head | "Too thin and looks scary" |
| `06-3d-volume-pass.png` | Puffier face, chunky collar, plumper body, next to the reference | Accepted direction |
| `07-3d-review-set-approved.png` | Front, 3/4, head and icon on light and dark, next to the reference | Approved: "way cuter" |
| `08-3d-poses-and-props.png` | 20 states posed with their props | First pose pass |
| `09-3d-final-renders.png` | The shipped render set: 21 stills, heads, 6 clips, 13 busy loops | Final mascot (contact sheet uses reduced colours) |
| `10-logo-kit.png` | Icons, favicon, rail mark, lockups and a macOS Dock check, built from Rizky's app logo | Final logo kit |

`reference/` holds Rizky's own images: the three character sheets he generated (`sheet-v1.webp`, `sheet-v2.jpg`, `sheet-v3-hires.jpg`) and the final app logo (`app-logo.webp`, 1600 px), which is the source every icon and logo file is regenerated from with `apps/desktop/scripts/brand-icons.mjs`. The copy the script reads is `apps/desktop/branding/agentforge/source/app-logo.webp` (same bytes); this one stays here with the sheets.
