// Maw3ed logo (PR-16b; design/logo is the source of truth): a calendar icon with the M inside, then the name where
// the "3" is drawn as two stacked turquoise arcs. Flat paths only: no text, gradients, filters or fonts, so it
// renders identically everywhere and is CSP-safe. The paths below are copied from design/logo/maw3ed-logo-light.svg
// (regenerate the files with scripts/design/build-logo-assets.mjs; tests/unit/ui/logo.test.ts compares them).

type Variant = 'full' | 'wordmark' | 'icon';
type Tone = 'brand' | 'white';

/** Below this rendered width the calendar icon is too small to read, so the plain wordmark is used instead. */
export const MIN_FULL_LOGO_WIDTH = 96;

const VIEWBOX = {
  full: { x: -8, y: 13, w: 453.53, h: 130.04 },
  wordmark: { x: 92, y: 24, w: 340, h: 115 },
  icon: { x: 0, y: 0, w: 64, h: 64 },
} as const;

// Flat fills only (palette v2). `white` is the reverse version for navy surfaces: the wordmark is white, and the
// icon's navy body (which would vanish on navy) is a slightly lighter navy with a faint light outline.
const palettes = {
  brand: { text: '#0B1938', body: '#0B1938', outline: 'none' },
  white: { text: '#FFFFFF', body: '#16295E', outline: '#FFFFFF' },
} as const satisfies Record<Tone, Record<string, string>>;

type LogoProps = {
  /** Accessible name. Omit when the logo sits next to the product name or is decorative: it is then `aria-hidden`. */
  label?: string;
  className?: string;
  /** Rendered width in px; the height follows the artwork's aspect ratio. */
  width?: number;
  /** `brand` = the light version on white surfaces; `white` = the reverse version on navy surfaces. */
  tone?: Tone;
  /**
   * `full` = calendar icon + name (falls back to the wordmark when `width` is under {@link MIN_FULL_LOGO_WIDTH}
   * px); `wordmark` = the plain written name only; `icon` = the calendar icon alone (tight spaces).
   */
  variant?: Variant;
};

const STROKE = { fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

/** The 64 x 64 calendar-M icon (pegs at y 0, body from y 6). */
function Icon({ tone }: { tone: Tone }) {
  const p = palettes[tone];
  return (
    <>
      <rect
        y="6"
        width="64"
        height="58"
        rx="14"
        fill={p.body}
        {...(tone === 'white' ? { stroke: p.outline, strokeOpacity: 0.22, strokeWidth: 1.2 } : {})}
      />
      <path d="M0 19V20A14 14 0 0 1 14 6H50A14 14 0 0 1 64 20V19Z" fill="#2864F5" />
      <rect x="17.5" y="0" width="5" height="13" rx="2.5" fill="#21CDB3" />
      <rect x="41.5" y="0" width="5" height="13" rx="2.5" fill="#21CDB3" />
      <g transform="translate(13.79 7.72) scale(0.53)">
        <path {...STROKE} strokeWidth={13} stroke="#FFFFFF" d="M6.5 93.5V34.5M62.5 34.5V93.5" />
        <path {...STROKE} strokeWidth={13} stroke="#21CDB3" d="M6.5 34.5L34.5 76.98 62.5 34.5" />
      </g>
    </>
  );
}

/** "aw ed" glyph paths plus the two turquoise arcs of the 3. */
function Wordmark({ tone }: { tone: Tone }) {
  const fill = palettes[tone].text;
  return (
    <>
      <g fill={fill}>
        <path
          transform="translate(94 100.0) scale(0.09730 -0.09730)"
          d="M274 566Q333 566 377.5 542.0Q422 518 446 479V558H617V0H446V79Q421 40 376.5 16.0Q332 -8 273 -8Q205 -8 149.0 27.5Q93 63 60.5 128.5Q28 194 28 280Q28 366 60.5 431.0Q93 496 149.0 531.0Q205 566 274 566ZM324 417Q273 417 237.5 380.5Q202 344 202 280Q202 216 237.5 178.5Q273 141 324 141Q375 141 410.5 178.0Q446 215 446 279Q446 343 410.5 380.0Q375 417 324 417Z"
        />
        <path
          transform="translate(160.06 100.0) scale(0.09730 -0.09730)"
          d="M863 558 712 0H523L435 362L344 0H156L4 558H175L254 159L348 558H529L624 161L702 558Z"
        />
        <path
          transform="translate(307.53 100.0) scale(0.09730 -0.09730)"
          d="M585 238H198Q202 186 231.5 158.5Q261 131 304 131Q368 131 393 185H575Q561 130 524.5 86.0Q488 42 433.0 17.0Q378 -8 310 -8Q228 -8 164.0 27.0Q100 62 64.0 127.0Q28 192 28 279Q28 366 63.5 431.0Q99 496 163.0 531.0Q227 566 310 566Q391 566 454.0 532.0Q517 498 552.5 435.0Q588 372 588 288Q588 264 585 238ZM413 333Q413 377 383.0 403.0Q353 429 308 429Q265 429 235.5 404.0Q206 379 199 333Z"
        />
        <path
          transform="translate(367.46 100.0) scale(0.09730 -0.09730)"
          d="M274 566Q329 566 374.5 543.0Q420 520 446 481V740H617V0H446V80Q422 40 377.5 16.0Q333 -8 274 -8Q205 -8 149.0 27.5Q93 63 60.5 128.5Q28 194 28 280Q28 366 60.5 431.0Q93 496 149.0 531.0Q205 566 274 566ZM324 417Q273 417 237.5 380.5Q202 344 202 280Q202 216 237.5 178.5Q273 141 324 141Q375 141 410.5 178.0Q446 215 446 279Q446 343 410.5 380.0Q375 417 324 417Z"
        />
      </g>
      <path fill="none" stroke="#21CDB3" strokeWidth="13.32" strokeLinecap="butt" d="M298.53 47.16A31.68 20.3 0 0 0 298.53 87.77" />
      <path fill="none" stroke="#21CDB3" strokeWidth="13.32" strokeLinecap="butt" d="M298.53 87.77A41.54 20.3 0 0 0 298.53 128.38" />
    </>
  );
}

export function Logo({ label, className, width = 130, tone = 'brand', variant = 'full' }: LogoProps) {
  const shown: Variant = variant === 'full' && width < MIN_FULL_LOGO_WIDTH ? 'wordmark' : variant;
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
      // The artwork is positioned in absolute SVG coordinates and is never mirrored under dir=rtl; a flipped
      // inline direction could reorder it, so it is always laid out left to right.
      style={{ direction: 'ltr' }}
    >
      {shown === 'icon' ? <Icon tone={tone} /> : null}
      {shown === 'full' ? (
        <>
          <g transform="translate(0 21) scale(1.25)">
            <Icon tone={tone} />
          </g>
          <Wordmark tone={tone} />
        </>
      ) : null}
      {shown === 'wordmark' ? <Wordmark tone={tone} /> : null}
    </svg>
  );
}
