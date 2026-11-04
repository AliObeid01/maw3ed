import { z } from 'zod';
import { ApiError, request } from './auth';

const person = z.object({ id: z.string(), name: z.string() });

export const reminderItemSchema = z.object({
  id: z.string(),
  kind: z.enum(['H24', 'H2', 'LATE']),
  dueAt: z.string(),
  appointment: z.object({
    id: z.string(),
    startAt: z.string(),
    service: z.object({ id: z.string(), name: z.string() }),
    staff: z.object({ id: z.string(), displayName: z.string() }),
  }),
  client: z.object({ name: z.string(), phone: z.string(), noShows: z.number().int() }),
  whatsappUrl: z.string().nullable(),
  phoneInvalid: z.boolean().optional(),
  status: z.enum(['PENDING', 'SENT']),
  sentBy: person.nullable(),
  sentAt: z.string().nullable(),
});
export type ReminderItem = z.infer<typeof reminderItemSchema>;

export const whatsappDueSchema = z.object({
  count: z.number().int(),
  items: z.array(reminderItemSchema),
});
export type WhatsappDue = z.infer<typeof whatsappDueSchema>;

const markSentSchema = z.object({
  id: z.string(),
  status: z.literal('SENT'),
  sentBy: person.nullable(),
  sentAt: z.string().nullable(),
});
export type MarkSentResult = z.infer<typeof markSentSchema>;

export const getWhatsappDue = (signal?: AbortSignal) =>
  request('/api/reminders/whatsapp-due', whatsappDueSchema, { signal });

export const markReminderSent = (id: string) =>
  request(`/api/reminders/${encodeURIComponent(id)}/mark-sent`, markSentSchema, {
    method: 'POST',
  });

const alreadySentSchema = z.object({
  sentBy: person.nullable(),
  sentAt: z.string().nullable(),
});

/** Who sent it first, from a 409 ALREADY_SENT (`error.data`); null when absent or malformed. */
export function alreadySentFrom(error: unknown) {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const parsed = alreadySentSchema.safeParse(error.data);
  return parsed.success ? parsed.data : null;
}
