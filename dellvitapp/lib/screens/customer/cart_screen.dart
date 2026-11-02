import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/format.dart';
import '../../core/theme.dart';
import '../../models/models.dart';
import '../../state/app_state.dart';
import '../../widgets/common.dart';
import '../../widgets/product_widgets.dart';
import '../auth/login_screen.dart';
import 'checkout_screen.dart';
import 'outlet_screen.dart';

class CartScreen extends StatelessWidget {
  const CartScreen({super.key});

  Future<void> _checkout(BuildContext context) async {
    final app = context.read<AppState>();
    final nav = Navigator.of(context);
    if (app.user == null) {
      // The cart is kept while the customer signs in.
      final signedIn = await nav.push<bool>(
        MaterialPageRoute(
          builder: (_) => const LoginScreen(
            reason: 'Sign in to check out. An account keeps your orders, delivery code and payment status safe.',
          ),
        ),
      );
      if (signedIn != true || app.user == null || !app.user!.isCustomer) return;
    }
    if (app.cart.isEmpty) return;
    nav.push(MaterialPageRoute(builder: (_) => const CheckoutScreen()));
  }

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final app = context.watch<AppState>();
    final cart = app.cart;
    if (cart.isEmpty) {
      return Scaffold(
        appBar: AppBar(title: const Text('Your cart'), titleSpacing: 20),
        body: EmptyState(
          icon: Icons.shopping_bag_outlined,
          title: 'Your cart is empty',
          message: 'Add something good from a local outlet.',
          action: 'Start shopping',
          onAction: () => app.goToTab(1),
        ),
      );
    }
    final first = cart.first.product;
    final chosen = app.area;
    final area = chosen != null && !chosen.isNationwide ? chosen : app.areaById(first.locationId);
    final subtotal = app.cartSubtotal;
    // Items from several outlets become one order per outlet, each with its own delivery.
    final outlets = <String, List<CartItem>>{};
    for (final i in cart) {
      outlets.putIfAbsent(i.product.outletId, () => []).add(i);
    }
    final free = area != null && area.freeDeliveryOver > 0 && subtotal >= area.freeDeliveryOver;
    final fee = free ? 0 : (area?.fee ?? 0) * outlets.length;
    final minimum = [asInt(app.site.settings['minimum_order']), area?.minimumOrder ?? 0].reduce((a, b) => a > b ? a : b);
    return Scaffold(
      appBar: AppBar(
        titleSpacing: 20,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Your cart'),
            Text(plural(app.cartCount, 'item'), style: context.t.bodySmall),
          ],
        ),
        actions: [
          TextButton.icon(
            onPressed: () async {
              if (await showConfirm(
                context,
                title: 'Clear your cart?',
                message: 'All items will be removed.',
                confirm: 'Clear cart',
                cancel: 'Keep items',
                danger: true,
              )) {
                app.clearCart();
              }
            },
            icon: const Icon(Icons.delete_outline_rounded, size: 18),
            label: const Text('Clear'),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 20),
        children: [
          if (outlets.length > 1) ...[
            Notice(
              'Your cart has items from ${outlets.length} outlets. They are ordered together and each outlet sends its part separately.',
              tone: Tone.blue,
              icon: Icons.storefront_outlined,
            ),
            const SizedBox(height: 12),
          ],
          for (final group in outlets.values) ...[
            AppCard(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => OutletScreen(id: group.first.product.outletId))),
              child: Row(
                children: [
                  const IconBubble(Icons.storefront_outlined, size: 40),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(group.first.product.outletName, style: context.t.titleSmall, maxLines: 1, overflow: TextOverflow.ellipsis),
                        Text('Add more items from this outlet', style: context.t.bodySmall),
                      ],
                    ),
                  ),
                  Icon(Icons.add_circle_outline_rounded, color: c.brand),
                ],
              ),
            ),
            const SizedBox(height: 10),
            for (final item in group)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Dismissible(
                  key: ValueKey(item.product.id),
                  direction: DismissDirection.endToStart,
                  onDismissed: (_) => app.setQuantity(item.product.id, 0),
                  background: Container(
                    alignment: Alignment.centerRight,
                    padding: const EdgeInsets.only(right: 22),
                    decoration: BoxDecoration(color: c.red50, borderRadius: BorderRadius.circular(18)),
                    child: Icon(Icons.delete_outline_rounded, color: c.brand),
                  ),
                  child: _CartLine(item),
                ),
              ),
            const SizedBox(height: 4),
          ],
          const SizedBox(height: 6),
          if (minimum > subtotal) ...[
            Notice('The minimum order is ${money(minimum)}. Add ${money(minimum - subtotal)} more to check out.', tone: Tone.amber),
            const SizedBox(height: 12),
          ],
          if (!free && area != null && area.freeDeliveryOver > 0) ...[
            Notice(
              'Add ${money(area.freeDeliveryOver - subtotal)} more for free delivery.',
              tone: Tone.green,
              icon: Icons.local_shipping_outlined,
            ),
            const SizedBox(height: 12),
          ],
          AppCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Order summary', style: context.t.titleMedium),
                const SizedBox(height: 8),
                SummaryLine('Subtotal', money(subtotal)),
                if (app.cartSavings > 0) SummaryLine('You save', '−${money(app.cartSavings)}', tone: Tone.green),
                SummaryLine(
                  'Delivery${outlets.length > 1 ? ' · ${outlets.length} outlets' : area == null ? '' : ' · ${area.name}'}',
                  fee == 0 ? 'Free' : money(fee),
                ),
                Divider(height: 18, color: c.line),
                SummaryLine('Total', money(subtotal + fee), bold: true),
                const SizedBox(height: 4),
                Text('Prices and stock are confirmed when you order.', style: context.t.bodySmall),
              ],
            ),
          ),
        ],
      ),
      bottomNavigationBar: BottomBar(
        child: AppButton(
          'Checkout · ${money(subtotal + fee)}',
          icon: Icons.lock_outline_rounded,
          onPressed: () => _checkout(context),
        ),
      ),
    );
  }
}

class _CartLine extends StatelessWidget {
  const _CartLine(this.item);
  final CartItem item;

  @override
  Widget build(BuildContext context) {
    final app = context.read<AppState>();
    final p = item.product;
    return AppCard(
      padding: const EdgeInsets.all(10),
      onTap: () => openProduct(context, p),
      child: Row(
        children: [
          NetImage(p.image, width: 74, height: 74, radius: 12),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(p.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.t.titleSmall),
                Text(p.unit, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.t.bodySmall),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        money(item.total),
                        style: context.t.titleSmall!.copyWith(fontWeight: FontWeight.w800, fontSize: 15),
                      ),
                    ),
                    QuantityStepper(
                      compact: true,
                      value: item.quantity,
                      max: p.maxQuantity,
                      onChanged: (q) => app.setQuantity(p.id, q),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
