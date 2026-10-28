import { useId } from 'react';

// Brand wordmark glyphs (the "M" is drawn as a shape), not translatable copy.
const WORDMARK_TAIL = 'aw3ed';
const VIEWBOX_W = 1360;
const VIEWBOX_H = 318;

const palettes = {
  brand: {
    stroke: '#174C4F',
    text: '#174C4F',
    g1: ['#E8B86D', '#174C4F'],
    g2: ['#123F42', '#E8B86D'],
    halo: '#FFFFFF',
  },
  // For the teal hero band.
  white: {
    stroke: '#FFFFFF',
    text: '#FFFFFF',
    g1: ['#E8B86D', '#FFFFFF'],
    g2: ['#E4EEEC', '#E8B86D'],
    halo: '#174C4F',
  },
} as const;

type LogoProps = {
  /** Accessible name. Omit when the logo sits next to the product name or is decorative: it is then `aria-hidden`. */
  label?: string;
  className?: string;
  /** Rendered width in px; the height follows the artwork's aspect ratio. */
  width?: number;
  tone?: 'brand' | 'white';
};

export function Logo({ label, className, width = 130, tone = 'brand' }: LogoProps) {
  const id = useId().replace(/:/g, '');
  const g1 = `${id}-g1`;
  const g2 = `${id}-g2`;
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
      <defs>
        <linearGradient id={g1} gradientUnits="userSpaceOnUse" x1="467" y1="0" x2="637" y2="0">
          <stop offset="0" stopColor={p.g1[0]} />
          <stop offset="1" stopColor={p.g1[1]} />
        </linearGradient>
        <linearGradient id={g2} gradientUnits="userSpaceOnUse" x1="719" y1="470" x2="880" y2="350">
          <stop offset="0" stopColor={p.g2[0]} />
          <stop offset="1" stopColor={p.g2[1]} />
        </linearGradient>
      </defs>
      <path
        d="M578 335H630M481 386H623M542 438H616M579 488H609"
        fill="none"
        stroke={`url(#${g1})`}
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
          stroke={`url(#${g2})`}
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
          fill="#E8B86D"
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
          fill="#E8B86D"
          stroke={p.halo}
          strokeWidth="12"
          paintOrder="stroke"
        />
      </g>
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
