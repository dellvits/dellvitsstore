import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/format.dart';
import '../../core/resource.dart';
import '../../core/theme.dart';
import '../../models/models.dart';
import '../../state/app_state.dart';
import '../../widgets/common.dart';
import '../../widgets/product_widgets.dart';
import '../../widgets/promo.dart';
import 'outlet_screen.dart';

class ProductScreen extends StatefulWidget {
  const ProductScreen({super.key, required this.id, this.preview});
  final String id;

  /// The product as the list showed it, so the page opens without waiting.
  final Product? preview;

  @override
  State<ProductScreen> createState() => _ProductScreenState();
}

class _ProductScreenState extends State<ProductScreen> {
  late final Resource<Product> _product;
  late final Resource<List<PaymentMethod>> _payments;
  Resource<List<Product>>? _related;
  int _page = 0;
  int _quantity = 1;

  @override
  void initState() {
    super.initState();
    final app = context.read<AppState>();
    _product = Resource<Product>(() async {
      final p = Product.fromJson(asMap(await app.api.get('/products/${widget.id}')));
      _loadRelated(p);
      return p;
    });
    if (widget.preview != null) _product.data = widget.preview;
    _product.start();
    _payments = Resource<List<PaymentMethod>>(
      () async => asList(await app.api.get('/payments', query: {'products': widget.id})).map(PaymentMethod.fromJson).toList(),
    )..start();
  }

  void _loadRelated(Product p) {
    if (_related != null || !mounted) return;
    final app = context.read<AppState>();
    _related = Resource<List<Product>>(
      () async => asList(
        await app.api.get('/products', query: {'location': p.locationId, 'outlet': p.outletId}),
      ).map(Product.fromJson).where((x) => x.id != p.id).take(10).toList(),
    )..start();
    _related!.addListener(() {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _product.dispose();
    _payments.dispose();
    _related?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final app = context.watch<AppState>();
    return ListenableBuilder(
      listenable: Listenable.merge([_product, _payments]),
      builder: (context, _) {
        final p = _product.data;
        if (p == null) {
          return Scaffold(
            appBar: AppBar(),
            body: _product.error != null ? ErrorState(_product.error!, onRetry: _product.refresh) : const LoadingView(),
          );
        }
        final inCart = app.quantityOf(p.id);
        final images = p.images.isEmpty ? [''] : p.images;
        final related = _related?.data ?? [];
        final max = p.maxQuantity;
        if (_quantity > max && max > 0) _quantity = max;
        return Scaffold(
          body: CustomScrollView(
            slivers: [
              SliverAppBar(
                pinned: true,
                expandedHeight: 320,
                backgroundColor: c.bg,
                leading: const _RoundBack(),
                actions: [
                  Padding(
                    padding: const EdgeInsets.only(right: 10),
                    child: _RoundIcon(
                      onTap: () => app.goToTab(2),
                      child: Badge(
                        isLabelVisible: app.cartCount > 0,
                        label: Text('${app.cartCount}'),
                        backgroundColor: c.brand,
                        child: Icon(Icons.shopping_bag_outlined, color: c.ink, size: 20),
                      ),
                    ),
                  ),
                ],
                flexibleSpace: FlexibleSpaceBar(
                  background: Stack(
                    fit: StackFit.expand,
                    children: [
                      PageView.builder(
                        itemCount: images.length,
                        onPageChanged: (i) => setState(() => _page = i),
                        itemBuilder: (_, i) => NetImage(images[i]),
                      ),
                      if (images.length > 1)
                        Positioned(
                          bottom: 14,
                          left: 0,
                          right: 0,
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              for (var i = 0; i < images.length; i++)
                                AnimatedContainer(
                                  duration: const Duration(milliseconds: 200),
                                  margin: const EdgeInsets.symmetric(horizontal: 3),
                                  width: i == _page ? 18 : 7,
                                  height: 7,
                                  decoration: BoxDecoration(
                                    color: i == _page ? c.brand : Colors.white.withValues(alpha: 0.85),
                                    borderRadius: BorderRadius.circular(9),
                                  ),
                                ),
                            ],
                          ),
                        ),
                    ],
                  ),
                ),
              ),
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(18, 18, 18, 0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          Pill(p.category, tone: Tone.brand),
                          if (p.discount > 0) Pill('${p.discount}% off', tone: Tone.red, icon: Icons.local_offer_outlined),
                          if (p.deal.isNotEmpty) Pill(p.deal, tone: Tone.orange),
                          if (p.soldOut)
                            const Pill('Sold out', tone: Tone.neutral)
                          else if (p.stock < 10)
                            Pill('Only ${p.stock} left', tone: Tone.amber),
                        ],
                      ),
                      const SizedBox(height: 12),
                      Text(p.name, style: context.t.headlineSmall),
                      const SizedBox(height: 4),
                      Text(p.unit, style: context.t.bodyMedium!.copyWith(color: c.muted)),
                      const SizedBox(height: 12),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Text(money(p.effectivePrice), style: context.t.headlineMedium!.copyWith(color: c.brand)),
                          if (p.discount > 0) ...[
                            const SizedBox(width: 10),
                            Padding(
                              padding: const EdgeInsets.only(bottom: 4),
                              child: Text(
                                money(p.price),
                                style: context.t.bodyLarge!.copyWith(color: c.muted, decoration: TextDecoration.lineThrough),
                              ),
                            ),
                          ],
                        ],
                      ),
                      const SizedBox(height: 16),
                      AppCard(
                        padding: const EdgeInsets.all(12),
                        onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => OutletScreen(id: p.outletId))),
                        child: Row(
                          children: [
                            const IconBubble(Icons.storefront_outlined, size: 42),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(p.outletName, style: context.t.titleSmall, maxLines: 1, overflow: TextOverflow.ellipsis),
                                  Text(
                                    'Delivery in about ${p.deliveryMinutes} min',
                                    style: context.t.bodySmall,
                                  ),
                                ],
                              ),
                            ),
                            Icon(Icons.chevron_right_rounded, color: c.muted),
                          ],
                        ),
                      ),
                      const SizedBox(height: 18),
                      Text('About this item', style: context.t.titleMedium),
                      const SizedBox(height: 6),
                      Text(p.description, style: context.t.bodyLarge),
                      if (p.includes.isNotEmpty) _Listed(title: 'What’s included', text: p.includes, icon: Icons.check_circle_outline_rounded, tone: Tone.green),
                      if (p.excludes.isNotEmpty) _Listed(title: 'Not included', text: p.excludes, icon: Icons.remove_circle_outline_rounded, tone: Tone.neutral),
                      if (_payments.data != null) ...[
                        const SizedBox(height: 18),
                        Text('Ways to pay', style: context.t.titleMedium),
                        const SizedBox(height: 8),
                        if (_payments.data!.isEmpty)
                          const Notice('This item cannot be ordered right now because no payment method is available for it.', tone: Tone.amber)
                        else
                          Wrap(
                            spacing: 8,
                            runSpacing: 8,
                            children: [
                              for (final m in _payments.data!)
                                Container(
                                  padding: const EdgeInsets.fromLTRB(6, 6, 12, 6),
                                  decoration: BoxDecoration(
                                    color: c.surface,
                                    borderRadius: BorderRadius.circular(14),
                                    border: Border.all(color: c.line),
                                  ),
                                  child: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      PaymentLogo(m, size: 30),
                                      const SizedBox(width: 8),
                                      Text(m.name, style: context.t.labelMedium!.copyWith(color: c.ink)),
                                    ],
                                  ),
                                ),
                            ],
                          ),
                      ],
                    ],
                  ),
                ),
              ),
              const SliverToBoxAdapter(child: PromoSlot('product')),
              if (related.isNotEmpty)
                SliverToBoxAdapter(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      SectionHeader('More from ${p.outletName}', eyebrow: 'Add to your order'),
                      ProductRail(related),
                    ],
                  ),
                ),
              const SliverToBoxAdapter(child: SizedBox(height: 24)),
            ],
          ),
          bottomNavigationBar: BottomBar(
            child: p.soldOut
                ? const AppButton('Sold out', onPressed: null)
                : inCart > 0
                ? Row(
                    children: [
                      QuantityStepper(value: inCart, max: max, onChanged: (q) => app.setQuantity(p.id, q)),
                      const SizedBox(width: 14),
                      Expanded(
                        child: AppButton('View cart · ${money(app.cartSubtotal)}', onPressed: () => app.goToTab(2)),
                      ),
                    ],
                  )
                : Row(
                    children: [
                      QuantityStepper(
                        value: _quantity,
                        max: max,
                        removable: false,
                        onChanged: (q) => setState(() => _quantity = q < 1 ? 1 : q),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: AppButton(
                          'Add · ${money(p.effectivePrice * _quantity)}',
                          icon: Icons.shopping_bag_outlined,
                          onPressed: () => addToCart(context, p, _quantity),
                        ),
                      ),
                    ],
                  ),
          ),
        );
      },
    );
  }
}

class _Listed extends StatelessWidget {
  const _Listed({required this.title, required this.text, required this.icon, required this.tone});
  final String title, text;
  final IconData icon;
  final Tone tone;

  @override
  Widget build(BuildContext context) {
    // Administrators write these as a line or a comma-separated list.
    final lines = text.split(RegExp(r'[\n,]')).map((s) => s.trim()).where((s) => s.isNotEmpty).toList();
    final colors = toneColors(context, tone);
    return Padding(
      padding: const EdgeInsets.only(top: 18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: context.t.titleMedium),
          const SizedBox(height: 6),
          for (final line in lines)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 3),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(padding: const EdgeInsets.only(top: 2), child: Icon(icon, size: 17, color: colors.fg)),
                  const SizedBox(width: 8),
                  Expanded(child: Text(line, style: context.t.bodyMedium)),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _RoundIcon extends StatelessWidget {
  const _RoundIcon({required this.child, required this.onTap});
  final Widget child;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Center(
    child: Material(
      color: context.c.surface,
      shape: const CircleBorder(),
      elevation: 2,
      shadowColor: Colors.black26,
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onTap,
        child: SizedBox(width: 40, height: 40, child: Center(child: child)),
      ),
    ),
  );
}

class _RoundBack extends StatelessWidget {
  const _RoundBack();

  @override
  Widget build(BuildContext context) => _RoundIcon(
    onTap: () => Navigator.of(context).maybePop(),
    child: Icon(Icons.arrow_back_rounded, color: context.c.ink, size: 20),
  );
}
