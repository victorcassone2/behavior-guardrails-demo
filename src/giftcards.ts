import { canRead, isStaff, requireActor } from './access.ts'
import type { Clock } from './clock.ts'
import type { Database, GiftCard, GiftCardSpend } from './db.ts'
import { ShopError } from './errors.ts'
import type { KeyedLock } from './lock.ts'

export function giftCardService(ctx: { db: Database; clock: Clock; locks: KeyedLock }) {
  const { db, clock, locks } = ctx

  /** Staff issue a gift card to a customer with a starting balance in cents. */
  async function issue(actorId: string, input: { ownerId: string; balanceCents: number }): Promise<GiftCard> {
    const actor = await requireActor(db, actorId)
    if (!isStaff(actor)) throw new ShopError('FORBIDDEN', 'Only staff can issue gift cards.')
    if (!(await db.getCustomer(input.ownerId))) throw new ShopError('NOT_FOUND', 'Customer not found.')
    if (!Number.isInteger(input.balanceCents) || input.balanceCents <= 0) {
      throw new ShopError('VALIDATION', 'A gift card balance is a positive number of cents.')
    }
    const card: GiftCard = {
      id: db.nextId('gift'),
      ownerId: input.ownerId,
      sharedWith: [],
      balanceCents: input.balanceCents,
      issuedAt: clock.now(),
    }
    await db.saveGiftCard(card)
    return card
  }

  async function get(actorId: string, cardId: string): Promise<GiftCard> {
    const actor = await requireActor(db, actorId)
    const card = await db.getGiftCard(cardId)
    if (!card || !(canRead(actor, card.ownerId) || card.sharedWith.includes(actor.id))) {
      throw new ShopError('NOT_FOUND', 'Gift card not found.')
    }
    return card
  }

  /** The owner lets another customer spend from the card. */
  async function share(actorId: string, cardId: string, customerId: string): Promise<GiftCard> {
    const card = await get(actorId, cardId)
    if (card.ownerId !== actorId) throw new ShopError('FORBIDDEN', 'Only the owner can share a gift card.')
    if (!(await db.getCustomer(customerId))) throw new ShopError('NOT_FOUND', 'Customer not found.')
    if (!card.sharedWith.includes(customerId)) card.sharedWith.push(customerId)
    await db.saveGiftCard(card)
    return card
  }

  /**
   * Spends part or all of a card's balance. Only the owner and customers it was
   * shared with can spend it, and the balance never goes below zero.
   */
  async function spend(actorId: string, cardId: string, amountCents: number, reference: string): Promise<GiftCardSpend> {
    await get(actorId, cardId)
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new ShopError('VALIDATION', 'Spend a positive number of cents.')
    }
    return locks.run(`gift:${cardId}`, async () => {
      const card = (await db.getGiftCard(cardId))!
      if (card.ownerId !== actorId && !card.sharedWith.includes(actorId)) {
        throw new ShopError('FORBIDDEN', 'This gift card belongs to someone else.')
      }
      if (amountCents > card.balanceCents) {
        throw new ShopError('GIFT_CARD_INSUFFICIENT_BALANCE', 'The gift card balance is too low.')
      }
      card.balanceCents -= amountCents
      await db.saveGiftCard(card)
      const record: GiftCardSpend = {
        id: db.nextId('gsp'),
        cardId,
        customerId: actorId,
        amountCents,
        reference,
        spentAt: clock.now(),
      }
      await db.insertGiftCardSpend(record)
      return record
    })
  }

  return { issue, get, share, spend }
}
