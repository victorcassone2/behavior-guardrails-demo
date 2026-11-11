import { ShopError } from './errors.ts'
import type { OrderLine, Voucher } from './db.ts'

export function subtotal(lines: OrderLine[]): number {
  if (lines.length === 0) throw new ShopError('VALIDATION', 'An order needs at least one line.')
  return lines.reduce((sum, line) => {
    if (!Number.isInteger(line.unitPriceCents) || line.unitPriceCents < 0) {
      throw new ShopError('VALIDATION', `Invalid price for ${line.sku}.`)
    }
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      throw new ShopError('VALIDATION', `Invalid quantity for ${line.sku}.`)
    }
    return sum + line.unitPriceCents * line.quantity
  }, 0)
}

/**
 * Percent discounts round down to the cent, so the shop never gives away a
 * fraction of a cent. A fixed discount never exceeds the subtotal, so a total is
 * never negative.
 */
export function discountFor(voucher: Voucher, subtotalCents: number): number {
  if (voucher.kind === 'percent') return Math.floor((subtotalCents * voucher.value) / 100)
  return Math.min(voucher.value, subtotalCents)
}
