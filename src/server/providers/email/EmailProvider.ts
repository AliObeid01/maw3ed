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
export class EmailSendError extends Error {
  readonly code: string;
  readonly permanent: boolean;

  constructor(code: string, permanent: boolean) {
    super(`Email send failed (${code})`);
    this.name = 'EmailSendError';
    this.code = code;
    this.permanent = permanent;
  }
}
