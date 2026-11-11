import type { Customer, Database } from './db.ts'
import { ShopError } from './errors.ts'

/** The account making a request. Unknown accounts are refused outright. */
export async function requireActor(db: Database, actorId: string): Promise<Customer> {
  const actor = await db.getCustomer(actorId)
  if (!actor) throw new ShopError('FORBIDDEN', 'Unknown account.')
  return actor
}

export const isStaff = (actor: Customer) => actor.role === 'support' || actor.role === 'admin'

/** Customers see their own data; support and admin staff see everyone's. */
export function canRead(actor: Customer, ownerId: string): boolean {
  return actor.id === ownerId || isStaff(actor)
}
