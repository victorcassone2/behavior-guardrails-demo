import { describe, expect, it } from 'vitest'
import { manualClock } from './clock.ts'
import { ShopError } from './errors.ts'
import { createShop } from './shop.ts'

async function setup() {
  const clock = manualClock('2026-03-01T12:00:00.000Z')
  const shop = createShop({ clock })
  const admin = await shop.register('admin@shop.test', 'admin')
  const ada = await shop.register('ada@example.com')
  return { shop, clock, admin, ada }
}

describe('orders', () => {
  it('totals the order lines in cents', async () => {
    const { shop, ada } = await setup()
    const order = await shop.orders.create(ada.id, [
      { sku: 'mug', unitPriceCents: 1250, quantity: 2 },
      { sku: 'tea', unitPriceCents: 899, quantity: 1 },
    ])
    expect(order).toMatchObject({ subtotalCents: 3399, totalCents: 3399, status: 'open' })
  })

  it('rejects an empty order', async () => {
    const { shop, ada } = await setup()
    await expect(shop.orders.create(ada.id, [])).rejects.toThrow(ShopError)
  })
})

describe('vouchers', () => {
  it('rounds a percent discount down to the cent', async () => {
    const { shop, admin, ada, clock } = await setup()
    await shop.vouchers.issue(admin.id, {
      code: 'save15',
      kind: 'percent',
      value: 15,
      expiresAt: new Date(clock.now().getTime() + 86_400_000),
    })
    const order = await shop.orders.create(ada.id, [{ sku: 'book', unitPriceCents: 1999, quantity: 1 }])

    const discounted = await shop.orders.applyVoucher(ada.id, order.id, 'SAVE15')

    // 15% of 19.99 is 2.9985, which rounds down to 2.99.
    expect(discounted).toMatchObject({ discountCents: 299, totalCents: 1700, voucherCode: 'SAVE15' })
  })
})
