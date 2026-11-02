import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/links.dart';
import '../state/app_state.dart';
import 'customer/order_detail_screen.dart';
import 'customer/outlet_screen.dart';
import 'customer/outlets_screen.dart';
import 'customer/product_screen.dart';
import 'shared/info_screens.dart';
import 'shared/notifications_screen.dart';
import 'shared/support_chat_screen.dart';

/// Opens the screen a tapped notification points to. Customers go straight to the order or
/// page; workspace links written for the website (`/portal/...`, `/admin...`) open the inbox.
void openNotificationLink(BuildContext context, String link) {
  final app = context.read<AppState>();
  final customer = app.user == null || app.user!.isCustomer;
  final path = Uri.tryParse(link)?.path ?? '';
  const direct = ['/orders', '/products', '/outlets', '/search', '/support', '/cart'];
  if (customer && direct.any(path.startsWith)) {
    openLink(context, link);
  } else {
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => const NotificationsScreen()));
  }
}

/// Follows a link written for the website (`/products/abc`, `/search?category=Food`) to the
/// matching screen of the app. Web addresses open in the browser.
void openLink(BuildContext context, String link) {
  if (link.isEmpty) return;
  if (link.startsWith('http://') || link.startsWith('https://')) {
    openExternal(link);
    return;
  }
  final uri = Uri.tryParse(link);
  if (uri == null) return;
  final parts = uri.pathSegments.where((s) => s.isNotEmpty).toList();
  final app = context.read<AppState>();
  final nav = Navigator.of(context);
  void push(Widget screen) => nav.push(MaterialPageRoute(builder: (_) => screen));
  final customer = app.user == null || app.user!.isCustomer;
  if (parts.isEmpty) {
    if (customer) app.goToTab(0);
    return;
  }
  switch (parts.first) {
    case 'products' when parts.length > 1:
      push(ProductScreen(id: parts[1]));
    case 'outlets':
      push(parts.length > 1 ? OutletScreen(id: parts[1]) : const OutletsScreen());
    case 'search' when customer:
      app.goToTab(1, category: uri.queryParameters['category'], query: uri.queryParameters['q'] ?? '');
    case 'cart' when customer:
      app.goToTab(2);
    case 'orders' when customer:
      if (parts.length > 1) {
        push(OrderDetailScreen(id: parts[1]));
      } else {
        app.goToTab(3);
      }
    case 'account' when customer:
      app.goToTab(4);
    case 'support':
      push(const SupportChatScreen());
    case 'contact':
      push(const ContactScreen());
    case 'about':
      push(const AboutScreen());
    case 'notifications':
      push(const NotificationsScreen());
  }
}
