/**
 * Directory filters come from the URL, which anyone can edit or share. The API refuses what does not fit its
 * schema (search up to 80, category up to 40 characters, no NUL), and a 400 would show the generic error page,
 * so the page cleans the values first, the same way an unknown `area` is dropped.
 */
export const DIRECTORY_SEARCH_MAX = 80;
export const DIRECTORY_CATEGORY_MAX = 40;

// C0 controls (NUL included), DEL and the C1 range: nothing a person types in a filter.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

const clean = (value: string | null | undefined): string => (value ?? '').replace(CONTROL, '').trim();

/** Free-text search from the URL: control characters removed, then cut to the API limit (never in the middle of a pair). */
export function cleanSearchParam(value: string | null | undefined): string {
  const text = clean(value);
  if (text.length <= DIRECTORY_SEARCH_MAX) return text;
  let cut = text.slice(0, DIRECTORY_SEARCH_MAX);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut.trim();
}

/**
 * Category from the URL: a key or a legacy free text. A value that does not fit the limit cannot match any
 * listing, so it is dropped (no filter) instead of sent to the API.
 */
export function cleanCategoryParam(value: string | null | undefined): string {
  const text = clean(value);
  return text.length > DIRECTORY_CATEGORY_MAX ? '' : text;
}
