/** A client with at least this many recorded no-shows is flagged as a repeat no-show (FR-23). */
export const REPEAT_NO_SHOW_THRESHOLD = 2;

export const isRepeatNoShow = (noShows: number): boolean => noShows >= REPEAT_NO_SHOW_THRESHOLD;
