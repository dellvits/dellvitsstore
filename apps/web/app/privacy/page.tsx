import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description: 'How Dellvit collects, uses, shares and protects your information on the website and in the Dellvit app.',
  alternates: { canonical: '/privacy' },
};

const updated = '17 October 2026';
const email = 'dellvitsupport@gmail.com';

/**
 * The privacy policy for the website and the Android app (Google Play links here). Plain server-
 * rendered text with no data loading, so it opens for everyone, also during maintenance.
 * Keep it in step with what the app really collects: Google rejects policies that do not.
 */
export default function PrivacyPolicy() {
  return (
    <div className="container page legal">
      <span className="eyebrow">Legal</span>
      <h1>Privacy policy</h1>
      <p className="legal-meta">Last updated: {updated}</p>

      <p>
        This policy explains what information Dellvit collects when you use our website{' '}
        <Link href="/">dellvit.com</Link> and the Dellvit app for Android, how we use and share it, and the choices you
        have. It applies to customers, guests who use Dellvit without an account, delivery riders and partner outlets.
      </p>

      <nav className="legal-toc" aria-label="On this page">
        <a href="#collect">Information we collect</a>
        <a href="#use">How we use it</a>
        <a href="#share">Who we share it with</a>
        <a href="#location">Location</a>
        <a href="#notifications">Notifications</a>
        <a href="#cookies">Cookies and analytics</a>
        <a href="#security">Storage and security</a>
        <a href="#retention">How long we keep it</a>
        <a href="#choices">Your choices</a>
        <a href="#delete-account">Delete your account</a>
        <a href="#children">Children</a>
        <a href="#contact">Contact us</a>
      </nav>

      <h2>Who we are</h2>
      <p>
        Dellvit is a local delivery service in Pakistan. It connects customers with outlets (shops, kitchens and stores)
        and delivery riders. In this policy, &ldquo;Dellvit&rdquo;, &ldquo;we&rdquo; and &ldquo;us&rdquo; mean the
        Dellvit service. You can reach us at <a href={'mailto:' + email}>{email}</a>.
      </p>

      <h2 id="collect">Information we collect</h2>
      <h3>Information you give us</h3>
      <ul>
        <li>
          <strong>Account details:</strong> your name, email address, phone number, delivery address and delivery area,
          and your password (stored only in a scrambled, one-way form we cannot read).
        </li>
        <li>
          <strong>Orders:</strong> the products you order, the outlet, the delivery address and map pin, delivery notes,
          the payment method you choose and your order history.
        </li>
        <li>
          <strong>Payment proofs:</strong> if you pay by bank transfer or mobile wallet, the screenshot or reference you
          upload so our team can confirm the payment. We do not collect or store card numbers.
        </li>
        <li>
          <strong>Messages:</strong> what you send through support chat (including files you attach) and the contact
          form.
        </li>
        <li>
          <strong>Riders:</strong> vehicle type and number, CNIC and driving licence numbers, an emergency contact, and
          the account details used to pay your earnings.
        </li>
        <li>
          <strong>Outlets:</strong> business and contact details, addresses, product information and photos, and the
          documents we ask for to verify the outlet.
        </li>
      </ul>
      <h3>Information collected automatically</h3>
      <ul>
        <li>
          <strong>Location:</strong> see <a href="#location">Location</a> below.
        </li>
        <li>
          <strong>Device and notification details:</strong> a notification token from Google Firebase Cloud Messaging
          for your phone, or a push subscription for your browser, so we can send you notifications.
        </li>
        <li>
          <strong>Basic technical information:</strong> such as your IP address, browser or device type and the time of
          your requests, which our servers record to keep the service working and secure.
        </li>
        <li>
          <strong>Preferences on your device:</strong> your cart, chosen delivery area, theme and which announcements you
          have read are kept on your phone or in your browser.
        </li>
      </ul>

      <h2 id="use">How we use your information</h2>
      <ul>
        <li>To create and manage your account and sign you in.</li>
        <li>To take your orders, pass them to the outlet and a rider, deliver them and confirm the handover.</li>
        <li>To check and record payments, and to pay riders and outlets what they have earned.</li>
        <li>To show the outlets and products available in your delivery area.</li>
        <li>To send you order updates, verification codes, support replies and announcements from Dellvit.</li>
        <li>To answer your questions and resolve problems with orders.</li>
        <li>To keep Dellvit safe: preventing fraud and abuse, and protecting our users and partners.</li>
        <li>To understand how Dellvit is used and improve it.</li>
      </ul>
      <p>We do not sell your personal information.</p>

      <h2 id="share">Who we share it with</h2>
      <ul>
        <li>
          <strong>The outlet you order from</strong> receives your order and the details it needs to prepare it.
        </li>
        <li>
          <strong>The rider who delivers your order</strong> receives your name, phone number, delivery address and map
          pin. While an order is on its way, you can see the rider&rsquo;s location.
        </li>
        <li>
          <strong>Service providers</strong> who run parts of Dellvit for us, only as needed for that work: Supabase
          (database), Vercel (website and server hosting), Cloudflare (storage of images and uploaded files), Google
          Firebase (phone notifications), our email provider (sending emails such as verification codes) and
          OpenStreetMap (map images, which receive your IP address when a map loads).
        </li>
        <li>
          <strong>When the law requires it</strong>, or to protect the rights, safety and property of Dellvit, our users
          or others.
        </li>
      </ul>

      <h2 id="location">Location</h2>
      <ul>
        <li>
          <strong>Customers:</strong> with your permission, the app uses your phone&rsquo;s location to find your
          delivery area and to pin your delivery address. You can choose your area and address by hand instead.
        </li>
        <li>
          <strong>Riders:</strong> when you are on duty and switch on location sharing, the app sends your live location
          to Dellvit every few seconds, also when the app is in the background or the screen is off (Android shows a
          notification while this is on). It is recorded only while you have a delivery in hand, so the customer can
          follow their order and our team can manage deliveries. Sharing stops when you switch it off or go off duty.
        </li>
      </ul>
      <p>You can turn off location access at any time in your phone&rsquo;s settings.</p>

      <h2 id="notifications">Notifications</h2>
      <p>
        With your permission we send notifications about your orders, payments, earnings and support replies, and
        announcements from Dellvit. You can choose which kinds pop up in Notification settings, or turn notifications off
        for Dellvit in your phone or browser settings.
      </p>

      <h2 id="cookies">Cookies and analytics</h2>
      <p>
        The website uses a cookie to keep you signed in and stores your cart and preferences in your browser. If they are
        switched on, the website may also use Google Analytics and the Meta Pixel to measure visits and the results of
        our advertising; these services may set their own cookies. You can block or delete cookies in your browser
        settings, though signing in needs the session cookie. The app does not use these analytics tools.
      </p>

      <h2 id="security">Storage and security</h2>
      <p>
        Information is sent over encrypted connections (HTTPS) and stored with our service providers, whose servers may
        be outside Pakistan. Passwords are stored in a one-way scrambled form, and uploaded payment proofs and documents
        are kept private. Access to personal information inside Dellvit is limited to the staff who need it. No system is
        completely secure, so please keep your password private.
      </p>

      <h2 id="retention">How long we keep it</h2>
      <p>
        We keep your account information while your account is open. When an account is deleted, we remove or anonymise
        your personal details, but we keep order, payment and payout records for as long as accounting, tax and legal
        rules require, and to resolve disputes.
      </p>

      <h2 id="choices">Your choices</h2>
      <ul>
        <li>You can see and change your name, phone number and address in your profile.</li>
        <li>You can change your password and sign out of other devices.</li>
        <li>You can choose which notifications pop up, and turn location and notifications off in your phone settings.</li>
        <li>You can ask us for a copy of your information, to correct it, or to delete it.</li>
      </ul>

      <h2 id="delete-account">Delete your account</h2>
      <p>You can ask us to delete your Dellvit account and its personal information at any time:</p>
      <ol>
        <li>
          In the app or on the website, open <strong>Support chat</strong> and write &ldquo;Delete my account&rdquo;, or
        </li>
        <li>
          Email <a href={'mailto:' + email + '?subject=Delete%20my%20Dellvit%20account'}>{email}</a> with the subject
          &ldquo;Delete my account&rdquo; from the email address of your account.
        </li>
      </ol>
      <p>
        We may ask you to confirm the request. We delete the account and its personal details within 30 days. Orders that
        are still in progress, and money a rider or outlet is still owed, are settled first. As explained above, order and
        payment records that the law requires us to keep are kept without your contact details.
      </p>

      <h2 id="children">Children</h2>
      <p>
        Dellvit is not meant for children under 13, and we do not knowingly collect information from them. If you
        believe a child has given us information, contact us and we will delete it.
      </p>

      <h2>Changes to this policy</h2>
      <p>
        We may update this policy as Dellvit changes. We will change the date at the top, and tell you in the app or by
        email about important changes.
      </p>

      <h2 id="contact">Contact us</h2>
      <p>
        Questions about this policy or your information: email <a href={'mailto:' + email}>{email}</a>, use support
        chat in the app, or visit our <Link href="/contact">contact page</Link>.
      </p>
    </div>
  );
}
