/**
 * Soft teal and gold glows with a faint grid (boards 3.1 to 3.3). Purely decorative.
 * The blobs drift on `md+` only (blur plus animation is costly on phones) and never with reduced motion.
 * A page can render `<div data-auth-mirror />` to flip the whole backdrop, as board 3.3 does.
 */
export function AuthBackdrop() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden group-has-[[data-auth-mirror]]/auth:-scale-x-100"
    >
      <div className="absolute -start-[200px] -top-[260px] size-[420px] rounded-full bg-brand opacity-55 blur-[80px] md:size-[680px] md:blur-[100px] md:animate-drift-1 motion-reduce:animate-none" />
      <div className="absolute -end-[180px] top-[8%] size-[360px] rounded-full bg-accent opacity-55 blur-[80px] md:size-[580px] md:blur-[100px] md:animate-drift-2 motion-reduce:animate-none" />
      <div className="absolute start-[22%] -bottom-[300px] size-[380px] rounded-full bg-accent opacity-45 blur-[80px] md:size-[560px] md:blur-[110px] md:animate-drift-1 motion-reduce:animate-none" />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(rgba(37,45,45,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(37,45,45,0.06) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
          maskImage: 'radial-gradient(ellipse at center, #000 25%, transparent 72%)',
          WebkitMaskImage: 'radial-gradient(ellipse at center, #000 25%, transparent 72%)',
        }}
      />
    </div>
  );
}
