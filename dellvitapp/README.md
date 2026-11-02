# Dellvit Android app

The Flutter app for the Dellvit delivery platform. Package name: `com.dellvit.intelloplex`.

It uses the **same database as the website**. The app never connects to Supabase itself: it calls the
Express API in `apps/api` (the same one the website calls), so orders, products, accounts and
payments are shared. The app signs in with a bearer token (`X-Client: mobile`), kept in the phone's
secure storage.

## Who can use it

| Account  | Sign in with         | What they get                                                        |
| -------- | -------------------- | -------------------------------------------------------------------- |
| Guest    | nothing              | Browse products and outlets, fill a cart                             |
| Customer | email + password     | Checkout, order tracking, delivery code, payments, support chat      |
| Rider    | rider ID + password  | Delivery requests, pickup, OTP delivery, live location, cash, payouts |
| Outlet   | outlet ID + password | Accept and prepare orders, manage products, sales figures            |

Administrators keep using the website (`/admin`). The API refuses administrator sign-in from the app.

## Run it

```powershell
cd dellvitapp
flutter pub get
flutter run                       # uses https://www.dellvit.com
```

To use another server, for example the API on your own computer (the emulator reaches it at
`10.0.2.2`):

```powershell
flutter run --dart-define=DELLVIT_ORIGIN=http://10.0.2.2:3000
```

`DELLVIT_ORIGIN` is the website address without `/api`. Product pictures and payment logos are loaded
from the same address.

## Build

```powershell
flutter build apk --release        # build\app\outputs\flutter-apk\app-release.apk
flutter build appbundle --release  # for Google Play
```

The release build is signed with the debug key until you add your own keystore in
`android/app/build.gradle.kts`. Google Play needs your own key.

## Icon and launch screen

The brand pictures in `assets/brand` were made from `apps/web/public/images`. After changing them:

```powershell
dart run flutter_launcher_icons
dart run flutter_native_splash:create
```

## Where things are

```text
lib/
  main.dart            App start and the gate that picks the right workspace
  core/                API client, theme (the website's colours), formatting, location, links
  models/              Data the API returns: products, orders, areas, payment methods
  state/app_state.dart Session, delivery area, cart, store settings, notifications
  widgets/             Shared parts: cards, buttons, maps, product tiles, payment fields
  screens/
    splash_screen.dart, onboarding_screen.dart
    auth/              Log in, sign up, email code
    customer/          Home, search, outlets, product, cart, checkout, orders, order tracking
    shared/            Account, profile, password & devices, notifications, support chat, about, contact
    staff/             Order list, order page and actions for outlets and riders
    rider/             Dashboard, duty and live location, COD cash, earnings and payouts
    outlet/            Dashboard, products and the product form
```

## Notes

- Notifications are read from the server every 15 seconds while the app is open. The API sends Web
  Push only, so the app does not get pop-ups when it is closed. That needs Firebase Cloud Messaging
  and a small addition to `apps/api/src/notifications.ts`.
- Maps use OpenStreetMap tiles, like the website.
- Chat attachments: pictures can be sent and viewed. PDF documents open on the website.
