import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/pick_image.dart';
import '../../core/resource.dart';
import '../../core/theme.dart';
import '../../models/models.dart';
import '../../state/app_state.dart';
import '../../widgets/common.dart';

/// The outlet's own products: listed and archived.
class OutletProductsScreen extends StatefulWidget {
  const OutletProductsScreen({super.key});

  @override
  State<OutletProductsScreen> createState() => _OutletProductsScreenState();
}

class _OutletProductsScreenState extends State<OutletProductsScreen> {
  late final Resource<List<Product>> _products;
  String _search = '';
  String _filter = 'listed';

  @override
  void initState() {
    super.initState();
    final api = context.read<AppState>().api;
    _products = Resource<List<Product>>(
      () async => asList(await api.get('/manage/products')).map(Product.fromJson).toList(),
    )..start();
  }

  @override
  void dispose() {
    _products.dispose();
    super.dispose();
  }

  Future<void> _edit([Product? product]) async {
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => ProductFormScreen(product: product)),
    );
    if (saved == true) _products.refresh(silent: true);
  }

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return Scaffold(
      appBar: AppBar(title: const Text('Products'), titleSpacing: 20),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _edit(),
        icon: const Icon(Icons.add_rounded),
        label: const Text('Add product', style: TextStyle(fontWeight: FontWeight.w700)),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 10),
            child: TextField(
              decoration: const InputDecoration(hintText: 'Search products', prefixIcon: Icon(Icons.search_rounded)),
              onChanged: (v) => setState(() => _search = v),
            ),
          ),
          Align(
            alignment: Alignment.centerLeft,
            child: ChoiceChips<String>(
              options: const {'listed': 'Listed', 'low': 'Low stock', 'out': 'Out of stock', 'archived': 'Archived'},
              value: _filter,
              onChanged: (v) => setState(() => _filter = v),
            ),
          ),
          const SizedBox(height: 6),
          Expanded(
            child: RefreshIndicator(
              color: c.brand,
              onRefresh: () => _products.refresh(silent: true),
              child: ResourceView<List<Product>>(
                resource: _products,
                builder: (context, all) {
                  final q = _search.trim().toLowerCase();
                  final items = all
                      .where(
                        (p) =>
                            switch (_filter) {
                              'archived' => !p.active,
                              'low' => p.active && p.stock > 0 && p.stock < 10,
                              'out' => p.active && p.stock == 0,
                              _ => p.active,
                            } &&
                            (q.isEmpty || '${p.name} ${p.category} ${p.sku}'.toLowerCase().contains(q)),
                      )
                      .toList();
                  if (items.isEmpty) {
                    return ListView(
                      children: [
                        EmptyState(
                          icon: Icons.restaurant_menu_rounded,
                          title: all.isEmpty ? 'No products yet' : 'Nothing here',
                          message: all.isEmpty ? 'Add your first product to start selling.' : 'No products match this filter.',
                          action: all.isEmpty ? 'Add product' : null,
                          onAction: () => _edit(),
                        ),
                      ],
                    );
                  }
                  return ListView.separated(
                    keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                    padding: const EdgeInsets.fromLTRB(16, 6, 16, 96),
                    itemCount: items.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 10),
                    itemBuilder: (context, i) {
                      final p = items[i];
                      return AppCard(
                        key: ValueKey(p.id),
                        padding: const EdgeInsets.all(10),
                        onTap: () => _edit(p),
                        child: Row(
                          children: [
                            Opacity(opacity: p.active ? 1 : 0.5, child: NetImage(p.image, width: 68, height: 68, radius: 12)),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(p.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.t.titleSmall),
                                  const SizedBox(height: 2),
                                  Text('${p.category} · ${p.unit}', maxLines: 1, overflow: TextOverflow.ellipsis, style: context.t.bodySmall),
                                  const SizedBox(height: 6),
                                  Row(
                                    children: [
                                      Text(money(p.effectivePrice), style: context.t.titleSmall!.copyWith(fontWeight: FontWeight.w800)),
                                      if (p.discount > 0) ...[const SizedBox(width: 6), Pill('−${p.discount}%', tone: Tone.red, dense: true)],
                                      const Spacer(),
                                      if (!p.active)
                                        const Pill('Archived', dense: true)
                                      else
                                        Pill(
                                          p.stock == 0 ? 'Out of stock' : '${p.stock} in stock',
                                          tone: p.stock == 0
                                              ? Tone.red
                                              : p.stock < 10
                                              ? Tone.amber
                                              : Tone.green,
                                          dense: true,
                                        ),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
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

/// Add or edit one product. Prices are typed in rupees and saved in paisa.
class ProductFormScreen extends StatefulWidget {
  const ProductFormScreen({super.key, this.product});
  final Product? product;

  @override
  State<ProductFormScreen> createState() => _ProductFormScreenState();
}

class _ProductFormScreenState extends State<ProductFormScreen> {
  final _form = GlobalKey<FormState>();
  late final Resource<({Json outlet, List<Json> methods})> _setup;
  late final TextEditingController _name, _description, _price, _discount, _stock, _max, _unit, _sku, _minutes, _deal, _includes, _excludes;
  late List<String> _images;
  late Set<String> _methods;
  late String _category;
  late bool _active;
  bool _uploading = false;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final app = context.read<AppState>();
    final p = widget.product;
    TextEditingController text(String v) => TextEditingController(text: v);
    _name = text(p?.name ?? '');
    _description = text(p?.description ?? '');
    _price = text(p == null ? '' : (p.price / 100).toStringAsFixed(p.price % 100 == 0 ? 0 : 2));
    _discount = text('${p?.discount ?? 0}');
    _stock = text('${p?.stock ?? 10}');
    _max = text('${p?.maxPerOrder ?? 10}');
    _unit = text(p?.unit ?? '1 item');
    _sku = text(p?.sku ?? '');
    _minutes = text('${p?.deliveryMinutes ?? 30}');
    _deal = text(p?.deal ?? '');
    _includes = text(p?.includes ?? '');
    _excludes = text(p?.excludes ?? '');
    _images = List.of(p?.images ?? const []);
    _methods = {...?p?.paymentMethods};
    _category = p?.category ?? (app.site.categories.isEmpty ? '' : app.site.categories.first.name);
    _active = p?.active ?? true;
    _setup = Resource(() async {
      final r = await Future.wait<dynamic>([app.api.get('/manage/outlet'), app.api.get('/manage/payment-methods')]);
      final methods = asList(r[1]);
      // A new product starts with every enabled method, so it can be ordered straight away.
      if (p == null && _methods.isEmpty) _methods = {for (final m in methods) if (asBool(m['active'])) asString(m['id'])};
      return (outlet: asMap(r[0]), methods: methods);
    })..start();
  }

  @override
  void dispose() {
    for (final c in [_name, _description, _price, _discount, _stock, _max, _unit, _sku, _minutes, _deal, _includes, _excludes]) {
      c.dispose();
    }
    _setup.dispose();
    super.dispose();
  }

  Future<void> _addImage() async {
    final app = context.read<AppState>();
    final picked = await pickAndCropImage(context, title: 'Crop product photo', square: true);
    if (picked == null || !mounted) return;
    setState(() => _uploading = true);
    try {
      final r = asMap(await app.api.upload('/manage/images', picked));
      setState(() => _images.add(asString(r['url'])));
    } catch (e) {
      app.notice(errorText(e));
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Json _body(Json outlet) => {
    'outlet_id': asString(outlet['id']),
    'name': _name.text.trim(),
    'description': _description.text.trim(),
    'category': _category,
    'price': ((double.tryParse(_price.text.trim()) ?? 0) * 100).round(),
    'stock': int.tryParse(_stock.text.trim()) ?? 0,
    'max_per_order': int.tryParse(_max.text.trim()) ?? 99,
    'unit': _unit.text.trim(),
    'sku': _sku.text.trim(),
    // The product stays in the area it is listed in; new ones start in the outlet's area.
    'location_id': widget.product?.locationId ?? asString(outlet['location_id']),
    'discount': int.tryParse(_discount.text.trim()) ?? 0,
    'deal': _deal.text.trim(),
    'images': _images,
    'includes': _includes.text.trim(),
    'excludes': _excludes.text.trim(),
    'delivery_minutes': int.tryParse(_minutes.text.trim()) ?? 30,
    'payment_methods': _methods.toList(),
    'active': _active ? 1 : 0,
  };

  Future<void> _save(Json outlet) async {
    final valid = _form.currentState?.validate() ?? false;
    String? problem;
    if (!valid) {
      problem = 'Please complete the highlighted fields.';
    } else if (_images.isEmpty) {
      problem = 'Add at least one product picture.';
    } else if (_category.isEmpty) {
      problem = 'Choose a category.';
    } else if (_methods.isEmpty) {
      problem = 'Choose at least one payment method for this product.';
    }
    if (problem != null) return setState(() => _error = problem);
    FocusScope.of(context).unfocus();
    final app = context.read<AppState>();
    final nav = Navigator.of(context);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final id = widget.product?.id;
      if (id == null) {
        await app.api.post('/manage/products', _body(outlet));
      } else {
        await app.api.put('/manage/products/$id', _body(outlet));
      }
      app.notice('Product saved.');
      nav.pop(true);
    } catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = errorText(e);
        });
      }
    }
  }

  Future<void> _archive() async {
    final app = context.read<AppState>();
    final nav = Navigator.of(context);
    final yes = await showConfirm(
      context,
      title: 'Archive this product?',
      message: 'Customers will no longer see it. Past orders keep it, and you can list it again later.',
      confirm: 'Archive',
      danger: true,
    );
    if (!yes) return;
    try {
      await app.api.delete('/manage/products/${widget.product!.id}');
      app.notice('Product archived.');
      nav.pop(true);
    } catch (e) {
      app.notice(errorText(e));
    }
  }

  String? _number(String? v, {required int min, required int max, required String what}) {
    final n = int.tryParse((v ?? '').trim());
    return n == null || n < min || n > max ? '$what: $min–$max' : null;
  }

  Widget _section(String title, List<Widget> children) => Padding(
    padding: const EdgeInsets.only(bottom: 14),
    child: AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [Text(title, style: context.t.titleMedium), const SizedBox(height: 14), ...children],
      ),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final app = context.watch<AppState>();
    final digits = [FilteringTextInputFormatter.digitsOnly];
    final categories = {...app.site.categories.map((x) => x.name), if (_category.isNotEmpty) _category}.toList();
    return ListenableBuilder(
      listenable: _setup,
      builder: (context, _) {
        final setup = _setup.data;
        return Scaffold(
          appBar: AppBar(
            title: Text(widget.product == null ? 'Add product' : 'Edit product'),
            actions: [
              if (widget.product != null && widget.product!.active)
                IconButton(tooltip: 'Archive', icon: const Icon(Icons.archive_outlined), onPressed: _archive),
              const SizedBox(width: 4),
            ],
          ),
          body: setup == null
              ? (_setup.error != null ? ErrorState(_setup.error!, onRetry: _setup.refresh) : const LoadingView())
              : Form(
                  key: _form,
                  child: ListView(
                    keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                    padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                    children: [
                      if (_error != null) ...[Notice(_error!, tone: Tone.red), const SizedBox(height: 12)],
                      _section('Pictures', [
                        SizedBox(
                          height: 92,
                          child: ListView(
                            scrollDirection: Axis.horizontal,
                            children: [
                              for (final (i, url) in _images.indexed)
                                Padding(
                                  padding: const EdgeInsets.only(right: 10),
                                  child: Stack(
                                    children: [
                                      NetImage(url, width: 92, height: 92, radius: 14),
                                      Positioned(
                                        right: 4,
                                        top: 4,
                                        child: Material(
                                          color: Colors.black54,
                                          shape: const CircleBorder(),
                                          child: InkWell(
                                            customBorder: const CircleBorder(),
                                            onTap: () => setState(() => _images.removeAt(i)),
                                            child: const Padding(
                                              padding: EdgeInsets.all(4),
                                              child: Icon(Icons.close_rounded, color: Colors.white, size: 16),
                                            ),
                                          ),
                                        ),
                                      ),
                                      if (i == 0)
                                        const Positioned(left: 6, bottom: 6, child: Pill('Cover', tone: Tone.brand, dense: true)),
                                    ],
                                  ),
                                ),
                              if (_images.length < 6)
                                Material(
                                  color: c.soft,
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(14),
                                    side: BorderSide(color: c.lineStrong),
                                  ),
                                  clipBehavior: Clip.antiAlias,
                                  child: InkWell(
                                    onTap: _uploading ? null : _addImage,
                                    child: SizedBox(
                                      width: 92,
                                      height: 92,
                                      child: _uploading
                                          ? const Center(child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.4)))
                                          : Column(
                                              mainAxisAlignment: MainAxisAlignment.center,
                                              children: [
                                                Icon(Icons.add_a_photo_outlined, color: c.brand),
                                                const SizedBox(height: 4),
                                                Text('Add', style: context.t.labelMedium),
                                              ],
                                            ),
                                    ),
                                  ),
                                ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text('Up to 6 pictures, 4 MB each. The first one is the cover.', style: context.t.bodySmall),
                      ]),
                      _section('Details', [
                        TextFormField(
                          controller: _name,
                          maxLength: 150,
                          textCapitalization: TextCapitalization.words,
                          decoration: const InputDecoration(labelText: 'Product name', counterText: ''),
                          validator: (v) => (v ?? '').trim().isEmpty ? 'Enter the product name.' : null,
                        ),
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: _description,
                          maxLength: 2000,
                          minLines: 3,
                          maxLines: 6,
                          textCapitalization: TextCapitalization.sentences,
                          decoration: const InputDecoration(labelText: 'Description', alignLabelWithHint: true, counterText: ''),
                          validator: (v) => (v ?? '').trim().isEmpty ? 'Describe the product.' : null,
                        ),
                        const SizedBox(height: 12),
                        Text('Category', style: context.t.labelMedium),
                        const SizedBox(height: 8),
                        ChoiceChips<String>(
                          padding: EdgeInsets.zero,
                          options: {for (final x in categories) x: x},
                          value: _category,
                          onChanged: (v) => setState(() => _category = v),
                        ),
                        const SizedBox(height: 14),
                        Row(
                          children: [
                            Expanded(
                              child: TextFormField(
                                controller: _unit,
                                maxLength: 100,
                                decoration: const InputDecoration(labelText: 'Unit', hintText: '1 kg, 1 meal…', counterText: ''),
                                validator: (v) => (v ?? '').trim().isEmpty ? 'Enter the unit.' : null,
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: TextFormField(
                                controller: _sku,
                                maxLength: 40,
                                decoration: const InputDecoration(labelText: 'SKU (optional)', counterText: ''),
                                validator: (v) => RegExp(r'^[\w./-]*$').hasMatch((v ?? '').trim()) ? null : 'Letters, numbers, - . /',
                              ),
                            ),
                          ],
                        ),
                      ]),
                      _section('Price & stock', [
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              child: TextFormField(
                                controller: _price,
                                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                                inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[\d.]'))],
                                decoration: const InputDecoration(labelText: 'Price (Rs)'),
                                validator: (v) {
                                  final n = double.tryParse((v ?? '').trim());
                                  return n == null || n < 1 || n > 1000000 ? 'Rs 1 – 1,000,000' : null;
                                },
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: TextFormField(
                                controller: _discount,
                                keyboardType: TextInputType.number,
                                inputFormatters: digits,
                                decoration: const InputDecoration(labelText: 'Discount %'),
                                validator: (v) => _number(v, min: 0, max: 90, what: 'Discount'),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              child: TextFormField(
                                controller: _stock,
                                keyboardType: TextInputType.number,
                                inputFormatters: digits,
                                decoration: const InputDecoration(labelText: 'Stock'),
                                validator: (v) => _number(v, min: 0, max: 100000, what: 'Stock'),
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: TextFormField(
                                controller: _max,
                                keyboardType: TextInputType.number,
                                inputFormatters: digits,
                                decoration: const InputDecoration(labelText: 'Max per order'),
                                validator: (v) => _number(v, min: 1, max: 99, what: 'Limit'),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: _minutes,
                          keyboardType: TextInputType.number,
                          inputFormatters: digits,
                          decoration: const InputDecoration(labelText: 'Delivery time (minutes)'),
                          validator: (v) => _number(v, min: 10, max: 240, what: 'Minutes'),
                        ),
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: _deal,
                          maxLength: 150,
                          decoration: const InputDecoration(labelText: 'Deal label (optional)', hintText: 'Lunch favourite', counterText: ''),
                        ),
                      ]),
                      _section('What the customer gets', [
                        TextFormField(
                          controller: _includes,
                          maxLength: 1000,
                          minLines: 1,
                          maxLines: 3,
                          decoration: const InputDecoration(labelText: 'Included (optional)', hintText: 'Burger, fries and drink', counterText: ''),
                        ),
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: _excludes,
                          maxLength: 1000,
                          minLines: 1,
                          maxLines: 3,
                          decoration: const InputDecoration(labelText: 'Not included (optional)', hintText: 'Extra toppings', counterText: ''),
                        ),
                      ]),
                      _section('Payment methods', [
                        if (setup.methods.isEmpty) const Text('Dellvit has not set up any payment method yet.'),
                        for (final m in setup.methods)
                          CheckboxListTile(
                            dense: true,
                            contentPadding: EdgeInsets.zero,
                            controlAffinity: ListTileControlAffinity.leading,
                            activeColor: c.brand,
                            value: _methods.contains(asString(m['id'])),
                            title: Text(asString(m['name']), style: context.t.titleSmall),
                            subtitle: Text(
                              '${paymentTypeLabels[asString(m['type'])] ?? 'Payment'}${asBool(m['active']) ? '' : ' · switched off by Dellvit'}',
                              style: context.t.bodySmall,
                            ),
                            onChanged: (v) => setState(() {
                              if (v ?? false) {
                                _methods.add(asString(m['id']));
                              } else {
                                _methods.remove(asString(m['id']));
                              }
                            }),
                          ),
                      ]),
                      AppCard(
                        padding: EdgeInsets.zero,
                        child: SwitchListTile(
                          contentPadding: const EdgeInsets.fromLTRB(16, 4, 10, 4),
                          title: const Text('Listed for customers'),
                          subtitle: Text(_active ? 'Customers can see and order it' : 'Archived: hidden from customers'),
                          value: _active,
                          onChanged: (v) => setState(() => _active = v),
                        ),
                      ),
                    ],
                  ),
                ),
          bottomNavigationBar: setup == null
              ? null
              : BottomBar(
                  child: AppButton(
                    widget.product == null ? 'Add product' : 'Save changes',
                    busy: _busy,
                    onPressed: _uploading ? null : () => _save(setup.outlet),
                  ),
                ),
        );
      },
    );
  }
}
