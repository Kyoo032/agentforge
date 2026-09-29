import type { PickerGroupKind } from "@agentforge/core/preferred";
import { t } from "./i18n";

/**
 * The words on a model picker's group headings, in the desk's language.
 *
 * Core sends each group as a stable `kind` plus an English `label` (`pickerGroups`), and copy is the
 * renderer's job: the host never imports these catalogues. Brand groups (GPT, Claude, Gemini, ...) are
 * proper nouns and keep their own name; `recommended` and `other` are words and go through the
 * `chat` catalogue. Both pickers use this, the Chat palette and the native `<select>` the studios and
 * Knowledge use, which used to disagree: the palette translated "Recommended" and the select never did.
 */
export function pickerGroupLabel(group: { kind: PickerGroupKind; label: string }): string {
  switch (group.kind) {
    case "recommended":
      return t("chat.models.groups.recommended");
    case "other":
      return t("chat.models.groups.other");
    default:
      return group.label;
  }
}

/** The one heading of the flat embeddings list, where there is a single group and no brand split. */
export function embeddingsGroupLabel(): string {
  return t("chat.models.groups.embeddings");
}
