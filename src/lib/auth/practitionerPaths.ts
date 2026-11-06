/** The only dashboard pages a PRACTITIONER may open until PR-5 adds the scoped schedule screens. */
const ALLOWED = ['/app/welcome', '/app/account'] as const;

export function practitionerMayView(pathname: string): boolean {
  const path = pathname.split('?')[0]!.replace(/\/+$/, '');
  return ALLOWED.some((p) => path === p || path.startsWith(`${p}/`));
}
