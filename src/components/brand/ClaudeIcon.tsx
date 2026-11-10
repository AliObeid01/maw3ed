// The ONE icon for every "Claude" surface (owner card, business button, home strip, /assistant). This is a neutral
// placeholder: an original chat bubble holding a small four-point spark, drawn on lucide's 24 px stroke grid.
// Anthropic's logo may only be used with Anthropic's permission (trademark guidelines:
// https://www.anthropic.com/legal/trademark-guidelines). To swap in an approved icon, change only this file.

type ClaudeIconProps = {
  /** Rendered width and height in px. */
  size?: number;
  className?: string;
  /** Decorative by default; pass `false` only when the icon stands alone without a text label. */
  'aria-hidden'?: boolean;
};

export function ClaudeIcon({ size = 24, className, 'aria-hidden': ariaHidden = true }: ClaudeIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={ariaHidden}
      className={className}
    >
      {/* Chat bubble with a tail at the bottom-left. */}
      <path d="M20 12a8 7.5 0 0 1-8 7.5c-1.2 0-2.3-.2-3.3-.6L4 20l1.4-3.5A7.4 7.4 0 0 1 4 12a8 7.5 0 0 1 8-7.5 8 7.5 0 0 1 8 7.5Z" />
      {/* Four-point spark inside. */}
      <path d="M12 8.5c.3 2 .9 2.7 3 3-2.1.3-2.7 1-3 3-.3-2-.9-2.7-3-3 2.1-.3 2.7-1 3-3Z" />
    </svg>
  );
}
