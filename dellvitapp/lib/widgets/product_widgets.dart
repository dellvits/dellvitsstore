import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/format.dart';
import '../core/theme.dart';
import '../models/models.dart';
import '../screens/customer/outlet_screen.dart';
import '../screens/customer/product_screen.dart';
import '../state/app_state.dart';
import 'area_picker.dart';
import 'common.dart';

/// Adds to the cart and explains, in the app's own words, when it cannot.
Future<void> addToCart(BuildContext context, Product p, [int quantity = 1]) async {
  final app = context.read<AppState>();
  switch (app.add(p, quantity)) {
    case AddResult.added:
      break;
    case AddResult.soldOut:
      app.notice('This item is sold out.');
    case AddResult.limit:
      app.notice('You can order up to ${p.orderLimit} of this item at a time.');
    case AddResult.stock:
      app.notice('Only ${p.stock} left of this item.');
    case AddResult.otherArea:
      app.notice('This item is not available in your selected area.');
      showAreaPicker(context);
  }
}

/// The plus button on a product; it becomes a stepper once the product is in the cart.
class AddControl extends StatelessWidget {
  const AddControl(this.product, {super.key});
  final Product product;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final app = context.watch<AppState>();
    final quantity = app.quantityOf(product.id);
    if (product.soldOut) return const SizedBox.shrink();
    if (quantity == 0) {
      return DecoratedBox(
        decoration: BoxDecoration(
          gradient: c.buttonGradient,
          borderRadius: BorderRadius.circular(13),
          boxShadow: [BoxShadow(color: c.brand.withValues(alpha: 0.35), blurRadius: 10, offset: const Offset(0, 4))],
        ),
        child: Material(
          type: MaterialType.transparency,
          child: InkWell(
            borderRadius: BorderRadius.circular(13),
            onTap: () => addToCart(context, product),
            child: const SizedBox(width: 36, height: 36, child: Icon(Icons.add_rounded, color: Colors.white, size: 22)),
          ),
        ),
      );
    }
    return Material(
      color: c.surface,
      elevation: 3,
      shadowColor: c.shadow,
      shape: StadiumBorder(side: BorderSide(color: c.line)),
      child: Padding(
        padding: const EdgeInsets.all(3),
        child: QuantityStepper(
          compact: true,
          value: quantity,
          max: product.maxQuantity,
          onChanged: (q) => app.setQuantity(product.id, q),
        ),
      ),
    );
  }
}

class PriceText extends StatelessWidget {
  const PriceText(this.product, {super.key, this.size = 15});
  final Product product;
  final double size;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return Text.rich(
      TextSpan(
        children: [
          TextSpan(
            text: money(product.effectivePrice),
            style: TextStyle(fontSize: size, fontWeight: FontWeight.w800, color: c.ink),
          ),
          if (product.discount > 0)
            TextSpan(
              text: '  ${money(product.price)}',
              style: TextStyle(
                fontSize: size - 3,
                fontWeight: FontWeight.w500,
                color: c.muted,
                decoration: TextDecoration.lineThrough,
              ),
            ),
        ],
      ),
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
    );
  }
}

void openProduct(BuildContext context, Product p) =>
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => ProductScreen(id: p.id, preview: p)));

void openOutlet(BuildContext context, Outlet o) =>
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => OutletScreen(id: o.id, preview: o)));

class _ProductBadges extends StatelessWidget {
  const _ProductBadges(this.product);
  final Product product;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    if (product.soldOut) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(color: c.inverse.withValues(alpha: 0.85), borderRadius: BorderRadius.circular(8)),
        child: const Text('Sold out', style: TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w700)),
      );
    }
    if (product.discount > 0) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(color: c.brand, borderRadius: BorderRadius.circular(8)),
        child: Text(
          '${product.discount}% OFF',
          style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w800, letterSpacing: 0.2),
        ),
      );
    }
    return const SizedBox.shrink();
  }
}

/// A product in a grid or a rail: picture on top, details below.
class ProductCard extends StatelessWidget {
  const ProductCard(this.product, {super.key});
  final Product product;

  /// The height grids and rails give each card.
  static const double height = 252;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return AppCard(
      padding: EdgeInsets.zero,
      onTap: () => openProduct(context, product),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Padding(
              // The picture sits inset with its own rounded corners.
              padding: const EdgeInsets.fromLTRB(6, 6, 6, 0),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(15),
                child: ColoredBox(
                  color: c.soft,
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      Opacity(opacity: product.soldOut ? 0.55 : 1, child: NetImage(product.image)),
                      Positioned(left: 7, top: 7, child: _ProductBadges(product)),
                      Positioned(right: 7, bottom: 7, child: AddControl(product)),
                    ],
                  ),
                ),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(product.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.t.titleSmall),
                const SizedBox(height: 2),
                Text(
                  product.outletName.isEmpty ? product.unit : '${product.unit} · ${product.outletName}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: context.t.bodySmall,
                ),
                const SizedBox(height: 7),
                PriceText(product),
                const SizedBox(height: 5),
                Row(
                  children: [
                    Icon(Icons.schedule_rounded, size: 13, color: c.muted),
                    const SizedBox(width: 4),
                    Text('${product.deliveryMinutes} min', style: context.t.bodySmall!.copyWith(fontSize: 11.5)),
                    if (product.deal.isNotEmpty) ...[
                      const SizedBox(width: 6),
                      Flexible(child: Pill(product.deal, tone: Tone.orange, dense: true)),
                    ],
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

/// A product as a wide row: used in lists where the name matters more than the picture.
class ProductTile extends StatelessWidget {
  const ProductTile(this.product, {super.key});
  final Product product;

  @override
  Widget build(BuildContext context) => AppCard(
    padding: const EdgeInsets.all(10),
    onTap: () => openProduct(context, product),
    child: Row(
      children: [
        Stack(
          children: [
            Opacity(opacity: product.soldOut ? 0.55 : 1, child: NetImage(product.image, width: 92, height: 92, radius: 12)),
            Positioned(left: 5, top: 5, child: _ProductBadges(product)),
          ],
        ),
        const SizedBox(width: 12),
        Expanded(
          child: SizedBox(
            height: 92,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(product.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.t.titleSmall),
                const SizedBox(height: 2),
                Text(
                  product.description,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: context.t.bodySmall,
                ),
                const Spacer(),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Expanded(child: PriceText(product)),
                    AddControl(product),
                  ],
                ),
              ],
            ),
          ),
        ),
      ],
    ),
  );
}

/// A row of products that scrolls sideways.
class ProductRail extends StatelessWidget {
  const ProductRail(this.products, {super.key});
  final List<Product> products;

  @override
  Widget build(BuildContext context) => SizedBox(
    height: ProductCard.height,
    child: ListView.separated(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      itemCount: products.length,
      separatorBuilder: (_, _) => const SizedBox(width: 12),
      itemBuilder: (_, i) => SizedBox(width: 164, child: ProductCard(products[i])),
    ),
  );
}

const productGrid = SliverGridDelegateWithFixedCrossAxisCount(
  crossAxisCount: 2,
  mainAxisExtent: ProductCard.height,
  crossAxisSpacing: 12,
  mainAxisSpacing: 12,
);

class OutletMeta extends StatelessWidget {
  const OutletMeta(this.outlet, {super.key});
  final Outlet outlet;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final parts = [
      outlet.category,
      if (outlet.deliveryMinutes > 0) '${outlet.deliveryMinutes} min',
      if (outlet.products > 0) plural(outlet.products, 'item'),
    ].where((s) => s.isNotEmpty).join(' · ');
    return Row(
      children: [
        Flexible(child: Text(parts, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.t.bodySmall)),
        if (!outlet.open) ...[
          const SizedBox(width: 6),
          Text('Closed', style: context.t.bodySmall!.copyWith(color: c.brand, fontWeight: FontWeight.w700)),
        ],
      ],
    );
  }
}

/// An outlet in the home page rail.
class OutletCard extends StatelessWidget {
  const OutletCard(this.outlet, {super.key});
  final Outlet outlet;

  @override
  Widget build(BuildContext context) => SizedBox(
    width: 232,
    child: AppCard(
      padding: EdgeInsets.zero,
      onTap: () => openOutlet(context, outlet),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(6, 6, 6, 0),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(15),
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    Opacity(opacity: outlet.open ? 1 : 0.6, child: NetImage(outlet.image, icon: Icons.storefront_outlined)),
                    if (outlet.featured)
                      const Positioned(left: 8, top: 8, child: Pill('Featured', tone: Tone.orange, icon: Icons.star_rounded, dense: true)),
                  ],
                ),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(outlet.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.t.titleSmall),
                const SizedBox(height: 3),
                OutletMeta(outlet),
              ],
            ),
          ),
        ],
      ),
    ),
  );
}

/// An outlet as a full-width row, for the outlets list.
class OutletTile extends StatelessWidget {
  const OutletTile(this.outlet, {super.key});
  final Outlet outlet;

  @override
  Widget build(BuildContext context) => AppCard(
    padding: const EdgeInsets.all(10),
    onTap: () => openOutlet(context, outlet),
    child: Row(
      children: [
        Opacity(
          opacity: outlet.open ? 1 : 0.6,
          child: NetImage(outlet.image, width: 76, height: 76, radius: 12, icon: Icons.storefront_outlined),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Flexible(
                    child: Text(outlet.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.t.titleSmall),
                  ),
                  if (outlet.featured) ...[
                    const SizedBox(width: 6),
                    Icon(Icons.star_rounded, size: 16, color: context.c.orange),
                  ],
                ],
              ),
              const SizedBox(height: 3),
              OutletMeta(outlet),
              const SizedBox(height: 3),
              Text(outlet.address, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.t.bodySmall),
            ],
          ),
        ),
        Icon(Icons.chevron_right_rounded, color: context.c.muted),
      ],
    ),
  );
}
