# Nultron images

The mascot is a set of pre-rendered images, the output of the offline 3D pipeline (glossy clay, one fixed
camera, transparent background). The app ships only these files. To update the character, replace them
(same layout) and `manifest.json`; nothing in code changes. Read `docs/internal/maps/mascot-and-brand.md`
first.

```
manifest.json
full/<state>.webp     the whole body, one square canvas (manifest `full.size`, 512 px)
head/<state>.webp     the head, one square canvas (`head.size`, 256 px), for boxes under 64 px
clips/<state>.webp    one-shot strips, `frames` canvases of `size` px side by side (320 px), played once
loops/<state>.webp    busy strips, 4 frames of 320 px, looped while a job runs
```

- `<state>` is one of the 21 in `apps/web/lib/mascot-states.ts`. Every state has a `full/` and a `head/`
  still. The character is the same size in every `full/` image (one camera), so a state change never makes
  it jump: do not re-crop per state.
- **Clips** exist for the `once` states (`wave`, `celebrating`, `error`, `surprised`, `love`, `lets-go`);
  the last frame equals the still. A clip lasts `frames / fps` and must last 600 to 1200 ms. They are
  static sprite sheets stepped with `transform` and `steps()`, not animated WebP.
- **Loops** exist for the working states, exactly 4 frames each (`--ease-busy` is `steps(4)`), at the fps
  recorded for THAT loop in the manifest (3, 4 or 6). They run only while a job runs (`data-busy`).
- A state with no clip or loop takes a small transform motion on its still (`nultron.css`), and a head box
  (under 64 px) has neither strip: it takes the same transform motion on the head.
- The manifest is imported (typed and bundled), not fetched. `bytes` is the total the files carry.
- The files sit here, next to the code, rather than under `public/`: the desktop shell loads the renderer
  as a `file://` document where an absolute `/nultron/...` path would point at the disk's root, and going
  through the bundler puts a content hash in each name, so a replaced render is never served stale.
- `lib/nultron-images.test.tsx` checks every file the manifest names exists at the size it declares (PNG or
  WebP), that no other file is here, and that clips, loops and beats fit the motion contract.
- The renders come from `tools/nultron-3d` (its README has the steps). Do not copy a render in by hand: run
  `node sync-images.mjs <render dir>` there, which checks the set against this folder's contract first.
