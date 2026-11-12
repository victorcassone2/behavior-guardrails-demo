// Behavioral Guardrails — BEH-006: Gift card spends never overdraw the balance. Generated tests; review before merging.
import { describe, expect, it } from 'vitest'
import { manualClock } from './clock.ts'
import { ShopError } from './errors.ts'
import { createShop } from './shop.ts'

async function setup(balanceCents = 5000) {
  const shop = createShop({ clock: manualClock('2026-03-01T12:00:00.000Z') })
  const admin = await shop.register('admin@shop.test', 'admin')
  const ada = await shop.register('ada@example.com')
  const card = await shop.giftCards.issue(admin.id, { ownerId: ada.id, balanceCents })
  expect(card.balanceCents).toBe(balanceCents)

  async function balance(): Promise<number> {
    return (await shop.giftCards.get(ada.id, card.id)).balanceCents
  }

  return { shop, admin, ada, card, balance }
}

async function expectRefused(attempt: Promise<unknown>, code: string) {
  await expect(attempt).rejects.toBeInstanceOf(ShopError)
  await expect(attempt).rejects.toMatchObject({ code })
}

describe('gift card spends never overdraw the balance', () => {
  it('BEH-006-S01: a partial spend succeeds and leaves the rest of the balance on the card', async () => {
    const h = await setup(5000)

    const spend = await h.shop.giftCards.spend(h.ada.id, h.card.id, 2000, 'ord_1')

    expect(spend).toMatchObject({ cardId: h.card.id, customerId: h.ada.id, amountCents: 2000, reference: 'ord_1' })
    expect(await h.balance()).toBe(3000)
  })

  it('BEH-006-S02: a spend one cent above the remaining balance is refused and the balance is unchanged', async () => {
    const h = await setup(5000)
    await h.shop.giftCards.spend(h.ada.id, h.card.id, 2000, 'ord_1')
    expect(await h.balance()).toBe(3000)

    await expectRefused(h.shop.giftCards.spend(h.ada.id, h.card.id, 3001, 'ord_2'), 'GIFT_CARD_INSUFFICIENT_BALANCE')

    expect(await h.balance()).toBe(3000)
  })

  it('BEH-006-S03: spending exactly the remaining balance after a partial spend succeeds and leaves 0', async () => {
    const h = await setup(5000)
    await h.shop.giftCards.spend(h.ada.id, h.card.id, 2000, 'ord_1')
    expect(await h.balance()).toBe(3000)

    const spend = await h.shop.giftCards.spend(h.ada.id, h.card.id, 3000, 'ord_2')

    expect(spend).toMatchObject({ cardId: h.card.id, amountCents: 3000 })
    expect(await h.balance()).toBe(0)
  })

  it('BEH-006-S04: of two concurrent 3000-cent spends on a 5000-cent card, exactly one succeeds and 2000 cents remain', async () => {
    const h = await setup(5000)

    const results = await Promise.allSettled([
      h.shop.giftCards.spend(h.ada.id, h.card.id, 3000, 'ord_a'),
      h.shop.giftCards.spend(h.ada.id, h.card.id, 3000, 'ord_b'),
    ])

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0].reason).toBeInstanceOf(ShopError)
    expect(rejected[0].reason).toMatchObject({ code: 'GIFT_CARD_INSUFFICIENT_BALANCE' })

    const remaining = await h.balance()
    expect(remaining).toBe(2000)
    expect(remaining).toBeGreaterThanOrEqual(0)
  })

  it('BEH-006-S05: of ten concurrent 1000-cent spends on a 5000-cent card, exactly five succeed and the balance ends at 0', async () => {
    const h = await setup(5000)

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => h.shop.giftCards.spend(h.ada.id, h.card.id, 1000, `ord_${i}`)),
    )

    const fulfilled = results.filter(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof h.shop.giftCards.spend>>> => r.status === 'fulfilled',
    )
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(fulfilled).toHaveLength(5)
    expect(rejected).toHaveLength(5)
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(ShopError)
      expect(r.reason).toMatchObject({ code: 'GIFT_CARD_INSUFFICIENT_BALANCE' })
    }
    expect(fulfilled.reduce((sum, r) => sum + r.value.amountCents, 0)).toBe(5000)

    const remaining = await h.balance()
    expect(remaining).toBe(0)
    expect(remaining).toBeGreaterThanOrEqual(0)
  })

  it('BEH-006-S06: spends of 0, -100 and 12.5 cents are each refused and the balance stays at 5000', async () => {
    const h = await setup(5000)

    await expectRefused(h.shop.giftCards.spend(h.ada.id, h.card.id, 0, 'ord_zero'), 'VALIDATION')
    expect(await h.balance()).toBe(5000)

    await expectRefused(h.shop.giftCards.spend(h.ada.id, h.card.id, -100, 'ord_negative'), 'VALIDATION')
    expect(await h.balance()).toBe(5000)

    await expectRefused(h.shop.giftCards.spend(h.ada.id, h.card.id, 12.5, 'ord_fraction'), 'VALIDATION')
    expect(await h.balance()).toBe(5000)
  })
})
