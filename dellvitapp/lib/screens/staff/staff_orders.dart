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

/// Order work for the two staff roles the app serves. Every step has exactly one owner:
/// the outlet prepares, the rider collects and delivers.
enum StaffRole { outlet, rider }

/// Where an order sits in a staff member's day.
enum OrderBucket { requests, active, done, cancelled }

OrderBucket bucketOf(Order o, StaffRole role) {
  if (o.status == 'cancelled') return OrderBucket.cancelled;
  if (o.status == 'delivered') return OrderBucket.done;
  final pending = role == StaffRole.outlet
      ? o.status == 'placed' && o.flow.outletStatus == 'pending'
      : o.flow.riderStatus == 'pending';
  return pending ? OrderBucket.requests : OrderBucket.active;
}

/// A plain-language line about what the order is waiting for.
String staffNote(Order o, StaffRole role) {
  if (o.closed) return '';
  if (role == StaffRole.outlet) {
    if (o.flow.cancelRequest.isNotEmpty) return 'Cancellation requested. Dellvit is reviewing it.';
    return switch (o.status) {
      'placed' => o.flow.outletStatus == 'pending' ? 'New order. Accept or reject it.' : 'Accepted. Waiting for the rider to accept.',
      'confirmed' => 'Confirmed. Start preparing.',
      'preparing' => 'In the kitchen. Mark it ready when packed.',
      'ready' => o.hasRider ? 'Waiting for ${o.riderName.split(' ').first} to collect.' : 'Waiting for a rider.',
      'picked_up' => 'On the way to the customer.',
      _ => '',
    };
  }
  if (o.flow.riderStatus == 'pending') return 'New delivery request. Accept or decline.';
  return switch (o.status) {
    'placed' => 'Accepted. Waiting for the outlet to accept.',
    'confirmed' => 'Confirmed. The outlet will start preparing.',
    'preparing' => 'Being prepared at ${o.outletName}.',
    'ready' => 'Ready. Collect it from ${o.outletName}.',
    'picked_up' => 'Deliver to ${o.name} and ask for the code.',
    _ => '',
  };
}

Future<bool> _run(BuildContext context, Future<dynamic> Function(Api api) call, String done) async {
  final app = context.read<AppState>();
  try {
    await call(app.api);
    HapticFeedback.mediumImpact();
    app.notice(done);
    return true;
  } catch (e) {
    app.notice(errorText(e));
    return false;
  }
}

/// The buttons an outlet or a rider has for one order at its current stage.
class StaffActions extends StatefulWidget {
  const StaffActions({super.key, required this.order, required this.role, required this.onChanged, this.compact = false});
  final Order order;
  final StaffRole role;
  final VoidCallback onChanged;

  /// In a list the buttons are smaller and the secondary ones are left to the detail page.
  final bool compact;

  /// Whether there is anything to press, so lists can skip the row entirely.
  static bool has(Order o, StaffRole role) {
    if (o.closed) return false;
    if (role == StaffRole.outlet) return o.status == 'placed' ? o.flow.outletStatus == 'pending' : ['confirmed', 'preparing'].contains(o.status);
    return o.flow.riderStatus == 'pending' || (o.flow.riderStatus == 'accepted' && ['ready', 'picked_up'].contains(o.status));
  }

  @override
  State<StaffActions> createState() => _StaffActionsState();
}

class _StaffActionsState extends State<StaffActions> {
  bool _busy = false;

  Future<void> _do(Future<dynamic> Function(Api api) call, String done) async {
    setState(() => _busy = true);
    final ok = await _run(context, call, done);
    if (mounted) setState(() => _busy = false);
    if (ok) widget.onChanged();
  }

  Future<void> _reject() async {
    final o = widget.order;
    final outlet = widget.role == StaffRole.outlet;
    final reason = await showPrompt(
      context,
      title: outlet ? 'Reject ${o.reference}?' : 'Decline ${o.reference}?',
      message: outlet
          ? 'The order will be cancelled and the customer will see your reason.'
          : 'Dellvit will assign another rider. The order is not cancelled.',
      fieldLabel: 'Reason',
      hint: outlet ? 'e.g. An item is out of stock' : 'e.g. Too far from my location',
      confirm: outlet ? 'Reject order' : 'Decline delivery',
      required: outlet,
      danger: true,
    );
    if (reason == null) return;
    await _do(
      (api) => api.post('/orders/${o.id}/${outlet ? 'outlet' : 'rider'}-response', {'decision': 'reject', 'note': reason}),
      outlet ? 'Order rejected. The customer has been informed.' : 'Delivery declined.',
    );
  }

  Future<void> _requestCancel() async {
    final o = widget.order;
    final reason = await showPrompt(
      context,
      title: 'Request cancellation',
      message: 'Only Dellvit can cancel an order that is being prepared. We will review your request.',
      fieldLabel: 'Why can’t this order be completed?',
      confirm: 'Send request',
      required: true,
      danger: true,
    );
    if (reason == null) return;
    await _do((api) => api.post('/orders/${o.id}/cancel-request', {'reason': reason}), 'Cancellation request sent to Dellvit.');
  }

  Future<void> _complete() async {
    final done = await showSheet<bool>(context, builder: (_) => _CompleteDelivery(order: widget.order));
    if (done == true) widget.onChanged();
  }

  @override
  Widget build(BuildContext context) {
    final o = widget.order;
    final small = widget.compact;
    if (o.closed) return const SizedBox.shrink();
    Widget pair(Widget a, Widget b) => Row(
      children: [
        Expanded(child: a),
        const SizedBox(width: 10),
        Expanded(child: b),
      ],
    );
    final accept = AppButton(
      'Accept',
      small: small,
      busy: _busy,
      icon: Icons.check_rounded,
      color: context.c.green,
      onPressed: () => _do(
        (api) => api.post('/orders/${o.id}/${widget.role == StaffRole.outlet ? 'outlet' : 'rider'}-response', {'decision': 'accept'}),
        widget.role == StaffRole.outlet ? 'Order accepted.' : 'Delivery accepted.',
      ),
    );
    final reject = AppButton(
      widget.role == StaffRole.outlet ? 'Reject' : 'Decline',
      small: small,
      outlined: true,
      danger: true,
      onPressed: _busy ? null : _reject,
    );

    if (widget.role == StaffRole.outlet) {
      if (o.status == 'placed' && o.flow.outletStatus == 'pending') return pair(reject, accept);
      final next = switch (o.status) {
        'confirmed' => AppButton(
          'Start preparing',
          small: small,
          busy: _busy,
          icon: Icons.soup_kitchen_outlined,
          onPressed: () => _do((api) => api.patch('/orders/${o.id}/status', {'status': 'preparing'}), 'Marked as preparing.'),
        ),
        'preparing' => AppButton(
          'Mark ready for pickup',
          small: small,
          busy: _busy,
          icon: Icons.inventory_2_outlined,
          color: context.c.green,
          onPressed: () => _do((api) => api.patch('/orders/${o.id}/status', {'status': 'ready'}), 'Marked ready for pickup.'),
        ),
        _ => null,
      };
      if (next == null) return const SizedBox.shrink();
      if (small || o.flow.cancelRequest.isNotEmpty) return next;
      return Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          next,
          TextButton(onPressed: _busy ? null : _requestCancel, child: const Text('Can’t complete it? Request cancellation')),
        ],
      );
    }

    // Rider
    if (o.flow.riderStatus == 'pending') return pair(reject, accept);
    if (o.flow.riderStatus != 'accepted') return const SizedBox.shrink();
    final toOutlet = o.status != 'picked_up';
    final navigate = AppButton(
      toOutlet ? 'To outlet' : 'To customer',
      small: small,
      outlined: true,
      icon: Icons.navigation_outlined,
      onPressed: () => toOutlet ? openDirections(o.outletLat, o.outletLng) : openDirections(o.lat, o.lng),
    );
    if (o.status == 'ready') {
      return pair(
        navigate,
        AppButton(
          'Confirm pickup',
          small: small,
          busy: _busy,
          icon: Icons.shopping_bag_outlined,
          onPressed: () => _do((api) => api.patch('/orders/${o.id}/status', {'status': 'picked_up'}), 'Pickup confirmed.'),
        ),
      );
    }
    if (o.status == 'picked_up') {
      return pair(
        navigate,
        AppButton('Complete', small: small, icon: Icons.verified_outlined, color: context.c.green, onPressed: _complete),
      );
    }
    return small ? const SizedBox.shrink() : navigate;
  }
}

/// The rider's last step: confirm the money and enter the customer's delivery code.
class _CompleteDelivery extends StatefulWidget {
  const _CompleteDelivery({required this.order});
  final Order order;

  @override
  State<_CompleteDelivery> createState() => _CompleteDeliveryState();
}

class _CompleteDeliveryState extends State<_CompleteDelivery> {
  final _otp = TextEditingController();
  bool _confirmed = false;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _otp.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final app = context.read<AppState>();
    final nav = Navigator.of(context);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await app.api.post('/orders/${widget.order.id}/verify', {'otp': _otp.text, 'cash_received': true});
      HapticFeedback.heavyImpact();
      app.notice('Delivery completed. Great work!');
      nav.pop(true);
    } catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = errorText(e);
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final o = widget.order;
    final waiting = o.online && o.paymentStatus != 'paid';
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Complete delivery', style: context.t.headlineSmall),
            const SizedBox(height: 4),
            Text('${o.reference} · ${o.name}', style: context.t.bodyMedium!.copyWith(color: c.muted)),
            const SizedBox(height: 14),
            if (waiting)
              const Notice('This online payment is not verified yet. Ask Dellvit support before handing over.', tone: Tone.amber)
            else ...[
              if (_error != null) ...[Notice(_error!, tone: Tone.red), const SizedBox(height: 12)],
              AppCard(
                padding: const EdgeInsets.fromLTRB(4, 4, 12, 4),
                color: o.online ? c.blue50 : c.amber50,
                borderColor: Colors.transparent,
                onTap: () => setState(() => _confirmed = !_confirmed),
                child: Row(
                  children: [
                    Checkbox(value: _confirmed, activeColor: c.green, onChanged: (v) => setState(() => _confirmed = v ?? false)),
                    Expanded(
                      child: Text(
                        o.online ? 'Payment was verified online. I did not collect cash.' : 'I collected ${money(o.total)} in cash',
                        style: context.t.titleSmall,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 14),
              TextField(
                controller: _otp,
                keyboardType: TextInputType.number,
                textAlign: TextAlign.center,
                maxLength: 6,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                style: TextStyle(fontSize: 28, fontWeight: FontWeight.w800, letterSpacing: 12, color: c.ink, height: 1.2),
                decoration: InputDecoration(
                  counterText: '',
                  labelText: 'Customer’s delivery code',
                  floatingLabelBehavior: FloatingLabelBehavior.always,
                  hintText: '••••••',
                  hintStyle: TextStyle(fontSize: 28, letterSpacing: 12, color: c.lineStrong, fontWeight: FontWeight.w800),
                ),
                onChanged: (_) => setState(() {}),
              ),
              const SizedBox(height: 6),
              Text('Ask the customer for the 6-digit code shown on their order.', style: context.t.bodySmall),
              const SizedBox(height: 16),
              AppButton(
                'Verify & complete',
                busy: _busy,
                color: c.green,
                icon: Icons.verified_outlined,
                onPressed: _confirmed && _otp.text.length == 6 ? _submit : null,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// A staff member's orders, split into what needs them now and what is finished.
class StaffOrdersView extends StatefulWidget {
  const StaffOrdersView({super.key, required this.orders, required this.role});
  final Resource<List<Order>> orders;
  final StaffRole role;

  @override
  State<StaffOrdersView> createState() => _StaffOrdersViewState();
}

class _StaffOrdersViewState extends State<StaffOrdersView> {
  OrderBucket _bucket = OrderBucket.active;
  bool _chosen = false;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final outlet = widget.role == StaffRole.outlet;
    return ListenableBuilder(
      listenable: widget.orders,
      builder: (context, _) {
        final all = widget.orders.data;
        if (all == null) {
          return widget.orders.error != null
              ? ErrorState(widget.orders.error!, onRetry: widget.orders.refresh)
              : const SkeletonList(height: 112);
        }
        int count(OrderBucket b) => all.where((o) => bucketOf(o, widget.role) == b).length;
        // New requests come first until the person picks a tab themselves.
        if (!_chosen) _bucket = count(OrderBucket.requests) > 0 ? OrderBucket.requests : OrderBucket.active;
        final items = all.where((o) => bucketOf(o, widget.role) == _bucket).toList();
        String chip(String name, OrderBucket b, {bool always = false}) {
          final n = count(b);
          return n > 0 || always ? '$name ($n)' : name;
        }

        return Column(
          children: [
            Align(
              alignment: Alignment.centerLeft,
              child: ChoiceChips<OrderBucket>(
                options: {
                  OrderBucket.requests: chip(outlet ? 'New' : 'Requests', OrderBucket.requests, always: true),
                  OrderBucket.active: chip(outlet ? 'In progress' : 'Active', OrderBucket.active, always: true),
                  OrderBucket.done: chip('Delivered', OrderBucket.done),
                  OrderBucket.cancelled: 'Cancelled',
                },
                value: _bucket,
                onChanged: (v) => setState(() {
                  _bucket = v;
                  _chosen = true;
                }),
              ),
            ),
            const SizedBox(height: 6),
            Expanded(
              child: RefreshIndicator(
                color: c.brand,
                onRefresh: () => widget.orders.refresh(silent: true),
                child: items.isEmpty
                    ? ListView(
                        children: [
                          EmptyState(
                            icon: outlet ? Icons.receipt_long_outlined : Icons.two_wheeler_rounded,
                            title: switch (_bucket) {
                              OrderBucket.requests => outlet ? 'No new orders' : 'No delivery requests',
                              OrderBucket.active => outlet ? 'Nothing in progress' : 'No active deliveries',
                              OrderBucket.done => 'Nothing delivered yet',
                              OrderBucket.cancelled => 'No cancelled orders',
                            },
                            message: _bucket == OrderBucket.requests
                                ? 'New ${outlet ? 'orders' : 'requests'} appear here as soon as Dellvit sends them.'
                                : null,
                          ),
                        ],
                      )
                    : ListView.separated(
                        padding: const EdgeInsets.fromLTRB(16, 6, 16, 24),
                        itemCount: items.length,
                        separatorBuilder: (_, _) => const SizedBox(height: 10),
                        itemBuilder: (context, i) {
                          final o = items[i];
                          return OrderCard(
                            key: ValueKey(o.id),
                            order: o,
                            title: outlet ? o.name : '${o.outletName} → ${o.name}',
                            amount: outlet ? o.subtotal : o.total,
                            note: o.late ? 'Running late · ${staffNote(o, widget.role)}' : staffNote(o, widget.role),
                            onTap: () async {
                              await Navigator.of(context).push(
                                MaterialPageRoute(builder: (_) => StaffOrderScreen(id: o.id, role: widget.role, preview: o)),
                              );
                              widget.orders.refresh(silent: true);
                            },
                            footer: StaffActions.has(o, widget.role)
                                ? StaffActions(
                                    order: o,
                                    role: widget.role,
                                    compact: true,
                                    onChanged: () => widget.orders.refresh(silent: true),
                                  )
                                : null,
                          );
                        },
                      ),
              ),
            ),
          ],
        );
      },
    );
  }
}

/// One order as an outlet or a rider works on it.
class StaffOrderScreen extends StatefulWidget {
  const StaffOrderScreen({super.key, required this.id, required this.role, this.preview});
  final String id;
  final StaffRole role;
  final Order? preview;

  @override
  State<StaffOrderScreen> createState() => _StaffOrderScreenState();
}

class _StaffOrderScreenState extends State<StaffOrderScreen> {
  late final Resource<Order> _order;

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

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final outlet = widget.role == StaffRole.outlet;
    return ListenableBuilder(
      listenable: _order,
      builder: (context, _) {
        final o = _order.data;
        if (o == null) {
          return Scaffold(
            appBar: AppBar(title: const Text('Order')),
            // A rider who declined, or was replaced, no longer has the order.
            body: _order.error != null ? ErrorState(_order.error!, onRetry: _order.refresh) : const LoadingView(),
          );
        }
        final note = staffNote(o, widget.role);
        final cancelledAt = o.events.where((e) => e.status == 'cancelled').firstOrNull?.createdAt;
        return Scaffold(
          appBar: AppBar(
            title: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(o.reference, style: context.t.titleMedium),
                Text('Placed ${dateTime(o.createdAt)}', style: context.t.bodySmall),
              ],
            ),
            actions: [Padding(padding: const EdgeInsets.only(right: 14), child: StatusBadge(o.status))],
          ),
          body: RefreshIndicator(
            color: c.brand,
            onRefresh: () => _order.refresh(silent: true),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
              children: [
                if (note.isNotEmpty) ...[
                  Notice(note, tone: bucketOf(o, widget.role) == OrderBucket.requests ? Tone.amber : Tone.blue),
                  const SizedBox(height: 12),
                ],
                if (o.locked) ...[
                  const Notice('This order is completed and can no longer be changed.', icon: Icons.lock_outline_rounded, tone: Tone.green),
                  const SizedBox(height: 12),
                ],
                if (o.status == 'cancelled') ...[
                  Notice(
                    'Cancelled by ${label(o.flow.cancelledBy.isEmpty ? 'Dellvit' : o.flow.cancelledBy)}'
                    '${o.flow.cancelReason.isEmpty ? '.' : ': ${o.flow.cancelReason}'}',
                    tone: Tone.red,
                    icon: Icons.cancel_outlined,
                  ),
                  const SizedBox(height: 12),
                ],
                StatGrid([
                  StatTile(
                    icon: o.status == 'delivered'
                        ? Icons.home_outlined
                        : o.status == 'cancelled'
                        ? Icons.cancel_outlined
                        : Icons.timer_outlined,
                    name: o.status == 'delivered'
                        ? 'Delivered'
                        : o.status == 'cancelled'
                        ? 'Cancelled'
                        : o.late
                        ? 'Running late'
                        : 'Due in',
                    value: o.status == 'delivered'
                        ? timeText(o.deliveredAt)
                        : o.status == 'cancelled'
                        ? timeText(cancelledAt)
                        : '',
                    tone: o.status == 'delivered'
                        ? Tone.green
                        : o.late || o.status == 'cancelled'
                        ? Tone.red
                        : Tone.blue,
                    child: o.closed
                        ? null
                        : Countdown(deadline: o.deliverBy, pending: o.status == 'placed', style: context.t.titleMedium!.copyWith(fontWeight: FontWeight.w800)),
                  ),
                  StatTile(
                    icon: Icons.account_balance_wallet_outlined,
                    name: outlet ? 'Items value' : (o.online ? 'Paid online' : 'Collect in cash'),
                    value: money(outlet ? o.subtotal : o.total),
                    tone: Tone.brand,
                  ),
                ]),
                const SizedBox(height: 12),
                AppCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Pickup & delivery', style: context.t.titleMedium),
                      const SizedBox(height: 14),
                      RouteCard(o, contacts: true),
                      if (!outlet && !(o.outletLat == 0 && o.outletLng == 0)) ...[
                        const SizedBox(height: 14),
                        DeliveryMap(drop: LatLng(o.lat, o.lng), pickup: LatLng(o.outletLat, o.outletLng), height: 180),
                      ],
                    ],
                  ),
                ),
                if (outlet && o.hasRider) ...[
                  const SizedBox(height: 12),
                  AppCard(
                    child: Row(
                      children: [
                        Avatar(o.riderName, size: 42),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(o.riderName, style: context.t.titleSmall),
                              Text(
                                switch (o.flow.riderStatus) {
                                  'accepted' => 'Rider · accepted the delivery',
                                  'pending' => 'Rider · waiting to accept',
                                  _ => 'Rider',
                                },
                                style: context.t.bodySmall,
                              ),
                            ],
                          ),
                        ),
                        if (o.riderPhone.isNotEmpty)
                          IconButton.filledTonal(onPressed: () => callPhone(o.riderPhone), icon: const Icon(Icons.call_outlined, size: 20)),
                      ],
                    ),
                  ),
                ],
                const SizedBox(height: 12),
                OrderItemsCard(o, itemsOnly: outlet),
                const SizedBox(height: 12),
                AppCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Payment', style: context.t.titleMedium),
                      const SizedBox(height: 12),
                      PaymentLine(o),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                AppCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Activity', style: context.t.titleMedium),
                      const SizedBox(height: 10),
                      for (final e in o.events.reversed)
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 5),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Container(
                                width: 8,
                                height: 8,
                                margin: const EdgeInsets.only(top: 6, right: 10),
                                decoration: BoxDecoration(color: toneColors(context, statusTone(e.status)).fg, shape: BoxShape.circle),
                              ),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(eventLabels[e.status] ?? label(e.status), style: context.t.titleSmall),
                                    if (e.note.isNotEmpty) Text(e.note, style: context.t.bodySmall),
                                  ],
                                ),
                              ),
                              Text(dateTime(e.createdAt), style: context.t.bodySmall!.copyWith(fontSize: 11.5)),
                            ],
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          bottomNavigationBar: StaffActions.has(o, widget.role) || (!outlet && !o.closed && o.flow.riderStatus == 'accepted')
              ? BottomBar(
                  child: StaffActions(order: o, role: widget.role, onChanged: () => _order.refresh(silent: true)),
                )
              : null,
        );
      },
    );
  }
}
