import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/resource.dart';
import '../../models/models.dart';
import '../../state/app_state.dart';
import '../../widgets/dock.dart';
import '../shared/account_screen.dart';
import '../staff/staff_orders.dart';
import 'outlet_dashboard.dart';
import 'outlet_products.dart';

/// The outlet's workspace: today's orders, the menu and the account.
class OutletShell extends StatefulWidget {
  const OutletShell({super.key});

  @override
  State<OutletShell> createState() => _OutletShellState();
}

class _OutletShellState extends State<OutletShell> {
  late final Resource<List<Order>> _orders;
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
  }

  @override
  void dispose() {
    _orders.dispose();
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
            OutletDashboard(orders: _orders, onTab: _go),
            page(
              1,
              () => Scaffold(
                appBar: AppBar(title: const Text('Orders'), titleSpacing: 20),
                body: StaffOrdersView(orders: _orders, role: StaffRole.outlet),
              ),
            ),
            page(2, () => const OutletProductsScreen()),
            page(3, () => const AccountScreen()),
          ],
        ),
        bottomNavigationBar: ListenableBuilder(
          listenable: _orders,
          builder: (context, _) {
            final fresh = (_orders.data ?? []).where((o) => bucketOf(o, StaffRole.outlet) == OrderBucket.requests).length;
            return Dock(
              index: _tab,
              onTap: _go,
              items: [
                const DockItem(Icons.dashboard_outlined, Icons.dashboard_rounded, 'Dashboard'),
                DockItem(Icons.receipt_long_outlined, Icons.receipt_long_rounded, 'Orders', badge: fresh > 0 ? '$fresh' : null),
                const DockItem(Icons.restaurant_menu_outlined, Icons.restaurant_menu_rounded, 'Products'),
                DockItem(Icons.person_outline_rounded, Icons.person_rounded, 'Account', dot: app.unread + app.supportUnread > 0),
              ],
            );
          },
        ),
      ),
    );
  }
}
