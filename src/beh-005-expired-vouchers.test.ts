// Behavioral Guardrails — BEH-005: Expired vouchers cannot be used. Generated tests; review before merging.
import { describe, expect, it } from 'vitest'
import { manualClock } from './clock.ts'
import { Database, type Customer, type OrderLine } from './db.ts'
import { ShopError } from './errors.ts'
import { KeyedLock } from './lock.ts'
import { orderService } from './orders.ts'
import { voucherService } from './vouchers.ts'

const DAY_MS = 86_400_000
const START = '2026-03-01T12:00:00.000Z'
const CODE = 'SPRING10'
const LINES: OrderLine[] = [{ sku: 'mug', unitPriceCents: 2000, quantity: 1 }]
// A 10% voucher on a 20.00 order.
const SUBTOTAL_CENTS = 2000
const DISCOUNT_CENTS = 200
const TOTAL_CENTS = 1800

const iso = (ms: number) => new Date(ms).toISOString()

/**
 * Wires the real services the same way createShop() does, but keeps a handle on
 * the in-memory Database so the tests can check whether a payment was stored for
 * an order (the shop's public API has no way to list them).
 */
async function setup() {
  const clock = manualClock(START)
  const db = new Database()
  const locks = new KeyedLock()
  const vouchers = voucherService({ db, clock, locks })
  const orders = orderService({ db, clock, vouchers })

  const admin: Customer = { id: db.nextId('cus'), email: 'admin@shop.test', role: 'admin' }
  const ada: Customer = { id: db.nextId('cus'), email: 'ada@example.com', role: 'customer' }
  await db.saveCustomer(admin)
  await db.saveCustomer(ada)

  /**
   * A voucher that meets every condition apart from time: it is assigned to Ada,
   * its minimum is below the order subtotal, and it has plenty of uses left.
   */
  async function issueVoucher(validFrom: Date, expiresAt: Date) {
    return vouchers.issue(admin.id, {
      code: CODE,
      kind: 'percent',
      value: 10,
      minOrderCents: 1000,
      validFrom,
      expiresAt,
      maxRedemptions: 100,
      perCustomerLimit: 1,
      assignedTo: ada.id,
    })
  }

  /** A voucher valid from START that expires a week later. */
  async function issueWeekLongVoucher() {
    const start = new Date(START).getTime()
    return issueVoucher(new Date(start), new Date(start + 7 * DAY_MS))
  }

  /** An open order for Ada with the voucher applied while it is still valid. */
  async function openOrderWithValidVoucher() {
    const order = await orders.create(ada.id, LINES)
    const applied = await orders.applyVoucher(ada.id, order.id, CODE)
    expect(applied).toMatchObject({ voucherCode: CODE, discountCents: DISCOUNT_CENTS, totalCents: TOTAL_CENTS, status: 'open' })
    return applied
  }

  async function allRedemptions() {
    return vouchers.redemptions(admin.id, CODE)
  }

  return { clock, db, vouchers, orders, admin, ada, issueVoucher, issueWeekLongVoucher, openOrderWithValidVoucher, allRedemptions }
}

async function expectExpiredRejection(attempt: Promise<unknown>) {
  const error = await attempt.then(
    () => null,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(ShopError)
  expect(error).toMatchObject({ code: 'VOUCHER_EXPIRED' })
}

describe('expired vouchers cannot be added to an order', () => {
  it('BEH-005-S01: rejects adding a voucher whose expiry time has already passed and leaves the order unchanged', async () => {
    const h = await setup()
    const now = h.clock.now().getTime()
    await h.issueVoucher(new Date(now - 30 * DAY_MS), new Date(now - DAY_MS))
    const order = await h.orders.create(h.ada.id, LINES)

    await expectExpiredRejection(h.orders.applyVoucher(h.ada.id, order.id, CODE))

    const stored = await h.orders.get(h.ada.id, order.id)
    expect(stored).toMatchObject({
      voucherCode: null,
      discountCents: 0,
      subtotalCents: SUBTOTAL_CENTS,
      totalCents: SUBTOTAL_CENTS,
      status: 'open',
    })
    expect(stored.totalCents).toBe(stored.subtotalCents)
  })

  it('BEH-005-S02: rejects adding a voucher at exactly its expiry time', async () => {
    const h = await setup()
    const voucher = await h.issueWeekLongVoucher()
    const order = await h.orders.create(h.ada.id, LINES)

    h.clock.set(iso(voucher.expiresAt.getTime()))
    await expectExpiredRejection(h.orders.applyVoucher(h.ada.id, order.id, CODE))

    const stored = await h.orders.get(h.ada.id, order.id)
    expect(stored).toMatchObject({
      voucherCode: null,
      discountCents: 0,
      subtotalCents: SUBTOTAL_CENTS,
      totalCents: SUBTOTAL_CENTS,
      status: 'open',
    })
    expect(stored.totalCents).toBe(stored.subtotalCents)
  })

  it('BEH-005-S03: accepts adding a voucher one millisecond before its expiry time', async () => {
    const h = await setup()
    const voucher = await h.issueWeekLongVoucher()
    const order = await h.orders.create(h.ada.id, LINES)

    h.clock.set(iso(voucher.expiresAt.getTime() - 1))
    const applied = await h.orders.applyVoucher(h.ada.id, order.id, CODE)

    expect(applied).toMatchObject({
      voucherCode: CODE,
      discountCents: DISCOUNT_CENTS,
      totalCents: TOTAL_CENTS,
      status: 'open',
    })
    const stored = await h.orders.get(h.ada.id, order.id)
    expect(stored).toMatchObject({
      voucherCode: CODE,
      discountCents: DISCOUNT_CENTS,
      totalCents: TOTAL_CENTS,
    })
    expect(stored.totalCents).toBe(stored.subtotalCents - stored.discountCents)
  })
})

describe('a voucher that expires after being added blocks payment', () => {
  it('BEH-005-S04: rejects paying after the voucher has expired; the order stays open with no payment or redemption', async () => {
    const h = await setup()
    const voucher = await h.issueWeekLongVoucher()
    const order = await h.openOrderWithValidVoucher()

    h.clock.set(iso(voucher.expiresAt.getTime() + 60 * 60 * 1000))
    await expectExpiredRejection(h.orders.pay(h.ada.id, order.id))

    const stored = await h.orders.get(h.ada.id, order.id)
    expect(stored.status).toBe('open')
    expect(await h.db.paymentForOrder(order.id)).toBeNull()

    const redemptions = await h.allRedemptions()
    expect(redemptions.filter((r) => r.orderId === order.id)).toEqual([])
    expect(redemptions.filter((r) => r.customerId === h.ada.id)).toEqual([])
  })

  it('BEH-005-S05: rejects paying at exactly the voucher expiry time; the order stays open with no payment or redemption', async () => {
    const h = await setup()
    const voucher = await h.issueWeekLongVoucher()
    const order = await h.openOrderWithValidVoucher()

    h.clock.set(iso(voucher.expiresAt.getTime()))
    await expectExpiredRejection(h.orders.pay(h.ada.id, order.id))

    const stored = await h.orders.get(h.ada.id, order.id)
    expect(stored.status).toBe('open')
    expect(await h.db.paymentForOrder(order.id)).toBeNull()
    expect(await h.allRedemptions()).toEqual([])
  })

  it('BEH-005-S06: accepts paying one millisecond before the voucher expiry time and records one redemption', async () => {
    const h = await setup()
    const voucher = await h.issueWeekLongVoucher()
    const order = await h.openOrderWithValidVoucher()

    h.clock.set(iso(voucher.expiresAt.getTime() - 1))
    const result = await h.orders.pay(h.ada.id, order.id)

    expect(result.order).toMatchObject({ id: order.id, status: 'paid', totalCents: TOTAL_CENTS })
    expect(result.payment.amountCents).toBe(TOTAL_CENTS)

    const stored = await h.orders.get(h.ada.id, order.id)
    expect(stored.status).toBe('paid')
    expect(await h.db.paymentForOrder(order.id)).toMatchObject({ orderId: order.id, amountCents: TOTAL_CENTS })

    const forThisOrder = (await h.allRedemptions()).filter((r) => r.orderId === order.id)
    expect(forThisOrder).toHaveLength(1)
    expect(forThisOrder[0]).toMatchObject({ code: CODE, customerId: h.ada.id, discountCents: DISCOUNT_CENTS })
  })
})
