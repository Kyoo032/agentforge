import type { CSSProperties, ReactNode } from "react";
import { MascotSlot } from "@/components/mascot-slot";
import type { ModeIconName } from "@/components/mode-icons";
import { isMascotMode } from "@/lib/mascot-states";

const MODE = "var(--mode)";
const A2 = "var(--accent-2)";
const A3 = "var(--accent-3)";
const A4 = "var(--accent-4)";
const SURFACE = "var(--surface)";
const LINE = "var(--line)";
const MUTED = "var(--text-3)";

function Pop({ i, children }: { i: number; children: ReactNode }) {
  return (
    <g className="enter-pop" style={{ "--i": i, transformBox: "fill-box", transformOrigin: "center" } as CSSProperties}>
      {children}
    </g>
  );
}

function Spark({ x, y, fill, s = 1 }: { x: number; y: number; fill: string; s?: number }) {
  return (
    <path
      fill={fill}
      transform={`translate(${x} ${y}) scale(${s})`}
      d="M0-7 1.7-1.7 7 0 1.7 1.7 0 7-1.7 1.7-7 0-1.7-1.7Z"
    />
  );
}

function Sheet({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <>
      <rect x={x} y={y} width={w} height={h} rx="6" fill={SURFACE} stroke={LINE} strokeWidth="2" />
      <path d={`M${x + w - 16} ${y} L${x + w} ${y + 16} H${x + w - 16} Z`} fill={A2} />
    </>
  );
}

function Lines({ x, y, widths }: { x: number; y: number; widths: number[] }) {
  const rows: ReactNode[] = [];
  let top = y;
  for (const width of widths) {
    rows.push(<rect key={`${x}-${top}`} x={x} y={top} width={width} height="3" rx="1.5" fill={MUTED} />);
    top += 10;
  }
  return rows;
}

const SCENES: Record<ModeIconName, ReactNode> = {
  documents: (
    <>
      <Sheet x={18} y={14} w={78} h={82} />
      <rect x="30" y="32" width="36" height="7" rx="2" fill={MODE} />
      <Lines x={30} y={48} widths={[52, 44, 48, 28]} />
      <Pop i={1}>
        <g transform="rotate(32 118 58)">
          <rect x="112" y="28" width="9" height="48" rx="3" fill={MODE} />
          <rect x="112" y="28" width="9" height="12" rx="3" fill={A3} />
          <path d="M112 76 L116.5 88 L121 76 Z" fill={A4} />
        </g>
      </Pop>
      <Pop i={2}>
        <Spark x={132} y={22} fill={A4} s={0.8} />
      </Pop>
    </>
  ),
  research: (
    <>
      <Sheet x={14} y={18} w={70} h={76} />
      <Lines x={26} y={40} widths={[44, 36, 40]} />
      <Pop i={1}>
        <circle cx="104" cy="62" r="24" fill={SURFACE} stroke={MODE} strokeWidth="4" />
        <circle cx="104" cy="62" r="14" fill="none" stroke={A2} strokeWidth="2" />
        <rect x="120" y="78" width="8" height="22" rx="3" fill={MODE} transform="rotate(40 124 80)" />
      </Pop>
      <Pop i={2}>
        <Spark x={138} y={24} fill={A4} />
      </Pop>
      <Pop i={0}>
        <Spark x={28} y={22} fill={A3} s={0.7} />
      </Pop>
    </>
  ),
  finance: (
    <>
      <path d="M16 90 H92" stroke={LINE} strokeWidth="2" strokeLinecap="round" />
      <rect x="22" y="62" width="16" height="28" rx="3" fill={A2} />
      <Pop i={1}>
        <rect x="44" y="44" width="16" height="46" rx="3" fill={A3} />
      </Pop>
      <Pop i={2}>
        <rect x="66" y="24" width="16" height="66" rx="3" fill={MODE} />
      </Pop>
      <Pop i={0}>
        <g>
          <circle cx="122" cy="74" r="16" fill={A4} stroke={SURFACE} strokeWidth="3" />
          <circle cx="122" cy="58" r="16" fill={A2} stroke={SURFACE} strokeWidth="3" />
          <circle cx="122" cy="42" r="16" fill={MODE} stroke={SURFACE} strokeWidth="3" />
          <circle cx="122" cy="42" r="5" fill="none" stroke={SURFACE} strokeWidth="2" />
        </g>
      </Pop>
    </>
  ),
  data: (
    <>
      {[0, 1, 2, 3].map((row) =>
        [0, 2].map((col) => (
          <rect
            key={`${col}-${row}`}
            x={28 + col * 36}
            y={16 + row * 22}
            width="32"
            height="18"
            rx="3"
            fill={row === 0 ? A3 : SURFACE}
            stroke={LINE}
            strokeWidth="2"
          />
        )),
      )}
      <Pop i={1}>
        {[0, 1, 2, 3].map((row) => (
          <rect key={row} x={64} y={16 + row * 22} width="32" height="18" rx="3" fill={MODE} />
        ))}
      </Pop>
      <Pop i={2}>
        <Spark x={142} y={24} fill={A4} s={0.8} />
      </Pop>
    </>
  ),
  market: (
    <>
      <path d="M14 92 H146" stroke={LINE} strokeWidth="2" strokeLinecap="round" />
      <g>
        <path d="M36 28 V78" stroke={MUTED} strokeWidth="2" />
        <rect x="28" y="40" width="16" height="22" rx="2" fill={A4} />
      </g>
      <Pop i={1}>
        <path d="M72 18 V84" stroke={MUTED} strokeWidth="2" />
        <rect x="64" y="30" width="16" height="34" rx="2" fill={MODE} />
      </Pop>
      <Pop i={2}>
        <path d="M108 22 V80" stroke={MUTED} strokeWidth="2" />
        <rect x="100" y="36" width="16" height="26" rx="2" fill={A2} />
      </Pop>
      <Pop i={0}>
        <g>
          <path d="M116 80 L142 50" stroke={A3} strokeWidth="4" strokeLinecap="round" />
          <path d="M154 40 L134 46 L148 62 Z" fill={A3} />
        </g>
      </Pop>
    </>
  ),
  legal: (
    <>
      <path d="M78 86 L70 98 H86 Z" fill={MODE} />
      <rect x="62" y="96" width="32" height="6" rx="2" fill={MUTED} />
      <path d="M28 36 H128" stroke={MODE} strokeWidth="4" strokeLinecap="round" />
      <path d="M36 36 V52" stroke={MUTED} strokeWidth="2" />
      <path d="M120 36 V52" stroke={MUTED} strokeWidth="2" />
      <Pop i={1}>
        <path d="M22 52 H50 L44 70 H28 Z" fill={A2} stroke={MODE} strokeWidth="2" />
      </Pop>
      <Pop i={2}>
        <path d="M106 52 H134 L128 70 H112 Z" fill={A4} stroke={MODE} strokeWidth="2" />
      </Pop>
      <Pop i={0}>
        <g>
          <Sheet x={96} y={8} w={36} h={28} />
          <Lines x={102} y={16} widths={[22, 16]} />
        </g>
      </Pop>
    </>
  ),
  meeting: (
    <>
      <Pop i={1}>
        <g>
          <rect x="12" y="16" width="72" height="40" rx="14" fill={A3} />
          <path d="M28 56 L22 70 L42 56 Z" fill={A3} />
        </g>
      </Pop>
      <Pop i={2}>
        <g>
          <rect x="70" y="40" width="64" height="32" rx="14" fill={MODE} />
          <path d="M118 72 L128 84 L108 72 Z" fill={MODE} />
        </g>
      </Pop>
      <Pop i={0}>
        <g>
          <rect x="46" y="78" width="16" height="22" rx="8" fill={A4} />
          <path d="M42 90 v4 a12 12 0 0 0 24 0 v-4" fill="none" stroke={MODE} strokeWidth="3" />
          <path d="M54 102 V108" stroke={MODE} strokeWidth="3" strokeLinecap="round" />
        </g>
      </Pop>
    </>
  ),
  videos: (
    <>
      <rect x="18" y="36" width="88" height="58" rx="6" fill={SURFACE} stroke={LINE} strokeWidth="2" />
      <Pop i={1}>
        <g>
          <rect x="18" y="18" width="88" height="22" rx="4" fill={MODE} />
          <path d="M18 28 H34 L40 18 H52 L58 28 H70 L76 18 H88 L94 28 H106" stroke={SURFACE} strokeWidth="4" />
        </g>
      </Pop>
      <Pop i={2}>
        <g>
          <circle cx="122" cy="68" r="24" fill={A4} />
          <path d="M114 56 L136 68 L114 80 Z" fill={SURFACE} />
        </g>
      </Pop>
    </>
  ),
  music: (
    <>
      <path
        d="M8 72 C28 72 28 48 48 48 S68 78 88 78 S108 40 128 40 S148 64 156 64"
        fill="none"
        stroke={A2}
        strokeWidth="4"
        strokeLinecap="round"
      />
      <Pop i={1}>
        <g>
          <ellipse cx="58" cy="70" rx="12" ry="9" fill={MODE} transform="rotate(-20 58 70)" />
          <rect x="68" y="28" width="4" height="44" rx="1" fill={MODE} />
          <rect x="68" y="28" width="16" height="5" rx="1" fill={MODE} />
        </g>
      </Pop>
      <Pop i={2}>
        <g>
          <ellipse cx="112" cy="52" rx="12" ry="9" fill={A4} transform="rotate(-18 112 52)" />
          <rect x="122" y="14" width="4" height="40" rx="1" fill={A4} />
          <rect x="122" y="14" width="16" height="5" rx="1" fill={A4} />
        </g>
      </Pop>
      <Pop i={0}>
        <Spark x={24} y={36} fill={A3} s={0.75} />
      </Pop>
    </>
  ),
  edit: (
    <>
      <rect x="14" y="28" width="96" height="14" rx="4" fill={A2} />
      <rect x="14" y="48" width="72" height="14" rx="4" fill={MODE} />
      <Pop i={1}>
        <rect x="14" y="68" width="110" height="14" rx="4" fill={A3} />
      </Pop>
      <path d="M92 22 V92" stroke={A4} strokeWidth="3" strokeLinecap="round" />
      <Pop i={2}>
        <g transform="translate(118 36)">
          <circle cx="0" cy="0" r="8" fill={SURFACE} stroke={MODE} strokeWidth="3" />
          <circle cx="18" cy="18" r="8" fill={SURFACE} stroke={MODE} strokeWidth="3" />
          <path d="M6 4 L16 14 M4 6 L14 16" stroke={A4} strokeWidth="3" strokeLinecap="round" />
        </g>
      </Pop>
    </>
  ),
  presentations: (
    <>
      <path d="M80 96 L28 108 H132 Z" fill={MUTED} />
      <path d="M80 28 V96" stroke={LINE} strokeWidth="4" />
      <rect x="28" y="16" width="104" height="62" rx="6" fill={SURFACE} stroke={MODE} strokeWidth="3" />
      <Pop i={1}>
        <g>
          <circle cx="78" cy="48" r="18" fill={A3} />
          <path d="M78 48 L78 30 A18 18 0 0 1 94 56 Z" fill={MODE} />
        </g>
      </Pop>
      <Pop i={2}>
        <rect x="40" y="28" width="18" height="8" rx="2" fill={A2} />
      </Pop>
    </>
  ),
  images: (
    <>
      <rect x="16" y="14" width="128" height="84" rx="8" fill={SURFACE} stroke={LINE} strokeWidth="3" />
      <rect x="24" y="22" width="112" height="68" rx="4" fill={A2} />
      <Pop i={1}>
        <circle cx="112" cy="40" r="12" fill={A4} />
      </Pop>
      <ellipse cx="70" cy="78" rx="36" ry="16" fill={MODE} />
      <Pop i={2}>
        <ellipse cx="108" cy="74" rx="28" ry="14" fill={A3} />
      </Pop>
    </>
  ),
  knowledge: (
    <>
      <path d="M40 70 L80 36 L120 58 L96 86 L40 70" fill="none" stroke={LINE} strokeWidth="2" />
      <path d="M80 36 L96 86" fill="none" stroke={LINE} strokeWidth="2" />
      <Pop i={1}>
        <circle cx="40" cy="70" r="12" fill={A2} />
      </Pop>
      <Pop i={2}>
        <circle cx="80" cy="36" r="14" fill={MODE} />
      </Pop>
      <circle cx="120" cy="58" r="11" fill={A4} />
      <Pop i={0}>
        <circle cx="96" cy="86" r="10" fill={A3} />
      </Pop>
    </>
  ),
  chat: (
    <>
      <Pop i={1}>
        <g>
          <rect x="16" y="18" width="84" height="48" rx="16" fill={MODE} />
          <path d="M36 66 L28 84 L54 66 Z" fill={MODE} />
          <circle cx="42" cy="42" r="4" fill={SURFACE} />
          <circle cx="58" cy="42" r="4" fill={SURFACE} />
          <circle cx="74" cy="42" r="4" fill={SURFACE} />
        </g>
      </Pop>
      <Pop i={2}>
        <rect x="78" y="58" width="64" height="32" rx="14" fill={A3} />
      </Pop>
    </>
  ),
  channels: (
    <>
      <Pop i={1}>
        <path d="M28 78 L132 28 L92 86 L78 62 Z" fill={MODE} />
      </Pop>
      <Pop i={2}>
        <path d="M78 62 L132 28 L96 52 Z" fill={A4} />
      </Pop>
      <Pop i={0}>
        <g>
          <circle cx="24" cy="40" r="4" fill={A2} />
          <circle cx="40" cy="28" r="3" fill={A3} />
        </g>
      </Pop>
    </>
  ),
  workspaces: (
    <>
      <rect x="24" y="18" width="48" height="32" rx="6" fill={A2} />
      <Pop i={1}>
        <rect x="84" y="18" width="48" height="32" rx="6" fill={MODE} />
      </Pop>
      <rect x="24" y="60" width="48" height="32" rx="6" fill={A3} />
      <Pop i={2}>
        <rect x="84" y="60" width="48" height="32" rx="6" fill={A4} />
      </Pop>
    </>
  ),
  usage: (
    <>
      <path d="M28 78 A52 52 0 0 1 132 78" fill="none" stroke={LINE} strokeWidth="10" strokeLinecap="round" />
      <Pop i={1}>
        <path d="M36 74 A44 44 0 0 1 108 46" fill="none" stroke={MODE} strokeWidth="10" strokeLinecap="round" />
      </Pop>
      <Pop i={2}>
        <path d="M80 78 L112 48" stroke={A4} strokeWidth="4" strokeLinecap="round" />
      </Pop>
      <circle cx="80" cy="78" r="6" fill={A3} />
    </>
  ),
  settings: (
    <>
      <rect x="28" y="24" width="104" height="8" rx="4" fill={LINE} />
      <rect x="28" y="50" width="104" height="8" rx="4" fill={LINE} />
      <rect x="28" y="76" width="104" height="8" rx="4" fill={LINE} />
      <Pop i={1}>
        <circle cx="58" cy="28" r="10" fill={MODE} />
      </Pop>
      <Pop i={2}>
        <circle cx="108" cy="54" r="10" fill={A4} />
      </Pop>
      <Pop i={0}>
        <circle cx="78" cy="80" r="10" fill={A2} />
      </Pop>
    </>
  ),
};

/** A small flat scene for an empty studio. Colours come from the mode and the desk tokens. */
export function ModeIllustration({ mode }: { mode: ModeIconName }) {
  return (
    <div className="mx-auto flex w-40 flex-col items-center gap-2" data-mode={mode}>
      {isMascotMode(mode) ? <MascotSlot mode={mode} placement="empty" /> : null}
      <svg
        width="160"
        height="110"
        viewBox="0 0 160 110"
        className="illustration-float block"
        fill="none"
        aria-hidden="true"
      >
        {SCENES[mode]}
      </svg>
    </div>
  );
}
