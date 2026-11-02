import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:latlong2/latlong.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/links.dart';
import '../../core/resource.dart';
import '../../core/theme.dart';
import '../../models/models.dart';
import '../../state/app_state.dart';
import '../../widgets/common.dart';
import '../../widgets/maps.dart';
import '../../widgets/order_widgets.dart';
import '../../widgets/payment_widgets.dart';
import '../shared/image_view_screen.dart';
import '../shared/support_chat_screen.dart';

/// A customer's view of one order: where it is, the delivery code, the payment and the bill.
class OrderDetailScreen extends StatefulWidget {
  const OrderDetailScreen({super.key, required this.id, this.preview, this.justPlaced = false});
  final String id;
  final Order? preview;

  /// Opened straight from checkout, so the order is celebrated first.
  final bool justPlaced;

  @override
  State<OrderDetailScreen> createState() => _OrderDetailScreenState();
}

class _OrderDetailScreenState extends State<OrderDetailScreen> {
  late final Resource<Order> _order;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    final api = context.read<AppState>().api;
    _order = Resource<Order>(
      () async => Order.fromJson(asMap(await api.get('/orders/${widget.id}'))),
      every: const Duration(seconds: 10),
    );
    if (widget.preview != null) _order.data = widget.preview;
    _order.start();
  }

  @override
  void dispose() {
    _order.dispose();
    super.dispose();
  }

  Future<void> _cancel(Order o) async {
    final app = context.read<AppState>();
    final yes = await showConfirm(
      context,
      title: 'Cancel this order?',
      message: o.online && o.paymentStatus == 'paid'
          ? 'Your online payment will be refunded by Dellvit.'
          : 'The outlet and rider will be notified.',
      confirm: 'Cancel order',
      cancel: 'Keep order',
      danger: true,
    );
    if (!yes) return;
    setState(() => _busy = true);
    try {
      await app.api.patch('/orders/${o.id}/status', {'status': 'cancelled'});
      app.notice('Order cancelled.');
      await _order.refresh(silent: true);
    } catch (e) {
      app.notice(errorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return ListenableBuilder(
      listenable: _order,
      builder: (context, _) {
        final o = _order.data;
        if (o == null) {
          return Scaffold(
            appBar: AppBar(title: const Text('Order')),
            body: _order.error != null ? ErrorState(_order.error!, onRetry: _order.refresh) : const LoadingView(),
          );
        }
        final done = o.closed;
        return Scaffold(
          appBar: AppBar(
            title: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(o.reference, style: context.t.titleMedium),
                Text('Placed ${dateTime(o.createdAt)}', style: context.t.bodySmall),
              ],
            ),
            actions: [
              IconButton(
                tooltip: 'Copy order number',
                icon: const Icon(Icons.copy_rounded, size: 20),
                onPressed: () {
                  Clipboard.setData(ClipboardData(text: o.reference));
                  context.read<AppState>().notice('Order number copied');
                },
              ),
            ],
          ),
          body: RefreshIndicator(
            color: c.brand,
            onRefresh: () => _order.refresh(silent: true),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 28),
              children: [
                if (widget.justPlaced && !done) ...[
                  const Notice(
                    'We’ve received your order. You can follow every step here.',
                    title: 'Order placed!',
                    tone: Tone.green,
                    icon: Icons.celebration_outlined,
                  ),
                  const SizedBox(height: 12),
                ],
                _Headline(o),
                const SizedBox(height: 12),
                if (o.status == 'cancelled') ...[
                  Notice(
                    [
                      'This order was cancelled${switch (o.flow.cancelledBy) {
                        'outlet' => ' by the outlet',
                        'customer' => ' at your request',
                        'system' => ' because the payment failed',
                        _ => ' by Dellvit',
                      }}.',
                      if (o.flow.cancelReason.isNotEmpty) 'Reason: ${o.flow.cancelReason}',
                      if (o.paymentStatus == 'refund_due') 'Your payment will be refunded shortly.',
                      if (o.paymentStatus == 'refunded') 'Your payment has been refunded.',
                    ].join(' '),
                    tone: Tone.red,
                    icon: Icons.cancel_outlined,
                  ),
                  const SizedBox(height: 12),
                ] else ...[
                  if (o.otp.isNotEmpty && !done) ...[_OtpCard(o.otp), const SizedBox(height: 12)],
                  AppCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Progress', style: context.t.titleMedium),
                        const SizedBox(height: 14),
                        OrderStepper(o),
                      ],
                    ),
                  ),
                  const SizedBox(height: 12),
                ],
                _PaymentCard(order: o, onChanged: () => _order.refresh(silent: true)),
                const SizedBox(height: 12),
                AppCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(child: Text('Delivery', style: context.t.titleMedium)),
                          if (o.hasRider && !done && o.riderPhone.isNotEmpty)
                            AppButton(
                              'Call ${o.riderName.split(' ').first}',
                              small: true,
                              expand: false,
                              outlined: true,
                              icon: Icons.call_outlined,
                              onPressed: () => callPhone(o.riderPhone),
                            ),
                        ],
                      ),
                      const SizedBox(height: 14),
                      RouteCard(o),
                      const SizedBox(height: 14),
                      if (o.hasRider)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: Row(
                            children: [
                              Avatar(o.riderName, size: 36),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(o.riderName, style: context.t.titleSmall),
                                    Text(
                                      o.riderLat != null
                                          ? 'Location shared ${ago(o.riderSeenAt).toLowerCase()}'
                                          : done
                                          ? 'Your rider'
                                          : 'Your rider · live location appears on the way',
                                      style: context.t.bodySmall,
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        )
                      else if (!done)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: Text('A rider will be assigned shortly.', style: context.t.bodySmall),
                        ),
                      DeliveryMap(
                        drop: LatLng(o.lat, o.lng),
                        pickup: o.outletLat == 0 && o.outletLng == 0 ? null : LatLng(o.outletLat, o.outletLng),
                        rider: o.riderLat == null ? null : LatLng(o.riderLat!, o.riderLng!),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                OrderItemsCard(o),
                const SizedBox(height: 16),
                AppButton(
                  'Get help with this order',
                  outlined: true,
                  icon: Icons.support_agent_rounded,
                  onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SupportChatScreen())),
                ),
                if (o.canCancel) ...[
                  const SizedBox(height: 10),
                  AppButton('Cancel order', outlined: true, danger: true, busy: _busy, onPressed: () => _cancel(o)),
                ],
              ],
            ),
          ),
        );
      },
    );
  }
}

/// The big status at the top: what is happening now and when the order should arrive.
class _Headline extends StatelessWidget {
  const _Headline(this.order);
  final Order order;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final o = order;
    final cancelled = o.status == 'cancelled';
    final delivered = o.status == 'delivered';
    final message = switch (o.status) {
      'placed' =>
        !o.paymentVerified
            ? (o.paymentStatus == 'rejected'
                  ? 'Your payment could not be verified. Please update the details below.'
                  : 'We’re verifying your payment. Your order will be confirmed right after.')
            : (o.flow.sentAt != null
                  ? 'We’re confirming your order with the outlet and a rider.'
                  : 'We’re assigning a rider to your order.'),
      'confirmed' => 'The outlet and your rider have accepted your order.',
      'preparing' => 'The outlet is preparing your order.',
      'ready' => 'Your order is packed and waiting for the rider.',
      'picked_up' => 'Your rider has picked up your order.',
      'delivered' => 'Delivered ${dateTime(o.deliveredAt)}. Enjoy!',
      _ => 'This order will not be delivered.',
    };
    final icon = switch (o.status) {
      'delivered' => Icons.check_circle_rounded,
      'cancelled' => Icons.cancel_rounded,
      'picked_up' => Icons.two_wheeler_rounded,
      'ready' => Icons.inventory_2_rounded,
      'preparing' => Icons.soup_kitchen_rounded,
      'confirmed' => Icons.thumb_up_alt_rounded,
      _ => Icons.hourglass_top_rounded,
    };
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: cancelled ? null : c.gradient,
        color: cancelled ? c.soft : null,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: cancelled ? c.surface : Colors.white.withValues(alpha: 0.22),
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, color: cancelled ? c.muted : Colors.white),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  o.customerHeadline,
                  style: TextStyle(
                    color: cancelled ? c.ink : Colors.white,
                    fontSize: 21,
                    fontWeight: FontWeight.w800,
                    height: 1.2,
                    letterSpacing: -0.4,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            message,
            style: TextStyle(
              color: cancelled ? c.text : Colors.white.withValues(alpha: 0.95),
              fontSize: 13.5,
              fontWeight: FontWeight.w600,
              height: 1.4,
            ),
          ),
          if (!cancelled && !delivered) ...[
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
              decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.18), borderRadius: BorderRadius.circular(12)),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.schedule_rounded, color: Colors.white, size: 17),
                  const SizedBox(width: 8),
                  const Text('Arriving in  ', style: TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600)),
                  Countdown(
                    deadline: o.deliverBy,
                    pending: o.status == 'placed',
                    style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.w800),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _OtpCard extends StatelessWidget {
  const _OtpCard(this.otp);
  final String otp;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return AppCard(
      color: c.green50,
      borderColor: c.green.withValues(alpha: 0.35),
      child: Row(
        children: [
          Icon(Icons.verified_user_rounded, color: c.green, size: 30),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Delivery code', style: context.t.titleSmall!.copyWith(color: c.successInk)),
                Text('Share it with your rider only when the order arrives.', style: context.t.bodySmall!.copyWith(color: c.successInk)),
              ],
            ),
          ),
          const SizedBox(width: 10),
          Text(
            otp,
            style: TextStyle(color: c.successInk, fontSize: 26, fontWeight: FontWeight.w800, letterSpacing: 3, height: 1),
          ),
        ],
      ),
    );
  }
}

class _PaymentCard extends StatefulWidget {
  const _PaymentCard({required this.order, required this.onChanged});
  final Order order;
  final VoidCallback onChanged;

  @override
  State<_PaymentCard> createState() => _PaymentCardState();
}

class _PaymentCardState extends State<_PaymentCard> {
  final _form = GlobalKey<FormState>();
  late final ProofData _proof = ProofData(payerName: widget.order.payerName, payerAccount: widget.order.payerAccount);
  bool _busy = false;

  @override
  void dispose() {
    _proof.dispose();
    super.dispose();
  }

  Future<void> _resubmit() async {
    if (!(_form.currentState?.validate() ?? false)) return;
    final app = context.read<AppState>();
    setState(() => _busy = true);
    try {
      await app.api.post('/orders/${widget.order.id}/payment', _proof.toJson());
      app.notice('Payment details submitted for verification.');
      widget.onChanged();
    } catch (e) {
      app.notice(errorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final o = widget.order;
    final rejected = o.paymentStatus == 'rejected' && o.status != 'cancelled';
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Payment', style: context.t.titleMedium),
          const SizedBox(height: 12),
          PaymentLine(o),
          if (o.online) ...[
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(child: _Fact('Transaction ID', o.transactionId.isEmpty ? '—' : o.transactionId)),
                Expanded(child: _Fact('Sender', o.payerName.isEmpty ? '—' : o.payerName)),
              ],
            ),
            if (o.proofUrl.isNotEmpty) ...[
              const SizedBox(height: 12),
              InkWell(
                borderRadius: BorderRadius.circular(12),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => ImageViewScreen(path: o.proofUrl, title: 'Payment receipt', private: true)),
                ),
                child: Row(
                  children: [
                    NetImage(o.proofUrl, width: 48, height: 48, radius: 10, private: true, icon: Icons.receipt_long_outlined),
                    const SizedBox(width: 10),
                    Text('View receipt', style: TextStyle(color: c.brand, fontWeight: FontWeight.w700, fontSize: 13.5)),
                  ],
                ),
              ),
            ],
            if (o.paymentStatus != 'paid' && !rejected && !o.closed && o.paymentStatus != 'refund_due') ...[
              const SizedBox(height: 12),
              const Notice(
                'We’re verifying your payment. The outlet will accept your order once it’s confirmed.',
                icon: Icons.schedule_rounded,
              ),
            ],
          ],
          if (rejected) ...[
            const SizedBox(height: 12),
            Notice(o.paymentNote, title: 'Payment not verified:', tone: Tone.red),
            const SizedBox(height: 12),
            AccountDetails(o.paymentDetails),
            const SizedBox(height: 12),
            Form(key: _form, child: ProofFields(data: _proof)),
            const SizedBox(height: 12),
            AppButton('Resubmit payment details', busy: _busy, onPressed: _resubmit),
          ],
        ],
      ),
    );
  }
}

class _Fact extends StatelessWidget {
  const _Fact(this.name, this.value);
  final String name, value;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(name, style: context.t.bodySmall),
      const SizedBox(height: 2),
      Text(value, style: context.t.titleSmall, maxLines: 1, overflow: TextOverflow.ellipsis),
    ],
  );
}
