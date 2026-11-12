import { describe, expect, it } from 'vitest'
import { manualClock } from './clock.ts'
import { createShop } from './shop.ts'

async function setup() {
  const shop = createShop({ clock: manualClock('2026-03-01T12:00:00.000Z') })
  const admin = await shop.register('admin@shop.test', 'admin')
  const ada = await shop.register('ada@example.com')
  return { shop, admin, ada }
}

describe('gift cards', () => {
  it('issues a card with its balance in cents', async () => {
    const { shop, admin, ada } = await setup()
    const card = await shop.giftCards.issue(admin.id, { ownerId: ada.id, balanceCents: 5000 })
    expect(card).toMatchObject({ ownerId: ada.id, balanceCents: 5000, sharedWith: [] })
  })

  it('spends the whole balance', async () => {
    const { shop, admin, ada } = await setup()
    const card = await shop.giftCards.issue(admin.id, { ownerId: ada.id, balanceCents: 2500 })
    await shop.giftCards.spend(ada.id, card.id, 2500, 'ord_1')
    expect((await shop.giftCards.get(ada.id, card.id)).balanceCents).toBe(0)
  })
})
