import { systemClock, type Clock } from './clock.ts'
import { Database, type Customer, type Role } from './db.ts'
import { ShopError } from './errors.ts'
import { KeyedLock } from './lock.ts'
import { orderService } from './orders.ts'
import { paymentService } from './payments.ts'
import { voucherService } from './vouchers.ts'

/**
 * The whole shop, wired together. Each call takes the id of the account making
 * the request first; access rules are enforced inside the services.
 */
export function createShop(options: { clock?: Clock } = {}) {
  const db = new Database()
  const clock = options.clock ?? systemClock
  const locks = new KeyedLock()
  const vouchers = voucherService({ db, clock, locks })
  const orders = orderService({ db, clock, vouchers })
  const payments = paymentService({ db, clock, locks })

  async function register(email: string, role: Role = 'customer'): Promise<Customer> {
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new ShopError('VALIDATION', 'Invalid email.')
    const customer: Customer = { id: db.nextId('cus'), email: email.toLowerCase(), role }
    await db.saveCustomer(customer)
    return customer
  }

  return { register, vouchers, orders, payments, clock }
}

export type Shop = ReturnType<typeof createShop>
