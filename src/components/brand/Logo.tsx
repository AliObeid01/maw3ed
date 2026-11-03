// Brand wordmark glyphs (the "M" is drawn as a shape), not translatable copy.
const WORDMARK_TAIL = 'aw3ed';
const VIEWBOX_W = 1360;
const VIEWBOX_H = 336;

// Flat fills only (palette v2, no gradients). Gold is used for the thin wordmark underline and nowhere else.
const palettes = {
  brand: {
    stroke: '#0B1938',
    text: '#0B1938',
    lines: '#43C4F0',
    mark: '#254EDB',
    peg: '#254EDB',
    halo: '#FFFFFF',
  },
  // For the navy hero band.
  white: {
    stroke: '#FFFFFF',
    text: '#FFFFFF',
    lines: '#43C4F0',
    mark: '#43C4F0',
    peg: '#43C4F0',
    halo: '#0B1938',
  },
} as const;
const GOLD = '#E8B86D';

type LogoProps = {
  /** Accessible name. Omit when the logo sits next to the product name or is decorative: it is then `aria-hidden`. */
  label?: string;
  className?: string;
  /** Rendered width in px; the height follows the artwork's aspect ratio. */
  width?: number;
  tone?: 'brand' | 'white';
};

export function Logo({ label, className, width = 130, tone = 'brand' }: LogoProps) {
  const p = palettes[tone];
  return (
    <svg
      viewBox={`455 216 ${VIEWBOX_W} ${VIEWBOX_H}`}
      width={width}
      height={Math.round((width * VIEWBOX_H) / VIEWBOX_W)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={className}
      // The wordmark is Latin text positioned in absolute SVG coordinates; under dir=rtl its text-anchor flips and it overlaps the icon.
      style={{ direction: 'ltr' }}
    >
      <path
        d="M578 335H630M481 386H623M542 438H616M579 488H609"
        fill="none"
        stroke={p.lines}
        strokeWidth="28"
        strokeLinecap="round"
      />
      <g transform="translate(55.6 0) skewX(-8)">
        <rect
          x="665"
          y="277"
          width="285"
          height="238"
          rx="48"
          fill="none"
          stroke={p.stroke}
          strokeWidth="30"
        />
        <path
          d="M746.5 439V353L807.5 408L868.5 353V439"
          fill="none"
          stroke={p.mark}
          strokeWidth="38"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <rect
          x="727"
          y="230"
          width="20"
          height="62"
          rx="10"
          fill={p.peg}
          stroke={p.halo}
          strokeWidth="12"
          paintOrder="stroke"
        />
        <rect
          x="862"
          y="230"
          width="20"
          height="62"
          rx="10"
          fill={p.peg}
          stroke={p.halo}
          strokeWidth="12"
          paintOrder="stroke"
        />
      </g>
      <rect x="718" y="542" width="974" height="7" rx="3.5" fill={GOLD} />
      <text
        x="988"
        y="527"
        // next/font exposes Outfit as --font-outfit on <html>; the fallbacks keep the SVG legible if it is used standalone.
        style={{ fontFamily: 'var(--font-outfit), Outfit, sans-serif' }}
        fontWeight="600"
        fontSize="260"
        letterSpacing="-2.6"
        fill={p.text}
      >
        {WORDMARK_TAIL}
      </text>
    </svg>
  );
}
