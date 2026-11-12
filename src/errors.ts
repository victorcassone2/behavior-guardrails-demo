export type ShopErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'VALIDATION'
  | 'VOUCHER_NOT_FOUND'
  | 'VOUCHER_NOT_YET_VALID'
  | 'VOUCHER_EXPIRED'
  | 'VOUCHER_ALREADY_REDEEMED'
  | 'VOUCHER_LIMIT_REACHED'
  | 'VOUCHER_MIN_ORDER'
  | 'VOUCHER_NOT_ASSIGNED'
  | 'ORDER_NOT_OPEN'
  | 'ORDER_ALREADY_HAS_VOUCHER'
  | 'REFUND_EXCEEDS_PAYMENT'
  | 'REFUND_INVALID_AMOUNT'
  | 'GIFT_CARD_INSUFFICIENT_BALANCE'

/** Every rule violation surfaces as a ShopError with a stable code. */
export class ShopError extends Error {
  constructor(
    readonly code: ShopErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ShopError'
  }
}
