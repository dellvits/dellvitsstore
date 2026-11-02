import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/format.dart';
import '../../core/links.dart';
import '../../core/resource.dart';
import '../../core/theme.dart';
import '../../models/models.dart';
import '../../state/app_state.dart';
import '../../widgets/cart_bar.dart';
import '../../widgets/common.dart';
import '../../widgets/product_widgets.dart';
import '../../widgets/promo.dart';

/// One outlet's menu.
class OutletScreen extends StatefulWidget {
  const OutletScreen({super.key, required this.id, this.preview});
  final String id;

  /// What the list already knew about the outlet, shown until the full details arrive.
  final Outlet? preview;

  @override
  State<OutletScreen> createState() => _OutletScreenState();
}

class _OutletScreenState extends State<OutletScreen> {
  late final Resource<Outlet> _outlet;
  late final Resource<List<Product>> _products;
  String _category = 'All';

  @override
  void initState() {
    super.initState();
    final app = context.read<AppState>();
    _outlet = Resource<Outlet>(() async => Outlet.fromJson(asMap(await app.api.get('/outlets/${widget.id}'))));
    if (widget.preview != null) _outlet.data = widget.preview;
    _outlet.start();
    _products = Resource<List<Product>>(
      () async => asList(
        await app.api.get('/products', query: {'outlet': widget.id, 'location': app.area?.id}),
      ).map(Product.fromJson).toList(),
    )..start();
  }

  @override
  void dispose() {
    _outlet.dispose();
    _products.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return Scaffold(
      body: ListenableBuilder(
        listenable: Listenable.merge([_outlet, _products]),
        builder: (context, _) {
          final o = _outlet.data;
          if (o == null) {
            return SafeArea(
              child: _outlet.error != null ? ErrorState(_outlet.error!, onRetry: _outlet.refresh) : const LoadingView(),
            );
          }
          final all = _products.data;
          final categories = ['All', ...{for (final p in all ?? <Product>[]) p.category}];
          final items = (all ?? []).where((p) => _category == 'All' || p.category == _category).toList();
          return CustomScrollView(
            slivers: [
              SliverAppBar(
                pinned: true,
                expandedHeight: 210,
                backgroundColor: c.bg,
                title: Text(o.name),
                flexibleSpace: FlexibleSpaceBar(
                  background: Stack(
                    fit: StackFit.expand,
                    children: [
                      NetImage(o.image, icon: Icons.storefront_outlined),
                      DecoratedBox(
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            begin: Alignment.topCenter,
                            end: Alignment.bottomCenter,
                            colors: [c.bg.withValues(alpha: 0.85), c.bg.withValues(alpha: 0), c.bg.withValues(alpha: 0)],
                            stops: const [0, 0.5, 1],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          if (o.category.isNotEmpty) Pill(o.category, tone: Tone.brand),
                          Pill(
                            o.open ? (o.hours.isEmpty ? 'Open 24 hours' : 'Open · ${o.hours}') : 'Closed now${o.hours.isEmpty ? '' : ' · ${o.hours}'}',
                            tone: o.open ? Tone.green : Tone.red,
                            icon: Icons.schedule_rounded,
                          ),
                          if (o.minimumOrder > 0) Pill('Min. order ${money(o.minimumOrder)}', icon: Icons.shopping_basket_outlined),
                        ],
                      ),
                      const SizedBox(height: 12),
                      Text(o.name, style: context.t.headlineSmall),
                      if (o.description.isNotEmpty) ...[
                        const SizedBox(height: 6),
                        Text(o.description, style: context.t.bodyMedium!.copyWith(color: c.muted)),
                      ],
                      const SizedBox(height: 12),
                      AppCard(
                        padding: EdgeInsets.zero,
                        child: Column(
                          children: [
                            ListTile(
                              dense: true,
                              leading: Icon(Icons.location_on_outlined, color: c.brand),
                              title: Text(o.address, style: context.t.bodyMedium),
                            ),
                            if (o.phone.isNotEmpty) ...[
                              Divider(indent: 56, color: c.line),
                              ListTile(
                                dense: true,
                                leading: Icon(Icons.call_outlined, color: c.brand),
                                title: Text(o.phone, style: context.t.bodyMedium),
                                trailing: Icon(Icons.chevron_right_rounded, color: c.muted),
                                onTap: () => callPhone(o.phone),
                              ),
                            ],
                          ],
                        ),
                      ),
                      if (!o.open) ...[
                        const SizedBox(height: 12),
                        const Notice('This outlet is not taking orders right now. You can still browse the menu.', tone: Tone.amber),
                      ],
                    ],
                  ),
                ),
              ),
              const SliverToBoxAdapter(child: PromoSlot('outlet')),
              SliverToBoxAdapter(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SectionHeader('Menu', eyebrow: all == null ? null : plural(all.length, 'item')),
                    if (categories.length > 2)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: ChoiceChips<String>(
                          options: {for (final x in categories) x: x},
                          value: _category,
                          onChanged: (v) => setState(() => _category = v),
                        ),
                      ),
                  ],
                ),
              ),
              if (all == null)
                SliverToBoxAdapter(
                  child: _products.error != null
                      ? ErrorState(_products.error!, onRetry: _products.refresh)
                      : const SkeletonList(count: 4, height: 112),
                )
              else if (items.isEmpty)
                const SliverToBoxAdapter(
                  child: EmptyState(
                    icon: Icons.restaurant_menu_rounded,
                    title: 'Nothing here yet',
                    message: 'This outlet has no products in your delivery area right now.',
                  ),
                )
              else
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 28),
                  sliver: SliverList.separated(
                    itemCount: items.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 10),
                    itemBuilder: (_, i) => ProductTile(items[i], key: ValueKey(items[i].id)),
                  ),
                ),
            ],
          );
        },
      ),
      bottomNavigationBar: const CartBar(),
    );
  }
}
