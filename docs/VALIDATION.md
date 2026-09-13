# Validation record

Validated during the September 2026 build session using Node.js 24.19.0.

## Automated gates

- `npm run build`: Express TypeScript compilation and optimized Next.js 16.3.4 webpack build.
- `npm run typecheck`: frontend and backend TypeScript checks.
- `npm test`: 13 workflow/authorization subtests plus their parent test, 14 reported passes.

The integration suite creates a temporary SQLite database and upload directory and removes them after testing. It dispatches real HTTP-shaped requests through the Express application without opening a listening network port. These tests exercise middleware, route validation, database queries and file handling; they are not mocks of the business logic.

## Coverage

1. Location/category/search filtering using stored catalogue records.
2. Anonymous session order isolation and rejection of unapproved browser origins.
3. Server-controlled pricing, stock reservation, automatic rider assignment and idempotent checkout retry.
4. Invalid stock quantities, mixed outlets, wrong delivery area and out-of-area map pin rejection.
5. Cross-outlet/rider access rejection and customer OTP concealment from staff.
6. Full preparation, pickup, incorrect-OTP lockout, expiry, cash-confirmation requirement and completed-delivery lifecycle.
7. Cancellation stock restoration exactly once.
8. Outlet product ownership, creation, edit, archive and restore.
9. Admin creation of outlet credentials and rider accounts.
10. Admin-only document upload/download/delete and denial through the public media route.
11. Product image conversion and public WebP retrieval.
12. Contact inbox, editable advertising, script-link rejection and delivery-area persistence.
13. Registration, profile updates, password rotation and logout invalidation.

## Asset and source checks

Generated hero and rider artwork were inspected. Category artwork was inspected and split from the generated atlas. All integrated raster artwork and supplied logos are WebP. The original client inputs are unchanged. The ZIP excludes databases, uploaded private documents, sessions, dependencies and build output.

## Limits

No browser automation, screenshot-based layout testing, physical-device testing, production deployment, real merchant delivery, payment provider integration or external map-service availability test was performed. Responsive styling includes desktop, tablet, mobile, small-screen and reduced-motion rules, but a client acceptance pass on target devices is still needed.
