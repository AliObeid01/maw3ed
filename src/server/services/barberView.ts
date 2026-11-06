import { firstNameOf } from '@/server/domain/scope';

/**
 * What a barber may know about a client: the first name and the phone (to call or message them). No surname,
 * e-mail, id or counters. Every barber-facing DTO builds its client part through this one function.
 */
export const barberClient = (client: { name: string; phone: string }) => ({
  name: firstNameOf(client.name),
  phone: client.phone,
});
