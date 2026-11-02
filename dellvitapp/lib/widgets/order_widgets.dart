import 'dart:async';

import 'package:flutter/material.dart';

import '../core/format.dart';
import '../core/links.dart';
import '../core/theme.dart';
import '../models/models.dart';
import 'common.dart';

/// Time left until an order is due, counting down every second.
class Countdown extends StatefulWidget {
  const Countdown({super.key, required this.deadline, this.pending = false, this.style});
  final String deadline;

  /// The order is not confirmed yet, so the clock has not started.
  final bool pending;
  final TextStyle? style;

  @override
  State<Countdown> createState() => _CountdownState();
}

class _CountdownState extends State<Countdown> {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.pending) return Text('Starts after confirmation', style: widget.style);
    final due = parseTime(widget.deadline);
    final seconds = due == null ? 0 : due.difference(DateTime.now()).inSeconds;
    final late = seconds <= 0;
    return Text(
      late ? 'Running late' : '${seconds ~/ 60}m ${(seconds % 60).toString().padLeft(2, '0')}s',
      style: (widget.style ?? const TextStyle()).copyWith(color: late ? context.c.brand : null),
    );
  }
}

/// An order in a list, for any role. [subtitle] says who or what the order is for.
class OrderCard extends StatelessWidget {
  const OrderCard({super.key, required this.order, required this.title, required this.amount, this.onTap, this.footer, this.note});
  final Order order;
  final String title;
  final int amount;
  final VoidCallback? onTap;

  /// Buttons under the order, such as Accept and Decline.
  final Widget? footer;

  /// A short line under the status, e.g. "Verifying payment".
  final String? note;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return AppCard(
      padding: const EdgeInsets.all(12),
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              NetImage(order.items.isEmpty ? '' : order.items.first.image, width: 58, height: 58, radius: 12),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.t.titleSmall),
                        ),
                        const SizedBox(width: 8),
                        StatusBadge(order.status, dense: true),
                      ],
                    ),
                    const SizedBox(height: 3),
                    Text(order.itemsText, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.t.bodySmall),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        Text(money(amount), style: context.t.titleSmall!.copyWith(fontWeight: FontWeight.w800)),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            '${order.reference} · ${dateTime(order.createdAt)}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            textAlign: TextAlign.end,
                            style: context.t.bodySmall!.copyWith(fontSize: 11.5),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (note != null && note!.isNotEmpty) ...[
            const SizedBox(height: 10),
            Row(
              children: [
                Icon(Icons.info_outline_rounded, size: 15, color: c.muted),
                const SizedBox(width: 6),
                Expanded(child: Text(note!, style: context.t.bodySmall, maxLines: 2, overflow: TextOverflow.ellipsis)),
              ],
            ),
          ],
          if (footer != null) ...[const SizedBox(height: 12), footer!],
        ],
      ),
    );
  }
}

/// The steps an order goes through, top to bottom, with the time each was reached.
class OrderStepper extends StatelessWidget {
  const OrderStepper(this.order, {super.key});
  final Order order;

  static const _stages = ['placed', 'payment_verified', 'confirmed', 'preparing', 'ready', 'picked_up', 'delivered'];
  static const _titles = {
    'placed': 'Order placed',
    'payment_verified': 'Payment verified',
    'confirmed': 'Confirmed by outlet & rider',
    'preparing': 'Being prepared',
    'ready': 'Ready for pickup',
    'picked_up': 'On the way',
    'delivered': 'Delivered',
  };

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    // Payment verification sits between placing and confirming the order.
    final current = order.status == 'placed' ? (order.paymentVerified ? 1 : 0) : _stages.indexOf(order.status);
    return Column(
      children: [
        for (var i = 0; i < _stages.length; i++)
          () {
            final stage = _stages[i];
            final done = i <= current;
            final isCurrent = i == current && order.status != 'delivered';
            OrderEvent? event;
            for (final e in order.events.reversed) {
              if (e.status == stage) {
                event = e;
                break;
              }
            }
            return IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  SizedBox(
                    width: 30,
                    child: Column(
                      children: [
                        Container(
                          width: 24,
                          height: 24,
                          decoration: BoxDecoration(
                            color: done ? c.green : c.surface,
                            shape: BoxShape.circle,
                            border: Border.all(color: done ? c.green : c.lineStrong, width: 2),
                          ),
                          child: done
                              ? const Icon(Icons.check_rounded, color: Colors.white, size: 15)
                              : Center(
                                  child: Text('${i + 1}', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: c.muted, height: 1)),
                                ),
                        ),
                        if (i < _stages.length - 1)
                          Expanded(
                            child: Container(width: 2, color: i < current ? c.green : c.line),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Padding(
                      padding: EdgeInsets.only(top: 2, bottom: i < _stages.length - 1 ? 16 : 0),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: Text(
                              _titles[stage]!,
                              style: context.t.bodyMedium!.copyWith(
                                color: done ? c.ink : c.muted,
                                fontWeight: isCurrent ? FontWeight.w800 : (done ? FontWeight.w600 : FontWeight.w500),
                              ),
                            ),
                          ),
                          Text(
                            event != null
                                ? timeText(event.createdAt)
                                : stage == 'payment_verified' && !order.paymentVerified && order.status == 'placed'
                                ? 'Pending'
                                : '',
                            style: context.t.bodySmall,
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            );
          }(),
      ],
    );
  }
}

/// Where the order is collected and where it goes, with call and map shortcuts.
class RouteCard extends StatelessWidget {
  const RouteCard(this.order, {super.key, this.contacts = false});
  final Order order;

  /// Riders and outlets get the phone numbers and map links; customers do not need them.
  final bool contacts;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    Widget stop({
      required IconData icon,
      required Tone tone,
      required String kind,
      required String name,
      required String address,
      String phone = '',
      double? lat,
      double? lng,
      bool last = false,
    }) => IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Column(
            children: [
              IconBubble(icon, tone: tone, size: 36),
              if (!last) Expanded(child: Container(width: 2, margin: const EdgeInsets.symmetric(vertical: 4), color: c.line)),
            ],
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(bottom: last ? 0 : 14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(kind.toUpperCase(), style: context.t.labelSmall),
                  const SizedBox(height: 2),
                  Text(name, style: context.t.titleSmall),
                  Text(address, style: context.t.bodySmall),
                  if (contacts) ...[
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      runSpacing: 6,
                      children: [
                        if (phone.isNotEmpty)
                          ActionChip(
                            avatar: Icon(Icons.call_outlined, size: 16, color: c.brand),
                            label: Text(phone),
                            onPressed: () => callPhone(phone),
                          ),
                        if (lat != null && lng != null && (lat != 0 || lng != 0))
                          ActionChip(
                            avatar: Icon(Icons.directions_outlined, size: 16, color: c.brand),
                            label: const Text('Directions'),
                            onPressed: () => openDirections(lat, lng),
                          ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        stop(
          icon: Icons.storefront_outlined,
          tone: Tone.orange,
          kind: 'Pickup',
          name: order.outletName,
          address: order.outletAddress,
          phone: order.outletPhone,
          lat: order.outletLat,
          lng: order.outletLng,
        ),
        stop(
          icon: Icons.home_outlined,
          tone: Tone.brand,
          kind: 'Deliver to',
          name: order.name,
          address: order.address,
          phone: order.phone,
          lat: order.lat,
          lng: order.lng,
          last: true,
        ),
        if (order.notes.isNotEmpty) ...[
          const SizedBox(height: 12),
          Notice('“${order.notes}”', title: 'Customer note:', tone: Tone.neutral, icon: Icons.sticky_note_2_outlined),
        ],
      ],
    );
  }
}

/// The items of an order with its totals. Outlets see the item value; others the full bill.
class OrderItemsCard extends StatelessWidget {
  const OrderItemsCard(this.order, {super.key, this.itemsOnly = false});
  final Order order;
  final bool itemsOnly;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Items', style: context.t.titleMedium),
          const SizedBox(height: 10),
          for (final i in order.items)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Row(
                children: [
                  NetImage(i.image, width: 46, height: 46, radius: 10),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(i.name, maxLines: 2, overflow: TextOverflow.ellipsis, style: context.t.titleSmall),
                        Text('${i.quantity} × ${money(i.unitPrice)}', style: context.t.bodySmall),
                      ],
                    ),
                  ),
                  Text(money(i.unitPrice * i.quantity), style: context.t.titleSmall),
                ],
              ),
            ),
          Divider(height: 12, color: c.line),
          const SizedBox(height: 4),
          if (itemsOnly)
            SummaryLine('Items value', money(order.subtotal), bold: true)
          else ...[
            SummaryLine('Subtotal', money(order.subtotal)),
            SummaryLine('Delivery', order.deliveryFee == 0 ? 'Free' : money(order.deliveryFee)),
            if (order.discount > 0)
              SummaryLine('Coupon ${order.couponCode}'.trim(), '−${money(order.discount)}', tone: Tone.green),
            Divider(height: 16, color: c.line),
            SummaryLine('Total', money(order.total), bold: true),
          ],
        ],
      ),
    );
  }
}

/// Method and status of an order's payment in one line.
class PaymentLine extends StatelessWidget {
  const PaymentLine(this.order, {super.key});
  final Order order;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      PaymentLogo(order.paymentDetails, size: 34),
      const SizedBox(width: 10),
      Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(order.paymentName, style: context.t.titleSmall, maxLines: 1, overflow: TextOverflow.ellipsis),
            Text(paymentTypeLabels[order.paymentType] ?? 'Payment', style: context.t.bodySmall),
          ],
        ),
      ),
      StatusBadge(
        order.paymentStatus,
        text: order.paymentLabel,
      ),
    ],
  );
}
