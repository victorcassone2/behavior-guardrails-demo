import { canRead, isStaff, requireActor } from './access.ts'
import type { Clock } from './clock.ts'
import type { Database, Payment, Refund } from './db.ts'
import { ShopError } from './errors.ts'
import type { KeyedLock } from './lock.ts'

export interface RefundOptions {
  reason: string
  /** Retrying with the same key returns the original refund instead of refunding twice. */
  idempotencyKey?: string
}

export function paymentService(ctx: { db: Database; clock: Clock; locks: KeyedLock }) {
  const { db, clock, locks } = ctx

  async function get(actorId: string, paymentId: string): Promise<Payment> {
    const actor = await requireActor(db, actorId)
    const payment = await db.getPayment(paymentId)
    if (!payment || !canRead(actor, payment.customerId)) throw new ShopError('NOT_FOUND', 'Payment not found.')
    return payment
  }

  /**
   * Support and admin staff refund payments, fully or in parts. The refunds on a
   * payment never add up to more than was captured. Refunding does not give a
   * redeemed voucher back.
   */
  async function refund(actorId: string, paymentId: string, amountCents: number, options: RefundOptions): Promise<Refund> {
    const actor = await requireActor(db, actorId)
    if (!isStaff(actor)) throw new ShopError('FORBIDDEN', 'Only staff can issue refunds.')

    return locks.run(`payment:${paymentId}`, async () => {
      const payment = await db.getPayment(paymentId)
      if (!payment) throw new ShopError('NOT_FOUND', 'Payment not found.')

      if (options.idempotencyKey) {
        const previous = (await db.refundsFor(paymentId)).find((r) => r.idempotencyKey === options.idempotencyKey)
        if (previous) {
          if (previous.amountCents !== amountCents) {
            throw new ShopError('VALIDATION', 'That idempotency key was already used for a different amount.')
          }
          return previous
        }
      }

      if (!Number.isInteger(amountCents) || amountCents <= 0) {
        throw new ShopError('REFUND_INVALID_AMOUNT', 'Refunds are a positive number of cents.')
      }
      if (payment.refundedCents + amountCents > payment.amountCents) {
        throw new ShopError('REFUND_EXCEEDS_PAYMENT', 'Refunds cannot exceed the original payment.')
      }

      const refund: Refund = {
        id: db.nextId('ref'),
        paymentId,
        amountCents,
        reason: options.reason,
        idempotencyKey: options.idempotencyKey ?? null,
        createdBy: actor.id,
        createdAt: clock.now(),
      }
      await db.insertRefund(refund)
      payment.refundedCents += amountCents
      await db.savePayment(payment)

      const order = await db.getOrder(payment.orderId)
      if (order) {
        order.status = payment.refundedCents === payment.amountCents ? 'refunded' : 'partially_refunded'
        await db.saveOrder(order)
      }
      return refund
    })
  }

  async function refunds(actorId: string, paymentId: string): Promise<Refund[]> {
    await get(actorId, paymentId)
    return db.refundsFor(paymentId)
  }

  return { get, refund, refunds }
}
