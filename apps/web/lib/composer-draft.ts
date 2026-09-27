/**
 * Unsent Chat composer text and files.
 *
 * `WorkModeKeepAlive` mounts every desk under `key={workspaceId ?? "boot"}`. The shell
 * starts with no desk id, then `GET /workspaces` names one and remounts the pane. Composer
 * state dies with that remount, which is how an attachment made on a brand-new Chat
 * disappears before it is sent. This stash lives outside that key. A later desk id adopts
 * the boot draft; a switch to a different desk does not.
 */

export type ComposerDraftFile = {
  id: string;
  file: File;
  kind: string;
};

type Stash = {
  workspaceId: string | null;
  text: string;
  files: ComposerDraftFile[];
};

let stash: Stash = { workspaceId: null, text: "", files: [] };

export function readComposerDraft(workspaceId: string | null): { text: string; files: ComposerDraftFile[] } {
  if (stash.workspaceId && workspaceId && stash.workspaceId !== workspaceId) {
    stash = { workspaceId, text: "", files: [] };
    return { text: "", files: [] };
  }
  if (stash.workspaceId == null && workspaceId) {
    stash = { ...stash, workspaceId };
  }
  return { text: stash.text, files: [...stash.files] };
}

export function writeComposerDraft(
  workspaceId: string | null,
  draft: { text: string; files: ComposerDraftFile[] },
): void {
  const id =
    stash.workspaceId && workspaceId && stash.workspaceId !== workspaceId
      ? workspaceId
      : (workspaceId ?? stash.workspaceId);
  stash = { workspaceId: id, text: draft.text, files: draft.files };
}

export function resetComposerDraftForTests(): void {
  stash = { workspaceId: null, text: "", files: [] };
}
