import {
  EmailSendError,
  IDEMPOTENT_MISMATCH,
  type EmailMessage,
  type EmailProvider,
  type EmailResult,
} from './EmailProvider';

const ENDPOINT = 'https://api.resend.com/emails';
const DEFAULT_TIMEOUT_MS = 8_000;

export interface ResendOptions {
  apiKey: string;
  from: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** 4xx is permanent, except the "try again" statuses (request timeout, concurrent idempotent request, rate limit). */
const RETRYABLE_4XX = new Set([408, 409, 425, 429]);

/**
 * Resend over plain HTTP (no SDK). The `Idempotency-Key` header makes a repeated send within 24 h return
 * the original result, which is the third layer of "a reminder never sends twice". Errors carry a short
 * code only: provider response text, the API key and recipients never reach a message, log or job row.
 */
export class ResendEmailProvider implements EmailProvider {
  private readonly apiKey: string;
  private readonly from: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: ResendOptions) {
    this.apiKey = options.apiKey;
    this.from = options.from;
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async send(message: EmailMessage): Promise<EmailResult> {
    const payload: Record<string, unknown> = {
      from: this.from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
    };
    if (message.attachments?.length) {
      payload.attachments = message.attachments.map((a) => ({
        filename: a.filename,
        content: Buffer.from(a.content, 'utf8').toString('base64'),
        content_type: a.contentType,
      }));
    }

    let res: Response;
    try {
      res = await this.fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': message.idempotencyKey,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new EmailSendError('resend_network', false);
    }

    if (!res.ok) {
      if (res.status === 429) {
        const secs = Number(res.headers.get('retry-after'));
        throw new EmailSendError('resend_http_429', false, {
          rateLimited: true,
          retryAfterMs:
            Number.isFinite(secs) && secs > 0 ? Math.min(secs, 86_400) * 1000 : undefined,
        });
      }
      if (res.status === 409) {
        let name: unknown;
        try {
          name = ((await res.json()) as { name?: unknown }).name;
        } catch {
          name = undefined;
        }
        // The key was already accepted with a different payload: the mail exists, do not retry.
        if (name === IDEMPOTENT_MISMATCH) throw new EmailSendError(IDEMPOTENT_MISMATCH, true);
      }
      const permanent = res.status >= 400 && res.status < 500 && !RETRYABLE_4XX.has(res.status);
      throw new EmailSendError(`resend_http_${res.status}`, permanent);
    }
    let id: unknown;
    try {
      id = ((await res.json()) as { id?: unknown }).id;
    } catch {
      id = undefined;
    }
    if (typeof id !== 'string' || !id) throw new EmailSendError('resend_bad_response', false);
    return { providerMessageId: id };
  }
}
