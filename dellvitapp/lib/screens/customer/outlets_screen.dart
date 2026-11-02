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

/// Every outlet that delivers in the chosen area.
class OutletsScreen extends StatefulWidget {
  const OutletsScreen({super.key});

  @override
  State<OutletsScreen> createState() => _OutletsScreenState();
}

class _OutletsScreenState extends State<OutletsScreen> {
  Resource<List<Outlet>>? _outlets;
  String? _areaId;
  String _search = '';
  String _category = 'All';
  bool _openOnly = false;

  void _sync(AppState app) {
    final id = app.area?.id;
    if (id == _areaId && (_outlets != null || id == null)) return;
    _areaId = id;
    _outlets?.dispose();
    _outlets = id == null
        ? null
        : (Resource<List<Outlet>>(
            () async => asList(await app.api.get('/outlets', query: {'location': id})).map(Outlet.fromJson).toList(),
          )..start());
  }

  @override
  void dispose() {
    _outlets?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final app = context.watch<AppState>();
    _sync(app);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Outlets near you'),
        actions: [
          TextButton.icon(
            onPressed: () => showAreaPicker(context),
            icon: const Icon(Icons.location_on_outlined, size: 17),
            label: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 120),
              child: Text(app.area?.name ?? 'Select area', maxLines: 1, overflow: TextOverflow.ellipsis),
            ),
          ),
          const SizedBox(width: 6),
        ],
      ),
      body: _outlets == null
          ? const SingleChildScrollView(child: ChooseArea())
          : RefreshIndicator(
              color: c.brand,
              onRefresh: () => _outlets!.refresh(silent: true),
              child: ResourceView<List<Outlet>>(
                resource: _outlets!,
                builder: (context, all) {
                  final categories = ['All', ...{for (final o in all) o.category}.where((x) => x.isNotEmpty)];
                  final q = _search.trim().toLowerCase();
                  final items = all
                      .where(
                        (o) =>
                            (_category == 'All' || o.category == _category) &&
                            (!_openOnly || o.open) &&
                            (q.isEmpty || '${o.name} ${o.category} ${o.address}'.toLowerCase().contains(q)),
                      )
                      .toList();
                  return ListView(
                    keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                    padding: const EdgeInsets.only(bottom: 24),
                    children: [
                      const PromoSlot('outlets', padding: EdgeInsets.fromLTRB(16, 4, 16, 8)),
                      Padding(
                        padding: const EdgeInsets.fromLTRB(16, 4, 16, 10),
                        child: TextField(
                          decoration: const InputDecoration(hintText: 'Search outlets', prefixIcon: Icon(Icons.search_rounded)),
                          onChanged: (v) => setState(() => _search = v),
                        ),
                      ),
                      ChoiceChips<String>(
                        leading: FilterChip(
                          label: const Text('Open now'),
                          selected: _openOnly,
                          selectedColor: c.brand50,
                          onSelected: (v) => setState(() => _openOnly = v),
                        ),
                        options: {for (final x in categories) x: x},
                        value: _category,
                        onChanged: (v) => setState(() => _category = v),
                      ),
                      const SizedBox(height: 8),
                      if (items.isEmpty)
                        const EmptyState(
                          icon: Icons.storefront_outlined,
                          title: 'No outlets found',
                          message: 'Try another search or delivery area.',
                        )
                      else
                        for (final o in items)
                          Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 10), child: OutletTile(o, key: ValueKey(o.id))),
                    ],
                  );
                },
              ),
            ),
    );
  }
}
