import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/pick_image.dart';
import '../../core/resource.dart';
import '../../core/theme.dart';
import '../../models/models.dart';
import '../../state/app_state.dart';
import '../../widgets/common.dart';
import 'product_screen.dart';

/// Find my product: the customer describes what they want, and Dellvit tells them when a
/// matching product is on the store, now or whenever one is added later.
class FindProductScreen extends StatefulWidget {
  const FindProductScreen({super.key});

  @override
  State<FindProductScreen> createState() => _FindProductScreenState();
}

class _FindProductScreenState extends State<FindProductScreen> {
  late final Resource<List<Json>> _wishes = Resource<List<Json>>(
    () async => asList(await Api.instance.get('/wishes')).map(asMap).toList(),
  )..start();

  @override
  void dispose() {
    _wishes.dispose();
    super.dispose();
  }

  Future<void> _edit([Json? wish]) async {
    final saved = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => _WishForm(wish: wish)));
    if (saved == true) _wishes.refresh(silent: true);
  }

  Future<void> _status(Json w, String status) async {
    final app = context.read<AppState>();
    try {
      await app.api.patch('/wishes/${asString(w['id'])}', {'status': status});
      app.notice(status == 'open' ? 'We are looking again.' : status == 'found' ? 'Marked as found.' : 'Request closed.');
      _wishes.refresh(silent: true);
    } catch (e) {
      app.notice(errorText(e));
    }
  }

  Future<void> _delete(Json w) async {
    final app = context.read<AppState>();
    if (!await showConfirm(
      context,
      title: 'Delete this request?',
      message: 'You will not be told about new matches for “${asString(w['name'])}”.',
      confirm: 'Delete',
      danger: true,
    )) {
      return;
    }
    try {
      await app.api.delete('/wishes/${asString(w['id'])}');
      _wishes.refresh(silent: true);
    } catch (e) {
      app.notice(errorText(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final app = context.watch<AppState>();
    return Scaffold(
      appBar: AppBar(title: const Text('Find my product')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _edit(),
        backgroundColor: c.brand,
        foregroundColor: Colors.white,
        icon: const Icon(Icons.add_rounded),
        label: const Text('New request'),
      ),
      body: RefreshIndicator(
        color: c.brand,
        onRefresh: () => _wishes.refresh(silent: true),
        child: ResourceView<List<Json>>(
          resource: _wishes,
          builder: (context, list) => ListView(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
            children: [
              const Notice(
                'Add pictures, the name and what matters to you: price, colour, quality, quantity and area. We compare it with everything on Dellvit now and with every new product, and notify you the moment it is here.',
                title: 'Can’t find something?',
                icon: Icons.manage_search_rounded,
              ),
              const SizedBox(height: 14),
              if (list.isEmpty)
                EmptyState(
                  icon: Icons.manage_search_rounded,
                  title: 'No requests yet',
                  message: 'Tell us what you are looking for.',
                  action: 'New request',
                  onAction: () => _edit(),
                )
              else
                for (final w in list) ...[
                  _WishCard(
                    wish: w,
                    area: app.areaById(asString(w['location_id']))?.name ?? 'Any area',
                    onEdit: () => _edit(w),
                    onStatus: (s) => _status(w, s),
                    onDelete: () => _delete(w),
                  ),
                  const SizedBox(height: 12),
                ],
            ],
          ),
        ),
      ),
    );
  }
}

class _WishCard extends StatelessWidget {
  const _WishCard({required this.wish, required this.area, required this.onEdit, required this.onStatus, required this.onDelete});
  final Json wish;
  final String area;
  final VoidCallback onEdit, onDelete;
  final ValueChanged<String> onStatus;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final images = asStrings(wish['images']);
    final matches = asList(wish['matches']).map(asMap).toList();
    final status = asString(wish['status']);
    final maxPrice = asInt(wish['max_price']);
    final details = [
      if (maxPrice > 0) 'Up to ${money(maxPrice)}',
      asString(wish['color']),
      asString(wish['quality']),
      if (asInt(wish['quantity'], 1) > 1) '${asInt(wish['quantity'])} pieces',
      area,
    ].where((x) => x.isNotEmpty).join(' · ');
    final (text, tone) = status == 'closed'
        ? ('Closed', Tone.neutral)
        : status == 'found'
        ? ('Found', Tone.green)
        : matches.isNotEmpty
        ? ('${matches.length} match${matches.length == 1 ? '' : 'es'}', Tone.green)
        : ('Looking', Tone.blue);
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              images.isEmpty
                  ? const IconBubble(Icons.manage_search_rounded, size: 52)
                  : NetImage(images.first, width: 56, height: 56, radius: 12),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(asString(wish['name']), style: context.t.titleSmall),
                    if (details.isNotEmpty) Text(details, style: context.t.bodySmall),
                    Text('Asked ${dayText(asString(wish['created_at']))}', style: context.t.bodySmall),
                  ],
                ),
              ),
              Pill(text, tone: tone, dense: true),
            ],
          ),
          if (asString(wish['description']).isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(asString(wish['description'])),
          ],
          const SizedBox(height: 10),
          if (matches.isNotEmpty) ...[
            Text('Your desired products on Dellvit', style: context.t.titleSmall!.copyWith(color: c.successInk)),
            const SizedBox(height: 8),
            for (final m in matches)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: AppCard(
                  padding: const EdgeInsets.all(8),
                  color: c.soft,
                  onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => ProductScreen(id: asString(m['id'])))),
                  child: Row(
                    children: [
                      NetImage(asString(m['image']), width: 46, height: 46, radius: 10),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(asString(m['name']), maxLines: 1, overflow: TextOverflow.ellipsis, style: context.t.titleSmall),
                            Text(asString(m['outlet_name']), style: context.t.bodySmall),
                          ],
                        ),
                      ),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Text(money(asInt(m['effective_price'])), style: context.t.titleSmall),
                          if (!asBool(m['available'], true)) Text('Sold out', style: context.t.bodySmall),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
          ] else if (status == 'open')
            Text('Nothing yet. You will get a notification when it arrives.', style: context.t.bodySmall),
          const SizedBox(height: 6),
          Wrap(
            spacing: 6,
            children: [
              TextButton.icon(onPressed: onEdit, icon: const Icon(Icons.edit_outlined, size: 18), label: const Text('Edit')),
              if (status == 'open' && matches.isNotEmpty)
                TextButton.icon(
                  onPressed: () => onStatus('found'),
                  icon: const Icon(Icons.check_circle_outline, size: 18),
                  label: const Text('I found it'),
                ),
              if (status == 'open')
                TextButton.icon(onPressed: () => onStatus('closed'), icon: const Icon(Icons.close_rounded, size: 18), label: const Text('Stop looking'))
              else
                TextButton.icon(onPressed: () => onStatus('open'), icon: const Icon(Icons.refresh_rounded, size: 18), label: const Text('Look again')),
              TextButton.icon(
                onPressed: onDelete,
                style: TextButton.styleFrom(foregroundColor: c.brand),
                icon: const Icon(Icons.delete_outline_rounded, size: 18),
                label: const Text('Delete'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

const _qualities = ['Any', 'Brand new', 'Like new', 'Used', 'Premium', 'Standard', 'Budget'];

class _WishForm extends StatefulWidget {
  const _WishForm({this.wish});
  final Json? wish;

  @override
  State<_WishForm> createState() => _WishFormState();
}

class _WishFormState extends State<_WishForm> {
  final _form = GlobalKey<FormState>();
  late final _name = TextEditingController(text: asString(widget.wish?['name']));
  late final _description = TextEditingController(text: asString(widget.wish?['description']));
  late final _price = TextEditingController(
    text: asInt(widget.wish?['max_price']) > 0 ? (asInt(widget.wish?['max_price']) ~/ 100).toString() : '',
  );
  late final _color = TextEditingController(text: asString(widget.wish?['color']));
  late final _quantity = TextEditingController(text: asInt(widget.wish?['quantity'], 1).toString());
  late final _notes = TextEditingController(text: asString(widget.wish?['notes']));
  late List<String> _images = asStrings(widget.wish?['images']);
  late String _quality = asString(widget.wish?['quality']).isEmpty ? 'Any' : asString(widget.wish?['quality']);
  String? _area;
  bool _uploading = false, _saving = false;

  @override
  void initState() {
    super.initState();
    final app = context.read<AppState>();
    _area = widget.wish == null ? app.user?.locationId : asString(widget.wish!['location_id']);
    if (_area != null && app.areaById(_area) == null) _area = null;
  }

  @override
  void dispose() {
    for (final c in [_name, _description, _price, _color, _quantity, _notes]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _addPicture() async {
    final app = context.read<AppState>();
    final path = await pickAndCropImage(context, title: 'Crop picture');
    if (path == null || !mounted) return;
    setState(() => _uploading = true);
    try {
      final r = asMap(await app.api.upload('/uploads/images', path));
      setState(() => _images = [..._images, asString(r['url'])]);
    } catch (e) {
      app.notice(errorText(e));
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate() || _saving) return;
    final app = context.read<AppState>();
    final nav = Navigator.of(context);
    setState(() => _saving = true);
    try {
      final body = {
        'name': _name.text.trim(),
        'description': _description.text.trim(),
        'images': _images,
        'max_price': (int.tryParse(_price.text.trim()) ?? 0) * 100,
        'color': _color.text.trim(),
        'quality': _quality == 'Any' ? '' : _quality,
        'quantity': int.tryParse(_quantity.text.trim()) ?? 1,
        'location_id': _area,
        'notes': _notes.text.trim(),
      };
      final id = asString(widget.wish?['id']);
      final r = asMap(id.isEmpty ? await app.api.post('/wishes', body) : await app.api.put('/wishes/$id', body));
      final found = asList(r['matches']).length;
      app.notice(
        found > 0
            ? 'Good news: $found product${found == 1 ? '' : 's'} on Dellvit already match.'
            : 'Saved. We will tell you as soon as a matching product arrives on Dellvit.',
      );
      nav.pop(true);
    } catch (e) {
      app.notice(errorText(e));
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final app = context.watch<AppState>();
    return Scaffold(
      appBar: AppBar(title: Text(widget.wish == null ? 'New request' : 'Edit request')),
      body: Form(
        key: _form,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
          children: [
            Text('Pictures (up to 6)', style: context.t.titleSmall),
            const SizedBox(height: 8),
            SizedBox(
              height: 86,
              child: ListView(
                scrollDirection: Axis.horizontal,
                children: [
                  for (final url in _images)
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: Stack(
                        children: [
                          NetImage(url, width: 86, height: 86, radius: 12),
                          Positioned(
                            right: 2,
                            top: 2,
                            child: InkWell(
                              onTap: () => setState(() => _images = _images.where((x) => x != url).toList()),
                              child: const CircleAvatar(radius: 12, backgroundColor: Colors.black54, child: Icon(Icons.close, size: 14, color: Colors.white)),
                            ),
                          ),
                        ],
                      ),
                    ),
                  if (_images.length < 6)
                    InkWell(
                      onTap: _uploading ? null : _addPicture,
                      borderRadius: BorderRadius.circular(12),
                      child: Container(
                        width: 86,
                        height: 86,
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: c.line),
                          color: c.soft,
                        ),
                        child: _uploading
                            ? const Center(child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2)))
                            : Icon(Icons.add_a_photo_outlined, color: c.brand),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _name,
              maxLength: 150,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(labelText: 'Product name', hintText: 'e.g. Red sneakers size 42', counterText: ''),
              validator: (v) => (v ?? '').trim().length < 2 ? 'Enter the product name.' : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _description,
              maxLength: 2000,
              minLines: 2,
              maxLines: 5,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(labelText: 'Description', hintText: 'Model, size, brand…', counterText: '', alignLabelWithHint: true),
            ),
            const SizedBox(height: 18),
            Text('Key features', style: context.t.titleSmall),
            const SizedBox(height: 8),
            TextFormField(
              controller: _price,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'Most you want to pay (Rs)', hintText: 'Any price'),
            ),
            const SizedBox(height: 12),
            TextFormField(controller: _color, maxLength: 60, decoration: const InputDecoration(labelText: 'Colour', counterText: '')),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _qualities.contains(_quality) ? _quality : 'Any',
              decoration: const InputDecoration(labelText: 'Quality'),
              items: [for (final q in _qualities) DropdownMenuItem(value: q, child: Text(q))],
              onChanged: (v) => setState(() => _quality = v ?? 'Any'),
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _quantity,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'Quantity'),
              validator: (v) => (int.tryParse((v ?? '').trim()) ?? 0) < 1 ? 'Enter at least 1.' : null,
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String?>(
              initialValue: _area,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Location'),
              items: [
                const DropdownMenuItem<String?>(value: null, child: Text('Any area (Nation Wide)')),
                for (final a in app.areas) DropdownMenuItem<String?>(value: a.id, child: Text(a.name, overflow: TextOverflow.ellipsis)),
              ],
              onChanged: (v) => setState(() => _area = v),
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _notes,
              maxLength: 1000,
              minLines: 2,
              maxLines: 4,
              decoration: const InputDecoration(labelText: 'Anything else (optional)', counterText: '', alignLabelWithHint: true),
            ),
          ],
        ),
      ),
      bottomNavigationBar: BottomBar(
        child: AppButton(
          widget.wish == null ? 'Find it for me' : 'Save and search again',
          icon: Icons.manage_search_rounded,
          busy: _saving,
          onPressed: _save,
        ),
      ),
    );
  }
}
