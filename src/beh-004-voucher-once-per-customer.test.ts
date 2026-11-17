// Behavioral Guardrails — BEH-004: Customer can redeem a voucher only once. Generated tests; review before merging.
import { describe, expect, it } from 'vitest'
import { manualClock } from './clock.ts'
import { Database, type Customer, type OrderLine } from './db.ts'
import { ShopError } from './errors.ts'
import { KeyedLock } from './lock.ts'
import { orderService } from './orders.ts'
import { paymentService } from './payments.ts'
import { voucherService, type IssueVoucherInput } from './vouchers.ts'

const DAY_MS = 86_400_000
const CODE = 'WELCOME10'
const LINES: OrderLine[] = [{ sku: 'mug', unitPriceCents: 2000, quantity: 1 }]
// A 10% voucher on a 20.00 order.
const DISCOUNT_CENTS = 200
const TOTAL_CENTS = 1800

/**
 * Wires the real services the same way createShop() does, but keeps a handle on
 * the in-memory Database so the tests can check which payments were actually
 * stored for an order (the shop's public API has no way to list them).
 */
async function setup() {
  const clock = manualClock('2026-03-01T12:00:00.000Z')
  const db = new Database()
  const locks = new KeyedLock()
  const vouchers = voucherService({ db, clock, locks })
  const orders = orderService({ db, clock, vouchers })
  const payments = paymentService({ db, clock, locks })

  const admin: Customer = { id: db.nextId('cus'), email: 'admin@shop.test', role: 'admin' }
  const ada: Customer = { id: db.nextId('cus'), email: 'ada@example.com', role: 'customer' }
  await db.saveCustomer(admin)
  await db.saveCustomer(ada)

  /** A valid voucher. Total uses are generous so only the per-customer limit can block a payment. */
  async function issueVoucher(overrides: Partial<IssueVoucherInput> = {}) {
    return vouchers.issue(admin.id, {
      code: CODE,
      kind: 'percent',
      value: 10,
      minOrderCents: 1000,
      expiresAt: new Date(clock.now().getTime() + 30 * DAY_MS),
      maxRedemptions: 1000,
      ...overrides,
    })
  }

  /** An open order for Ada that meets the voucher's conditions, with the voucher applied. */
  async function openOrderWithVoucher(code: string) {
    const order = await orders.create(ada.id, LINES)
    const applied = await orders.applyVoucher(ada.id, order.id, code)
    expect(applied.voucherCode).toBe(code)
    return applied
  }

  async function redemptionsOf(code: string, customerId: string) {
    return (await vouchers.redemptions(admin.id, code)).filter((r) => r.customerId === customerId)
  }

  return { db, vouchers, orders, payments, admin, ada, issueVoucher, openOrderWithVoucher, redemptionsOf }
}

async function expectAlreadyRedeemed(attempt: Promise<unknown>) {
  await expect(attempt).rejects.toBeInstanceOf(ShopError)
  await expect(attempt).rejects.toMatchObject({ code: 'VOUCHER_ALREADY_REDEEMED' })
}

describe('voucher redemption is limited per customer', () => {
  it('BEH-004-S01: rejects paying a second order with a default-limit voucher the customer already redeemed', async () => {
    const h = await setup()
    // No perCustomerLimit given: the default applies.
    const voucher = await h.issueVoucher()
    const orderA = await h.openOrderWithVoucher(voucher.code)
    const orderB = await h.openOrderWithVoucher(voucher.code)

    const paidA = await h.orders.pay(h.ada.id, orderA.id)
    expect(paidA.order.status).toBe('paid')

    await expectAlreadyRedeemed(h.orders.pay(h.ada.id, orderB.id))

    expect(await h.db.paymentForOrder(orderB.id)).toBeNull()
    expect((await h.orders.get(h.ada.id, orderB.id)).status).not.toBe('paid')

    const mine = await h.redemptionsOf(voucher.code, h.ada.id)
    expect(mine).toHaveLength(1)
    expect(mine[0].orderId).toBe(orderA.id)
  })

  it('BEH-004-S02: accepts applying an already-redeemed voucher to a new open order without recording a redemption', async () => {
    const h = await setup()
    const voucher = await h.issueVoucher()
    const orderA = await h.openOrderWithVoucher(voucher.code)
    await h.orders.pay(h.ada.id, orderA.id)
    expect(await h.redemptionsOf(voucher.code, h.ada.id)).toHaveLength(1)

    const orderB = await h.orders.create(h.ada.id, LINES)
    const applied = await h.orders.applyVoucher(h.ada.id, orderB.id, voucher.code)

    expect(applied).toMatchObject({
      voucherCode: CODE,
      discountCents: DISCOUNT_CENTS,
      totalCents: TOTAL_CENTS,
      status: 'open',
    })
    const stored = await h.orders.get(h.ada.id, orderB.id)
    expect(stored).toMatchObject({ voucherCode: CODE, discountCents: DISCOUNT_CENTS, totalCents: TOTAL_CENTS })

    const mine = await h.redemptionsOf(voucher.code, h.ada.id)
    expect(mine.map((r) => r.orderId)).toEqual([orderA.id])
  })

  it('BEH-004-S03: with a per-customer limit of 2, the first two payments succeed and the third is rejected', async () => {
    const h = await setup()
    const voucher = await h.issueVoucher({ perCustomerLimit: 2, maxRedemptions: 100 })
    const order1 = await h.openOrderWithVoucher(voucher.code)
    const order2 = await h.openOrderWithVoucher(voucher.code)
    const order3 = await h.openOrderWithVoucher(voucher.code)

    const first = await h.orders.pay(h.ada.id, order1.id)
    expect(first.order.status).toBe('paid')
    expect((await h.redemptionsOf(voucher.code, h.ada.id)).map((r) => r.orderId)).toEqual([order1.id])

    const second = await h.orders.pay(h.ada.id, order2.id)
    expect(second.order.status).toBe('paid')
    expect((await h.redemptionsOf(voucher.code, h.ada.id)).map((r) => r.orderId)).toEqual([order1.id, order2.id])

    await expectAlreadyRedeemed(h.orders.pay(h.ada.id, order3.id))

    expect((await h.orders.get(h.ada.id, order1.id)).status).toBe('paid')
    expect((await h.orders.get(h.ada.id, order2.id)).status).toBe('paid')
    expect((await h.orders.get(h.ada.id, order3.id)).status).not.toBe('paid')
    expect(await h.db.paymentForOrder(order3.id)).toBeNull()

    const mine = await h.redemptionsOf(voucher.code, h.ada.id)
    expect(mine).toHaveLength(2)
    expect(mine.map((r) => r.orderId)).toEqual([order1.id, order2.id])
  })

  it('BEH-004-S04: still rejects paying another order after the order that redeemed the voucher was fully refunded', async () => {
    const h = await setup()
    const voucher = await h.issueVoucher()
    const orderA = await h.openOrderWithVoucher(voucher.code)
    const orderB = await h.openOrderWithVoucher(voucher.code)

    const { payment } = await h.orders.pay(h.ada.id, orderA.id)
    await h.payments.refund(h.admin.id, payment.id, payment.amountCents, { reason: 'Returned' })
    const refunded = await h.payments.get(h.admin.id, payment.id)
    expect(refunded.refundedCents).toBe(refunded.amountCents)

    await expectAlreadyRedeemed(h.orders.pay(h.ada.id, orderB.id))

    expect(await h.db.paymentForOrder(orderB.id)).toBeNull()
    expect((await h.orders.get(h.ada.id, orderB.id)).status).not.toBe('paid')

    const mine = await h.redemptionsOf(voucher.code, h.ada.id)
    expect(mine.map((r) => r.orderId)).toEqual([orderA.id])
  })

  it('BEH-004-S05: lets the customer pay with a voucher that was only applied to a cancelled, unpaid order', async () => {
    const h = await setup()
    const voucher = await h.issueVoucher()
    const orderA = await h.openOrderWithVoucher(voucher.code)
    const cancelled = await h.orders.cancel(h.ada.id, orderA.id)
    expect(cancelled.status).toBe('cancelled')

    const orderB = await h.openOrderWithVoucher(voucher.code)
    const { order, payment } = await h.orders.pay(h.ada.id, orderB.id)

    expect(order).toMatchObject({
      id: orderB.id,
      status: 'paid',
      voucherCode: CODE,
      discountCents: DISCOUNT_CENTS,
      totalCents: TOTAL_CENTS,
    })
    expect(payment.amountCents).toBe(TOTAL_CENTS)
    expect((await h.orders.get(h.ada.id, orderB.id)).status).toBe('paid')
    expect(await h.db.paymentForOrder(orderB.id)).toMatchObject({ amountCents: TOTAL_CENTS })

    const mine = await h.redemptionsOf(voucher.code, h.ada.id)
    expect(mine).toHaveLength(1)
    expect(mine[0].orderId).toBe(orderB.id)
  })

  it('BEH-004-S06: when two orders with the same voucher are paid at the same time, only one payment succeeds', async () => {
    const h = await setup()
    const voucher = await h.issueVoucher()
    const orderA = await h.openOrderWithVoucher(voucher.code)
    const orderB = await h.openOrderWithVoucher(voucher.code)
    const ids = [orderA.id, orderB.id]

    const results = await Promise.allSettled([h.orders.pay(h.ada.id, orderA.id), h.orders.pay(h.ada.id, orderB.id)])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)

    const winnerIndex = results.findIndex((r) => r.status === 'fulfilled')
    const loserIndex = results.findIndex((r) => r.status === 'rejected')
    const winner = results[winnerIndex] as PromiseFulfilledResult<Awaited<ReturnType<typeof h.orders.pay>>>
    const loser = results[loserIndex] as PromiseRejectedResult
    const winnerId = ids[winnerIndex]
    const loserId = ids[loserIndex]

    expect(loser.reason).toBeInstanceOf(ShopError)
    expect(loser.reason).toMatchObject({ code: 'VOUCHER_ALREADY_REDEEMED' })

    expect(winner.value.order.id).toBe(winnerId)
    expect(winner.value.order.status).toBe('paid')
    expect((await h.orders.get(h.ada.id, winnerId)).status).toBe('paid')
    expect(await h.db.paymentForOrder(winnerId)).not.toBeNull()

    expect((await h.orders.get(h.ada.id, loserId)).status).not.toBe('paid')
    expect(await h.db.paymentForOrder(loserId)).toBeNull()

    const mine = await h.redemptionsOf(voucher.code, h.ada.id)
    expect(mine).toHaveLength(1)
    expect(mine[0].orderId).toBe(winnerId)
  })
})
