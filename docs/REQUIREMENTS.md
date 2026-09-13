# Client requirements mapping

| Supplied requirement                                                | Implemented location / behaviour                                                                |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Supplied design and branding                                        | Branded responsive home, supplied logo, WebP images, service cards, process steps and ad banner |
| Header Search, Cart, Orders, Outlets, About, Contact, Login, Signup | Global header and mobile navigation                                                             |
| Location changes products/outlets                                   | Area selector, query filtering and checkout area validation                                     |
| Client contact information                                          | Footer, contact page and phone/email links                                                      |
| Click product image for details                                     | `/products/:id`, price/quantity/includes/excludes/time and basket actions                       |
| Delivery details alongside product                                  | Product sidebar previews customer details; checkout edits the full delivery form                |
| Populate account delivery details                                   | Customer profile fills checkout form                                                            |
| Order-only address change                                           | Separate delivery snapshot stored in orders; profile is never overwritten by checkout           |
| Notes                                                               | Checkout notes saved with the order and visible to customer, assigned rider and relevant staff  |
| Admin creates outlets                                               | Name, phone, email, area, address, coordinates and unique customer/login ID                     |
| Outlet login with customer ID/password                              | Shared login endpoint and outlet portal                                                         |
| Outlet can add/remove own products                                  | Ownership-checked create/edit/archive/restore endpoints                                         |
| Private admin documents                                             | PDF uploads, download and deletion, admin authorization for all routes                          |
| Product quantity/images/price/location/discounts/deals              | Product manager plus server conversion of uploads to WebP                                       |
| Assign rider when order arrives                                     | Least-loaded active rider in matching area; pending/manual assignment when unavailable          |
| Rider pickup/drop details                                           | Delivery panel and map with both locations                                                      |
| Rider COD collection amount                                         | Exact order total displayed; collection confirmation required before completion                 |
| Rider route and time remaining                                      | OSRM route on OpenStreetMap, navigation link, countdown; route fallback clearly labelled        |
| Customer order reference and OTP                                    | Unique order reference and six-digit OTP on customer order page                                 |
| Rider verifies delivery with customer OTP                           | Assigned rider only, picked-up status required, attempt lockout, correct OTP completes delivery |
| Replace app download section with advertising                       | Admin-editable homepage advertisement                                                           |
| Flutter later, shared database                                      | Express API boundary and documented mobile bearer authentication                                |

## Scope decisions

- Cash on delivery is the implemented payment method; no online payment provider was supplied.
- Demo delivery areas include 6th Road, Satellite Town and F-10. Admins can create additional areas and list products accordingly.
- An order includes one outlet; a multi-outlet logistics/cart flow was not specified.
- Routing services and basemap providers need connectivity. This web version does not stream rider GPS.
- Advertising is a directly managed content slot. Ad-network billing, scripts and reporting require the client's provider/account choice.
- Password reset is available to admins when editing outlet/rider accounts. Customers can change passwords while signed in; recovery by email/SMS is a future provider integration.
