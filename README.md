# Behavioral Guardrails demo shop

A small in-memory shop for trying out [Behavioral Guardrails](https://github.com/victorcassone2): define a behavior in plain language, clarify it, approve scenarios, and let it generate Vitest tests that run in GitHub Actions.

There is no server or database. `createShop()` returns the services, and every call takes the id of the account making the request first.

```ts
import { createShop, manualClock } from './src/index.ts'

const shop = createShop({ clock: manualClock('2026-03-01T12:00:00Z') })
const admin = await shop.register('admin@shop.test', 'admin')
const ada = await shop.register('ada@example.com')

await shop.vouchers.issue(admin.id, { code: 'WELCOME10', kind: 'percent', value: 10, expiresAt: new Date('2026-04-01') })
const order = await shop.orders.create(ada.id, [{ sku: 'mug', unitPriceCents: 1250, quantity: 2 }])
await shop.orders.applyVoucher(ada.id, order.id, 'welcome10')
const { payment } = await shop.orders.pay(ada.id, order.id)
```

## What's in it

| Area | Rules worth protecting |
| --- | --- |
| Vouchers (`src/vouchers.ts`) | Codes are case-insensitive. Valid from `validFrom` up to, but not including, `expiresAt`. Limits on total and per-customer redemptions. Personal vouchers. Minimum order totals. Re-checked at payment, and redeemed under a lock so simultaneous checkouts can't both use the last redemption. |
| Orders (`src/orders.ts`) | Totals in integer cents. Percent discounts round down. One voucher per order. Only open orders can change. |
| Payments and refunds (`src/payments.ts`) | Only staff refund. Partial refunds are allowed, but they never add up to more than the payment, even under concurrency. Idempotency keys make retries safe. Refunds don't give vouchers back. |
| Gift cards (`src/giftcards.ts`) | Staff issue cards with a balance in integer cents. A card can be spent in parts. Only its owner, and customers the owner shared it with, can spend it. |
| Access (`src/access.ts`) | Customers see only their own orders and payments. Someone else's order looks like a missing one. Support staff can read everything but can't change orders. |

`src/db.ts` yields to the event loop on every read and write, like real I/O, so race conditions are real here.

Some of these rules are product decisions a team might disagree with (should a refund give a voucher back? should a forbidden order return "not found"?). That's on purpose: they're good material for Behavioral Guardrails' clarification questions.

## Commands

```bash
npm ci
npm test
npm run typecheck
```
