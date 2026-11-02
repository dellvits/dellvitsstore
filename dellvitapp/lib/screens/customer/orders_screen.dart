import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/resource.dart';
import '../../core/theme.dart';
import '../../models/models.dart';
import '../../state/app_state.dart';
import '../../widgets/common.dart';
import '../../widgets/order_widgets.dart';
import '../auth/login_screen.dart';
import 'order_detail_screen.dart';

/// The customer's order history, refreshed while it is open.
class OrdersScreen extends StatefulWidget {
  const OrdersScreen({super.key});

  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen> {
  Resource<List<Order>>? _orders;
  String? _userId;
  String _filter = 'all';

  void _sync(AppState app) {
    final id = app.user?.id;
    if (id == _userId && (_orders != null || id == null)) return;
    _userId = id;
    _orders?.dispose();
    _orders = id == null
        ? null
        : (Resource<List<Order>>(
            () async => asList(await app.api.get('/orders')).map(Order.fromJson).toList(),
            every: const Duration(seconds: 20),
          )..start());
  }

  @override
  void dispose() {
    _orders?.dispose();
    super.dispose();
  }

  String? _note(Order o) {
    if (o.paymentStatus == 'rejected' && o.status != 'cancelled') return 'Payment not verified. Tap to fix it.';
    if (o.status == 'placed') return o.paymentVerified ? 'Confirming with the outlet and a rider' : 'Verifying your payment';
    if (o.status == 'picked_up') return 'Your rider is on the way';
    if (o.paymentStatus == 'refund_due') return 'Your payment will be refunded';
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final app = context.watch<AppState>();
    _sync(app);
    return Scaffold(
      appBar: AppBar(title: const Text('Your orders'), titleSpacing: 20),
      body: _orders == null
          ? EmptyState(
              icon: Icons.receipt_long_outlined,
              title: 'Log in to see your orders',
              message: 'Track deliveries, see your delivery code and check your payments.',
              action: 'Log in',
              onAction: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const LoginScreen())),
            )
          : Column(
              children: [
                ChoiceChips<String>(
                  options: const {'all': 'All', 'active': 'In progress', 'delivered': 'Delivered', 'cancelled': 'Cancelled'},
                  value: _filter,
                  onChanged: (v) => setState(() => _filter = v),
                ),
                const SizedBox(height: 6),
                Expanded(
                  child: RefreshIndicator(
                    color: c.brand,
                    onRefresh: () => _orders!.refresh(silent: true),
                    child: ResourceView<List<Order>>(
                      resource: _orders!,
                      builder: (context, all) {
                        final items = all
                            .where(
                              (o) => switch (_filter) {
                                'active' => !o.closed,
                                'delivered' => o.status == 'delivered',
                                'cancelled' => o.status == 'cancelled',
                                _ => true,
                              },
                            )
                            .toList();
                        if (items.isEmpty) {
                          return ListView(
                            children: [
                              EmptyState(
                                icon: Icons.receipt_long_outlined,
                                title: all.isEmpty ? 'No orders yet' : 'Nothing here',
                                message: all.isEmpty ? 'Your orders will appear here once you place one.' : 'No orders match this filter.',
                                action: all.isEmpty ? 'Start shopping' : null,
                                onAction: () => app.goToTab(1),
                              ),
                            ],
                          );
                        }
                        return ListView.separated(
                          padding: const EdgeInsets.fromLTRB(16, 6, 16, 24),
                          itemCount: items.length,
                          separatorBuilder: (_, _) => const SizedBox(height: 10),
                          itemBuilder: (context, i) {
                            final o = items[i];
                            return OrderCard(
                              key: ValueKey(o.id),
                              order: o,
                              title: o.outletName,
                              amount: o.total,
                              note: _note(o),
                              onTap: () async {
                                await Navigator.of(context).push(
                                  MaterialPageRoute(builder: (_) => OrderDetailScreen(id: o.id, preview: o)),
                                );
                                _orders?.refresh(silent: true);
                              },
                            );
                          },
                        );
                      },
                    ),
                  ),
                ),
              ],
            ),
    );
  }
}
