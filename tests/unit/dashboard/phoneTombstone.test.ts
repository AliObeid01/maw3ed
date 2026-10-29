import { describe, expect, it } from 'vitest';
import { formatPhone, isDeletedClient, isE164, telUrl, whatsappChatUrl } from '@/lib/dashboard/phone';

const TOMBSTONE = 'deleted:clx9abc123def456ghi789jkl';

describe('anonymised client phone', () => {
  it('is not E.164 and is recognised as a deleted client', () => {
    expect(isE164(TOMBSTONE)).toBe(false);
    expect(isDeletedClient(TOMBSTONE)).toBe(true);
    expect(isDeletedClient('+96171234567')).toBe(false);
  });
  it('never prints the tombstone: an em dash instead', () => {
    expect(formatPhone(TOMBSTONE)).toBe('—');
    expect(formatPhone('')).toBe('—');
  });
  it('builds no tel: or wa.me link from it', () => {
    expect(telUrl(TOMBSTONE)).toBeNull();
    expect(whatsappChatUrl(TOMBSTONE)).toBeNull();
    expect(whatsappChatUrl('deleted:12345678901')).toBeNull();
  });
  it('still links real numbers', () => {
    expect(telUrl('+96171234567')).toBe('tel:+96171234567');
    expect(whatsappChatUrl('+96171234567')).toBe('https://wa.me/96171234567');
    expect(formatPhone('+96171234567')).toBe('+961 71 234 567');
  });
  it('E.164 bounds: 8 to 15 digits, no leading zero', () => {
    expect(isE164('+1234567')).toBe(false);
    expect(isE164('+12345678')).toBe(true);
    expect(isE164('+123456789012345')).toBe(true);
    expect(isE164('+1234567890123456')).toBe(false);
    expect(isE164('+0123456789')).toBe(false);
  });
});
