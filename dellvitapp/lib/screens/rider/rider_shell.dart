import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/resource.dart';
import '../../models/models.dart';
import '../../state/app_state.dart';
import '../../widgets/dock.dart';
import '../shared/account_screen.dart';
import '../staff/staff_orders.dart';
import 'rider_duty.dart';
import 'rider_home.dart';
import 'rider_money.dart';

/// The rider's workspace: deliveries first, money second.
class RiderShell extends StatefulWidget {
  const RiderShell({super.key});

  @override
  State<RiderShell> createState() => _RiderShellState();
}

class _RiderShellState extends State<RiderShell> {
  late final Resource<List<Order>> _orders;
  late final RiderDuty _duty;
  final Set<int> _opened = {0};
  int _tab = 0;

  @override
  void initState() {
    super.initState();
    final api = context.read<AppState>().api;
    _orders = Resource<List<Order>>(
      () async => asList(await api.get('/orders')).map(Order.fromJson).toList(),
      every: const Duration(seconds: 10),
    )..start();
    _duty = RiderDuty(api)..load();
  }

  @override
  void dispose() {
    _orders.dispose();
    _duty.dispose();
    super.dispose();
  }

  void _go(int i) => setState(() {
    _tab = i;
    _opened.add(i);
  });

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    Widget page(int i, Widget Function() build) => _opened.contains(i) ? build() : const SizedBox.shrink();
    return PopScope(
      canPop: _tab == 0,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _go(0);
      },
      child: Scaffold(
        body: IndexedStack(
          index: _tab,
          children: [
            RiderHome(orders: _orders, duty: _duty, onTab: _go),
            page(
              1,
              () => Scaffold(
                appBar: AppBar(title: const Text('Deliveries'), titleSpacing: 20),
                body: StaffOrdersView(orders: _orders, role: StaffRole.rider),
              ),
            ),
            page(2, () => const RiderCashScreen()),
            page(3, () => const RiderEarningsScreen()),
            page(4, () => const AccountScreen()),
          ],
        ),
        bottomNavigationBar: ListenableBuilder(
          listenable: _orders,
          builder: (context, _) {
            final requests = (_orders.data ?? []).where((o) => bucketOf(o, StaffRole.rider) == OrderBucket.requests).length;
            return Dock(
              index: _tab,
              onTap: _go,
              items: [
                const DockItem(Icons.dashboard_outlined, Icons.dashboard_rounded, 'Home'),
                DockItem(Icons.two_wheeler_outlined, Icons.two_wheeler_rounded, 'Deliveries', badge: requests > 0 ? '$requests' : null),
                const DockItem(Icons.payments_outlined, Icons.payments_rounded, 'Cash'),
                const DockItem(Icons.account_balance_wallet_outlined, Icons.account_balance_wallet_rounded, 'Earnings'),
                DockItem(Icons.person_outline_rounded, Icons.person_rounded, 'Account', dot: app.unread + app.supportUnread > 0),
              ],
            );
          },
        ),
      ),
    );
  }
}
