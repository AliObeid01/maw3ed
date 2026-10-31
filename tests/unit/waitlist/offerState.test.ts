import { describe, expect, it } from 'vitest';
import { offerViewStatus } from '@/server/domain/offerState';

describe('offerViewStatus: each state of an offer link tells its own truth', () => {
  it('an offer that won or can still win keeps its own status', () => {
    expect(offerViewStatus('OPEN', 'OPEN')).toBe('OPEN');
    expect(offerViewStatus('CLAIMED', 'FULFILLED')).toBe('CLAIMED');
    expect(offerViewStatus('EXPIRED', 'OPEN')).toBe('EXPIRED');
    expect(offerViewStatus('EXPIRED', 'CANCELLED')).toBe('EXPIRED');
  });
  it('superseded while the entry is still waiting means someone else got the slot', () => {
    expect(offerViewStatus('SUPERSEDED', 'OPEN')).toBe('TAKEN');
  });
  it('superseded because the client left (or staff removed the entry) is UNAVAILABLE, never TAKEN', () => {
    expect(offerViewStatus('SUPERSEDED', 'CANCELLED')).toBe('UNAVAILABLE');
    expect(offerViewStatus('OPEN', 'CANCELLED')).toBe('UNAVAILABLE');
  });
  it('another offer of the same request already booked: ALREADY_BOOKED', () => {
    expect(offerViewStatus('SUPERSEDED', 'FULFILLED')).toBe('ALREADY_BOOKED');
    expect(offerViewStatus('OPEN', 'FULFILLED')).toBe('ALREADY_BOOKED');
  });
});
