# Images

Images is a generate studio (prompt → gallery), not a canvas editor. It lists gateway image model ids. Without a Toko Token key the page still renders and shows a needs-key note. Live generate is an operator pass on this machine, never Cloud.

## Sub-features

- `images-rail` reaches `/images` from `mode-images` on Default.
- `images-shell` shows `images-studio` (heading Images, prompt bar, gallery).
- `images-needs-key` shows `images-studio-needs-key` when no gateway key is ready.
- `images-empty` shows `images-studio-empty` ("Nothing here yet") when the gallery has no items.

## How to get to it (user POV)

- Choose Images on the left rail (`mode-images`). Default already has the tab.
- Open `http://127.0.0.1:3000/images` when the tab is unlocked. A hidden generate URL redirects to the first visible mode.

## Driving it with the Agentforge harness

Preconditions:

- Doctor exits 0.
- `mode-images` is visible on Default. If count is 0, you are on a desk that hid Images (e.g. Legal) — not a missing agent.
- Stub / no-key proof stops at the shell. Do not click `images-studio-submit` unless the operator asked for a live generate and doctor reports `ai`.

- **Open Images.** Click `mode-images`. URL matches `/images` (15s). `images-studio` is visible (15s).
- **No-key state.** If doctor `hasOpenai` is false, `images-studio-needs-key` is visible and mentions Settings.
- **Empty gallery.** When there are no saved images, `images-studio-empty` is visible.
- **IDE proof.** Screenshot of the studio shell (and needs-key if shown) under `evidence/images/<run-id>/`.
- **Cloud.** `foundation.spec.ts` asserts `images-studio` on Default. It does not generate an image.

## Gotchas

- The smoke does not assert `images-studio-needs-key`. Still require it for a no-key proof on this map.
- The studio posts to `/api/v1/images`, not `/runs/image`. `/runs/image` is fail-closed attach-and-analyze. A keyless submit is a 400, not a silent drop.
- A visible prompt bar is not a successful generate. Proof of generate is a gallery item (or a visible `images-studio-error`).
- Midjourney-style `mj_*` ids may appear in the picker when live. Stub has no live catalog.
