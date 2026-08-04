import { describe, expect, it } from 'vitest';
import {
  chargeReservedCredits,
  creditPurchase,
  refundReservedCredits,
  reserveCredits,
} from '../src/lib/credit-ledger.js';

describe('credit ledger', () => {
  it('reserves and charges without double charging', () => {
    const reserved = reserveCredits({ balance: 100, reservedBalance: 0 }, 20);
    expect(reserved).toEqual({ balance: 100, reservedBalance: 20 });
    expect(chargeReservedCredits(reserved, 20)).toEqual({ balance: 80, reservedBalance: 0 });
  });

  it('releases a failed generation reservation', () => {
    const reserved = reserveCredits({ balance: 100, reservedBalance: 0 }, 20);
    expect(refundReservedCredits(reserved, 20)).toEqual({ balance: 100, reservedBalance: 0 });
  });

  it('credits a purchase once at the ledger level', () => {
    expect(creditPurchase({ balance: 10, reservedBalance: 0 }, 50)).toEqual({
      balance: 60,
      reservedBalance: 0,
    });
  });
});
