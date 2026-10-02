export type Location = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  fee?: number;
  radius?: number;
  active?: number;
  /** Paisa; 0 when the area sets no minimum. */
  minimum_order?: number;
  /** Paisa; orders with at least this subtotal are delivered free. 0 when the fee always applies. */
  free_delivery_over?: number;
  /** Delivery hours in Pakistan time as HH:MM; both empty when delivery runs around the clock. */
  opens_at?: string;
  closes_at?: string;
};
/** A delivery area as the admin panel lists it; orders and sales are for the chosen time frame. */
export type AdminArea = Required<Location> & {
  outlets: number;
  products: number;
  /** Outlets and products that are not deleted, closed ones included: these stop the area being deleted. */
  all_outlets: number;
  all_products: number;
  riders: number;
  riders_on_duty: number;
  active_orders: number;
  orders: number;
  sales: number;
};
export type User = {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  location_id: string;
  role: 'customer' | 'admin' | 'outlet' | 'rider';
  is_super_admin?: boolean;
  /** The store owner's administrator account, which nobody else can change. */
  is_owner?: boolean;
  permissions?: string[];
  login_id?: string;
  active: number;
  created_at?: string;
  last_login_at?: string | null;
  email_verified_at?: string | null;
  /** Notification types the account has silenced. */
  notify_muted?: string[];
};
export type Product = {
  id: string;
  outlet_id: string;
  outlet_name: string;
  name: string;
  description: string;
  category: string;
  price: number;
  effective_price: number;
  stock: number;
  /** Most a customer can buy in one order. */
  max_per_order: number;
  unit: string;
  sku: string;
  location_id: string;
  discount: number;
  deal: string;
  images: string[];
  includes: string;
  excludes: string;
  delivery_minutes: number;
  /** Ids of the payment methods checkout offers for this product. */
  payment_methods: string[];
  active: number;
  pickup_address?: string;
};
export type Outlet = {
  id: string;
  name: string;
  phone: string;
  email?: string;
  address: string;
  location_id: string;
  image: string;
  category: string;
  customer_id?: string;
  lat: number;
  lng: number;
  active: number;
  products?: number;
  delivery_minutes?: number | null;
  description?: string;
  featured?: number;
  /** Paisa; 0 when the outlet sets no minimum of its own. */
  minimum_order?: number;
  /** Opening hours in Pakistan time as HH:MM; both empty when open around the clock. */
  opens_at?: string;
  closes_at?: string;
  /** 0 while new orders are paused. */
  accepting?: number;
  /** Whether the outlet takes orders right now: not paused and inside its hours. */
  open?: boolean;
};
/** An outlet as the admin panel lists it, with its private settings and totals. */
export type AdminOutlet = Outlet & {
  commission_rate: number;
  owner_name: string;
  payout_bank: string;
  payout_title: string;
  payout_account: string;
  notes: string;
  orders: number;
  /** Item sales and the outlet's share of them on delivered orders, in paisa. */
  sales: number;
  payable: number;
};
export type Category = {
  id: string;
  name: string;
  description: string;
  image: string;
  active?: boolean;
  show_on_home?: boolean;
  home_limit?: number;
  show_in_filters?: boolean;
};
export type PaymentType = 'cod' | 'bank' | 'wallet' | 'raast';
export type PaymentMethod = {
  id: string;
  name: string;
  type: PaymentType | 'manual';
  logo?: string;
  instructions: string;
  bank_name?: string;
  account_title?: string;
  account_number?: string;
  iban?: string;
  branch_code?: string;
  provider?: string;
  mobile_number?: string;
  raast_id?: string;
  require_proof?: boolean;
  active?: boolean;
  /** Admin list only: how many products accept this method. */
  products?: number;
};
export type CartItem = { product: Product; quantity: number };
export type Order = {
  id: string;
  reference: string;
  user_id: string | null;
  outlet_id: string;
  rider_id: string | null;
  name: string;
  email: string;
  phone: string;
  address: string;
  location_id: string;
  lat: number;
  lng: number;
  notes: string;
  payment_method: string;
  discount?: number;
  coupon_code?: string;
  payment_name?: string;
  payment_type?: string;
  payment_status?: string;
  payment_instructions?: string;
  payment_note?: string;
  payment_details?: Partial<PaymentMethod>;
  transaction_id?: string;
  payer_name?: string;
  payer_account?: string;
  proof_url?: string | null;
  rider_location?: { lat: number; lng: number; accuracy: number; updated_at: string } | null;
  subtotal: number;
  delivery_fee: number;
  total: number;
  status: string;
  otp?: string;
  created_at: string;
  deliver_by: string;
  delivered_at: string | null;
  outlet: { name: string; address: string; lat: number; lng: number; phone: string };
  rider: { name: string; phone: string } | null;
  items: { id: string; name: string; quantity: number; unit_price: number; image: string }[];
  events: { status: string; created_at: string; note?: string; actor?: string }[];
  flow: OrderFlow;
  /** Whether the signed-in user may cancel this order at its current stage. */
  can_cancel: boolean;
  /** Delivered orders cannot be changed. */
  locked: boolean;
};
export type ResponseStatus = 'unsent' | 'pending' | 'accepted' | 'rejected';
export type OrderFlow = {
  sent_at: string | null;
  outlet_status: ResponseStatus;
  outlet_note: string;
  outlet_responded_at: string | null;
  rider_status: ResponseStatus;
  rider_note: string;
  rider_responded_at: string | null;
  rider_rejections: number;
  payment_verified_at: string | null;
  cancel_reason: string;
  cancelled_by: string | null;
  cancel_request: string;
  cancel_request_at: string | null;
  reminders: number;
  last_reminder_at: string | null;
};
export type AdminSummary = {
  orders: number;
  cancelled: number;
  active_orders: number;
  delivered: number;
  sales: number;
  outlet_deducted: number;
  outlet_commission: number;
  rider_commission: number;
  coupon_deductions: number;
  store_sales: number;
  delivery_fees: number;
  outlets: number;
  statuses: Record<string, number>;
};
/** Live queues for the admin dashboard; counts are all-time, amounts in paisa. */
export type AdminAttention = {
  dispatch: number;
  cancel_requests: number;
  outlet_declined: number;
  awaiting_outlet: number;
  awaiting_rider: number;
  rider_needed: number;
  late: number;
  active: number;
  ready: number;
  on_the_road: number;
  payments: number;
  payments_amount: number;
  refunds: number;
  refunds_amount: number;
  payout_requests: number;
  payout_amount: number;
  cod_deposits: number;
  cod_amount: number;
  riders_available: number;
  riders_busy: number;
  riders_total: number;
  out_of_stock: number;
  low_stock: number;
  outlets_paused: number;
  outlets_total: number;
  messages: number;
  checked_at: string;
};
export type OutletSummary = {
  outlet: Outlet & { commission_rate: number; accepting: number };
  statuses: Record<string, number>;
  orders: number;
  awaiting_response: number;
  in_kitchen: number;
  awaiting_pickup: number;
  late: number;
  out_of_stock: number;
  low_stock_count: number;
  checked_at: string;
  delivered: number;
  sales: number;
  commission: number;
  payable: number;
  average_order: number;
  top_products: { product_id: string; name: string; image: string; quantity: number; revenue: number }[];
  low_stock: { id: string; name: string; stock: number; image: string }[];
  daily: { day: string; orders: number; sales: number }[];
};
export type CashDeposit = {
  id: string;
  rider_id: string;
  rider_name?: string;
  login_id?: string;
  amount: number;
  method: string;
  reference: string;
  note: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  created_at: string;
  reviewed_at: string | null;
  reviewer_name: string | null;
  review_note: string;
};
export type CashStatement = {
  collected: number;
  approved: number;
  pending: number;
  in_hand: number;
  collected_range: number;
  submitted_range: number;
  collections: { order_id: string; reference: string; customer: string; amount: number; created_at: string }[];
  deposits: CashDeposit[];
};
export type Payout = {
  id: string;
  rider_id: string;
  rider_name?: string;
  login_id?: string;
  amount: number;
  note: string;
  method: string;
  reference: string;
  type: 'manual' | 'request';
  status: string;
  issued_by: string | null;
  created_at: string;
};
export type PayoutRequest = {
  id: string;
  rider_id: string;
  rider_name?: string;
  login_id?: string;
  amount: number;
  method: string;
  account: string;
  note: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  created_at: string;
  reviewed_at: string | null;
  reviewer_name: string | null;
  review_note: string;
  balance?: number;
};
export type AppNotification = {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string;
  read: number;
  created_at: string;
};
export type RiderStatement = {
  settings: { commission_type: string; commission_value: number; commission_base: string };
  earned: number;
  paid: number;
  balance: number;
  pending_requests: number;
  available: number;
  earned_range: number;
  paid_range: number;
  deliveries_range: number;
  today: number;
  week: number;
  deliveries: number;
  cash_collected: number;
  earnings: {
    id: string;
    order_id: string;
    reference: string;
    amount: number;
    commission_type: string;
    commission_value: number;
    commission_base: string;
    base_amount: number;
    cash_collected: number;
    order_total: number;
    created_at: string;
  }[];
  payouts: Payout[];
  requests: PayoutRequest[];
};
