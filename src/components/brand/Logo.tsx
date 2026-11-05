// Maw3ed logo, option B (design/logo is the source of truth): a calendar icon with the M inside, and the "3" in
// the name drawn as two stacked arcs (navy over turquoise). Flat paths only: no text, gradients or filters, so it
// renders identically everywhere and never depends on a font. The paths below are copied from
// design/logo/1-platform/maw3ed-logo-{light,reverse}.svg and maw3ed-wordmark-only-{light,reverse}.svg.

type Variant = 'full' | 'wordmark';
type Tone = 'brand' | 'white';

/** Below this rendered width the calendar icon is too small to read, so the plain wordmark is used instead. */
export const MIN_FULL_LOGO_WIDTH = 96;

const VIEWBOX = {
  full: { x: -8, y: 13, w: 363.55, h: 98 },
  wordmark: { x: -8, y: 20, w: 345.55, h: 88 },
} as const;

// Flat fills only (palette v2: Deep Navy, Turquoise, Electric Blue, Cyan Blue, Royal Blue, White).
const palettes = {
  // Light version, for white and light surfaces.
  brand: {
    body: '#0B1938',
    band: '#2864F5',
    pegs: '#21CDB3',
    glyph: '#FFFFFF',
    mark: '#21CDB3',
    text: '#0B1938',
    arcTop: '#0B1938',
    arcBottom: '#21CDB3',
  },
  // Reverse version, for the navy hero band and header.
  white: {
    body: '#254EDB',
    band: '#43C4F0',
    pegs: '#FFFFFF',
    glyph: '#FFFFFF',
    mark: '#21CDB3',
    text: '#FFFFFF',
    arcTop: '#FFFFFF',
    arcBottom: '#21CDB3',
  },
} as const satisfies Record<Tone, Record<string, string>>;

type LogoProps = {
  /** Accessible name. Omit when the logo sits next to the product name or is decorative: it is then `aria-hidden`. */
  label?: string;
  className?: string;
  /** Rendered width in px; the height follows the artwork's aspect ratio. */
  width?: number;
  /** `brand` = the light version on white surfaces; `white` = the reverse version on the navy hero / header. */
  tone?: Tone;
  /**
   * `full` = calendar icon + name (falls back to the wordmark when `width` is under {@link MIN_FULL_LOGO_WIDTH}
   * px); `wordmark` = the plain written name only.
   */
  variant?: Variant;
};

const STROKE = {
  fill: 'none',
  strokeWidth: 9,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** "aw3ed" letters plus the two arcs of the 3, shared by both variants (same coordinates in both files). */
function Letters({ p, withM }: { p: (typeof palettes)[Tone]; withM: boolean }) {
  return (
    <>
      <g {...STROKE} stroke={p.text}>
        {withM ? <path d="M4.5 95.5V32.5L34.5 78 64.5 32.5V95.5" /> : null}
        <circle cx="98" cy="80" r="15.5" />
        <path d="M113.5 64.5V95.5" />
        <path d="M129.5 64.5L142.5 95.5 155.5 64.5 168.5 95.5 181.5 64.5" />
        <path d="M245.05 80H276.05A15.5 15.5 0 1 0 271.51 90.96" />
        <circle cx="309.55" cy="80" r="15.5" />
        <path d="M325.05 32.5V95.5" />
      </g>
      <path {...STROKE} stroke={p.arcTop} d="M201.5 32.5H213.5A11.2 11.2 0 0 1 213.5 54.91H201.5" />
      <path
        {...STROKE}
        stroke={p.arcBottom}
        d="M201.5 70.41H213.5A12.55 12.55 0 0 1 213.5 95.5H201.5"
      />
    </>
  );
}

export function Logo({ label, className, width = 130, tone = 'brand', variant = 'full' }: LogoProps) {
  const p = palettes[tone];
  const shown: Variant = variant === 'full' && width >= MIN_FULL_LOGO_WIDTH ? 'full' : 'wordmark';
  const vb = VIEWBOX[shown];
  return (
    <svg
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      width={width}
      height={Math.round((width * vb.h) / vb.w)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-logo={shown}
      data-tone={tone}
      className={className}
      // The artwork is positioned in absolute SVG coordinates; under dir=rtl a flipped inline direction could
      // reorder it, so it is always laid out left to right.
      style={{ direction: 'ltr' }}
    >
      {shown === 'full' ? (
        <>
          <g transform="translate(18 0)">
            <Letters p={p} withM={false} />
          </g>
          <g transform="translate(0 21) scale(1.25)">
            <rect y="6" width="64" height="58" rx="14" fill={p.body} />
            <path d="M0 19V20A14 14 0 0 1 14 6H50A14 14 0 0 1 64 20V19Z" fill={p.band} />
            <rect x="17.5" y="0" width="5" height="13" rx="2.5" fill={p.pegs} />
            <rect x="41.5" y="0" width="5" height="13" rx="2.5" fill={p.pegs} />
            <g transform="translate(13.79 7.72) scale(0.53)">
              <path {...STROKE} strokeWidth={13} stroke={p.glyph} d="M6.5 93.5V34.5M62.5 34.5V93.5" />
              <path {...STROKE} strokeWidth={13} stroke={p.mark} d="M6.5 34.5L34.5 76.98 62.5 34.5" />
            </g>
          </g>
        </>
      ) : (
        <Letters p={p} withM />
      )}
    </svg>
  );
}
