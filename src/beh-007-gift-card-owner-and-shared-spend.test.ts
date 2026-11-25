// Behavioral Guardrails — BEH-007: Only owner and shared customers can spend gift cards. Generated tests; review before merging.
import { describe, expect, it } from 'vitest'
import { manualClock } from './clock.ts'
import { ShopError } from './errors.ts'
import { createShop } from './shop.ts'

async function setup(balanceCents = 5000) {
  const shop = createShop({ clock: manualClock('2026-03-01T12:00:00.000Z') })
  const admin = await shop.register('admin@shop.test', 'admin')
  const ada = await shop.register('ada@example.com')
  const bob = await shop.register('bob@example.com')
  const carol = await shop.register('carol@example.com')
  const card = await shop.giftCards.issue(admin.id, { ownerId: ada.id, balanceCents })
  expect(card.balanceCents).toBe(balanceCents)

  async function balanceAsAda(): Promise<number> {
    return (await shop.giftCards.get(ada.id, card.id)).balanceCents
  }

  return { shop, admin, ada, bob, carol, card, balanceAsAda }
}

describe('only the owner and shared customers can spend a gift card', () => {
  it('BEH-007-S01: the owner spends 2000 cents from her unshared 5000-cent card and the balance drops to 3000', async () => {
    const h = await setup(5000)

    const spend = await h.shop.giftCards.spend(h.ada.id, h.card.id, 2000, 'ord_1')

    expect(spend).toMatchObject({
      cardId: h.card.id,
      customerId: h.ada.id,
      amountCents: 2000,
      reference: 'ord_1',
    })
    expect(await h.balanceAsAda()).toBe(3000)
  })

  it('BEH-007-S03: a customer the card was not shared with is refused and the balance stays at 5000', async () => {
    const h = await setup(5000)
    const shared = await h.shop.giftCards.share(h.ada.id, h.card.id, h.bob.id)
    expect(shared.sharedWith).toContain(h.bob.id)
    expect(shared.sharedWith).not.toContain(h.carol.id)

    const attempt = h.shop.giftCards.spend(h.carol.id, h.card.id, 1000, 'ord_carol')

    // The error code was deliberately left unfixed: any ShopError counts as a refusal.
    await expect(attempt).rejects.toBeInstanceOf(ShopError)
    expect(await h.balanceAsAda()).toBe(5000)
  })
})
