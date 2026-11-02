import '../core/format.dart';

typedef Json = Map<String, dynamic>;

int asInt(dynamic v, [int fallback = 0]) {
  if (v is int) return v;
  if (v is num) return v.round();
  if (v is bool) return v ? 1 : 0;
  if (v is String) return int.tryParse(v) ?? double.tryParse(v)?.round() ?? fallback;
  return fallback;
}

double asDouble(dynamic v, [double fallback = 0]) {
  if (v is num) return v.toDouble();
  if (v is String) return double.tryParse(v) ?? fallback;
  return fallback;
}

String asString(dynamic v, [String fallback = '']) => v == null ? fallback : v.toString();

bool asBool(dynamic v, [bool fallback = false]) {
  if (v is bool) return v;
  if (v is num) return v != 0;
  if (v is String) return v == 'true' || v == '1';
  return fallback;
}

List<String> asStrings(dynamic v) => v is List ? v.map((e) => e.toString()).toList() : <String>[];
Json asMap(dynamic v) => v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};
List<Json> asList(dynamic v) => v is List ? v.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList() : <Json>[];

/// A delivery area with its pricing and rules. Money is in paisa.
class Area {
  Area.fromJson(Json j)
    : id = asString(j['id']),
      name = asString(j['name']),
      lat = asDouble(j['lat']),
      lng = asDouble(j['lng']),
      fee = asInt(j['fee']),
      radius = asDouble(j['radius'], 8),
      minimumOrder = asInt(j['minimum_order']),
      freeDeliveryOver = asInt(j['free_delivery_over']),
      opensAt = asString(j['opens_at']),
      closesAt = asString(j['closes_at']);

  Area._nationwide()
    : id = nationwideId,
      name = 'Nation Wide',
      lat = 30.3753,
      lng = 69.3451,
      fee = 0,
      radius = 0,
      minimumOrder = 0,
      freeDeliveryOver = 0,
      opensAt = '',
      closesAt = '';

  /// The default choice: products and outlets from every delivery area in Pakistan. The server
  /// reads this id as "all areas"; it is never a real delivery area, so checkout uses the
  /// product's own area instead.
  static final nationwide = Area._nationwide();
  static const nationwideId = 'nationwide';

  bool get isNationwide => id == nationwideId;

  final String id, name, opensAt, closesAt;
  final double lat, lng, radius;
  final int fee, minimumOrder, freeDeliveryOver;
}

class User {
  User.fromJson(Json j)
    : id = asString(j['id']),
      name = asString(j['name']),
      email = asString(j['email']),
      phone = asString(j['phone']),
      address = asString(j['address']),
      locationId = asString(j['location_id']),
      role = asString(j['role'], 'customer'),
      loginId = asString(j['login_id']),
      createdAt = asString(j['created_at']),
      notifyMuted = asStrings(j['notify_muted']);

  final String id, name, email, phone, address, locationId, role, loginId, createdAt;
  final List<String> notifyMuted;

  bool get isCustomer => role == 'customer';
  bool get isRider => role == 'rider';
  bool get isOutlet => role == 'outlet';

  /// A rider or outlet that signed up itself and is waiting for approval.
  bool get isApplicant => role == 'applicant';
}

class Product {
  Product.fromJson(this.raw)
    : id = asString(raw['id']),
      outletId = asString(raw['outlet_id']),
      outletName = asString(raw['outlet_name']),
      name = asString(raw['name']),
      description = asString(raw['description']),
      category = asString(raw['category']),
      price = asInt(raw['price']),
      effectivePrice = asInt(raw['effective_price'], asInt(raw['price'])),
      stock = asInt(raw['stock']),
      maxPerOrder = asInt(raw['max_per_order'], 99),
      unit = asString(raw['unit']),
      sku = asString(raw['sku']),
      locationId = asString(raw['location_id']),
      nationwide = asBool(raw['nationwide']),
      locationIds = asStrings(raw['location_ids']),
      discount = asInt(raw['discount']),
      deal = asString(raw['deal']),
      images = asStrings(raw['images']),
      includes = asString(raw['includes']),
      excludes = asString(raw['excludes']),
      deliveryMinutes = asInt(raw['delivery_minutes'], 30),
      paymentMethods = asStrings(raw['payment_methods']),
      active = asBool(raw['active'], true),
      pickupAddress = asString(raw['pickup_address']);

  /// Kept so a product can be saved with the cart and read back unchanged.
  final Json raw;
  final String id, outletId, outletName, name, description, category, unit, sku, locationId, deal;
  final String includes, excludes, pickupAddress;
  final int price, effectivePrice, stock, maxPerOrder, discount, deliveryMinutes;
  final List<String> images, paymentMethods;
  final bool active;

  /// Nation Wide products sell in every area; the others in their main area and [locationIds].
  final bool nationwide;
  final List<String> locationIds;

  /// Whether the product can be delivered in the area.
  bool sellsIn(String areaId) => nationwide || locationId == areaId || locationIds.contains(areaId);

  String get image => images.isEmpty ? '' : images.first;
  bool get soldOut => stock <= 0;

  /// Most of this product a single order may hold.
  int get orderLimit => maxPerOrder < 99 ? maxPerOrder : 99;

  /// The highest quantity the cart allows right now.
  int get maxQuantity => stock < orderLimit ? stock : orderLimit;
}

class CartItem {
  CartItem(this.product, this.quantity);
  final Product product;
  int quantity;

  int get total => product.effectivePrice * quantity;
  Json toJson() => {'product': product.raw, 'quantity': quantity};
}

class Outlet {
  Outlet.fromJson(Json j)
    : id = asString(j['id']),
      name = asString(j['name']),
      phone = asString(j['phone']),
      address = asString(j['address']),
      locationId = asString(j['location_id']),
      image = asString(j['image']),
      category = asString(j['category']),
      description = asString(j['description']),
      opensAt = asString(j['opens_at']),
      closesAt = asString(j['closes_at']),
      lat = asDouble(j['lat']),
      lng = asDouble(j['lng']),
      products = asInt(j['products']),
      deliveryMinutes = asInt(j['delivery_minutes']),
      minimumOrder = asInt(j['minimum_order']),
      featured = asBool(j['featured']),
      accepting = asBool(j['accepting'], true),
      open = asBool(j['open'], true),
      commissionRate = asDouble(j['commission_rate']);

  final String id, name, phone, address, locationId, image, category, description, opensAt, closesAt;
  final double lat, lng, commissionRate;
  final int products, deliveryMinutes, minimumOrder;
  final bool featured, accepting, open;

  String get hours => openingHours(opensAt, closesAt);
}

class Category {
  Category.fromJson(Json j)
    : id = asString(j['id']),
      name = asString(j['name']),
      description = asString(j['description']),
      image = asString(j['image']),
      showInFilters = asBool(j['show_in_filters'], true);

  final String id, name, description, image;
  final bool showInFilters;
}

class PaymentMethod {
  PaymentMethod.fromJson(Json j)
    : id = asString(j['id']),
      name = asString(j['name']),
      type = asString(j['type'], 'cod') == 'manual' ? 'bank' : asString(j['type'], 'cod'),
      logo = asString(j['logo']),
      instructions = asString(j['instructions']),
      bankName = asString(j['bank_name']),
      accountTitle = asString(j['account_title']),
      accountNumber = asString(j['account_number']),
      iban = asString(j['iban']),
      branchCode = asString(j['branch_code']),
      provider = asString(j['provider']),
      mobileNumber = asString(j['mobile_number']),
      raastId = asString(j['raast_id']),
      requireProof = asBool(j['require_proof']),
      qrPayload = asString(j['qr_payload']),
      serverHasQr = j['has_qr'] is bool ? j['has_qr'] as bool : null,
      active = asBool(j['active'], true);

  final String id, name, type, logo, instructions;
  final String bankName, accountTitle, accountNumber, iban, branchCode, provider, mobileNumber, raastId;
  final bool requireProof, active;

  /// The store's merchant QR; checkout shows a QR made from it for the exact amount.
  final String qrPayload;

  bool get isOnline => type != 'cod';
  /// What the server says: whether checkout can show a payment QR for this method.
  final bool? serverHasQr;

  /// Methods with a valid IBAN get a Raast QR made automatically at checkout; an imported merchant QR works too.
  bool get hasQr =>
      serverHasQr ?? (isOnline && (_ibanLike.hasMatch(iban) || _ibanLike.hasMatch(raastId) || qrPayload.isNotEmpty));
  static final _ibanLike = RegExp(r'^PK\d{2}[A-Z]{4}');

  /// The wallet or the bank the method belongs to.
  String get providerName => type == 'wallet' ? provider : bankName;

  String get subtitle => type == 'cod'
      ? 'Pay the rider in cash'
      : providerName.isNotEmpty
      ? providerName
      : 'Online transfer';

  /// Account details shown to the customer, in the order the website lists them.
  List<MapEntry<String, String>> get details => [
    if (type != 'wallet') MapEntry('Bank', bankName),
    if (type == 'wallet') MapEntry('Wallet', provider),
    MapEntry('Account title', accountTitle),
    MapEntry('Account number', accountNumber),
    MapEntry('IBAN', iban),
    MapEntry('Branch code', branchCode),
    MapEntry('Mobile number', mobileNumber),
    MapEntry('Raast ID', raastId),
  ].where((e) => e.value.isNotEmpty).toList();
}

const paymentTypeLabels = {
  'cod': 'Cash on delivery',
  'bank': 'Bank transfer',
  'manual': 'Bank transfer',
  'wallet': 'Mobile wallet',
  'raast': 'Raast',
};

class OrderItem {
  OrderItem.fromJson(Json j)
    : id = asString(j['id']),
      name = asString(j['name']),
      image = asString(j['image']),
      quantity = asInt(j['quantity'], 1),
      unitPrice = asInt(j['unit_price']);

  final String id, name, image;
  final int quantity, unitPrice;
}

class OrderEvent {
  OrderEvent.fromJson(Json j)
    : status = asString(j['status']),
      createdAt = asString(j['created_at']),
      note = asString(j['note']),
      actor = asString(j['actor']);

  final String status, createdAt, note, actor;
}

class OrderFlow {
  OrderFlow.fromJson(Json j)
    : sentAt = j['sent_at'] as String?,
      outletStatus = asString(j['outlet_status'], 'unsent'),
      riderStatus = asString(j['rider_status'], 'unsent'),
      paymentVerifiedAt = j['payment_verified_at'] as String?,
      cancelReason = asString(j['cancel_reason']),
      cancelledBy = asString(j['cancelled_by']),
      cancelRequest = asString(j['cancel_request']);

  final String? sentAt, paymentVerifiedAt;
  final String outletStatus, riderStatus, cancelReason, cancelledBy, cancelRequest;
}

class Order {
  Order.fromJson(Json j)
    : id = asString(j['id']),
      reference = asString(j['reference']),
      outletId = asString(j['outlet_id']),
      riderId = j['rider_id'] as String?,
      name = asString(j['name']),
      email = asString(j['email']),
      phone = asString(j['phone']),
      address = asString(j['address']),
      locationId = asString(j['location_id']),
      lat = asDouble(j['lat']),
      lng = asDouble(j['lng']),
      notes = asString(j['notes']),
      status = asString(j['status'], 'placed'),
      otp = asString(j['otp']),
      createdAt = asString(j['created_at']),
      deliverBy = asString(j['deliver_by']),
      deliveredAt = j['delivered_at'] as String?,
      subtotal = asInt(j['subtotal']),
      deliveryFee = asInt(j['delivery_fee']),
      total = asInt(j['total']),
      discount = asInt(j['discount']),
      couponCode = asString(j['coupon_code']),
      paymentName = asString(j['payment_name'], 'Cash on delivery'),
      paymentType = asString(j['payment_type'], 'cod'),
      paymentStatus = asString(j['payment_status']),
      paymentNote = asString(j['payment_note']),
      transactionId = asString(j['transaction_id']),
      payerName = asString(j['payer_name']),
      payerAccount = asString(j['payer_account']),
      proofUrl = asString(j['proof_url']),
      paymentDetails = PaymentMethod.fromJson({...asMap(j['payment_details']), 'type': asString(j['payment_type'], 'cod')}),
      outletName = asString(asMap(j['outlet'])['name'], 'Outlet'),
      outletAddress = asString(asMap(j['outlet'])['address']),
      outletPhone = asString(asMap(j['outlet'])['phone']),
      outletLat = asDouble(asMap(j['outlet'])['lat']),
      outletLng = asDouble(asMap(j['outlet'])['lng']),
      riderName = asString(asMap(j['rider'])['name']),
      riderPhone = asString(asMap(j['rider'])['phone']),
      riderLat = j['rider_location'] is Map ? asDouble(asMap(j['rider_location'])['lat']) : null,
      riderLng = j['rider_location'] is Map ? asDouble(asMap(j['rider_location'])['lng']) : null,
      riderSeenAt = asString(asMap(j['rider_location'])['updated_at']),
      items = asList(j['items']).map(OrderItem.fromJson).toList(),
      events = asList(j['events']).map(OrderEvent.fromJson).toList(),
      flow = OrderFlow.fromJson(asMap(j['flow'])),
      canCancel = asBool(j['can_cancel']),
      locked = asBool(j['locked']);

  final String id, reference, outletId, name, email, phone, address, locationId, notes, status, otp;
  final String createdAt, deliverBy, couponCode;
  final String? riderId, deliveredAt;
  final double lat, lng, outletLat, outletLng;
  final double? riderLat, riderLng;
  final int subtotal, deliveryFee, total, discount;
  final String paymentName, paymentType, paymentStatus, paymentNote, transactionId, payerName, payerAccount, proofUrl;
  final PaymentMethod paymentDetails;
  final String outletName, outletAddress, outletPhone, riderName, riderPhone, riderSeenAt;
  final List<OrderItem> items;
  final List<OrderEvent> events;
  final OrderFlow flow;
  final bool canCancel, locked;

  bool get closed => status == 'delivered' || status == 'cancelled';
  bool get online => paymentType != 'cod';
  bool get hasRider => riderName.isNotEmpty;
  bool get paymentVerified => flow.paymentVerifiedAt != null;
  int get units => items.fold(0, (n, i) => n + i.quantity);
  String get itemsText => items.map((i) => '${i.quantity}× ${i.name}').join(', ');

  bool get late {
    final due = parseTime(deliverBy);
    return !closed && status != 'placed' && due != null && due.isBefore(DateTime.now());
  }

  String get paymentLabel {
    if (paymentStatus == 'refund_due') return 'Refund due';
    if (paymentStatus == 'refunded') return 'Refunded';
    if (!online) return paymentStatus == 'paid' ? 'Collected' : 'Cash due';
    if (paymentStatus == 'paid') return 'Paid';
    if (paymentStatus == 'rejected') return 'Rejected';
    if (paymentStatus == 'failed') return 'Payment failed';
    return 'Verifying';
  }

  /// What the customer reads as the order's headline.
  String get customerHeadline {
    switch (status) {
      case 'delivered':
        return 'Delivered';
      case 'cancelled':
        return 'Order cancelled';
      case 'picked_up':
        return 'On the way';
      case 'ready':
        return 'Ready for pickup';
      case 'preparing':
        return 'Being prepared';
      case 'confirmed':
        return 'Order confirmed';
      default:
        return paymentVerified ? 'Confirming your order' : 'Verifying payment';
    }
  }
}

const eventLabels = {
  'placed': 'Order placed',
  'payment_verified': 'Payment verified',
  'sent': 'Sent to outlet & rider',
  'resent': 'Sent again for confirmation',
  'outlet_accepted': 'Outlet accepted',
  'rider_requested': 'New rider requested',
  'rider_accepted': 'Rider accepted',
  'rider_rejected': 'Rider declined',
  'confirmed': 'Order confirmed',
  'preparing': 'Preparing',
  'ready': 'Ready for pickup',
  'picked_up': 'Picked up',
  'delivered': 'Delivered',
  'cancelled': 'Cancelled',
  'reminder': 'Reminder from Dellvit',
  'cancel_requested': 'Cancellation requested',
  'cancel_request_dismissed': 'Cancellation request declined',
};

class AppNotification {
  AppNotification.fromJson(Json j)
    : id = asString(j['id']),
      type = asString(j['type']),
      title = asString(j['title']),
      body = asString(j['body']),
      link = asString(j['link']),
      read = asBool(j['read']),
      createdAt = asString(j['created_at']);

  final String id, type, title, body, link, createdAt;
  bool read;
}

/// A promotion on the storefront: either a home page content block or an advertisement.
class Promo {
  Promo.content(Json j)
    : id = asString(j['id']),
      isAd = false,
      format = asString(j['type'], 'section'),
      title = asString(j['name']),
      description = asString(j['description']),
      label = asString(j['eyebrow']),
      image = asString(j['image']),
      link = asString(j['link']),
      button = asString(j['button']),
      theme = asString(j['theme'], 'light'),
      placements = [asString(j['placement'], 'after_outlets')],
      devices = asString(j['devices'], 'all'),
      locationIds = asStrings(j['location_ids']),
      embedUrl = asString(j['embed_url']),
      layout = asString(j['layout'], 'image-right');

  Promo.ad(Json j)
    : id = asString(j['id']),
      isAd = true,
      format = asString(j['format'], 'banner'),
      title = asString(j['title']),
      description = asString(j['description']),
      label = asString(j['label']),
      image = asString(j['image']),
      link = asString(j['link']),
      button = asString(j['button']),
      theme = asString(j['theme'], 'brand'),
      placements = asStrings(j['placements']),
      devices = asString(j['devices'], 'all'),
      locationIds = asStrings(j['location_ids']),
      embedUrl = '',
      layout = '';

  final String id, format, title, description, label, image, link, button, theme, devices, embedUrl, layout;
  final List<String> placements, locationIds;
  final bool isAd;

  /// Whether this promotion is meant for phones in the given delivery area.
  bool showsIn(String? areaId) =>
      devices != 'desktop' && (locationIds.isEmpty || (areaId != null && locationIds.contains(areaId)));

  /// A video block opens its video; everything else opens its link.
  String get target => link.isNotEmpty ? link : embedUrl;
}

class ChatMessage {
  ChatMessage.fromJson(Json j)
    : id = asString(j['id']),
      staff = asBool(j['staff']),
      body = asString(j['body']),
      fileName = asString(j['file_name']),
      fileType = asString(j['file_type']),
      createdAt = asString(j['created_at']);

  final String id, body, fileName, fileType, createdAt;
  final bool staff;

  bool get hasImage => fileType.startsWith('image/');
  bool get hasFile => fileName.isNotEmpty || fileType.isNotEmpty;
}

/// Store-wide settings and public content, as `/site` returns them.
class Site {
  Site.fromJson(Json j)
    : settings = asMap(j['settings']),
      categories = asList(j['categories']).map(Category.fromJson).toList(),
      content = asList(j['content']).map(Promo.content).toList(),
      ads = asList(j['ads']).map(Promo.ad).toList(),
      blog = asMap(j['blog']);

  Site.empty() : settings = {}, categories = [], content = [], ads = [], blog = {};

  final Json settings;
  /// The blog's public settings: whether it is on, its title, and the home page section.
  final Json blog;
  bool get blogOn => blog['enabled'] == true;
  final List<Category> categories;
  final List<Promo> content, ads;

  String text(String key, [String fallback = '']) {
    final v = settings[key];
    return v is String && v.trim().isNotEmpty ? v.trim() : fallback;
  }

  /// A switch in Store settings; switches that were never saved count as on.
  bool on(String key) => settings[key] != false;

  String get name => text('name', 'Dellvit');
  bool get checkoutPaused => settings['checkout_enabled'] == false;
  String get checkoutMessage => text('checkout_message', 'Ordering is temporarily paused. Please try again later.');
  String get notice => settings['notice_enabled'] == true ? text('notice') : '';
}
