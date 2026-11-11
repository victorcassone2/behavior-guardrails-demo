import { canRead, requireActor } from './access.ts'
import type { Clock } from './clock.ts'
import type { Database, Order, OrderLine, Payment } from './db.ts'
import { ShopError } from './errors.ts'
import { discountFor, subtotal } from './money.ts'
import type { VoucherService } from './vouchers.ts'

export function orderService(ctx: { db: Database; clock: Clock; vouchers: VoucherService }) {
  const { db, clock, vouchers } = ctx

  /** Orders the actor may see. Someone else's order looks exactly like a missing one. */
  async function readable(actorId: string, orderId: string): Promise<Order> {
    const actor = await requireActor(db, actorId)
    const order = await db.getOrder(orderId)
    if (!order || !canRead(actor, order.customerId)) throw new ShopError('NOT_FOUND', 'Order not found.')
    return order
  }

  /** Only the customer who placed an order may change it. */
  async function owned(actorId: string, orderId: string): Promise<Order> {
    const order = await readable(actorId, orderId)
    if (order.customerId !== actorId) throw new ShopError('FORBIDDEN', 'Only the customer can change this order.')
    return order
  }

  async function create(actorId: string, lines: OrderLine[]): Promise<Order> {
    await requireActor(db, actorId)
    const subtotalCents = subtotal(lines)
    const order: Order = {
      id: db.nextId('ord'),
      customerId: actorId,
      lines: lines.map((l) => ({ ...l })),
      subtotalCents,
      voucherCode: null,
      discountCents: 0,
      totalCents: subtotalCents,
      status: 'open',
      createdAt: clock.now(),
    }
    await db.saveOrder(order)
    return order
  }

  const get = readable

  async function listForCustomer(actorId: string, customerId: string): Promise<Order[]> {
    const actor = await requireActor(db, actorId)
    if (!canRead(actor, customerId)) throw new ShopError('FORBIDDEN', 'You cannot list another customer’s orders.')
    return db.ordersFor(customerId)
  }

  /** Attaches a voucher to an open order. Nothing is redeemed until payment. */
  async function applyVoucher(actorId: string, orderId: string, code: string): Promise<Order> {
    const order = await owned(actorId, orderId)
    if (order.status !== 'open') throw new ShopError('ORDER_NOT_OPEN', 'Vouchers can only be added to open orders.')
    if (order.voucherCode) throw new ShopError('ORDER_ALREADY_HAS_VOUCHER', 'This order already has a voucher.')

    const voucher = await vouchers.find(code)
    vouchers.assertUsable(voucher, order.customerId, order.subtotalCents, clock.now())

    order.voucherCode = voucher.code
    order.discountCents = discountFor(voucher, order.subtotalCents)
    order.totalCents = order.subtotalCents - order.discountCents
    await db.saveOrder(order)
    return order
  }

  async function removeVoucher(actorId: string, orderId: string): Promise<Order> {
    const order = await owned(actorId, orderId)
    if (order.status !== 'open') throw new ShopError('ORDER_NOT_OPEN', 'Only open orders can change.')
    order.voucherCode = null
    order.discountCents = 0
    order.totalCents = order.subtotalCents
    await db.saveOrder(order)
    return order
  }

  /**
   * Pays an open order. A voucher on the order is redeemed here, after being
   * re-checked: it may have expired or been used up since it was applied.
   */
  async function pay(actorId: string, orderId: string): Promise<{ order: Order; payment: Payment }> {
    const order = await owned(actorId, orderId)
    if (order.status !== 'open') throw new ShopError('ORDER_NOT_OPEN', 'This order is not open.')

    if (order.voucherCode) {
      const voucher = await vouchers.find(order.voucherCode)
      order.discountCents = discountFor(voucher, order.subtotalCents)
      order.totalCents = order.subtotalCents - order.discountCents
      await vouchers.redeemForOrder(order, order.discountCents)
    }

    const payment: Payment = {
      id: db.nextId('pay'),
      orderId: order.id,
      customerId: order.customerId,
      amountCents: order.totalCents,
      refundedCents: 0,
      capturedAt: clock.now(),
    }
    await db.savePayment(payment)
    order.status = 'paid'
    await db.saveOrder(order)
    return { order, payment }
  }

  /** Open orders can be cancelled by their customer. Paid orders are refunded instead. */
  async function cancel(actorId: string, orderId: string): Promise<Order> {
    const order = await owned(actorId, orderId)
    if (order.status !== 'open') throw new ShopError('ORDER_NOT_OPEN', 'Only open orders can be cancelled.')
    order.status = 'cancelled'
    await db.saveOrder(order)
    return order
  }

  return { create, get, listForCustomer, applyVoucher, removeVoucher, pay, cancel }
}
