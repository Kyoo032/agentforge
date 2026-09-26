import { t } from "@/lib/i18n";
import { MASCOT_STATE_DATA, type MascotPlacement, type MascotState } from "@/lib/mascot-states";

/**
 * PLACEHOLDER mascot.
 *
 * The owner is designing the Nultron character. This file is the only art:
 * one geometric face plus pose layers, coloured with the desk accent. To swap
 * the real character in, replace the `<svg>` and keep `PlaceholderMascot`,
 * `data-testid="chat-mascot"`, `data-placeholder="nultron-mascot"`, and
 * `data-state`. Which pose plays is data in `lib/mascot-states.ts`. Motion
 * lives in `app/globals.css` under `.chat-mascot`.
 */
export type PlaceholderMascotState = MascotState;

export function PlaceholderMascot({
  state,
  placement = "beside",
  mode,
}: {
  state: MascotState;
  placement?: MascotPlacement;
  mode?: string;
}) {
  const def = MASCOT_STATE_DATA[state];
  return (
    <span
      className="chat-mascot"
      data-testid="chat-mascot"
      data-placeholder="nultron-mascot"
      data-state={state}
      data-pose={def.pose}
      data-mouth={def.mouth}
      data-placement={placement}
      data-mode={mode}
      role="img"
      aria-label={t(def.labelKey)}
      title={t(def.labelKey)}
    >
      <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
        <g className="chat-mascot-face">
          <rect
            className="chat-mascot-body"
            x="6"
            y="5"
            width="18"
            height="18"
            rx="4"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <g className="chat-mascot-look">
            <circle className="chat-mascot-eyes" cx="12" cy="12" r="1.3" fill="currentColor" />
            <circle className="chat-mascot-eyes" cx="18" cy="12" r="1.3" fill="currentColor" />
            <path className="chat-mascot-shut" d="M10.6 12.2h2.8M16.6 12.2h2.8" />
          </g>
          <path className="chat-mascot-mouth chat-mascot-mouth-idle" d="M11 16.5h8" />
          <path className="chat-mascot-mouth chat-mascot-mouth-talk" d="M11 16c1.2 1.6 6.8 1.6 8 0" />
          <path className="chat-mascot-mouth chat-mascot-mouth-smile" d="M10.5 15.6c1.4 2.2 7.6 2.2 9 0" />
          <path className="chat-mascot-mouth chat-mascot-mouth-sad" d="M11 17.6c1.4-1.6 6.6-1.6 8 0" />
          <path className="chat-mascot-mouth chat-mascot-mouth-sleep" d="M12 16.4h6" />
        </g>
        <g className="chat-mascot-arm">
          <path d="M22 14c3 0 5-2 6-4" />
        </g>
        <g className="chat-mascot-prop chat-mascot-prop-writing">
          <path d="M22 18l6 2-1 2-6-2z" />
        </g>
        <g className="chat-mascot-prop chat-mascot-prop-searching">
          <circle cx="24" cy="18" r="3" />
          <path d="M26.2 20.2 29 23" />
        </g>
        <g className="chat-mascot-prop chat-mascot-prop-calculating">
          <rect x="21" y="16" width="8" height="9" rx="1.2" />
          <path d="M23 18.5h4M23 21h2" />
        </g>
        <g className="chat-mascot-prop chat-mascot-prop-charting">
          <path d="M21 24V19M24.5 24v-8M28 24v-5" />
        </g>
        <g className="chat-mascot-prop chat-mascot-prop-reviewing">
          <rect x="21" y="15" width="7" height="9" rx="1" />
          <path d="M26 15.5l3 1.2-1.2 3" />
        </g>
        <g className="chat-mascot-prop chat-mascot-prop-listening">
          <path d="M21 12a4 4 0 0 1 8 0v3h-1.5V12a2.5 2.5 0 0 0-5 0v3H21z" />
        </g>
        <g className="chat-mascot-prop chat-mascot-prop-painting">
          <path d="M22 22c4-1 6-4 6-7 0-1.2-2-1-2.2.4-.3 2-2 3-3.8 2.6" />
        </g>
        <g className="chat-mascot-prop chat-mascot-prop-filming">
          <path d="M21 16h8v6h-8z" />
          <path d="M22 16l2-3h4l2 3" />
        </g>
        <g className="chat-mascot-prop chat-mascot-prop-editing">
          <path d="M22 16l3 3-1.2 1.2-3-3zM27 21l1.5 1.5" />
          <path d="M26 15l3 3-1.2 1.2-3-3z" />
        </g>
        <g className="chat-mascot-prop chat-mascot-prop-presenting">
          <rect x="21" y="15" width="8" height="6" rx="0.8" />
          <path d="M25 21v3M23 24h4" />
        </g>
        <g className="chat-mascot-prop chat-mascot-prop-sleep">
          <path d="M22 8h3l-3 3h3" />
        </g>
      </svg>
    </span>
  );
}
