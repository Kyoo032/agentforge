import type { Clip, EditProject } from "@agentforge/core/edit";

export type PreviewMediaKind = "video" | "image";

export type PreviewMedia = {
  clipId: string;
  kind: PreviewMediaKind;
  mediaId: string;
  /** Frame inside the source asset that the playhead maps to. */
  localFrame: number;
};

export function videoClipAt(project: EditProject, playhead: number): Clip | undefined {
  return project.clips.find(
    (clip) =>
      project.tracks.find((track) => track.id === clip.trackId)?.kind === "video" &&
      playhead >= clip.timelineStartFrame &&
      playhead < clip.timelineStartFrame + clip.durationFrames,
  );
}

/**
 * Resolve what the preview should draw for a video-track clip.
 * A clip whose source is still generating shows its fallback still, and an
 * image asset is drawn as an image rather than through a `<video>` element.
 */
export function previewMediaForClip(project: EditProject, clip: Clip | undefined, playhead: number): PreviewMedia | null {
  if (!clip) {
    return null;
  }
  const assetId = clip.source?.assetId ?? clip.fallbackAssetId;
  const asset = assetId ? project.assets[assetId] : undefined;
  if (!asset?.mediaId || asset.kind === "audio") {
    return null;
  }
  const inFrame = clip.source?.assetId === asset.id ? (clip.source?.inFrame ?? 0) : 0;
  return {
    clipId: clip.id,
    kind: asset.kind === "image" ? "image" : "video",
    mediaId: asset.mediaId,
    localFrame: Math.max(0, playhead - clip.timelineStartFrame + inFrame),
  };
}

export function previewMediaAt(project: EditProject, playhead: number): PreviewMedia | null {
  return previewMediaForClip(project, videoClipAt(project, playhead), playhead);
}

export type StillClip = { clipId: string; assetId: string; mediaId: string };

/** The image clip under the playhead, if any: the natural still for "Video from image". */
export function imageClipAt(project: EditProject, playhead: number): StillClip | null {
  const clip = videoClipAt(project, playhead);
  const assetId = clip?.source?.assetId;
  const asset = assetId ? project.assets[assetId] : undefined;
  if (!clip || !assetId || !asset?.mediaId || asset.kind !== "image") {
    return null;
  }
  return { clipId: clip.id, assetId, mediaId: asset.mediaId };
}
