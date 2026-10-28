export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Provider-side de-duplication key (for reminders: the ReminderJob id). */
  idempotencyKey: string;
}

export interface EmailResult {
  providerMessageId: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<EmailResult>;
}
