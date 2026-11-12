// Behavioral Guardrails — BEH-008: Only staff issue gift cards with valid balance. Generated tests; review before merging.
import { describe, expect, it } from 'vitest'
import { manualClock } from './clock.ts'
import { ShopError } from './errors.ts'
import { createShop } from './shop.ts'

function newShop() {
  return createShop({ clock: manualClock('2026-03-01T12:00:00.000Z') })
}

async function expectRefused(attempt: Promise<unknown>, code: string) {
  let returned: unknown = undefined
  let caught: unknown = undefined
  try {
    returned = await attempt
  } catch (error) {
    caught = error
  }
  expect(returned).toBeUndefined()
  expect(caught).toBeInstanceOf(ShopError)
  expect(caught).toMatchObject({ code })
}

describe('only staff issue gift cards with a valid balance', () => {
  it('BEH-008-S02: a support staff member issues a 2500-cent card to an existing customer', async () => {
    const shop = newShop()
    const support = await shop.register('support@shop.test', 'support')
    const ada = await shop.register('ada@example.com')

    const card = await shop.giftCards.issue(support.id, { ownerId: ada.id, balanceCents: 2500 })

    expect(card.ownerId).toBe(ada.id)
    expect(card.balanceCents).toBe(2500)
    expect(card.sharedWith).toEqual([])

    const stored = await shop.giftCards.get(ada.id, card.id)
    expect(stored).toMatchObject({ id: card.id, ownerId: ada.id, balanceCents: 2500, sharedWith: [] })
  })

  it('BEH-008-S03: a customer trying to issue a card to another customer is refused with FORBIDDEN', async () => {
    const shop = newShop()
    const ada = await shop.register('ada@example.com')
    const bob = await shop.register('bob@example.com')

    await expectRefused(shop.giftCards.issue(ada.id, { ownerId: bob.id, balanceCents: 5000 }), 'FORBIDDEN')
  })

  it('BEH-008-S04: an admin issues a 1000-cent card to another staff account (support member)', async () => {
    const shop = newShop()
    const admin = await shop.register('admin@shop.test', 'admin')
    const support = await shop.register('support@shop.test', 'support')

    const card = await shop.giftCards.issue(admin.id, { ownerId: support.id, balanceCents: 1000 })

    expect(card.ownerId).toBe(support.id)
    expect(card.balanceCents).toBe(1000)
    expect(card.sharedWith).toEqual([])

    const stored = await shop.giftCards.get(support.id, card.id)
    expect(stored).toMatchObject({ id: card.id, ownerId: support.id, balanceCents: 1000, sharedWith: [] })
  })

  it('BEH-008-S04: an admin issues a 1000-cent card to their own account', async () => {
    const shop = newShop()
    const admin = await shop.register('admin@shop.test', 'admin')
    await shop.register('support@shop.test', 'support')

    const card = await shop.giftCards.issue(admin.id, { ownerId: admin.id, balanceCents: 1000 })

    expect(card.ownerId).toBe(admin.id)
    expect(card.balanceCents).toBe(1000)
    expect(card.sharedWith).toEqual([])

    const stored = await shop.giftCards.get(admin.id, card.id)
    expect(stored).toMatchObject({ id: card.id, ownerId: admin.id, balanceCents: 1000, sharedWith: [] })
  })

  it('BEH-008-S05: issuing a card to a nonexistent account id is refused with NOT_FOUND', async () => {
    const shop = newShop()
    const admin = await shop.register('admin@shop.test', 'admin')

    await expectRefused(
      shop.giftCards.issue(admin.id, { ownerId: 'cus_does_not_exist', balanceCents: 5000 }),
      'NOT_FOUND',
    )
  })

  it('BEH-008-S06: issuing a card with a starting balance of 0 cents is refused with VALIDATION', async () => {
    const shop = newShop()
    const admin = await shop.register('admin@shop.test', 'admin')
    const ada = await shop.register('ada@example.com')

    await expectRefused(shop.giftCards.issue(admin.id, { ownerId: ada.id, balanceCents: 0 }), 'VALIDATION')
  })

  it('BEH-008-S06: issuing a card with a starting balance of -100 cents is refused with VALIDATION', async () => {
    const shop = newShop()
    const admin = await shop.register('admin@shop.test', 'admin')
    const ada = await shop.register('ada@example.com')

    await expectRefused(shop.giftCards.issue(admin.id, { ownerId: ada.id, balanceCents: -100 }), 'VALIDATION')
  })

  it('BEH-008-S07: issuing a card with a fractional starting balance of 10.5 cents is refused with VALIDATION', async () => {
    const shop = newShop()
    const admin = await shop.register('admin@shop.test', 'admin')
    const ada = await shop.register('ada@example.com')

    await expectRefused(shop.giftCards.issue(admin.id, { ownerId: ada.id, balanceCents: 10.5 }), 'VALIDATION')
  })
})
