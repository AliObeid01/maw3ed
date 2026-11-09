/**
 * A check mark that draws itself once (stroke-dashoffset in globals.css `.motion-check`, no inline style). Decorative.
 * With reduced motion the rule does not apply and the mark is simply there. Same size and weight as the lucide Check.
 */
export function DrawnCheck({ size = 26 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="motion-check"
    >
      <path d="M5 12.5 9.5 17 19 7.5" pathLength={24} />
    </svg>
  );
}
