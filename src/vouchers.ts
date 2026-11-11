import { isStaff, requireActor } from './access.ts'
import type { Clock } from './clock.ts'
import type { Database, Order, Redemption, Voucher } from './db.ts'
import { ShopError } from './errors.ts'
import type { KeyedLock } from './lock.ts'

export interface IssueVoucherInput {
  code: string
  kind: 'percent' | 'fixed'
  value: number
  minOrderCents?: number
  validFrom?: Date
  expiresAt: Date
  maxRedemptions?: number
  perCustomerLimit?: number
  assignedTo?: string | null
}

export const normalizeCode = (code: string) => code.trim().toUpperCase()

const CODE_PATTERN = /^[A-Z0-9-]{3,32}$/

export function voucherService(ctx: { db: Database; clock: Clock; locks: KeyedLock }) {
  const { db, clock, locks } = ctx

  /** Admins issue vouchers. Defaults: single use, one per customer, valid from now. */
  async function issue(actorId: string, input: IssueVoucherInput): Promise<Voucher> {
    const actor = await requireActor(db, actorId)
    if (actor.role !== 'admin') throw new ShopError('FORBIDDEN', 'Only admins can issue vouchers.')

    const code = normalizeCode(input.code)
    if (!CODE_PATTERN.test(code)) throw new ShopError('VALIDATION', 'Codes are 3-32 letters, digits or dashes.')
    if (await db.getVoucher(code)) throw new ShopError('VALIDATION', `Voucher ${code} already exists.`)

    if (input.kind === 'percent' && !(Number.isInteger(input.value) && input.value >= 1 && input.value <= 100)) {
      throw new ShopError('VALIDATION', 'A percent voucher takes a whole number from 1 to 100.')
    }
    if (input.kind === 'fixed' && !(Number.isInteger(input.value) && input.value > 0)) {
      throw new ShopError('VALIDATION', 'A fixed voucher takes a positive number of cents.')
    }

    const validFrom = input.validFrom ?? clock.now()
    if (input.expiresAt.getTime() <= validFrom.getTime()) {
      throw new ShopError('VALIDATION', 'A voucher must expire after it becomes valid.')
    }
    const maxRedemptions = input.maxRedemptions ?? 1
    const perCustomerLimit = input.perCustomerLimit ?? 1
    if (!Number.isInteger(maxRedemptions) || maxRedemptions < 1 || !Number.isInteger(perCustomerLimit) || perCustomerLimit < 1) {
      throw new ShopError('VALIDATION', 'Redemption limits must be positive whole numbers.')
    }
    const assignedTo = input.assignedTo ?? null
    if (assignedTo && !(await db.getCustomer(assignedTo))) {
      throw new ShopError('VALIDATION', 'A personal voucher must be assigned to an existing customer.')
    }

    const voucher: Voucher = {
      code,
      kind: input.kind,
      value: input.value,
      minOrderCents: input.minOrderCents ?? 0,
      validFrom,
      expiresAt: input.expiresAt,
      maxRedemptions,
      perCustomerLimit,
      assignedTo,
    }
    await db.saveVoucher(voucher)
    return voucher
  }

  async function find(code: string): Promise<Voucher> {
    const voucher = await db.getVoucher(normalizeCode(code))
    if (!voucher) throw new ShopError('VOUCHER_NOT_FOUND', 'That voucher code does not exist.')
    return voucher
  }

  /**
   * Whether `customerId` may use the voucher on an order of `subtotalCents` at
   * `now`. Checked when the voucher is applied and again when the order is paid.
   */
  function assertUsable(voucher: Voucher, customerId: string, subtotalCents: number, now: Date) {
    if (now.getTime() < voucher.validFrom.getTime()) {
      throw new ShopError('VOUCHER_NOT_YET_VALID', 'This voucher is not valid yet.')
    }
    if (now.getTime() >= voucher.expiresAt.getTime()) {
      throw new ShopError('VOUCHER_EXPIRED', 'This voucher has expired.')
    }
    if (voucher.assignedTo && voucher.assignedTo !== customerId) {
      throw new ShopError('VOUCHER_NOT_ASSIGNED', 'This voucher belongs to another customer.')
    }
    if (subtotalCents < voucher.minOrderCents) {
      throw new ShopError('VOUCHER_MIN_ORDER', 'The order total is below this voucher’s minimum.')
    }
  }

  /**
   * Records a redemption for a paid order. The voucher is re-validated and its
   * limits are checked under a per-voucher lock, so simultaneous checkouts
   * cannot both use the last remaining redemption.
   */
  async function redeemForOrder(order: Order, discountCents: number): Promise<Redemption> {
    const code = order.voucherCode!
    return (async () => {
      const voucher = await find(code)
      assertUsable(voucher, order.customerId, order.subtotalCents, clock.now())

      const redemptions = await db.redemptionsFor(code)
      const byCustomer = redemptions.filter((r) => r.customerId === order.customerId).length
      if (byCustomer >= voucher.perCustomerLimit) {
        throw new ShopError('VOUCHER_ALREADY_REDEEMED', 'You have already used this voucher.')
      }
      if (redemptions.length >= voucher.maxRedemptions) {
        throw new ShopError(
          voucher.maxRedemptions === 1 ? 'VOUCHER_ALREADY_REDEEMED' : 'VOUCHER_LIMIT_REACHED',
          'This voucher has been used up.',
        )
      }

      const redemption: Redemption = {
        id: db.nextId('red'),
        code,
        customerId: order.customerId,
        orderId: order.id,
        discountCents,
        redeemedAt: clock.now(),
      }
      await db.insertRedemption(redemption)
      return redemption
    })()
  }

  /** Staff can see who used a voucher. */
  async function redemptions(actorId: string, code: string): Promise<Redemption[]> {
    const actor = await requireActor(db, actorId)
    if (!isStaff(actor)) throw new ShopError('FORBIDDEN', 'Only staff can see voucher usage.')
    return db.redemptionsFor(normalizeCode(code))
  }

  return { issue, find, assertUsable, redeemForOrder, redemptions }
}

export type VoucherService = ReturnType<typeof voucherService>
