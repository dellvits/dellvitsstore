import { atomicRoute } from './atomic-route.js';
import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { all, one, run, transaction, type Row } from './db.js';
import { requireRole, hashPassword, accessRow, isOwner, type AuthRequest } from './security.js';
import { range, between } from './range.js';

export const permissions = [
  'overview',
  'orders',
  'products',
  'outlets',
  'riders',
  'locations',
  'ads',
  'messages',
  'categories',
  'content',
  'coupons',
  'payments',
  'customers',
  'audit',
  'settings',
] as const;
export async function access(user?: Row) {
  const a = await accessRow(user);
  return {
    is_super_admin: !!a?.super,
    permissions: a ? (JSON.parse(a.permissions) as string[]) : [],
  };
}
export async function can(user: Row | undefined, permission: string) {
  const a = await access(user);
  return a.is_super_admin || a.permissions.includes(permission);
}
export async function records(kind: string, activeOnly = false): Promise<Row[]> {
  return (await all('SELECT * FROM platform_records WHERE kind=?', kind))
    .map((r) => ({ ...JSON.parse(r.data), id: r.id }))
    .filter((r) => !activeOnly || r.active)
    .sort((a, b) => (a.position || 0) - (b.position || 0));
}
/** Enabled home page content that is inside its schedule right now. */
export async function publicContent() {
  const at = new Date().toISOString();
  return (await records('content', true)).filter(
    (c) => (!c.starts_at || c.starts_at <= at) && (!c.ends_at || c.ends_at > at),
  );
}
/** The date in Pakistan, as YYYY-MM-DD; advertising figures are counted per day. */
export const adDay = (at: Date | string = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date(at));
/**
 * Ads the storefront may show right now: enabled, inside their schedule and under their view
 * limit. Campaign details that only administrators need are left out.
 */
export async function publicAds() {
  const at = new Date().toISOString();
  const live = (await records('ads', true)).filter(
    (a) => (!a.starts_at || a.starts_at <= at) && (!a.ends_at || a.ends_at > at),
  );
  const capped = live.filter((a) => a.max_views > 0);
  const seen = new Map<string, number>(
    capped.length
      ? (
          await all(
            `SELECT ad_id,SUM(views) views FROM ad_stats WHERE ad_id IN (${capped.map(() => '?').join(',')}) GROUP BY ad_id`,
            ...capped.map((a) => a.id),
          )
        ).map((r) => [r.ad_id, Number(r.views)])
      : [],
  );
  return live
    .filter((a) => !(a.max_views > 0) || (seen.get(a.id) || 0) < a.max_views)
    .map(({ name, advertiser, notes, max_views, active, ...a }) => a);
}
/** Enabled categories for the storefront, without the commission only administrators may read. */
export const publicCategories = async () =>
  (await records('categories', true)).map(({ commission_rate, ...c }) => c);
/** All categories for the admin panel, with how many products and outlets use each one. */
async function adminCategories() {
  const count = async (table: string) =>
    new Map(
      (await all(`SELECT category,COUNT(*) n FROM ${table} GROUP BY category`)).map((r) => [
        r.category,
        r.n,
      ]),
    );
  const [list, products, outlets] = await Promise.all([
    records('categories'),
    count('products'),
    count('outlets'),
  ]);
  return list.map(
    (c): Row => ({ ...c, products: products.get(c.name) || 0, outlets: outlets.get(c.name) || 0 }),
  );
}
/** An area without a settings row yet has these. Money is in paisa. */
const areaDefaults = {
  active: 1,
  radius: 8,
  fee: 15000,
  minimum_order: 0,
  free_delivery_over: 0,
  opens_at: '',
  closes_at: '',
};
type AreaSettings = typeof areaDefaults;
/** Area settings with their defaults, for queries that join area_settings as `a`. */
export const areaColumns = Object.entries(areaDefaults)
  .map(([k, v]) => `COALESCE(a.${k},${typeof v === 'number' ? v : `'${v}'`}) ${k}`)
  .join(',');
export async function areaSettings(id: string): Promise<AreaSettings> {
  return {
    ...areaDefaults,
    ...(await one('SELECT * FROM area_settings WHERE location_id=?', id)),
  };
}
/** What delivery costs for an order of this subtotal: nothing once it reaches the free threshold. */
export const deliveryFee = (area: AreaSettings, subtotal: number) =>
  area.free_delivery_over > 0 && subtotal >= area.free_delivery_over ? 0 : area.fee;
const time = z.union([z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), z.literal('')]);
/** The settings an administrator can change on a delivery area; every one is optional. */
export const areaFields = {
  active: z.boolean().optional(),
  radius: z.number().min(0.1).max(100).optional(),
  fee: z.number().int().min(0).max(10000000).optional(),
  minimum_order: z.number().int().min(0).max(10000000).optional(),
  free_delivery_over: z.number().int().min(0).max(100000000).optional(),
  opens_at: time.optional(),
  closes_at: time.optional(),
};
/** Saves the settings given and keeps the rest as they are. */
export async function saveAreaSettings(
  id: string,
  s: Partial<Omit<AreaSettings, 'active'>> & { active?: boolean },
) {
  const next: AreaSettings = { ...(await areaSettings(id)) };
  for (const key of Object.keys(areaDefaults) as (keyof AreaSettings)[])
    if (s[key] !== undefined) (next as Row)[key] = key === 'active' ? Number(s.active) : s[key];
  const problem =
    !next.opens_at !== !next.closes_at
      ? 'Set both an opening and a closing time, or leave both empty.'
      : next.opens_at && next.opens_at === next.closes_at
        ? 'Opening and closing times must differ.'
        : '';
  if (problem) throw Object.assign(new Error(problem), { status: 400 });
  const keys = Object.keys(areaDefaults) as (keyof AreaSettings)[];
  await run(
    `INSERT INTO area_settings(location_id,${keys.join(',')}) VALUES(?,${keys.map(() => '?').join(',')}) ON CONFLICT(location_id) DO UPDATE SET ${keys.map((k) => `${k}=excluded.${k}`).join(',')}`,
    id,
    ...keys.map((k) => next[k]),
  );
}
/** The payment types checkout offers, in the order it lists them. */
export const paymentTypes = ['cod', 'bank', 'wallet', 'raast'] as const;
/**
 * Fields left on older payment records by the removed card integration and display order. They are
 * never sent out, so records saved before the cleanup migration ran stay clean too.
 */
const retiredPaymentKeys = [
  'position',
  'card_networks',
  'gateway',
  'environment',
  'merchant_id',
  'public_key',
  'secret_key',
  'webhook_secret',
  'api_base_url',
  'three_d_secure',
];
/** Payment methods in checkout order: by type, then by name. Retired card methods are dropped. */
async function paymentRecords(activeOnly = false) {
  const rank = (t: string) => paymentTypes.indexOf((t === 'manual' ? 'bank' : t) as never);
  return (await records('payments', activeOnly))
    .filter((m) => rank(m.type) >= 0)
    .map((m) => Object.fromEntries(Object.entries(m).filter(([k]) => !retiredPaymentKeys.includes(k))))
    .sort((a, b) => rank(a.type) - rank(b.type) || String(a.name).localeCompare(String(b.name)));
}
/** Enabled payment methods for checkout. */
export const paymentMethods = () => paymentRecords(true);
/** Every payment method, enabled or not, in checkout order. */
export const allPaymentMethods = () => paymentRecords();
/** The payment method ids a product row accepts. */
export const productPaymentIds = (p: Row): string[] => JSON.parse(p.payment_methods || '[]');
/** Enabled payment methods accepted by every one of the given products. */
export async function paymentMethodsFor(products: Row[]) {
  if (!products.length) return [];
  const lists = products.map(productPaymentIds);
  return (await paymentMethods()).filter((m) => lists.every((ids) => ids.includes(m.id)));
}
/** All payment methods for the admin panel, with how many products accept each one. */
async function adminPaymentMethods() {
  const [methods, products] = await Promise.all([
    allPaymentMethods(),
    all('SELECT payment_methods FROM products'),
  ]);
  const uses = new Map<string, number>();
  for (const p of products)
    for (const id of productPaymentIds(p)) uses.set(id, (uses.get(id) || 0) + 1);
  return methods.map((m): Row => ({ ...m, products: uses.get(m.id) || 0 }));
}
/** Removes a deleted payment method from every product that accepted it. */
async function detachPaymentMethod(id: string) {
  // LIKE narrows the scan; the exact match happens on the parsed list.
  for (const p of await all(
    'SELECT id,payment_methods FROM products WHERE payment_methods LIKE ?',
    '%' + JSON.stringify(id) + '%',
  )) {
    const ids = productPaymentIds(p);
    if (ids.includes(id))
      await run(
        'UPDATE products SET payment_methods=? WHERE id=?',
        JSON.stringify(ids.filter((x) => x !== id)),
        p.id,
      );
  }
}
const couponError = (message: string) => Object.assign(new Error(message), { status: 400 });
const rupees = (amount: number) => 'PKR ' + (amount / 100).toLocaleString('en-PK');
const inSchedule = (c: Row, at = new Date().toISOString()) =>
  (!c.starts_at || c.starts_at <= at) && (!c.ends_at || c.ends_at > at);
/**
 * The discount a coupon gives on a basket, or an error that tells the customer why it does not
 * apply. `fee` is the delivery fee, which a free-delivery coupon takes off. Limits per customer
 * and first-order coupons are checked once the customer is known.
 */
export async function couponDiscount(
  code: string,
  subtotal: number,
  context: { userId?: string; locationId?: string; fee?: number } = {},
) {
  if (!code) return { discount: 0, coupon: null };
  const c = (await records('coupons', true)).find((c) => c.code === code.trim().toUpperCase());
  const at = new Date().toISOString();
  if (!c) throw couponError('This coupon code is not valid.');
  if (c.starts_at && c.starts_at > at) throw couponError('This coupon is not active yet.');
  if (c.ends_at && c.ends_at < at) throw couponError('This coupon has expired.');
  if (c.location_ids?.length && !c.location_ids.includes(context.locationId))
    throw couponError('This coupon is not valid in your delivery area.');
  if (subtotal < c.minimum)
    throw couponError(
      `Add ${rupees(c.minimum - subtotal)} more to use this coupon. It needs a subtotal of ${rupees(c.minimum)}.`,
    );
  const uid = context.userId || '';
  const used = (await one(
    `SELECT COUNT(*) total,COUNT(*) FILTER (WHERE o.user_id=?) mine,
       (SELECT COUNT(*) FROM orders WHERE user_id=? AND status<>'cancelled') orders
     FROM coupon_uses u JOIN orders o ON o.id=u.order_id WHERE u.coupon_id=?`,
    uid,
    uid,
    c.id,
  ))!;
  if (c.limit > 0 && Number(used.total) >= c.limit)
    throw couponError('This coupon has been fully redeemed.');
  if (uid && c.per_customer > 0 && Number(used.mine) >= c.per_customer)
    throw couponError(
      c.per_customer === 1
        ? 'You have already used this coupon.'
        : `You have already used this coupon ${c.per_customer} times.`,
    );
  if (uid && c.first_order && Number(used.orders) > 0)
    throw couponError('This coupon is for your first order only.');
  if (c.type === 'delivery') return { discount: context.fee || 0, coupon: c };
  let discount = c.type === 'percent' ? Math.round((subtotal * c.value) / 100) : c.value;
  if (c.type === 'percent' && c.max_discount > 0) discount = Math.min(discount, c.max_discount);
  return { discount: Math.min(subtotal, discount), coupon: c };
}
const text = z.string().trim().min(1).max(200);
const contentTypes = ['hero', 'section', 'banner', 'announcement', 'embed'] as const;
const contentPlacements = ['top', 'after_nearby', 'after_categories', 'after_outlets', 'bottom'] as const;
/** Keep in sync with embedSource in apps/web/components/ContentBlocks.tsx */
const videoAddress =
  /^https:\/\/(www\.youtube\.com\/(watch\?v=|shorts\/|embed\/)|youtu\.be\/|(www\.)?vimeo\.com\/|player\.vimeo\.com\/video\/)[\w-]+/;
const image = z
  .string()
  .max(500)
  .refine(
    (v) => !v || /^\/(images|api\/media)\/[\w.-]+\.(webp|png|jpg|jpeg)$/.test(v),
    'Upload a local image.',
  );
const link = z
  .string()
  .max(500)
  .refine((v) => !v || /^\/(?!\/)[\w/?=&%#.-]*$/.test(v), 'Use a website path, such as /search.');
/** Ads may also lead to another website, over HTTPS only. */
const adLink = z
  .string()
  .trim()
  .max(500)
  .refine(
    (v) => !v || /^\/(?!\/)[\w/?=&%#.-]*$/.test(v) || /^https:\/\/[^\s<>"']+$/.test(v),
    'Use a website path such as /search, or a full https:// address.',
  );
const adFormats = ['banner', 'cover', 'strip', 'card', 'image'] as const;
const adPlacements = [...contentPlacements, 'search', 'search_inline', 'outlets', 'outlet', 'product'] as const;
/** A link to another website, for the store's social pages; empty when there is none. */
const webLink = z
  .string()
  .trim()
  .max(300)
  .refine((v) => !v || /^https:\/\/[^\s<>"']+$/.test(v), 'Use a full https:// address.')
  .default('');
/** A verification code; when the whole <meta> tag is pasted, only its content is kept. */
const verification = z
  .preprocess(
    (v) =>
      typeof v === 'string'
        ? (/content\s*=\s*["']([^"']*)["']/i.exec(v)?.[1] ?? v).trim()
        : v,
    z
      .string()
      .max(200)
      .refine((v) => !v || /^[\w.+/=-]{4,200}$/.test(v), 'Paste the verification code or its <meta> tag.'),
  )
  .default('');
/** A tracking ID; when a whole snippet is pasted, the ID is picked out of it. */
const trackingId = (id: RegExp, message: string) =>
  z
    .preprocess(
      (v) => (typeof v === 'string' ? (id.exec(v.toUpperCase())?.[0] ?? v.trim()) : v),
      z
        .string()
        .max(40)
        .refine((v) => !v || new RegExp(`^${id.source}$`).test(v), message),
    )
    .default('');
/** The settings rendered into the <head> of every storefront page. */
export const headFields = [
  'google_site_verification',
  'bing_site_verification',
  'google_analytics_id',
  'google_tag_manager_id',
  'facebook_pixel_id',
  'custom_head_code',
] as const;
const base = {
  active: z.boolean().default(true),
  position: z.number().int().min(0).max(999).default(0),
};
const schemas: Record<string, z.ZodType> = {
  settings: z.object({
    ...base,
    name: text,
    support_email: z.email(),
    support_phone: z.string().regex(/^\+?[\d ()-]{7,20}$/),
    support_address: z.string().max(500),
    about_title: text,
    about_description: z.string().max(4000),
    checkout_enabled: z.boolean(),
    minimum_order: z.number().int().min(0).max(10000000),
    show_trust: z.boolean(),
    show_categories: z.boolean(),
    show_nearby: z.boolean(),
    show_how: z.boolean(),
    show_why: z.boolean(),
    show_ad: z.boolean(),
    show_outlets: z.boolean().default(true),
    show_category_products: z.boolean().default(true),
    // Brand and contact details shown in the footer and on the contact page.
    tagline: z.string().trim().max(120).default(''),
    support_hours: z.string().trim().max(120).default(''),
    whatsapp: z
      .string()
      .trim()
      .max(20)
      .refine((v) => !v || /^\+?[\d ()-]{7,20}$/.test(v), 'Enter a valid WhatsApp number.')
      .default(''),
    facebook_url: webLink,
    instagram_url: webLink,
    tiktok_url: webLink,
    youtube_url: webLink,
    footer_note: z.string().trim().max(200).default(''),
    // A bar across the top of every storefront page.
    notice_enabled: z.boolean().default(false),
    notice: z.string().trim().max(200).default(''),
    // What customers read while ordering is paused.
    checkout_message: z.string().trim().max(300).default(''),
    // Whether new customers may create accounts, use the contact form and the support chat.
    signup_enabled: z.boolean().default(true),
    contact_form_enabled: z.boolean().default(true),
    chat_enabled: z.boolean().default(true),
    chat_greeting: z.string().trim().max(300).default(''),
    // Search engine verification and analytics, added to the <head> of every page.
    google_site_verification: verification,
    bing_site_verification: verification,
    google_analytics_id: trackingId(/(?:G|AW|DC)-[A-Z0-9]{4,20}/, 'Use a Google ID such as G-ABC123XYZ.'),
    google_tag_manager_id: trackingId(/GTM-[A-Z0-9]{4,12}/, 'Use a Tag Manager ID such as GTM-ABC1234.'),
    facebook_pixel_id: trackingId(/\d{6,20}/, 'Use the Pixel ID, a long number such as 123456789012345.'),
    custom_head_code: z.string().max(20000).default(''),
  }),
  categories: z.object({
    ...base,
    name: text,
    description: z.string().max(500).default(''),
    image,
    show_on_home: z.boolean().default(true),
    // How many products the category's home page section shows.
    home_limit: z.number().int().min(1).max(24).default(8),
    show_in_filters: z.boolean().default(true),
    // Starting commission for new outlets in this category; null leaves the platform default.
    commission_rate: z.number().min(0).max(100).nullable().default(null),
  }),
  content: z
    .object({
      ...base,
      name: text,
      type: z.enum(contentTypes),
      description: z.string().max(2000).default(''),
      image: image.default(''),
      link: link.default(''),
      button: z.string().max(80).default('Explore'),
      // A small label above the headline.
      eyebrow: z.string().trim().max(80).default(''),
      layout: z.enum(['image-right', 'image-left', 'image-background', 'centered']).default('image-right'),
      theme: z.enum(['light', 'soft', 'brand', 'dark', 'warm']).default('light'),
      // Where on the home page the block sits; heroes and announcements have fixed places.
      placement: z.enum(contentPlacements).default('after_outlets'),
      devices: z.enum(['all', 'desktop', 'mobile']).default('all'),
      // Delivery areas the block is shown in; empty means every area.
      location_ids: z.array(z.string().max(100)).max(200).default([]),
      starts_at: z.union([z.iso.datetime(), z.literal('')]).default(''),
      ends_at: z.union([z.iso.datetime(), z.literal('')]).default(''),
      // A YouTube or Vimeo page address, for video blocks.
      embed_url: z
        .string()
        .trim()
        .max(300)
        .default('')
        .refine((v) => !v || videoAddress.test(v), 'Use a YouTube or Vimeo video link.'),
    })
    .refine((v) => !v.starts_at || !v.ends_at || v.ends_at > v.starts_at, 'End must follow start.')
    .refine((v) => v.type !== 'embed' || !!v.embed_url, 'Add the video link.'),
  ads: z
    .object({
      ...base,
      // The campaign name administrators see; customers see the headline.
      name: text,
      advertiser: z.string().trim().max(120).default(''),
      label: z.string().trim().max(40).default(''),
      title: z.string().trim().max(120).default(''),
      description: z.string().trim().max(300).default(''),
      image: image.default(''),
      link: adLink.default(''),
      button: z.string().trim().max(40).default(''),
      format: z.enum(adFormats).default('banner'),
      theme: z.enum(['light', 'soft', 'brand', 'dark', 'warm']).default('brand'),
      // Every place the ad is shown: slots on the home page, the search page, the outlets page.
      placements: z.array(z.enum(adPlacements)).min(1, 'Choose where the ad is shown.').max(adPlacements.length),
      devices: z.enum(['all', 'desktop', 'mobile']).default('all'),
      // Delivery areas the ad is shown in; empty means every area.
      location_ids: z.array(z.string().max(100)).max(200).default([]),
      starts_at: z.union([z.iso.datetime(), z.literal('')]).default(''),
      ends_at: z.union([z.iso.datetime(), z.literal('')]).default(''),
      // The ad stops once it has been seen this many times; 0 means no limit.
      max_views: z.number().int().min(0).max(1000000000).default(0),
      notes: z.string().max(1000).default(''),
    })
    .refine((v) => !v.starts_at || !v.ends_at || v.ends_at > v.starts_at, 'End must follow start.')
    .refine((v) => (v.format === 'image' ? !!v.image : !!v.title), 'Add a headline, or a picture for a picture-only ad.')
    .refine((v) => v.format !== 'cover' || !!v.image, 'A cover ad needs a picture.')
    .transform((v) => ({ ...v, placements: [...new Set(v.placements)] })),
  coupons: z
    .object({
      ...base,
      name: text,
      code: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z0-9_-]{3,30}$/),
      // `delivery` takes the delivery fee off; its value is not used.
      type: z.enum(['percent', 'fixed', 'delivery']),
      value: z.number().int().min(0).max(10000000),
      // The most a percentage coupon may take off; 0 means no cap.
      max_discount: z.number().int().min(0).max(10000000).default(0),
      minimum: z.number().int().min(0),
      // Redemptions allowed in total and for each customer; 0 means unlimited.
      limit: z.number().int().min(0).max(1000000),
      per_customer: z.number().int().min(0).max(1000).default(0),
      first_order: z.boolean().default(false),
      // Delivery areas the coupon works in; empty means every area.
      location_ids: z.array(z.string().max(100)).max(200).default([]),
      // Listed at checkout as an offer the customer can apply with one tap.
      public: z.boolean().default(false),
      description: z.string().trim().max(200).default(''),
      starts_at: z.union([z.iso.datetime(), z.literal('')]),
      ends_at: z.union([z.iso.datetime(), z.literal('')]),
    })
    .refine((v) => v.type === 'delivery' || v.value > 0, 'Enter the discount.')
    .refine((v) => v.type !== 'percent' || v.value <= 100, 'Percent must be 100 or less.')
    .refine((v) => !v.starts_at || !v.ends_at || v.ends_at > v.starts_at, 'End must follow start.'),
  payments: z
    .object({
      // Checkout lists methods by type and name, so payment methods have no display order.
      active: base.active,
      name: text,
      type: z.enum(paymentTypes),
      logo: image.default(''),
      instructions: z.string().max(2000).default(''),
      bank_name: z.string().trim().max(100).default(''),
      account_title: z.string().trim().max(100).default(''),
      account_number: z
        .string()
        .max(40)
        .default('')
        .transform((v) => v.replace(/[\s-]/g, '')),
      iban: z
        .string()
        .max(40)
        .default('')
        .transform((v) => v.replace(/\s/g, '').toUpperCase()),
      branch_code: z.string().trim().max(20).default(''),
      provider: z.string().trim().max(40).default(''),
      mobile_number: z.string().max(20).default('').transform(pkMobile),
      raast_id: z
        .string()
        .max(40)
        .default('')
        .transform((v) =>
          /^PK/i.test(v.trim()) ? v.replace(/\s/g, '').toUpperCase() : pkMobile(v),
        ),
      require_proof: z.boolean().default(false),
    })
    .superRefine((v, ctx) => {
      const issue = (path: string, message: string) =>
        ctx.addIssue({ code: 'custom', path: [path], message });
      if (v.type === 'cod') return;
      if (!v.account_title) issue('account_title', 'Enter the account title.');
      if (v.type === 'bank') {
        if (!v.bank_name) issue('bank_name', 'Enter the bank name.');
        if (!v.account_number && !v.iban) issue('iban', 'Enter an account number or IBAN.');
        if (v.account_number && !/^\d{6,24}$/.test(v.account_number))
          issue('account_number', 'Account numbers contain 6–24 digits.');
        if (v.iban && !IBAN.test(v.iban))
          issue(
            'iban',
            'A Pakistani IBAN has 24 characters, for example PK36SCBL0000001123456702.',
          );
      }
      if (v.type === 'wallet') {
        if (!walletProviders.includes(v.provider)) issue('provider', 'Choose a wallet provider.');
        if (!MOBILE.test(v.mobile_number))
          issue('mobile_number', 'Enter the wallet mobile number as 03XXXXXXXXX.');
      }
      if (v.type === 'raast' && !MOBILE.test(v.raast_id) && !IBAN.test(v.raast_id))
        issue('raast_id', 'Use a Raast ID (03XXXXXXXXX mobile number) or an IBAN.');
    }),
};
/** Keep in sync with wallets in apps/web/lib/paymentProviders.ts */
export const walletProviders = [
  'JazzCash',
  'Easypaisa',
  'SadaPay',
  'NayaPay',
  'UPaisa',
  'Konnect by HBL',
  'Zindigi',
  'SimSim',
  'MCB Lite',
  'Alfa by Bank Alfalah',
  'Other',
];
const IBAN = /^PK\d{2}[A-Z]{4}[0-9A-Z]{16}$/;
const MOBILE = /^03\d{9}$/;
function pkMobile(v: string) {
  const d = v.replace(/[\s()-]/g, '');
  return d.startsWith('+92')
    ? '0' + d.slice(3)
    : d.startsWith('92') && d.length === 12
      ? '0' + d.slice(2)
      : d;
}
export const isOnline = (type?: string) => !!type && type !== 'cod';
export function installPlatform(app: Express) {
  app.use('/api', async (req: AuthRequest, res, next) => {
    if (req.user?.role !== 'admin') return next();
    const parts = req.path.split('/').filter(Boolean);
    let p: string | undefined;
    if (parts[0] === 'admin')
      p =
        parts[1] === 'records'
          ? parts[2]
          : (
              {
                summary: 'overview',
                documents: 'outlets',
                staff: 'staff',
                'area-settings': 'locations',
                support: 'messages',
                'email-settings': 'settings',
                'rider-controls': 'riders',
                tracking: 'riders',
                cash: 'riders',
                payouts: 'riders',
              } as Record<string, string>
            )[parts[1]] || parts[1];
    if (parts[0] === 'orders') p = 'orders';
    if (parts[0] === 'manage') p = parts[1] === 'images' ? 'images' : 'products';
    const allowed =
      p === 'images'
        ? (
            await Promise.all(
              ['products', 'outlets', 'ads', 'content', 'categories', 'payments'].map((x) =>
                can(req.user, x),
              ),
            )
          ).some(Boolean)
        : p === 'staff'
          ? (await access(req.user)).is_super_admin
          : !p || (await can(req.user, p));
    if (!allowed)
      return res
        .status(403)
        .json({ error: 'Your administrator has not granted access to this module.' });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && p) res.locals.auditTarget = req.path;
    next();
  });
  app.get('/api/site', async (_req, res) => {
    const [categories, content, payments, settings, ads] = await Promise.all([
      publicCategories(),
      publicContent(),
      paymentMethods(),
      records('settings', true),
      publicAds(),
    ]);
    res.json({
      categories,
      content,
      payments,
      settings: settings[0] || null,
      // Advertising has one master switch in Store settings.
      ads: settings[0]?.show_ad === false ? [] : ads,
    });
  });
  /** Verification tags and analytics for the page <head>; the web server reads this while rendering. */
  app.get('/api/site/head', async (_req, res) => {
    const s = (await records('settings', true))[0] || {};
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json(Object.fromEntries(headFields.map((k) => [k, s[k] || ''])));
  });
  /** Every ad with its view and click counts, for the chosen period and overall. */
  app.get('/api/admin/ads', requireRole('admin'), async (req, res) => {
    const r = range(req);
    const from = r.from === '0000' ? r.from : adDay(r.from);
    const to = r.to === '9999' ? r.to : adDay(r.to);
    const inRange = between('day');
    const [list, totals, days] = await Promise.all([
      records('ads'),
      all(
        `SELECT ad_id,SUM(views) views,SUM(clicks) clicks,
          SUM(CASE WHEN ${inRange} THEN views ELSE 0 END) views_range,
          SUM(CASE WHEN ${inRange} THEN clicks ELSE 0 END) clicks_range
         FROM ad_stats GROUP BY ad_id`,
        from,
        to,
        from,
        to,
      ),
      all(
        `SELECT day,SUM(views) views,SUM(clicks) clicks FROM ad_stats WHERE ${inRange} GROUP BY day ORDER BY day DESC LIMIT 60`,
        from,
        to,
      ),
    ]);
    const stats = new Map(totals.map((t) => [t.ad_id, t]));
    const count = (id: string, k: string) => Number(stats.get(id)?.[k] || 0);
    res.json({
      ads: list.map((a) => ({
        ...a,
        views: count(a.id, 'views'),
        clicks: count(a.id, 'clicks'),
        views_range: count(a.id, 'views_range'),
        clicks_range: count(a.id, 'clicks_range'),
      })),
      days: days
        .reverse()
        .map((d) => ({ day: d.day, views: Number(d.views), clicks: Number(d.clicks) })),
    });
  });
  /** Starts an ad's counts again from zero, which also restarts its view limit. */
  app.delete(
    '/api/admin/ads/:id/stats',
    requireRole('admin'),
    atomicRoute(async (req, res) => {
      await run('DELETE FROM ad_stats WHERE ad_id=?', String(req.params.id));
      res.json({ ok: true });
    }),
  );
  app.get('/api/categories', async (_req, res) => res.json(await publicCategories()));
  /** Enabled payment methods; with ?products=a,b only those every listed product accepts. */
  app.get('/api/payments', async (req, res) => {
    const ids = [
      ...new Set(
        String(req.query.products || '')
          .split(',')
          .filter(Boolean),
      ),
    ].slice(0, 50);
    if (!ids.length) return res.json(await paymentMethods());
    res.json(
      await paymentMethodsFor(
        await all(
          `SELECT payment_methods FROM products WHERE id IN (${ids.map(() => '?').join(',')})`,
          ...ids,
        ),
      ),
    );
  });
  app.post(
    '/api/quote',
    atomicRoute(async (req, res) => {
      const p = z
        .object({
          items: z
            .array(z.object({ product_id: text, quantity: z.number().int().min(1).max(99) }))
            .min(1)
            .max(50),
          location_id: text,
          coupon_code: z.string().max(30).default(''),
        })
        .parse(req.body);
      let subtotal = 0;
      for (const i of p.items) {
        const x = await one('SELECT * FROM products WHERE id=? AND active=1', i.product_id);
        if (!x || x.location_id !== p.location_id)
          return res.status(400).json({ error: 'An item is unavailable in this area.' });
        subtotal += Math.round((x.price * (100 - x.discount)) / 100) * i.quantity;
      }
      const area = await areaSettings(p.location_id);
      const fee = deliveryFee(area, subtotal);
      const user = (req as AuthRequest).user;
      const { discount } = await couponDiscount(p.coupon_code, subtotal, {
        userId: user?.role === 'customer' ? user.id : undefined,
        locationId: p.location_id,
        fee,
      });
      res.json({ subtotal, delivery_fee: fee, discount, total: subtotal + fee - discount });
    }),
  );
  /** Offers shown at checkout: public coupons that are running and valid in the area. */
  app.get('/api/coupons', async (req, res) => {
    const area = String(req.query.location || '');
    const open = (await records('coupons', true)).filter(
      (c) => c.public && inSchedule(c) && (!c.location_ids?.length || c.location_ids.includes(area)),
    );
    const limited = open.filter((c) => c.limit > 0);
    const used = new Map<string, number>(
      limited.length
        ? (
            await all(
              `SELECT coupon_id,COUNT(*) n FROM coupon_uses WHERE coupon_id IN (${limited.map(() => '?').join(',')}) GROUP BY coupon_id`,
              ...limited.map((c) => c.id),
            )
          ).map((r) => [r.coupon_id, Number(r.n)])
        : [],
    );
    res.json(
      open
        .filter((c) => !(c.limit > 0) || (used.get(c.id) || 0) < c.limit)
        .map((c) => ({
          code: c.code,
          name: c.name,
          description: c.description || '',
          type: c.type,
          value: c.value,
          max_discount: c.max_discount || 0,
          minimum: c.minimum,
          first_order: !!c.first_order,
          ends_at: c.ends_at,
        })),
    );
  });
  /** Every coupon with how often it was used and what it gave away, overall and in the period. */
  app.get('/api/admin/coupons', requireRole('admin'), async (req, res) => {
    const r = range(req);
    const within = between('o.created_at');
    const [list, stats] = await Promise.all([
      records('coupons'),
      all(
        `SELECT u.coupon_id,COUNT(*) uses,COALESCE(SUM(d.discount),0) discount,COALESCE(SUM(o.total),0) sales,
           COUNT(DISTINCT o.user_id) customers,
           COUNT(*) FILTER (WHERE ${within}) uses_range,
           COALESCE(SUM(d.discount) FILTER (WHERE ${within}),0) discount_range,
           COALESCE(SUM(o.total) FILTER (WHERE ${within}),0) sales_range
         FROM coupon_uses u JOIN orders o ON o.id=u.order_id LEFT JOIN order_details d ON d.order_id=o.id
         GROUP BY u.coupon_id`,
        r.from,
        r.to,
        r.from,
        r.to,
        r.from,
        r.to,
      ),
    ]);
    const by = new Map(stats.map((s) => [s.coupon_id, s]));
    const figure = (id: string, k: string) => Number(by.get(id)?.[k] || 0);
    res.json(
      list.map((c) => ({
        ...c,
        ...Object.fromEntries(
          ['uses', 'discount', 'sales', 'customers', 'uses_range', 'discount_range', 'sales_range'].map(
            (k) => [k, figure(c.id, k)],
          ),
        ),
      })),
    );
  });
  /** The latest orders a coupon was used on. */
  app.get('/api/admin/coupons/:id/orders', requireRole('admin'), async (req, res) =>
    res.json(
      await all(
        `SELECT o.id,o.reference,o.name,o.total,o.status,o.created_at,COALESCE(d.discount,0) discount
         FROM coupon_uses u JOIN orders o ON o.id=u.order_id LEFT JOIN order_details d ON d.order_id=o.id
         WHERE u.coupon_id=? ORDER BY o.created_at DESC LIMIT 50`,
        String(req.params.id),
      ),
    ),
  );
  app.get('/api/admin/records/:kind', requireRole('admin'), async (req, res) => {
    if (!schemas[String(req.params.kind)]) return res.sendStatus(404);
    res.json(
      req.params.kind === 'payments'
        ? await adminPaymentMethods()
        : req.params.kind === 'categories'
          ? await adminCategories()
          : await records(String(req.params.kind)),
    );
  });
  app.put(
    '/api/admin/records/:kind/:id',
    requireRole('admin'),
    atomicRoute(async (req, res) => {
      const kind = String(req.params.kind),
        id = String(req.params.id);
      if (!schemas[kind]) return res.sendStatus(404);
      const body = { ...req.body };
      const p = schemas[kind].parse(body) as Row;
      if (kind === 'settings' && id !== 'global')
        return res.status(400).json({ error: 'Use the global settings record.' });
      if (kind === 'coupons' && (await records(kind)).some((c) => c.id !== id && c.code === p.code))
        return res.status(409).json({ error: 'Coupon code already exists.' });
      if (kind === 'payments') {
        const old = (await records(kind)).find((m) => m.id === id);
        if (old && (old.type === 'manual' ? 'bank' : old.type) !== p.type)
          return res
            .status(400)
            .json({ error: 'The payment type cannot be changed. Create a new method instead.' });
      }
      if (kind === 'categories') {
        if (
          (await records(kind)).some(
            (c) => c.id !== id && c.name.toLowerCase() === p.name.toLowerCase(),
          )
        )
          return res.status(409).json({ error: 'Category already exists.' });
        const old = (await records(kind)).find((c) => c.id === id);
        await transaction(async () => {
          if (old) {
            await run('UPDATE products SET category=? WHERE category=?', p.name, old.name);
            await run('UPDATE outlets SET category=? WHERE category=?', p.name, old.name);
          }
          await run(
            'INSERT INTO platform_records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data',
            kind,
            id,
            JSON.stringify(p),
          );
        });
      } else
        await run(
          'INSERT INTO platform_records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data',
          kind,
          id,
          JSON.stringify(p),
        );
      res.json(
        kind === 'payments' ? (await adminPaymentMethods()).find((m) => m.id === id) : { ...p, id },
      );
    }),
  );
  app.patch(
    '/api/admin/records/:kind/:id',
    requireRole('admin'),
    atomicRoute(async (req, res) => {
      const kind = String(req.params.kind),
        id = String(req.params.id);
      if (!schemas[kind] || kind === 'settings') return res.sendStatus(404);
      // Categories also switch their storefront flags here, without a full save.
      const p = z
        .object({
          active: z.boolean().optional(),
          ...(kind === 'categories'
            ? { show_on_home: z.boolean().optional(), show_in_filters: z.boolean().optional() }
            : {}),
        })
        .parse(req.body);
      const row = await one('SELECT data FROM platform_records WHERE kind=? AND id=?', kind, id);
      if (!row) return res.sendStatus(404);
      await run(
        'UPDATE platform_records SET data=? WHERE kind=? AND id=?',
        JSON.stringify({ ...JSON.parse(row.data), ...p }),
        kind,
        id,
      );
      res.json({ ok: true });
    }),
  );
  app.delete(
    '/api/admin/records/:kind/:id',
    requireRole('admin'),
    atomicRoute(async (req, res) => {
      const kind = String(req.params.kind),
        id = String(req.params.id);
      if (!schemas[kind] || kind === 'settings') return res.sendStatus(404);
      const record = (await records(kind)).find((r) => r.id === id);
      if (!record) return res.sendStatus(404);
      if (
        kind === 'categories' &&
        (await one(
          'SELECT 1 FROM products WHERE category=? AND deleted_at IS NULL UNION SELECT 1 FROM outlets WHERE category=? AND deleted_at IS NULL',
          record.name,
          record.name,
        ))
      )
        return res
          .status(409)
          .json({ error: 'Products or outlets still use this category. Disable it instead.' });
      await run('DELETE FROM platform_records WHERE kind=? AND id=?', kind, id);
      if (kind === 'payments') await detachPaymentMethod(id);
      if (kind === 'ads') await run('DELETE FROM ad_stats WHERE ad_id=?', id);
      res.json({ ok: true });
    }),
  );
  /**
   * Administrators, in one query. Only super administrators reach these routes. The owner account
   * is marked protected: it can be seen here but never edited, disabled or deleted.
   */
  app.get('/api/admin/staff', requireRole('admin'), async (req: AuthRequest, res) => {
    const at = new Date().toISOString();
    const month = new Date(Date.now() - 30 * 86400000).toISOString();
    const users = await all(
      `SELECT u.id,u.name,u.email,u.phone,u.active,u.created_at,u.last_login_at,
         COALESCE(a.super,0) super,COALESCE(a.permissions,'[]') permissions,COALESCE(a.title,'') title,
         (SELECT COUNT(*) FROM sessions s WHERE s.user_id=u.id AND s.expires_at>?) sessions,
         (SELECT COUNT(*) FROM audit_log l WHERE l.user_id=u.id AND l.created_at>?) actions
       FROM users u LEFT JOIN admin_access a ON a.user_id=u.id WHERE u.role='admin'
       ORDER BY COALESCE(a.super,0) DESC,u.name`,
      at,
      month,
    );
    res.json({
      permissions,
      me: req.user!.id,
      users: users.map(({ super: isSuper, ...u }) => ({
        ...u,
        permissions: JSON.parse(u.permissions),
        is_super_admin: !!isSuper,
        is_owner: isOwner({ ...u, role: 'admin' }),
        sessions: Number(u.sessions),
        actions: Number(u.actions),
      })),
    });
  });
  /** The administrator a staff route acts on. The owner and the caller's own account are refused. */
  const staffMember = async (req: AuthRequest, action: string) => {
    const u = await one("SELECT * FROM users WHERE id=? AND role='admin'", String(req.params.id));
    if (!u) throw Object.assign(new Error('Administrator not found.'), { status: 404 });
    if (isOwner(u))
      throw Object.assign(new Error(`The owner account cannot be ${action}.`), { status: 403 });
    if (u.id === req.user!.id)
      throw Object.assign(
        new Error(`Your own account cannot be ${action} here. Use your profile instead.`),
        { status: 403 },
      );
    return u;
  };
  app.put(
    '/api/admin/staff/:id',
    requireRole('admin'),
    atomicRoute(async (req: AuthRequest, res) => {
      const p = z
        .object({
          name: text,
          email: z.email().transform((v) => v.toLowerCase()),
          phone: z.string().trim().max(30).default(''),
          title: z.string().trim().max(60).default(''),
          password: z.string().min(12).max(100).optional(),
          active: z.boolean(),
          // A super administrator has every module and manages the other administrators.
          super: z.boolean().default(false),
          permissions: z.array(z.enum(permissions)).max(permissions.length),
        })
        .parse(req.body);
      const id = String(req.params.id);
      const exists = await one('SELECT id,role FROM users WHERE id=?', id);
      if (exists && exists.role !== 'admin')
        return res.status(403).json({ error: 'That account is not an administrator.' });
      const old = exists ? await staffMember(req, 'changed') : undefined;
      if (!old && !p.password)
        return res.status(400).json({ error: 'A password is required for new administrators.' });
      if (old)
        await run(
          'UPDATE users SET name=?,email=?,phone=?,active=?,password_hash=? WHERE id=?',
          p.name,
          p.email,
          p.phone,
          Number(p.active),
          p.password ? hashPassword(p.password) : old.password_hash,
          id,
        );
      else
        await run(
          "INSERT INTO users(id,name,email,phone,password_hash,role,active,created_at,email_verified_at) VALUES(?,?,?,?,?,'admin',?,?,?)",
          id,
          p.name,
          p.email,
          p.phone,
          hashPassword(p.password!),
          Number(p.active),
          new Date().toISOString(),
          new Date().toISOString(),
        );
      await run(
        'INSERT INTO admin_access(user_id,super,permissions,title) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET super=excluded.super,permissions=excluded.permissions,title=excluded.title',
        id,
        Number(p.super),
        JSON.stringify(p.super ? [] : [...new Set(p.permissions)]),
        p.title,
      );
      // Saving signs the administrator out, so the new access applies from their next sign-in.
      await run('DELETE FROM sessions WHERE user_id=?', id);
      res.json({ ok: true });
    }),
  );
  /** The switch in the table: disable or enable an administrator. */
  app.patch(
    '/api/admin/staff/:id',
    requireRole('admin'),
    atomicRoute(async (req: AuthRequest, res) => {
      const p = z.object({ active: z.boolean() }).parse(req.body);
      const u = await staffMember(req, 'disabled');
      await run('UPDATE users SET active=? WHERE id=?', Number(p.active), u.id);
      if (!p.active) await run('DELETE FROM sessions WHERE user_id=?', u.id);
      res.json({ ok: true });
    }),
  );
  app.post(
    '/api/admin/staff/:id/sign-out',
    requireRole('admin'),
    atomicRoute(async (req: AuthRequest, res) => {
      const u = await staffMember(req, 'signed out');
      const { changes } = await run('DELETE FROM sessions WHERE user_id=?', u.id);
      res.json({ ok: true, sessions: changes });
    }),
  );
  /** Removes an administrator. What they did stays in the activity log, without their name. */
  app.delete(
    '/api/admin/staff/:id',
    requireRole('admin'),
    atomicRoute(async (req: AuthRequest, res) => {
      const u = await staffMember(req, 'deleted');
      for (const table of ['sessions', 'notifications', 'push_subscriptions', 'email_codes', 'admin_access'])
        await run(`DELETE FROM ${table} WHERE user_id=?`, u.id);
      await run('UPDATE support_threads SET assigned_to=NULL WHERE assigned_to=?', u.id);
      await run('DELETE FROM users WHERE id=?', u.id);
      res.json({ ok: true });
    }),
  );
  /** What administrators changed in the period, newest first. */
  app.get('/api/admin/audit', requireRole('admin'), async (req, res) => {
    const r = range(req);
    res.json(
      await all(
        `SELECT a.id,a.user_id,a.action,a.target,a.created_at,u.name,u.email FROM audit_log a LEFT JOIN users u ON u.id=a.user_id WHERE ${between('a.created_at')} ORDER BY a.created_at DESC LIMIT 1000`,
        r.from,
        r.to,
      ),
    );
  });
  /** Every area with its settings, what it covers and its orders in the time frame: one query. */
  app.get('/api/admin/area-settings', requireRole('admin'), async (req, res) => {
    const r = range(req);
    res.json(
      await all(
        `SELECT l.*,${areaColumns},(SELECT COUNT(*) FROM outlets WHERE location_id=l.id AND active=1) outlets,(SELECT COUNT(*) FROM products WHERE location_id=l.id AND active=1) products,(SELECT COUNT(*) FROM outlets WHERE location_id=l.id AND deleted_at IS NULL) all_outlets,(SELECT COUNT(*) FROM products WHERE location_id=l.id AND deleted_at IS NULL) all_products,(SELECT COUNT(*) FROM users WHERE role='rider' AND location_id=l.id AND active=1) riders,(SELECT COUNT(*) FROM users u LEFT JOIN rider_state s ON s.user_id=u.id WHERE u.role='rider' AND u.location_id=l.id AND u.active=1 AND COALESCE(s.available,1)=1) riders_on_duty,(SELECT COUNT(*) FROM orders WHERE location_id=l.id AND status NOT IN ('delivered','cancelled')) active_orders,(SELECT COUNT(*) FROM orders WHERE location_id=l.id AND ${between('created_at')}) orders,(SELECT COALESCE(SUM(total),0) FROM orders WHERE location_id=l.id AND status='delivered' AND ${between('created_at')}) sales FROM locations l LEFT JOIN area_settings a ON a.location_id=l.id WHERE l.deleted_at IS NULL ORDER BY l.name`,
        r.from,
        r.to,
        r.from,
        r.to,
      ),
    );
  });
  app.put(
    '/api/admin/area-settings/:id',
    requireRole('admin'),
    atomicRoute(async (req, res) => {
      const p = z
        .object({
          ...areaFields,
          active: z.boolean(),
          radius: z.number().min(0.1).max(100),
          fee: z.number().int().min(0).max(10000000),
        })
        .parse(req.body);
      await saveAreaSettings(String(req.params.id), p);
      res.json({ ok: true });
    }),
  );
  /** The switch in the area table: pause or resume an area without re-sending its settings. */
  app.patch(
    '/api/admin/area-settings/:id',
    requireRole('admin'),
    atomicRoute(async (req, res) => {
      const p = z.object({ active: z.boolean() }).parse(req.body);
      const id = String(req.params.id);
      if (!(await one('SELECT id FROM locations WHERE id=? AND deleted_at IS NULL', id))) return res.sendStatus(404);
      await saveAreaSettings(id, p);
      res.json({ ok: true });
    }),
  );
  app.get('/api/admin/tracking', requireRole('admin'), async (_req, res) =>
    res.json(
      await all(
        "SELECT u.id,u.name,u.phone,u.active,u.location_id,s.available,s.capacity,s.lat,s.lng,s.accuracy,s.updated_at,(SELECT COUNT(*) FROM orders WHERE rider_id=u.id AND status NOT IN ('delivered','cancelled')) load FROM users u LEFT JOIN rider_state s ON s.user_id=u.id WHERE u.role='rider' AND u.deleted_at IS NULL",
      ),
    ),
  );
  app.put(
    '/api/admin/rider-controls/:id',
    requireRole('admin'),
    atomicRoute(async (req, res) => {
      const p = z
        .object({ available: z.boolean(), capacity: z.number().int().min(1).max(50) })
        .parse(req.body);
      const id = String(req.params.id);
      if (!(await one("SELECT id FROM users WHERE id=? AND role='rider' AND deleted_at IS NULL", id)))
        return res.sendStatus(404);
      await run(
        'INSERT INTO rider_state(user_id,available,capacity) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET available=excluded.available,capacity=excluded.capacity',
        id,
        Number(p.available),
        p.capacity,
      );
      res.json({ ok: true });
    }),
  );
  app.get('/api/rider/state', requireRole('rider'), async (req: AuthRequest, res) =>
    res.json(
      (await one('SELECT * FROM rider_state WHERE user_id=?', req.user!.id)) || {
        available: 1,
        capacity: 5,
      },
    ),
  );
  app.patch(
    '/api/rider/state',
    requireRole('rider'),
    atomicRoute(async (req: AuthRequest, res) => {
      const p = z.object({ available: z.boolean() }).parse(req.body);
      await run(
        'INSERT INTO rider_state(user_id,available) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET available=excluded.available',
        req.user!.id,
        Number(p.available),
      );
      if (!p.available)
        await run(
          'UPDATE rider_state SET lat=NULL,lng=NULL,accuracy=NULL,updated_at=NULL WHERE user_id=?',
          req.user!.id,
        );
      res.json({ ok: true });
    }),
  );
  app.post(
    '/api/rider/location',
    requireRole('rider'),
    atomicRoute(async (req: AuthRequest, res) => {
      const p = z
        .object({
          lat: z.number().min(-90).max(90),
          lng: z.number().min(-180).max(180),
          accuracy: z.number().min(0).max(100000),
        })
        .parse(req.body);
      if (
        !(await one(
          "SELECT id FROM orders WHERE rider_id=? AND status NOT IN ('delivered','cancelled')",
          req.user!.id,
        ))
      )
        return res
          .status(409)
          .json({ error: 'Location is shared only while you have an active delivery.' });
      await run(
        'INSERT INTO rider_state(user_id,lat,lng,accuracy,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET lat=excluded.lat,lng=excluded.lng,accuracy=excluded.accuracy,updated_at=excluded.updated_at',
        req.user!.id,
        p.lat,
        p.lng,
        p.accuracy,
        new Date().toISOString(),
      );
      res.json({ ok: true });
    }),
  );
}
