import 'dart:convert';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:latlong2/latlong.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/location.dart';
import '../../core/resource.dart';
import '../../core/theme.dart';
import '../../models/models.dart';
import '../../state/app_state.dart';
import '../../widgets/common.dart';
import '../../widgets/maps.dart';
import '../../widgets/payment_widgets.dart';
import 'order_detail_screen.dart';

/// A version 4 UUID. One is made per checkout attempt and reused when that attempt is retried,
/// so a retry after a network error can never place the order twice.
String checkoutId() {
  final random = Random.secure();
  final b = List<int>.generate(16, (_) => random.nextInt(256));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  final h = b.map((x) => x.toRadixString(16).padLeft(2, '0')).join();
  return '${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-${h.substring(16, 20)}-${h.substring(20)}';
}

final _phone = RegExp(r'^\+?[\d ()-]{7,20}$');
final _email = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$');

class CheckoutScreen extends StatefulWidget {
  const CheckoutScreen({super.key});

  @override
  State<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends State<CheckoutScreen> {
  final _form = GlobalKey<FormState>();
  final _scroll = ScrollController();
  late final TextEditingController _name, _phoneCtl, _emailCtl, _address;
  final _notes = TextEditingController();
  final _coupon = TextEditingController();
  late final ProofData _proof;
  late final Resource<List<PaymentMethod>> _payments;
  late final Resource<List<Json>> _offers;
  late final List<CartItem> _items;
  Area? _area;
  late LatLng _pin;

  String _payment = '';
  String _applied = '';
  ({int subtotal, int fee, int discount, int total, int outlets})? _quote;
  String? _quoteError;
  bool _quoting = false;
  int _quoteRun = 0;

  String? _error;
  bool _busy = false;
  bool _locating = false;
  String? _key;
  dynamic _lastResponse;
  // The payment QR for the current total, and the reference printed in it.
  Json? _qr;
  final String _qrRef = checkoutId().replaceAll('-', '').substring(0, 10).toUpperCase();

  @override
  void initState() {
    super.initState();
    final app = context.read<AppState>();
    final user = app.user!;
    _items = List.of(app.cart);
    _name = TextEditingController(text: user.name);
    _phoneCtl = TextEditingController(text: user.phone);
    _emailCtl = TextEditingController(text: user.email);
    _address = TextEditingController(text: user.address);
    _proof = ProofData(payerName: user.name);
    // The area the shopper chose, then their own, as long as every item sells there; Nation Wide
    // is only for browsing.
    final fits = _choices(app);
    Area? pick(String? id) => fits.where((x) => x.id == id).firstOrNull;
    _area = pick(app.area?.isNationwide == true ? null : app.area?.id) ??
        pick(user.locationId) ??
        (fits.isNotEmpty ? fits.first : app.areaById(_items.first.product.locationId));
    _placePin(app);

    // Only the methods every product in the cart accepts.
    final ids = ({for (final i in _items) i.product.id}.toList()..sort()).join(',');
    _payments = Resource<List<PaymentMethod>>(() async {
      final list = asList(await app.api.get('/payments', query: {'products': ids})).map(PaymentMethod.fromJson).toList();
      if (!list.any((m) => m.id == _payment)) _payment = list.isEmpty ? '' : list.first.id;
      // The first method may have a QR, which comes with the quote.
      if (list.any((m) => m.id == _payment && m.hasQr)) Future.microtask(_loadQuote);
      return list;
    })..start();
    _offers = Resource<List<Json>>(() async => asList(await app.api.get('/coupons', query: {'location': _area?.id})))
      ..start();
    _loadQuote();
  }

  /// Delivery areas where every item in the cart can be delivered.
  List<Area> _choices(AppState app) => [
    for (final x in app.areas)
      if (_items.every((i) => i.product.sellsIn(x.id))) x,
  ];

  /// Puts the map pin where the shopper is, when that is inside the area, else at its centre.
  void _placePin(AppState app) {
    final area = _area;
    final here = app.coords;
    final near = area != null && here != null && distanceKm(here.lat, here.lng, area.lat, area.lng) <= area.radius;
    _pin = near ? LatLng(here.lat, here.lng) : LatLng(area?.lat ?? 33.6442, area?.lng ?? 73.0713);
  }

  @override
  void dispose() {
    for (final c in [_name, _phoneCtl, _emailCtl, _address, _notes, _coupon]) {
      c.dispose();
    }
    _proof.dispose();
    _payments.dispose();
    _offers.dispose();
    _scroll.dispose();
    super.dispose();
  }

  List<Json> get _lines => [
    for (final i in _items) {'product_id': i.product.id, 'quantity': i.quantity},
  ];
  int get _subtotal => _items.fold(0, (n, i) => n + i.total);

  /// Asks the server what this cart costs here, with the coupon. The server decides again when
  /// the order is placed; this is what the customer is shown first.
  Future<void> _loadQuote() async {
    final area = _area;
    if (area == null) return;
    final run = ++_quoteRun;
    setState(() {
      _quoting = true;
      _quoteError = null;
    });
    try {
      final q = asMap(
        await Api.instance.post('/quote', {
          'items': _lines,
          'location_id': area.id,
          'coupon_code': _applied,
          if (_qrMethod != null) 'payment_method': _qrMethod!.id,
          if (_qrMethod != null) 'reference': _qrRef,
        }),
      );
      if (!mounted || run != _quoteRun) return;
      setState(() {
        _quote = (
          subtotal: asInt(q['subtotal']),
          fee: asInt(q['delivery_fee']),
          discount: asInt(q['discount']),
          total: asInt(q['total']),
          outlets: asInt(q['outlets'], 1),
        );
        _qr = q['qr'] is Map ? asMap(q['qr']) : null;
        _quoting = false;
      });
    } catch (e) {
      if (!mounted || run != _quoteRun) return;
      setState(() {
        _quote = null;
        _quoteError = errorText(e);
        _quoting = false;
      });
    }
  }

  PaymentMethod? get _qrMethod => _payments.data?.where((m) => m.id == _payment && m.hasQr).firstOrNull;

  void _applyCoupon(String code) {
    FocusScope.of(context).unfocus();
    _applied = code.trim().toUpperCase();
    _coupon.text = _applied;
    _loadQuote();
  }

  Future<void> _locate() async {
    setState(() => _locating = true);
    final app = context.read<AppState>();
    try {
      final p = await currentPosition();
      setState(() => _pin = LatLng(double.parse(p.lat.toStringAsFixed(6)), double.parse(p.lng.toStringAsFixed(6))));
      app.notice('Location set (±${p.accuracy.round()} m). Adjust it on the map if needed.');
    } catch (e) {
      app.notice(errorText(e));
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  Future<void> _adjustPin() async {
    final picked = await Navigator.of(context).push<LatLng>(
      MaterialPageRoute(builder: (_) => MapPickerScreen(initial: _pin, area: _area)),
    );
    if (picked != null && mounted) setState(() => _pin = picked);
  }

  void _fail(String message) {
    setState(() => _error = message);
    _scroll.animateTo(0, duration: const Duration(milliseconds: 300), curve: Curves.easeOut);
  }

  Future<void> _submit() async {
    if (_busy) return;
    final app = context.read<AppState>();
    final nav = Navigator.of(context);
    final method = _payments.data?.where((m) => m.id == _payment).firstOrNull;
    if (!(_form.currentState?.validate() ?? false)) {
      _fail('Please complete the highlighted fields.');
      return;
    }
    if (method == null) {
      _fail('Choose a payment method.');
      return;
    }
    if (method.isOnline && method.requireProof && _proof.proofId == null) {
      _fail('Upload a screenshot of your payment receipt.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      _key ??= checkoutId();
      final order = Order.fromJson(
        asMap(
          _lastResponse = await app.api.post('/orders', {
            'items': _lines,
            'delivery': {
              'name': _name.text.trim(),
              'email': _emailCtl.text.trim(),
              'phone': _phoneCtl.text.trim(),
              'address': _address.text.trim(),
              'location_id': _area!.id,
              'lat': _pin.latitude,
              'lng': _pin.longitude,
              'notes': _notes.text.trim(),
            },
            'payment_method': _payment,
            if (method.isOnline) 'payment': _proof.toJson(),
            'coupon_code': _applied,
            'idempotency_key': _key,
          }),
        ),
      );
      // Back from the new order leads to the orders list.
      app.customerTab = 3;
      app.clearCart();
      // Items from several outlets became one order each: the orders list shows them all.
      final placed = asList(asMap(_lastResponse)['checkout']).length;
      if (placed > 1) {
        app.notice('$placed orders placed, one for each outlet.');
        nav.popUntil((route) => route.isFirst);
        app.goToTab(3);
        return;
      }
      nav.pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => OrderDetailScreen(id: order.id, preview: order, justPlaced: true)),
        (route) => route.isFirst,
      );
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        _fail(errorText(e));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final app = context.watch<AppState>();
    final area = _area;
    final quote = _quote;
    final fee = quote?.fee ?? (area?.fee ?? 0) * {for (final i in _items) i.product.outletId}.length;
    final total = quote?.total ?? _subtotal + fee;
    final km = area == null ? 0.0 : distanceKm(_pin.latitude, _pin.longitude, area.lat, area.lng);
    final outside = area != null && km > area.radius;

    return Scaffold(
      appBar: AppBar(title: const Text('Checkout')),
      body: ListenableBuilder(
        listenable: Listenable.merge([_payments, _offers]),
        builder: (context, _) {
          final payments = _payments.data;
          final method = payments?.where((m) => m.id == _payment).firstOrNull;
          final offers = _offers.data ?? [];
          return Form(
            key: _form,
            child: ListView(
              controller: _scroll,
              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
              children: [
                if (app.site.checkoutPaused) ...[
                  Notice(app.site.checkoutMessage, tone: Tone.amber, icon: Icons.pause_circle_outline_rounded),
                  const SizedBox(height: 12),
                ],
                if (_error != null) ...[Notice(_error!, tone: Tone.red), const SizedBox(height: 12)],

                _Step(
                  number: 1,
                  title: 'Contact & address',
                  child: Column(
                    children: [
                      TextFormField(
                        controller: _name,
                        maxLength: 100,
                        textCapitalization: TextCapitalization.words,
                        textInputAction: TextInputAction.next,
                        decoration: const InputDecoration(labelText: 'Full name', counterText: ''),
                        validator: (v) => (v ?? '').trim().isEmpty ? 'Enter your name.' : null,
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: _phoneCtl,
                        maxLength: 20,
                        keyboardType: TextInputType.phone,
                        textInputAction: TextInputAction.next,
                        decoration: const InputDecoration(labelText: 'Phone number', counterText: ''),
                        validator: (v) => _phone.hasMatch((v ?? '').trim()) ? null : 'Enter a valid phone number.',
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: _emailCtl,
                        maxLength: 200,
                        keyboardType: TextInputType.emailAddress,
                        textInputAction: TextInputAction.next,
                        decoration: const InputDecoration(labelText: 'Email', counterText: ''),
                        validator: (v) => _email.hasMatch((v ?? '').trim()) ? null : 'Enter a valid email address.',
                      ),
                      const SizedBox(height: 12),
                      if (_choices(app).length > 1)
                        DropdownButtonFormField<String>(
                          initialValue: area?.id,
                          isExpanded: true,
                          decoration: const InputDecoration(labelText: 'Delivery area', prefixIcon: Icon(Icons.location_on_outlined)),
                          items: [
                            for (final x in _choices(app)) DropdownMenuItem(value: x.id, child: Text(x.name, overflow: TextOverflow.ellipsis)),
                          ],
                          onChanged: (id) {
                            setState(() {
                              _area = app.areaById(id);
                              _placePin(app);
                            });
                            _loadQuote();
                          },
                        )
                      else
                        InputDecorator(
                          decoration: const InputDecoration(labelText: 'Delivery area', prefixIcon: Icon(Icons.location_on_outlined)),
                          child: Text(area?.name ?? 'Unknown area', style: context.t.bodyLarge!.copyWith(color: c.ink)),
                        ),
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: _address,
                        maxLength: 500,
                        minLines: 2,
                        maxLines: 3,
                        textCapitalization: TextCapitalization.sentences,
                        decoration: const InputDecoration(
                          labelText: 'Address',
                          hintText: 'House, street and nearby landmark',
                          counterText: '',
                          alignLabelWithHint: true,
                        ),
                        validator: (v) => (v ?? '').trim().isEmpty ? 'Enter your delivery address.' : null,
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: _notes,
                        maxLength: 2000,
                        minLines: 1,
                        maxLines: 3,
                        textCapitalization: TextCapitalization.sentences,
                        decoration: const InputDecoration(
                          labelText: 'Notes for rider (optional)',
                          hintText: 'Gate code, floor, landmark…',
                          counterText: '',
                        ),
                      ),
                    ],
                  ),
                ),

                _Step(
                  number: 2,
                  title: 'Pin your doorstep',
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      PinPreview(point: _pin, onTap: _adjustPin),
                      const SizedBox(height: 10),
                      Row(
                        children: [
                          Expanded(
                            child: AppButton(
                              _locating ? 'Locating…' : 'Use my location',
                              small: true,
                              outlined: true,
                              busy: _locating,
                              icon: Icons.my_location_rounded,
                              onPressed: _locate,
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: AppButton('Adjust on map', small: true, outlined: true, icon: Icons.map_outlined, onPressed: _adjustPin),
                          ),
                        ],
                      ),
                      if (outside) ...[
                        const SizedBox(height: 10),
                        Notice(
                          'This pin is ${km.toStringAsFixed(1)} km from ${area.name}. Deliveries reach up to ${area.radius.toStringAsFixed(area.radius % 1 == 0 ? 0 : 1)} km.',
                          tone: Tone.amber,
                          icon: Icons.location_off_outlined,
                        ),
                      ],
                    ],
                  ),
                ),

                _Step(
                  number: 3,
                  title: 'Payment',
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (payments == null && _payments.error != null)
                        ErrorState(_payments.error!, onRetry: _payments.refresh)
                      else if (payments == null)
                        const Skeleton(height: 64, radius: 14)
                      else if (payments.isEmpty)
                        Notice(
                          _items.length > 1
                              ? 'The items in your cart do not share a payment method. Remove an item and order it separately.'
                              : 'This item cannot be ordered right now because no payment method is available for it.',
                          tone: Tone.red,
                        )
                      else
                        for (final m in payments)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: AppCard(
                              padding: const EdgeInsets.all(12),
                              radius: 14,
                              color: m.id == _payment ? c.brand50 : c.surface,
                              borderColor: m.id == _payment ? c.brand : c.line,
                              onTap: () {
                                setState(() => _payment = m.id);
                                _loadQuote();
                              },
                              child: Row(
                                children: [
                                  PaymentLogo(m),
                                  const SizedBox(width: 12),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(m.name, style: context.t.titleSmall),
                                        Text(m.subtitle, style: context.t.bodySmall),
                                      ],
                                    ),
                                  ),
                                  Icon(
                                    m.id == _payment ? Icons.radio_button_checked_rounded : Icons.radio_button_off_rounded,
                                    color: m.id == _payment ? c.brand : c.lineStrong,
                                  ),
                                ],
                              ),
                            ),
                          ),
                      if (method != null && method.isOnline) ...[
                        const SizedBox(height: 4),
                        for (final (i, text) in [
                          'Send ${money(total)} to the account below',
                          'Enter the transaction details from your receipt',
                          'We verify the payment, then your order is accepted',
                        ].indexed)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 8),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Container(
                                  width: 20,
                                  height: 20,
                                  alignment: Alignment.center,
                                  decoration: BoxDecoration(color: c.ink, shape: BoxShape.circle),
                                  child: Text('${i + 1}', style: TextStyle(color: c.surface, fontSize: 11, fontWeight: FontWeight.w800, height: 1)),
                                ),
                                const SizedBox(width: 10),
                                Expanded(child: Text(text, style: context.t.bodyMedium)),
                              ],
                            ),
                          ),
                        const SizedBox(height: 4),
                        if (method.hasQr) ...[_PayQr(_qr, loading: _quoting), const SizedBox(height: 10)],
                        AccountDetails(method),
                        if (method.instructions.isNotEmpty) ...[
                          const SizedBox(height: 10),
                          Text(method.instructions, style: context.t.bodySmall),
                        ],
                        const SizedBox(height: 14),
                        ProofFields(data: _proof, requireProof: method.requireProof),
                      ] else if (method != null && method.instructions.isNotEmpty)
                        Text(method.instructions, style: context.t.bodySmall),
                    ],
                  ),
                ),

                _Step(
                  number: 4,
                  title: 'Order summary',
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(_items.first.product.outletName, style: context.t.bodySmall),
                      const SizedBox(height: 8),
                      for (final i in _items)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: Row(
                            children: [
                              NetImage(i.product.image, width: 46, height: 46, radius: 10),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(i.product.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.t.titleSmall),
                                    Text('Qty ${i.quantity}', style: context.t.bodySmall),
                                  ],
                                ),
                              ),
                              Text(money(i.total), style: context.t.titleSmall),
                            ],
                          ),
                        ),
                      Divider(height: 14, color: c.line),
                      const SizedBox(height: 6),
                      Row(
                        children: [
                          Expanded(
                            child: TextField(
                              controller: _coupon,
                              maxLength: 30,
                              enabled: _applied.isEmpty,
                              textCapitalization: TextCapitalization.characters,
                              decoration: const InputDecoration(
                                hintText: 'Coupon code',
                                counterText: '',
                                prefixIcon: Icon(Icons.local_offer_outlined, size: 20),
                              ),
                            ),
                          ),
                          const SizedBox(width: 10),
                          _applied.isEmpty
                              ? AppButton('Apply', expand: false, outlined: true, onPressed: () => _applyCoupon(_coupon.text))
                              : AppButton('Remove', expand: false, outlined: true, danger: true, onPressed: () => _applyCoupon('')),
                        ],
                      ),
                      if (_applied.isEmpty && offers.isNotEmpty) ...[
                        const SizedBox(height: 10),
                        for (final o in offers)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 8),
                            child: AppCard(
                              radius: 14,
                              color: c.orange50,
                              borderColor: c.orange.withValues(alpha: 0.35),
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                              onTap: () => _applyCoupon(asString(o['code'])),
                              child: Row(
                                children: [
                                  Icon(Icons.confirmation_number_outlined, color: c.orange, size: 20),
                                  const SizedBox(width: 10),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(asString(o['code']), style: context.t.titleSmall),
                                        Text(
                                          asString(o['description']).isNotEmpty ? asString(o['description']) : asString(o['name']),
                                          style: context.t.bodySmall,
                                          maxLines: 2,
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                      ],
                                    ),
                                  ),
                                  Text('Apply', style: TextStyle(color: c.brand, fontWeight: FontWeight.w800, fontSize: 13)),
                                ],
                              ),
                            ),
                          ),
                      ],
                      if (_quoteError != null) ...[const SizedBox(height: 10), Notice(_quoteError!, tone: Tone.red)],
                      const SizedBox(height: 10),
                      SummaryLine('Subtotal', money(quote?.subtotal ?? _subtotal)),
                      SummaryLine(
                        (quote?.outlets ?? 1) > 1 ? 'Delivery · ${quote!.outlets} outlets' : 'Delivery',
                        fee == 0 ? 'Free' : money(fee),
                      ),
                      if (area != null && area.freeDeliveryOver > 0 && fee > 0)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 4),
                          child: Text('Free delivery on orders over ${money(area.freeDeliveryOver)}.', style: context.t.bodySmall),
                        ),
                      if (quote != null && quote.discount > 0)
                        SummaryLine('Discount${_applied.isEmpty ? '' : ' · $_applied'}', '−${money(quote.discount)}', tone: Tone.green),
                      Divider(height: 18, color: c.line),
                      SummaryLine('Total', money(total), bold: true),
                    ],
                  ),
                ),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.verified_user_outlined, size: 15, color: c.muted),
                    const SizedBox(width: 6),
                    Flexible(
                      child: Text('You’ll get a delivery code to share with your rider.', style: context.t.bodySmall),
                    ),
                  ],
                ),
              ],
            ),
          );
        },
      ),
      bottomNavigationBar: ListenableBuilder(
        listenable: _payments,
        builder: (context, _) {
          final method = _payments.data?.where((m) => m.id == _payment).firstOrNull;
          final ready = method != null && quote != null && !_quoting && _quoteError == null && !app.site.checkoutPaused;
          return BottomBar(
            child: Row(
              children: [
                Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Total', style: context.t.bodySmall),
                    Text(money(total), style: context.t.titleLarge!.copyWith(fontWeight: FontWeight.w800)),
                  ],
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: AppButton(
                    method != null && method.isOnline ? 'Submit payment & order' : 'Place order',
                    busy: _busy,
                    onPressed: ready ? _submit : null,
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _Step extends StatelessWidget {
  const _Step({required this.number, required this.title, required this.child});
  final int number;
  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: AppCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 26,
                  height: 26,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(gradient: c.gradient, shape: BoxShape.circle),
                  child: Text('$number', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 13, height: 1)),
                ),
                const SizedBox(width: 10),
                Text(title, style: context.t.titleMedium),
              ],
            ),
            const SizedBox(height: 14),
            child,
          ],
        ),
      ),
    );
  }
}

/// The payment QR for this exact total: scanned with JazzCash, Easypaisa or a banking app, a
/// standard QR fills in the merchant and the amount by itself.
class _PayQr extends StatelessWidget {
  const _PayQr(this.qr, {required this.loading});
  final Json? qr;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final q = qr;
    if (q == null) {
      return AppCard(
        color: c.soft,
        child: Text(loading ? 'Preparing your payment QR…' : 'The payment QR could not be loaded.', style: context.t.bodySmall),
      );
    }
    final image = base64Decode(asString(q['image']).split(',').last);
    final dynamicQr = asBool(q['dynamic']);
    return AppCard(
      child: Column(
        children: [
          Text('Scan to pay ${money(asInt(q['amount']))}', style: context.t.titleMedium),
          const SizedBox(height: 2),
          Text(
            'To ${asString(q['merchant_name'])}${asString(q['account']).isEmpty ? '' : ' · ${asString(q['account'])}'}',
            style: context.t.bodySmall,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: c.line)),
            child: Image.memory(image, width: 210, height: 210, gaplessPlayback: true),
          ),
          const SizedBox(height: 10),
          Text(
            dynamicQr
                ? 'Scan this Raast QR with JazzCash, Easypaisa or your banking app on another phone; the account and amount fill in by themselves. Paying from this phone? Take a screenshot and choose it with "scan from gallery" in your wallet app.${asInt(q['valid_minutes']) > 0 ? ' It works for ${asInt(q['valid_minutes'])} minutes.' : ''}'
                : 'Scan with your wallet or banking app and enter ${money(asInt(q['amount']))} yourself.',
            textAlign: TextAlign.center,
            style: context.t.bodySmall,
          ),
        ],
      ),
    );
  }
}

