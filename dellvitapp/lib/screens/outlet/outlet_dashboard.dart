import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/resource.dart';
import '../../core/theme.dart';
import '../../models/models.dart';
import '../../state/app_state.dart';
import '../../widgets/common.dart';
import '../../widgets/order_widgets.dart';
import '../rider/rider_home.dart' show WorkspaceHeader;
import '../staff/staff_orders.dart';

class OutletDashboard extends StatefulWidget {
  const OutletDashboard({super.key, required this.orders, required this.onTab});
  final Resource<List<Order>> orders;
  final ValueChanged<int> onTab;

  @override
  State<OutletDashboard> createState() => _OutletDashboardState();
}

class _OutletDashboardState extends State<OutletDashboard> {
  late final Resource<Json> _summary;
  StatRange _range = StatRange.week;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final api = context.read<AppState>().api;
    _summary = Resource<Json>(
      () async => asMap(await api.get('/manage/outlet/summary', query: _range.query)),
      every: const Duration(seconds: 30),
    )..start();
  }

  @override
  void dispose() {
    _summary.dispose();
    super.dispose();
  }

  Future<void> _setAccepting(bool value) async {
    final app = context.read<AppState>();
    if (!value) {
      final yes = await showConfirm(
        context,
        title: 'Pause new orders?',
        message: 'Customers will see your outlet as closed until you turn orders back on. Orders already placed continue.',
        confirm: 'Pause orders',
        cancel: 'Keep taking orders',
        danger: true,
      );
      if (!yes) return;
    }
    setState(() => _saving = true);
    try {
      await app.api.patch('/manage/outlet/settings', {'accepting': value});
      app.notice(value ? 'You are taking orders again.' : 'New orders are paused.');
      await _summary.refresh(silent: true);
    } catch (e) {
      app.notice(errorText(e));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final app = context.watch<AppState>();
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light.copyWith(statusBarColor: Colors.transparent),
      child: Scaffold(
        body: RefreshIndicator(
          color: c.brand,
          onRefresh: () => Future.wait([_summary.refresh(silent: true), widget.orders.refresh(silent: true)]),
          child: ListenableBuilder(
            listenable: Listenable.merge([_summary, widget.orders]),
            builder: (context, _) {
              final d = _summary.data;
              final outlet = asMap(d?['outlet']);
              final accepting = d == null ? true : asBool(outlet['accepting'], true);
              final orders = widget.orders.data ?? [];
              final fresh = orders.where((o) => bucketOf(o, StaffRole.outlet) == OrderBucket.requests).toList();
              final kitchen = orders.where((o) => ['confirmed', 'preparing'].contains(o.status)).toList();
              final hours = openingHours(asString(outlet['opens_at']), asString(outlet['closes_at']));
              return ListView(
                padding: const EdgeInsets.only(bottom: 28),
                children: [
                  WorkspaceHeader(
                    eyebrow: 'Outlet',
                    title: asString(outlet['name'], app.user?.name ?? 'Your outlet'),
                    child: Container(
                      padding: const EdgeInsets.fromLTRB(14, 8, 6, 8),
                      decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.18), borderRadius: BorderRadius.circular(18)),
                      child: Row(
                        children: [
                          Container(
                            width: 10,
                            height: 10,
                            decoration: BoxDecoration(color: accepting ? const Color(0xFF7CF5C0) : Colors.white54, shape: BoxShape.circle),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  accepting ? 'Taking orders' : 'Orders paused',
                                  style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w800, height: 1.25),
                                ),
                                Text(
                                  hours.isEmpty ? 'Open 24 hours' : 'Hours: $hours',
                                  style: TextStyle(color: Colors.white.withValues(alpha: 0.88), fontSize: 12, fontWeight: FontWeight.w500),
                                ),
                              ],
                            ),
                          ),
                          Switch(value: accepting, onChanged: d == null || _saving ? null : _setAccepting),
                        ],
                      ),
                    ),
                  ),
                  if (d == null)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: _summary.error != null
                          ? ErrorState(_summary.error!, onRetry: _summary.refresh)
                          : const SkeletonList(count: 3, height: 110),
                    )
                  else ...[
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 18, 16, 0),
                      child: StatGrid([
                        StatTile(
                          icon: Icons.notification_important_outlined,
                          name: 'Awaiting your answer',
                          value: '${asInt(d['awaiting_response'])}',
                          tone: asInt(d['awaiting_response']) > 0 ? Tone.amber : Tone.neutral,
                        ),
                        StatTile(icon: Icons.soup_kitchen_outlined, name: 'In the kitchen', value: '${asInt(d['in_kitchen'])}', tone: Tone.orange),
                        StatTile(icon: Icons.inventory_2_outlined, name: 'Waiting for pickup', value: '${asInt(d['awaiting_pickup'])}', tone: Tone.blue),
                        StatTile(
                          icon: Icons.timer_off_outlined,
                          name: 'Running late',
                          value: '${asInt(d['late'])}',
                          tone: asInt(d['late']) > 0 ? Tone.red : Tone.neutral,
                        ),
                      ]),
                    ),
                    if (fresh.isNotEmpty || kitchen.isNotEmpty) ...[
                      SectionHeader(
                        fresh.isNotEmpty ? 'New orders' : 'In the kitchen',
                        eyebrow: 'Right now',
                        action: 'All orders',
                        onAction: () => widget.onTab(1),
                      ),
                      for (final o in [...fresh, ...kitchen].take(5))
                        Padding(
                          padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
                          child: OrderCard(
                            key: ValueKey(o.id),
                            order: o,
                            title: o.name,
                            amount: o.subtotal,
                            note: staffNote(o, StaffRole.outlet),
                            onTap: () async {
                              await Navigator.of(context).push(
                                MaterialPageRoute(builder: (_) => StaffOrderScreen(id: o.id, role: StaffRole.outlet, preview: o)),
                              );
                              widget.orders.refresh(silent: true);
                            },
                            footer: StaffActions.has(o, StaffRole.outlet)
                                ? StaffActions(
                                    order: o,
                                    role: StaffRole.outlet,
                                    compact: true,
                                    onChanged: () {
                                      widget.orders.refresh(silent: true);
                                      _summary.refresh(silent: true);
                                    },
                                  )
                                : null,
                          ),
                        ),
                    ],
                    const SectionHeader('Sales', eyebrow: 'Your figures'),
                    ChoiceChips<StatRange>(
                      options: {for (final r in StatRange.values) r: r.title},
                      value: _range,
                      onChanged: (v) {
                        setState(() => _range = v);
                        _summary.refresh(silent: true);
                      },
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                      child: StatGrid([
                        StatTile(icon: Icons.receipt_long_outlined, name: 'Orders received', value: '${asInt(d['orders'])}', tone: Tone.blue),
                        StatTile(icon: Icons.check_circle_outline_rounded, name: 'Delivered', value: '${asInt(d['delivered'])}', tone: Tone.green),
                        StatTile(icon: Icons.sell_outlined, name: 'Item sales', value: money(asInt(d['sales'])), tone: Tone.brand),
                        StatTile(
                          icon: Icons.account_balance_wallet_outlined,
                          name: 'Your share',
                          value: money(asInt(d['payable'])),
                          tone: Tone.purple,
                          hint: 'After ${_percent(asDouble(outlet['commission_rate']))}% commission',
                        ),
                        StatTile(icon: Icons.percent_rounded, name: 'Dellvit commission', value: money(asInt(d['commission'])), tone: Tone.orange),
                        StatTile(icon: Icons.shopping_basket_outlined, name: 'Average order', value: money(asInt(d['average_order'])), tone: Tone.neutral),
                      ]),
                    ),
                    if (asList(d['top_products']).isNotEmpty) ...[
                      const SectionHeader('Top products', eyebrow: 'Best sellers'),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        child: AppCard(
                          padding: EdgeInsets.zero,
                          child: Column(
                            children: [
                              for (final (i, p) in asList(d['top_products']).indexed) ...[
                                if (i > 0) Divider(indent: 72, color: c.line),
                                ListTile(
                                  contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
                                  leading: NetImage(asString(p['image']), width: 46, height: 46, radius: 10),
                                  title: Text(asString(p['name']), maxLines: 1, overflow: TextOverflow.ellipsis),
                                  subtitle: Text('${asInt(p['quantity'])} sold'),
                                  trailing: Text(money(asInt(p['revenue'])), style: context.t.titleSmall),
                                ),
                              ],
                            ],
                          ),
                        ),
                      ),
                    ],
                    if (asList(d['low_stock']).isNotEmpty) ...[
                      SectionHeader('Stock to refill', eyebrow: 'Running low', action: 'Products', onAction: () => widget.onTab(2)),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        child: AppCard(
                          padding: EdgeInsets.zero,
                          child: Column(
                            children: [
                              for (final (i, p) in asList(d['low_stock']).indexed) ...[
                                if (i > 0) Divider(indent: 72, color: c.line),
                                ListTile(
                                  contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
                                  leading: NetImage(asString(p['image']), width: 46, height: 46, radius: 10),
                                  title: Text(asString(p['name']), maxLines: 1, overflow: TextOverflow.ellipsis),
                                  trailing: Pill(
                                    asInt(p['stock']) == 0 ? 'Out of stock' : '${asInt(p['stock'])} left',
                                    tone: asInt(p['stock']) == 0 ? Tone.red : Tone.amber,
                                    dense: true,
                                  ),
                                ),
                              ],
                            ],
                          ),
                        ),
                      ),
                    ],
                  ],
                ],
              );
            },
          ),
        ),
      ),
    );
  }
}

String _percent(double v) => v % 1 == 0 ? v.toStringAsFixed(0) : v.toString();
