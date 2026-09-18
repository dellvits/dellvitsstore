# Validation record

Current revision: September 14, 2026, Node.js 24.16.0 on Windows.

## Automated checks

- API and web TypeScript checks pass.
- Express compilation and Next.js production webpack build pass.
- API integration suite: 22 tests reported, all pass.
- The test runner requires an unrestricted local process in this environment because the Windows sandbox fails the OS user lookup used by tsx. The tests themselves use a temporary database and upload folder and remove them afterwards.

Coverage includes the original order lifecycle, stock and checkout idempotency, guest isolation, outlet/rider ownership, OTP lockout, private documents, image conversion, account changes, and new platform controls:

- Separate administrator sign-in and rejection of the wrong account type.
- Server-enforced module permissions and rejection of privilege escalation.
- Staff-session invalidation after permission changes.
- Dynamic category visibility and rejection of unsafe content links.
- Store checkout pause, minimum subtotal, and public support settings.
- Coupon redemption limits, exact discounts, per-area fees, paused-area rejection, and disabled payment method rejection.
- Manual-transfer confirmation before delivery completion.
- Rider location ownership, customer isolation, and hiding positions on terminal orders.
- Dispatch availability/capacity settings and administrator audit records.

## Browser checks

Used headless Microsoft Edge against a production web preview on port 3100 and an isolated API/database on port 4100. The preview fixtures were stored only in the ignored `data/ux-review` directory.

- Desktop storefront and administrator overview checked at 1440 x 1000.
- Storefront, separate admin login, administrator overview and permission modal checked at 390 x 844.
- New admin modules opened successfully without API error panels: staff, categories, content, coupons, payments, settings, areas, riders, and customers.
- Customer account, checkout, and rider workspace checked at 390 x 844.
- No horizontal document overflow on these routes. Sidebar navigation and maps use their own internal scrolling/clipping.
- No JavaScript runtime exceptions reported during these checks.
- Checkout loaded live payment methods and a server quote and enabled submission once ready.
- Screenshots exposed an incorrect category image fallback, which was corrected to use the uploaded image path directly or the brand icon. Remaining COD-only order labels were replaced by the stored payment name and status.
- Hero screenshot inspected: irregular feathered edges blend into the page while the main phone, food, and parcel artwork remains sharp.

These checks do not claim physical-device GPS, background mobile tracking, real bank transaction verification, external payment gateway integration, accessibility certification, or production load testing. Browser location sharing depends on an open rider page, browser permission, and HTTPS in production. Road maps depend on external map and routing services.
