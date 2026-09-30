import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import {
  clipBeats,
  clipSpec,
  loopBeats,
  loopSpec,
  type NxImageKind,
  stillPath,
} from "@/components/nultron/nx-image-manifest";
import { imageUrl } from "@/components/nultron/nx-image-urls";
import { hasClip, hasLoop, hasStill } from "@/components/nultron/nx-picture";
import type { MascotState } from "@/lib/mascot-states";

/** Which files draw a state lives in nx-picture.ts; re-exported for the callers that always read it here. */
export { hasClip, hasLoop, hasStill };

/** Resolves true once the image is loaded and decoded, so painting it costs no blank frame; false if it failed. */
export function whenPaintable(img: HTMLImageElement): Promise<boolean> {
  if (typeof img.decode === "function") {
    return img.decode().then(
      () => true,
      () => false,
    );
  }
  if (img.complete) {
    return Promise.resolve(img.naturalWidth > 0);
  }
  return new Promise((resolve) => {
    img.addEventListener("load", () => resolve(true), { once: true });
    img.addEventListener("error", () => resolve(false), { once: true });
  });
}

type Painted = { state: MascotState; kind: NxImageKind };

const sameArt = (a: Painted, b: Painted) => a.state === b.state && a.kind === b.kind;
const artKey = (art: Painted) => `${art.kind}:${art.state}`;

/**
 * What is drawn: the still for the state and, for a state that has one, the clip that plays over it
 * once (a `once` state, full canvas only) or the four-frame loop that runs while a job does (a
 * `loop-busy` state, full canvas only, and only while `busy`: an idle body never fetches its loop). A
 * head box has neither and takes the small transform motion in `nultron.css`. Which state, size, crop and
 * motion is decided by the component and the stylesheet.
 *
 * Nothing is fetched here ahead of need (`nx-warm.ts` does that, from the mount points). Two rules keep
 * a slow fetch from ever showing an empty box, with or without a cache:
 *  - the art of the state the desk was showing stays mounted, under the new one, until the new still can
 *    be painted (`held`). It is the same element, not a copy of its URL: a new `<img>` can go back to the
 *    network for a picture that is already on screen (a browser with its cache off does), and a copy
 *    would then be the empty box;
 *  - a strip animates only once it is loaded and decoded and its own still is painted
 *    (`data-sheet="ready"` on the art), so the still stays on screen and the clip starts late instead of
 *    playing over nothing or over the previous state.
 */
export function NxImageRig({ state, kind, busy = false }: { state: MascotState; kind: NxImageKind; busy?: boolean }) {
  const [painted, setPainted] = useState<Painted | null>(null);
  const markPainted = useCallback(
    (next: Painted) => setPainted((current) => (current && sameArt(current, next) ? current : next)),
    [],
  );
  if (!hasStill(state, kind)) {
    return null;
  }
  const now: Painted = { state, kind };
  const behind = painted && !sameArt(painted, now) && hasStill(painted.state, painted.kind) ? painted : null;
  // An array of keyed arts: the previous art keeps its element when it goes from the only child to the
  // first of two, and a CSS animation restarts only when its element is new (two clip states share the
  // same animation names, so going from one to the next would otherwise play nothing).
  const arts = [
    ...(behind ? [<NxArt key={artKey(behind)} {...behind} busy={false} held onPainted={markPainted} />] : []),
    <NxArt key={artKey(now)} {...now} busy={busy} held={false} onPainted={markPainted} />,
  ];
  return <>{arts}</>;
}

function NxArt({
  state,
  kind,
  busy,
  held,
  onPainted,
}: {
  state: MascotState;
  kind: NxImageKind;
  busy: boolean;
  /** The art of the previous state, kept under the new one: its still only, no strip. */
  held: boolean;
  onPainted: (painted: Painted) => void;
}) {
  const still = imageUrl(stillPath(kind, state));
  const clip = !held && hasClip(state, kind) ? clipSpec(state) : null;
  const loop = !held && busy && hasLoop(state, kind) ? loopSpec(state) : null;
  const [stillPainted, setStillPainted] = useState(false);
  const [sheetReady, setSheetReady] = useState(false);
  const stillRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const img = stillRef.current;
    if (!img) {
      return;
    }
    let live = true;
    void whenPaintable(img).then(() => {
      if (live) {
        setStillPainted(true);
        onPainted({ state, kind });
      }
    });
    return () => {
      live = false;
    };
  }, [state, kind, onPainted]);

  const vars: Record<string, number> = {};
  if (clip) {
    vars["--nx-clip-frames"] = clip.frames;
    vars["--nx-clip-beats"] = clipBeats(clip);
  }
  if (loop) {
    vars["--nx-loop-frames"] = loop.frames;
    vars["--nx-loop-beats"] = loopBeats(loop);
  }
  return (
    <span
      className={held ? "nx-art nx-held" : "nx-art"}
      data-sheet={!held && stillPainted && sheetReady ? "ready" : undefined}
      style={clip || loop ? (vars as CSSProperties) : undefined}
    >
      <img ref={stillRef} className="nx-still" src={still} alt="" draggable={false} decoding="async" />
      {clip ? <NxSheet className="nx-strip" src={imageUrl(clip.src)} onReady={setSheetReady} /> : null}
      {loop ? <NxSheet className="nx-loop" src={imageUrl(loop.src)} onReady={setSheetReady} /> : null}
    </span>
  );
}

/**
 * A strip of frames. It reports when it can be painted (and that it no longer can, when it unmounts, so a
 * strip that comes back is not taken for a loaded one); the stylesheet does not start it before that.
 */
function NxSheet({
  className,
  src,
  onReady,
}: {
  className: "nx-strip" | "nx-loop";
  src: string | undefined;
  onReady: (ready: boolean) => void;
}) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const img = ref.current;
    if (!img) {
      return;
    }
    let live = true;
    void whenPaintable(img).then((ok) => {
      if (live && ok) {
        onReady(true);
      }
    });
    return () => {
      live = false;
      onReady(false);
    };
  }, [onReady]);
  return (
    <span className={className}>
      <img ref={ref} src={src} alt="" draggable={false} decoding="async" />
    </span>
  );
}
