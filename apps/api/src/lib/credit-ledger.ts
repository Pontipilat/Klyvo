export interface LedgerState {
  balance: number;
  reservedBalance: number;
}

export function reserveCredits(state: LedgerState, amount: number): LedgerState {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('INVALID_AMOUNT');
  if (state.balance - state.reservedBalance < amount) throw new Error('INSUFFICIENT_CREDITS');
  return { ...state, reservedBalance: state.reservedBalance + amount };
}

export function chargeReservedCredits(state: LedgerState, amount: number): LedgerState {
  if (state.reservedBalance < amount) throw new Error('INVALID_RESERVATION');
  return { balance: state.balance - amount, reservedBalance: state.reservedBalance - amount };
}

export function refundReservedCredits(state: LedgerState, amount: number): LedgerState {
  if (state.reservedBalance < amount) throw new Error('INVALID_RESERVATION');
  return { ...state, reservedBalance: state.reservedBalance - amount };
}

export function creditPurchase(state: LedgerState, amount: number): LedgerState {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('INVALID_AMOUNT');
  return { ...state, balance: state.balance + amount };
}
