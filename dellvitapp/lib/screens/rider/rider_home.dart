import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../core/format.dart';
import '../../core/resource.dart';
import '../../core/theme.dart';
import '../../models/models.dart';
import '../../state/app_state.dart';
import '../../widgets/common.dart';
import '../../widgets/curved_header.dart';
import '../../widgets/order_widgets.dart';
import '../shared/notifications_screen.dart';
import '../staff/staff_orders.dart';
import 'rider_duty.dart';

/// The gradient top that the rider and outlet dashboards share.
class WorkspaceHeader extends StatelessWidget {
  const WorkspaceHeader({super.key, required this.eyebrow, required this.title, this.child});
  final String eyebrow, title;
  final Widget? child;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final app = context.watch<AppState>();
    return CurvedHeader(
      bottom: 46,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      eyebrow.toUpperCase(),
                      style: TextStyle(color: Colors.white.withValues(alpha: 0.85), fontSize: 11, fontWeight: FontWeight.w800, letterSpacing: 1.1),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w800, height: 1.2, letterSpacing: -0.4),
                    ),
                  ],
                ),
              ),
              GlassButton(
                round: true,
                tooltip: 'Notifications',
                onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const NotificationsScreen())),
                child: Badge(
                  isLabelVisible: app.unread > 0,
                  label: Text(app.unread > 9 ? '9+' : '${app.unread}'),
                  backgroundColor: Colors.white,
                  textColor: c.brand,
                  child: const Icon(Icons.notifications_none_rounded),
                ),
              ),
            ],
          ),
          if (child != null) Padding(padding: const EdgeInsets.only(top: 16), child: child),
        ],
      ),
    );
  }
}

class RiderHome extends StatefulWidget {
  const RiderHome({super.key, required this.orders, required this.duty, required this.onTab});
  final Resource<List<Order>> orders;
  final RiderDuty duty;
  final ValueChanged<int> onTab;

  @override
  State<RiderHome> createState() => _RiderHomeState();
}

class _RiderHomeState extends State<RiderHome> {
  late final Resource<Json> _earnings;
  late final Resource<Json> _cash;

  @override
  void initState() {
    super.initState();
    final api = context.read<AppState>().api;
    _earnings = Resource<Json>(() async => asMap(await api.get('/rider/earnings')), every: const Duration(seconds: 60))..start();
    _cash = Resource<Json>(() async => asMap(await api.get('/rider/cash')), every: const Duration(seconds: 60))..start();
  }

  @override
  void dispose() {
    _earnings.dispose();
    _cash.dispose();
    super.dispose();
  }

  Future<void> _refresh() => Future.wait([
    widget.orders.refresh(silent: true),
    _earnings.refresh(silent: true),
    _cash.refresh(silent: true),
    widget.duty.load(),
  ]);

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final app = context.watch<AppState>();
    final duty = widget.duty;
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light.copyWith(statusBarColor: Colors.transparent),
      child: Scaffold(
        body: RefreshIndicator(
          color: c.brand,
          onRefresh: _refresh,
          child: ListenableBuilder(
            listenable: Listenable.merge([widget.orders, duty, _earnings, _cash]),
            builder: (context, _) {
              final orders = widget.orders.data ?? [];
              final requests = orders.where((o) => bucketOf(o, StaffRole.rider) == OrderBucket.requests).toList();
              final active = orders.where((o) => bucketOf(o, StaffRole.rider) == OrderBucket.active).toList();
              final e = _earnings.data;
              final cash = _cash.data;
              final onDuty = duty.onDuty ?? true;
              return ListView(
                padding: const EdgeInsets.only(bottom: 28),
                children: [
                  WorkspaceHeader(
                    eyebrow: 'Rider',
                    title: 'Hi ${app.user?.name.split(' ').first ?? 'there'}',
                    child: Container(
                      padding: const EdgeInsets.fromLTRB(14, 6, 6, 6),
                      decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.18), borderRadius: BorderRadius.circular(18)),
                      child: Column(
                        children: [
                          Row(
                            children: [
                              Container(
                                width: 10,
                                height: 10,
                                decoration: BoxDecoration(
                                  color: onDuty ? const Color(0xFF7CF5C0) : Colors.white54,
                                  shape: BoxShape.circle,
                                ),
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      onDuty ? 'On duty' : 'Off duty',
                                      style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w800, height: 1.25),
                                    ),
                                    Text(
                                      onDuty ? 'You can receive delivery requests' : 'Go on duty to receive deliveries',
                                      style: TextStyle(color: Colors.white.withValues(alpha: 0.88), fontSize: 12, fontWeight: FontWeight.w500),
                                    ),
                                  ],
                                ),
                              ),
                              Switch(
                                value: onDuty,
                                onChanged: duty.onDuty == null || duty.busy
                                    ? null
                                    : (v) async {
                                        final problem = await duty.setDuty(v);
                                        if (problem != null) app.notice(problem);
                                      },
                              ),
                            ],
                          ),
                          Divider(color: Colors.white.withValues(alpha: 0.25), height: 8),
                          Row(
                            children: [
                              Icon(
                                duty.sharing ? Icons.my_location_rounded : Icons.location_disabled_rounded,
                                color: Colors.white,
                                size: 18,
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    const Text(
                                      'Share live location',
                                      style: TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.w700, height: 1.25),
                                    ),
                                    Text(
                                      duty.message,
                                      maxLines: 2,
                                      overflow: TextOverflow.ellipsis,
                                      style: TextStyle(color: Colors.white.withValues(alpha: 0.88), fontSize: 12, fontWeight: FontWeight.w500),
                                    ),
                                  ],
                                ),
                              ),
                              Switch(
                                value: duty.sharing,
                                onChanged: !onDuty ? null : (v) => v ? duty.startSharing() : duty.stopSharing(),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 18, 16, 0),
                    child: StatGrid([
                      StatTile(
                        icon: Icons.notification_important_outlined,
                        name: 'New requests',
                        value: '${requests.length}',
                        tone: requests.isEmpty ? Tone.neutral : Tone.amber,
                      ),
                      StatTile(
                        icon: Icons.two_wheeler_rounded,
                        name: 'Active · capacity ${duty.capacity}',
                        value: '${active.length}',
                        tone: Tone.blue,
                      ),
                      StatTile(
                        icon: Icons.today_outlined,
                        name: 'Earned today',
                        value: e == null ? '…' : money(asInt(e['today'])),
                        tone: Tone.green,
                      ),
                      StatTile(
                        icon: Icons.date_range_outlined,
                        name: 'Last 7 days',
                        value: e == null ? '…' : money(asInt(e['week'])),
                        tone: Tone.green,
                      ),
                    ]),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                    child: AppCard(
                      padding: EdgeInsets.zero,
                      child: Column(
                        children: [
                          ListTile(
                            contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
                            leading: const IconBubble(Icons.account_balance_wallet_outlined, tone: Tone.purple, size: 40),
                            title: const Text('Available to withdraw'),
                            subtitle: Text(
                              e == null
                                  ? 'Loading…'
                                  : '${asInt(e['deliveries'])} ${asInt(e['deliveries']) == 1 ? 'delivery' : 'deliveries'} completed',
                            ),
                            trailing: Text(e == null ? '' : money(asInt(e['available'])), style: context.t.titleMedium!.copyWith(fontWeight: FontWeight.w800)),
                            onTap: () => widget.onTab(3),
                          ),
                          Divider(indent: 68, color: c.line),
                          ListTile(
                            contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
                            leading: const IconBubble(Icons.payments_outlined, tone: Tone.orange, size: 40),
                            title: const Text('COD cash in hand'),
                            subtitle: Text(
                              cash == null
                                  ? 'Loading…'
                                  : asInt(cash['pending']) > 0
                                  ? '${money(asInt(cash['pending']))} awaiting review'
                                  : 'Hand it over or transfer it to Dellvit',
                            ),
                            trailing: Text(cash == null ? '' : money(asInt(cash['in_hand'])), style: context.t.titleMedium!.copyWith(fontWeight: FontWeight.w800)),
                            onTap: () => widget.onTab(2),
                          ),
                        ],
                      ),
                    ),
                  ),
                  SectionHeader(
                    requests.isNotEmpty ? 'Waiting for your answer' : 'Deliveries in hand',
                    eyebrow: 'Right now',
                    action: 'All deliveries',
                    onAction: () => widget.onTab(1),
                  ),
                  if (widget.orders.data == null)
                    widget.orders.error != null
                        ? ErrorState(widget.orders.error!, onRetry: widget.orders.refresh)
                        : const SkeletonList(count: 2, height: 112)
                  else if (requests.isEmpty && active.isEmpty)
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      child: AppCard(
                        child: Column(
                          children: [
                            const IconBubble(Icons.two_wheeler_rounded, size: 52, tone: Tone.neutral),
                            const SizedBox(height: 10),
                            Text('No deliveries right now', style: context.t.titleMedium),
                            const SizedBox(height: 2),
                            Text(
                              onDuty ? 'New requests will appear here.' : 'Go on duty to receive requests.',
                              style: context.t.bodySmall,
                            ),
                          ],
                        ),
                      ),
                    )
                  else
                    for (final o in [...requests, ...active].take(6))
                      Padding(
                        padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
                        child: OrderCard(
                          key: ValueKey(o.id),
                          order: o,
                          title: '${o.outletName} → ${o.name}',
                          amount: o.total,
                          note: staffNote(o, StaffRole.rider),
                          onTap: () async {
                            await Navigator.of(context).push(
                              MaterialPageRoute(builder: (_) => StaffOrderScreen(id: o.id, role: StaffRole.rider, preview: o)),
                            );
                            widget.orders.refresh(silent: true);
                          },
                          footer: StaffActions.has(o, StaffRole.rider)
                              ? StaffActions(
                                  order: o,
                                  role: StaffRole.rider,
                                  compact: true,
                                  onChanged: () => widget.orders.refresh(silent: true),
                                )
                              : null,
                        ),
                      ),
                ],
              );
            },
          ),
        ),
      ),
    );
  }
}
