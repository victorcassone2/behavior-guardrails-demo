// An in-memory stand-in for a database. Every read and write yields to the event
// loop first, like real I/O would, so two requests in flight at once really can
// interleave. Code that checks-then-writes without a lock has the same race here
// that it would have against Postgres.

export type Role = 'customer' | 'support' | 'admin'

export interface Customer {
  id: string
  email: string
  role: Role
}

export interface Voucher {
  /** Stored upper-case; lookups are case-insensitive. */
  code: string
  kind: 'percent' | 'fixed'
  /** Percent off (1-100) or cents off. */
  value: number
  minOrderCents: number
  /** Valid when validFrom <= now < expiresAt. */
  validFrom: Date
  expiresAt: Date
  /** Total successful redemptions allowed across all customers. */
  maxRedemptions: number
  /** Successful redemptions allowed per customer. */
  perCustomerLimit: number
  /** A personal voucher can only be used by this customer. */
  assignedTo: string | null
}

export interface GiftCard {
  id: string
  /** The customer the card belongs to. */
  ownerId: string
  /** Other customers the owner shared the card with. */
  sharedWith: string[]
  balanceCents: number
  issuedAt: Date
}

export interface GiftCardSpend {
  id: string
  cardId: string
  customerId: string
  amountCents: number
  reference: string
  spentAt: Date
}

export interface Redemption {
  id: string
  code: string
  customerId: string
  orderId: string
  discountCents: number
  redeemedAt: Date
}

export interface OrderLine {
  sku: string
  unitPriceCents: number
  quantity: number
}

export type OrderStatus = 'open' | 'paid' | 'cancelled' | 'partially_refunded' | 'refunded'

export interface Order {
  id: string
  customerId: string
  lines: OrderLine[]
  subtotalCents: number
  voucherCode: string | null
  discountCents: number
  totalCents: number
  status: OrderStatus
  createdAt: Date
}

export interface Payment {
  id: string
  orderId: string
  customerId: string
  amountCents: number
  refundedCents: number
  capturedAt: Date
}

export interface Refund {
  id: string
  paymentId: string
  amountCents: number
  reason: string
  idempotencyKey: string | null
  createdBy: string
  createdAt: Date
}

const io = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

export class Database {
  private readonly tables = {
    customers: new Map<string, Customer>(),
    vouchers: new Map<string, Voucher>(),
    redemptions: [] as Redemption[],
    orders: new Map<string, Order>(),
    payments: new Map<string, Payment>(),
    refunds: [] as Refund[],
    giftCards: new Map<string, GiftCard>(),
    giftCardSpends: [] as GiftCardSpend[],
  }
  private sequence = 0

  nextId(prefix: string): string {
    this.sequence += 1
    return `${prefix}_${this.sequence}`
  }

  async getCustomer(id: string) {
    await io()
    return this.tables.customers.get(id) ?? null
  }
  async saveCustomer(customer: Customer) {
    await io()
    this.tables.customers.set(customer.id, { ...customer })
  }

  async getVoucher(code: string) {
    await io()
    const voucher = this.tables.vouchers.get(code)
    return voucher ? { ...voucher } : null
  }
  async saveVoucher(voucher: Voucher) {
    await io()
    this.tables.vouchers.set(voucher.code, { ...voucher })
  }

  async redemptionsFor(code: string) {
    await io()
    return this.tables.redemptions.filter((r) => r.code === code).map((r) => ({ ...r }))
  }
  async insertRedemption(redemption: Redemption) {
    await io()
    this.tables.redemptions.push({ ...redemption })
  }

  async getOrder(id: string) {
    await io()
    const order = this.tables.orders.get(id)
    return order ? structuredClone(order) : null
  }
  async ordersFor(customerId: string) {
    await io()
    return [...this.tables.orders.values()].filter((o) => o.customerId === customerId).map((o) => structuredClone(o))
  }
  async saveOrder(order: Order) {
    await io()
    this.tables.orders.set(order.id, structuredClone(order))
  }

  async getPayment(id: string) {
    await io()
    const payment = this.tables.payments.get(id)
    return payment ? { ...payment } : null
  }
  async paymentForOrder(orderId: string) {
    await io()
    const payment = [...this.tables.payments.values()].find((p) => p.orderId === orderId)
    return payment ? { ...payment } : null
  }
  async savePayment(payment: Payment) {
    await io()
    this.tables.payments.set(payment.id, { ...payment })
  }

  async refundsFor(paymentId: string) {
    await io()
    return this.tables.refunds.filter((r) => r.paymentId === paymentId).map((r) => ({ ...r }))
  }
  async insertRefund(refund: Refund) {
    await io()
    this.tables.refunds.push({ ...refund })
  }

  async getGiftCard(id: string) {
    await io()
    const card = this.tables.giftCards.get(id)
    return card ? structuredClone(card) : null
  }
  async saveGiftCard(card: GiftCard) {
    await io()
    this.tables.giftCards.set(card.id, structuredClone(card))
  }
  async insertGiftCardSpend(spend: GiftCardSpend) {
    await io()
    this.tables.giftCardSpends.push({ ...spend })
  }
}
