export const EDIT_REFUSAL_CODES = [
  "turn_cap_exceeded",
  "price_unknown",
  "confirm_required",
  "still_unsupported",
  "asr_unavailable",
  "review_required",
] as const;

export type EditRefusalCode = (typeof EDIT_REFUSAL_CODES)[number];

export type EditToolRefusal = {
  success: false;
  refused: EditRefusalCode;
  message?: string;
};

export function editToolRefusal(refused: EditRefusalCode, message?: string): EditToolRefusal {
  return message ? { success: false, refused, message } : { success: false, refused };
}
