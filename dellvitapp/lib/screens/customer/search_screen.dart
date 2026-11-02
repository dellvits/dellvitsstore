import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/resource.dart';
import '../../core/theme.dart';
import '../../models/models.dart';
import '../../state/app_state.dart';
import '../../widgets/area_picker.dart';
import '../../widgets/common.dart';
import '../../widgets/product_widgets.dart';
import '../../widgets/promo.dart';

const _sorts = {
  'recommended': 'Recommended',
  'low': 'Price: low to high',
  'high': 'Price: high to low',
  'deals': 'Biggest discount',
  'fast': 'Fastest delivery',
};

/// Browse and search every product in the chosen delivery area.
class SearchScreen extends StatefulWidget {
  const SearchScreen({super.key});

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  final _query = TextEditingController();
  Timer? _typing;
  Resource<List<Product>>? _products;
  String? _key;
  int _request = -1;
  String _category = 'All';
  String _sort = 'recommended';
  bool _deals = false;
  bool _inStock = false;

  /// Reloads when the area, the search text or the category changes.
  void _sync(AppState app) {
    if (app.searchRequest != _request) {
      _request = app.searchRequest;
      _category = app.searchCategory;
      if (_query.text != app.searchQuery) _query.text = app.searchQuery;
    }
    final area = app.area?.id;
    final key = '$area|${_query.text.trim()}|$_category';
    if (key == _key) return;
    _key = key;
    _products?.dispose();
    final q = _query.text.trim();
    final category = _category;
    _products = area == null
        ? null
        : (Resource<List<Product>>(
            () async => asList(
              await app.api.get('/products', query: {'location': area, 'q': q, 'category': category}),
            ).map(Product.fromJson).toList(),
          )..start());
  }

  @override
  void dispose() {
    _typing?.cancel();
    _products?.dispose();
    _query.dispose();
    super.dispose();
  }

  void _pickSort() {
    showModalBottomSheet<void>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
              child: Text('Sort by', style: context.t.headlineSmall),
            ),
            for (final e in _sorts.entries)
              ListTile(
                title: Text(e.value),
                trailing: e.key == _sort ? Icon(Icons.check_rounded, color: context.c.brand) : null,
                onTap: () {
                  setState(() => _sort = e.key);
                  Navigator.pop(context);
                },
              ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final app = context.watch<AppState>();
    _sync(app);
    final categories = ['All', ...app.site.categories.where((x) => x.showInFilters).map((x) => x.name)];
    if (!categories.contains(_category)) categories.add(_category);
    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      _query.text.trim().isNotEmpty
                          ? 'Results'
                          : _category != 'All'
                          ? _category
                          : 'Explore',
                      style: context.t.headlineSmall,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  TextButton.icon(
                    onPressed: () => showAreaPicker(context),
                    icon: const Icon(Icons.location_on_outlined, size: 17),
                    label: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 150),
                      child: Text(app.area?.name ?? 'Select area', maxLines: 1, overflow: TextOverflow.ellipsis),
                    ),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 6, 16, 10),
              child: TextField(
                controller: _query,
                textInputAction: TextInputAction.search,
                decoration: InputDecoration(
                  hintText: 'Search products or outlets',
                  prefixIcon: const Icon(Icons.search_rounded),
                  suffixIcon: _query.text.isEmpty
                      ? null
                      : IconButton(
                          icon: const Icon(Icons.close_rounded),
                          onPressed: () {
                            _query.clear();
                            setState(() {});
                          },
                        ),
                ),
                onChanged: (_) {
                  _typing?.cancel();
                  _typing = Timer(const Duration(milliseconds: 450), () {
                    if (mounted) setState(() {});
                  });
                },
                onSubmitted: (_) => setState(() {}),
              ),
            ),
            ChoiceChips<String>(
              options: {for (final x in categories) x: x},
              value: _category,
              onChanged: (v) => setState(() => _category = v),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 8, 4),
              child: Row(
                children: [
                  FilterChip(
                    label: const Text('Deals'),
                    avatar: Icon(Icons.local_offer_outlined, size: 16, color: _deals ? c.brand : c.muted),
                    selected: _deals,
                    selectedColor: c.brand50,
                    onSelected: (v) => setState(() => _deals = v),
                  ),
                  const SizedBox(width: 8),
                  FilterChip(
                    label: const Text('In stock'),
                    avatar: Icon(Icons.check_circle_outline_rounded, size: 16, color: _inStock ? c.brand : c.muted),
                    selected: _inStock,
                    selectedColor: c.brand50,
                    onSelected: (v) => setState(() => _inStock = v),
                  ),
                  const Spacer(),
                  TextButton.icon(
                    onPressed: _pickSort,
                    style: TextButton.styleFrom(foregroundColor: c.ink),
                    icon: const Icon(Icons.swap_vert_rounded, size: 18),
                    label: Text(_sort == 'recommended' ? 'Sort' : _sorts[_sort]!.split(':').last.trim()),
                  ),
                ],
              ),
            ),
            Expanded(
              child: _products == null
                  ? (app.areaStatus == AreaStatus.detecting ? const LoadingView() : const SingleChildScrollView(child: ChooseArea()))
                  : RefreshIndicator(
                      color: c.brand,
                      onRefresh: () => _products!.refresh(silent: true),
                      child: ResourceView<List<Product>>(
                        resource: _products!,
                        loading: GridView.builder(
                          padding: const EdgeInsets.all(16),
                          gridDelegate: productGrid,
                          itemCount: 6,
                          itemBuilder: (_, _) => const Skeleton(height: ProductCard.height, radius: 18),
                        ),
                        builder: (context, all) {
                          final items = all.where((p) => (!_deals || p.discount > 0) && (!_inStock || !p.soldOut)).toList();
                          switch (_sort) {
                            case 'low':
                              items.sort((a, b) => a.effectivePrice.compareTo(b.effectivePrice));
                            case 'high':
                              items.sort((a, b) => b.effectivePrice.compareTo(a.effectivePrice));
                            case 'deals':
                              items.sort((a, b) => b.discount.compareTo(a.discount));
                            case 'fast':
                              items.sort((a, b) => a.deliveryMinutes.compareTo(b.deliveryMinutes));
                          }
                          if (items.isEmpty) {
                            return ListView(
                              children: const [
                                EmptyState(
                                  icon: Icons.search_off_rounded,
                                  title: 'No matching items',
                                  message: 'Try another search, category or delivery area.',
                                ),
                              ],
                            );
                          }
                          return CustomScrollView(
                            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                            slivers: [
                              const SliverToBoxAdapter(child: PromoSlot('search', padding: EdgeInsets.fromLTRB(16, 6, 16, 0))),
                              SliverToBoxAdapter(
                                child: Padding(
                                  padding: const EdgeInsets.fromLTRB(18, 10, 16, 8),
                                  child: Text('${items.length} ${items.length == 1 ? 'item' : 'items'}', style: context.t.bodySmall),
                                ),
                              ),
                              SliverPadding(
                                padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                                sliver: SliverGrid.builder(
                                  gridDelegate: productGrid,
                                  itemCount: items.length,
                                  itemBuilder: (_, i) => ProductCard(items[i], key: ValueKey(items[i].id)),
                                ),
                              ),
                            ],
                          );
                        },
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
