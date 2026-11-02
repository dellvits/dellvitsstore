import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../models/models.dart';
import '../../state/app_state.dart';
import '../../widgets/app_popup.dart';
import '../../widgets/dock.dart';
import '../shared/account_screen.dart';
import 'cart_screen.dart';
import 'home_screen.dart';
import 'orders_screen.dart';
import 'search_screen.dart';

/// The storefront: five tabs along the bottom, for guests and signed-in customers alike.
class CustomerShell extends StatefulWidget {
  const CustomerShell({super.key});

  @override
  State<CustomerShell> createState() => _CustomerShellState();
}

class _CustomerShellState extends State<CustomerShell> {
  // A tab is built the first time it is opened and then keeps its place.
  final Set<int> _opened = {0};

  @override
  void initState() {
    super.initState();
    _popup();
  }

  /// Shows the administrator's pop-up, after its delay, if the shopper is still on the storefront.
  Future<void> _popup() async {
    final app = context.read<AppState>();
    final popup = await app.duePopup();
    if (popup == null) return;
    await Future<void>.delayed(Duration(milliseconds: 600 + asInt(popup['delay'], 2) * 1000));
    // Not over a screen the shopper has opened since, such as a product or checkout.
    if (!mounted || ModalRoute.of(context)?.isCurrent != true) return;
    app.popupShown(asString(popup['id']));
    await showAppPopup(context, popup);
  }

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final tab = app.customerTab;
    _opened.add(tab);
    Widget page(int i, Widget child) => _opened.contains(i) ? child : const SizedBox.shrink();
    return PopScope(
      // Back from another tab returns to Home before leaving the app.
      canPop: tab == 0,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) app.goToTab(0);
      },
      child: Scaffold(
        body: IndexedStack(
          index: tab,
          children: [
            page(0, const HomeScreen()),
            page(1, const SearchScreen()),
            page(2, const CartScreen()),
            page(3, const OrdersScreen()),
            page(4, const AccountScreen()),
          ],
        ),
        bottomNavigationBar: Dock(
          index: tab,
          onTap: app.goToTab,
          items: [
            const DockItem(Icons.home_outlined, Icons.home_rounded, 'Home'),
            const DockItem(Icons.search_rounded, Icons.manage_search_rounded, 'Search'),
            DockItem(Icons.shopping_bag_outlined, Icons.shopping_bag_rounded, 'Cart', badge: app.cartCount > 0 ? '${app.cartCount}' : null),
            const DockItem(Icons.receipt_long_outlined, Icons.receipt_long_rounded, 'Orders'),
            DockItem(Icons.person_outline_rounded, Icons.person_rounded, 'Account', dot: app.unread + app.supportUnread > 0),
          ],
        ),
      ),
    );
  }
}
