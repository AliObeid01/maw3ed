import { useId } from 'react';

// Brand wordmark glyphs (the "M" is drawn as a shape), not translatable copy.
const WORDMARK_TAIL = 'aw3ed';

type LogoProps = {
  label: string;
  className?: string;
  width?: number;
  height?: number;
};

export function Logo({ label, className, width = 130, height = 30 }: LogoProps) {
  const id = useId();
  const g1 = `${id}-g1`;
  const g2 = `${id}-g2`;
  return (
    <svg
      viewBox="455 216 1360 318"
      width={width}
      height={height}
      role="img"
      aria-label={label}
      className={className}
      // The wordmark is Latin text positioned in absolute SVG coordinates; under dir=rtl its text-anchor flips and it overlaps the icon.
      style={{ direction: 'ltr' }}
    >
      <defs>
        <linearGradient id={g1} gradientUnits="userSpaceOnUse" x1="467" y1="0" x2="637" y2="0">
          <stop offset="0" stopColor="#E8B86D" />
          <stop offset="1" stopColor="#174C4F" />
        </linearGradient>
        <linearGradient id={g2} gradientUnits="userSpaceOnUse" x1="719" y1="470" x2="880" y2="350">
          <stop offset="0" stopColor="#123F42" />
          <stop offset="1" stopColor="#E8B86D" />
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
          stroke="#174C4F"
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
          stroke="#FFFFFF"
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
          stroke="#FFFFFF"
          strokeWidth="12"
          paintOrder="stroke"
        />
      </g>
      <text
        x="988"
        y="527"
        fontFamily="Outfit, sans-serif"
        fontWeight="600"
        fontSize="260"
        letterSpacing="-2.6"
        fill="#174C4F"
      >
        {WORDMARK_TAIL}
      </text>
    </svg>
  );
}
