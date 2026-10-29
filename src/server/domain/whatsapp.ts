/** `wa.me` click-to-chat link. `phone` must be E.164 (`+` and 8 to 15 digits). */
export function whatsappUrl(phone: string, text: string): string {
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error('WhatsApp phone must be E.164.');
  return `https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(text)}`;
}
