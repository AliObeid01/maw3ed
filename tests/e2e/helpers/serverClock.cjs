// Preloaded into the e2e dev server (NODE_OPTIONS=--require): shifts the server's Date by a constant offset so
// the server-rendered "today" matches the frozen browser clock (see clock.ts). Otherwise Next logs a hydration
// mismatch for time-derived text (greeting, date) and React rebuilds the tree under the test's feet.
const offset = Number(process.env.E2E_CLOCK_OFFSET_MS || 0);
if (offset) {
  const RealDate = Date;
  globalThis.Date = new Proxy(RealDate, {
    construct(target, args, newTarget) {
      return Reflect.construct(target, args.length ? args : [RealDate.now() + offset], newTarget);
    },
    apply() {
      return new globalThis.Date().toString();
    },
    get(target, prop, receiver) {
      if (prop === 'now') return () => RealDate.now() + offset;
      return Reflect.get(target, prop, receiver);
    },
  });
}
