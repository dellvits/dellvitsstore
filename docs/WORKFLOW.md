# Order workflow, settlements and rider finance

This document supersedes the order lifecycle and cancellation rules in API.md and PLATFORM.md.

## Order lifecycle

| Stage             | Who acts                     | What happens                                                                                                  |
| ----------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `placed`          | Customer                     | Stock is reserved. No rider is assigned automatically.                                                        |
| Payment verified  | System or admin              | COD is verified on placement, cards when the gateway reports `paid`, transfers when an admin approves them.   |
| Sent              | Admin                        | Admin picks an active, on-duty rider in the area with spare capacity, then sends the order.                   |
| Outlet response   | Outlet                       | **Accept** or **Reject**. A rejection cancels the order and shows the reason to the customer.                 |
| Rider response    | Rider                        | **Accept** or **Decline**. A decline unassigns the rider. The order is not cancelled; admin reassigns.        |
| `confirmed`       | System                       | Set automatically once the outlet and rider have both accepted. The delivery countdown starts here.          |
| `preparing`       | Outlet only                  | Admin can send reminders until the order is ready.                                                            |
| `ready`           | Outlet only                  | Rider is notified. Any open cancellation request is cleared.                                                  |
| `picked_up`       | Assigned rider only          | Requires the rider to have accepted the delivery.                                                             |
| `delivered`       | Assigned rider only (OTP)    | Rider earning and order settlement are recorded. The order is locked: no cancel, reassign or payment change. |

Outlets and riders see an order only after it has been sent to them.

### Cancellation

| Status                   | May cancel                                                                  |
| ------------------------ | --------------------------------------------------------------------------- |
| `placed`, `confirmed`    | Admin (reason required), customer; outlet by rejecting while `placed`       |
| `preparing`              | Admin only. The outlet can send a cancellation request for admin review.    |
| `ready`, `picked_up`     | Admin, customer                                                             |
| `delivered`, `cancelled` | Nobody                                                                      |

Cancelling restores stock, releases the coupon redemption, stores the reason and who cancelled, and marks paid online payments as `refund_due`. Admins record the refund from Payments (`refunded`).

## Settlement

When an order is delivered a row is written to `order_settlements`:

- `outlet_commission` = item subtotal × the outlet's commission rate (default 10%, set per outlet)
- `outlet_payable` (outlet deduction) = subtotal − outlet commission
- `rider_commission` = the rider's earning for the order
- `store_net` (store sales) = customer total − outlet payable − rider commission

Coupon discounts already reduce the customer total and are reported separately. Delivered orders from before this change are backfilled on startup.

## Rider cash and payouts

- **COD cash in hand** = cash collected on deliveries − verified submissions − pending submissions.
- Riders submit cash (handover, bank, wallet, Raast) for admin verification. A rejected or withdrawn submission returns to cash in hand.
- **Available balance** = earnings − payouts − pending payout requests. Riders request payouts; admins approve (recording method and reference) or reject with a reason. Admins can also record a direct payout.

## Time-frame filters

Summary endpoints accept optional `from` and `to` ISO timestamps. Dashboards and tables offer Today, last 6 hours, 24 hours, 7 days, 30 days, all time and a custom date range. Tables default to the last 7 days; the admin dashboard cards default to today and "Orders by status" to the last 24 hours.

## Endpoints

All paths start with `/api`.

| Path                                   | Method    | Audience / purpose                                                     |
| -------------------------------------- | --------- | ---------------------------------------------------------------------- |
| `/admin/orders/:id/riders`             | GET       | Riders in the order's area with load and why each is unavailable       |
| `/admin/orders/:id/dispatch`           | POST      | Assign a rider and send a verified order to the outlet and rider       |
| `/admin/orders/:id/assign`             | PATCH     | Reassign the rider before pickup; a sent order requests the new rider  |
| `/admin/orders/:id/remind`             | POST      | Remind the outlet while `confirmed` or `preparing`                     |
| `/admin/orders/:id/cancel-request`     | POST      | Approve (cancel) or dismiss an outlet cancellation request             |
| `/orders/:id/outlet-response`          | POST      | Outlet accepts or rejects a sent order                                 |
| `/orders/:id/rider-response`           | POST      | Rider accepts or declines a delivery request                           |
| `/orders/:id/cancel-request`           | POST      | Outlet asks Dellvit to cancel a confirmed or preparing order           |
| `/orders/:id/status`                   | PATCH     | `preparing`, `ready`, `picked_up` or `cancelled` (with `reason`)       |
| `/admin/summary?from&to`               | GET       | Sales, deductions, commissions, statuses and items needing attention   |
| `/admin/payments/:id/refund`           | PATCH     | Record a refund for a cancelled paid order                             |
| `/manage/outlet/summary?from&to`       | GET       | Outlet dashboard figures, top products and low stock                   |
| `/manage/outlet/settlements`           | GET       | Outlet's delivered-order earnings                                      |
| `/manage/outlet/settings`              | PATCH     | Outlet pauses or resumes new orders                                    |
| `/rider/cash?from&to`                  | GET       | Rider COD position, collections and submissions                        |
| `/rider/cash/deposits`                 | POST      | Submit collected cash for verification                                 |
| `/rider/cash/deposits/:id`             | DELETE    | Withdraw a pending submission                                          |
| `/rider/earnings?from&to`              | GET       | Balance, ranged earnings/payouts, payout details and requests          |
| `/rider/payout-requests`               | POST      | Request a payout up to the available balance                           |
| `/rider/payout-requests/:id`           | DELETE    | Withdraw a pending request                                             |
| `/admin/cash?from&to`                  | GET       | All riders' cash positions and submissions (Riders module)             |
| `/admin/cash/riders/:id`               | GET       | One rider's cash transactions                                          |
| `/admin/cash/deposits/:id`             | PATCH     | Verify or reject a cash submission                                     |
| `/admin/payouts?from&to`               | GET       | Payout requests, payout history and rider balances (Riders module)     |
| `/admin/payouts/requests/:id`          | POST      | Approve (pay) or reject a payout request                               |
| `/admin/riders/:id/payouts`            | POST      | Direct payout with `method` and `reference`                            |

New tables: `order_flow`, `order_settlements`, `outlet_settings`, `cod_deposits`, `payout_requests`. New columns: `order_events.note`, `order_events.actor`, and `rider_payouts.method`, `reference`, `type`, `status`. All are added in place on startup.
