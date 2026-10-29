/** A client with at least this many recorded no-shows is flagged as a repeat no-show (FR-23). */
export const REPEAT_NO_SHOW_THRESHOLD = 2;

export const isRepeatNoShow = (noShows: number): boolean => noShows >= REPEAT_NO_SHOW_THRESHOLD;

/** Anonymised clients keep their row (appointments reference it) but lose every personal field. */
export const DELETED_CLIENT_NAME = 'Deleted client';
/** `phone` of an anonymised client is `deleted:<id>`: not E.164, so it can never collide with a real number. */
export const TOMBSTONE_PHONE_PREFIX = 'deleted:';
export const tombstonePhone = (clientId: string): string => `${TOMBSTONE_PHONE_PREFIX}${clientId}`;
