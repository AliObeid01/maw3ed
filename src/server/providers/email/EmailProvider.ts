export interface EmailAttachment {
  filename: string;
  /** Plain text content (for example an .ics file); providers encode it as needed. */
  content: string;
  contentType: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Provider-side de-duplication key (for reminders: the ReminderJob id). */
  idempotencyKey: string;
  attachments?: EmailAttachment[] | undefined;
}

export interface EmailResult {
  providerMessageId: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<EmailResult>;
}

/**
 * A send failure with a SHORT machine code (never provider text, recipients or keys). `permanent` means a
 * retry cannot help (bad request, auth, forbidden sender); transient failures are retried with backoff.
 */
/** Resend answers 409 with this name when a key is reused for a different request. */
export const IDEMPOTENT_MISMATCH = 'invalid_idempotent_request';

export interface EmailSendErrorOptions {
  /** The provider throttled us (429 / quota): park the job, do not burn an attempt. */
  rateLimited?: boolean;
  retryAfterMs?: number | undefined;
}

/**
 * A send failure with a SHORT machine code (never provider text, recipients or keys). `permanent` means a
 * retry cannot help (bad request, auth, forbidden sender); transient failures are retried with backoff.
 * Code `invalid_idempotent_request` means the provider already accepted this key earlier.
 */
export class EmailSendError extends Error {
  readonly code: string;
  readonly permanent: boolean;
  readonly rateLimited: boolean;
  readonly retryAfterMs: number | undefined;

  constructor(code: string, permanent: boolean, options: EmailSendErrorOptions = {}) {
    super(`Email send failed (${code})`);
    this.name = 'EmailSendError';
    this.code = code;
    this.permanent = permanent;
    this.rateLimited = options.rateLimited ?? false;
    this.retryAfterMs = options.retryAfterMs;
  }
}
