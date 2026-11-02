import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/api.dart';
import '../core/location.dart';
import '../core/resource.dart';
import '../core/theme.dart';
import '../models/models.dart';
import '../state/app_state.dart';
import '../widgets/common.dart';
import 'auth/signup_screen.dart' show AreaField;

const _vehicles = {'motorbike': 'Motorbike', 'bicycle': 'Bicycle', 'car': 'Car', 'rickshaw': 'Rickshaw', 'on_foot': 'On foot'};
const _commissions = {'fixed': 'A fixed amount per delivery', 'percent': 'A percentage of the delivery fee'};
const _payouts = {'cash': 'Cash (collect from the office)', 'bank': 'Bank account', 'wallet': 'Mobile wallet', 'raast': 'Raast ID'};

/// What a rider or outlet that signed up itself sees until an administrator approves it: where
/// the application stands, and the details to send. Once approved the account becomes a rider or
/// outlet and the app opens its workspace by itself.
class PartnerScreen extends StatefulWidget {
  const PartnerScreen({super.key});

  @override
  State<PartnerScreen> createState() => _PartnerScreenState();
}

class _PartnerScreenState extends State<PartnerScreen> {
  late final Resource<Json> _app;
  Timer? _check;

  @override
  void initState() {
    super.initState();
    final app = context.read<AppState>();
    _app = Resource<Json>(() async => asMap(await app.api.get('/partner/application')))..start();
    // An approval changes the account; the app notices on its own and opens the workspace.
    _check = Timer.periodic(const Duration(seconds: 30), (_) => app.refreshSession());
  }

  @override
  void dispose() {
    _check?.cancel();
    _app.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final app = context.read<AppState>();
    return Scaffold(
      appBar: AppBar(
        title: const Text('Your application'),
        automaticallyImplyLeading: false,
        actions: [
          IconButton(
            tooltip: 'Check again',
            icon: const Icon(Icons.refresh_rounded),
            onPressed: () => Future.wait([app.refreshSession(), _app.refresh(silent: true)]),
          ),
          IconButton(
            tooltip: 'Log out',
            icon: const Icon(Icons.logout_rounded),
            onPressed: () async {
              final yes = await showConfirm(context, title: 'Log out?', confirm: 'Log out', cancel: 'Stay', danger: true);
              if (yes) await app.logout();
            },
          ),
        ],
      ),
      body: ListenableBuilder(
        listenable: _app,
        builder: (context, _) {
          final data = _app.data;
          if (data == null) {
            return _app.error != null
                ? ErrorState(_app.error!, onRetry: _app.refresh)
                : const Center(child: CircularProgressIndicator());
          }
          return RefreshIndicator(
            onRefresh: () => Future.wait([app.refreshSession(), _app.refresh(silent: true)]),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
              children: [
                _Status(data),
                const SizedBox(height: 16),
                _Form(
                  key: ValueKey(asString(data['status'])),
                  app: data,
                  onSent: (sent) {
                    final first = asString(data['status']) != 'pending';
                    _app.set(sent);
                    app.notice(first ? 'Thank you! Your details are sent for review.' : 'Your details are updated.');
                  },
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _Status extends StatelessWidget {
  const _Status(this.app);
  final Json app;

  @override
  Widget build(BuildContext context) {
    final rider = asString(app['kind']) == 'rider';
    final title = rider ? 'Become a Dellvit rider' : 'Sell on Dellvit';
    final (Tone tone, IconData icon, String head, String body) = switch (asString(app['status'])) {
      'pending' => (
        Tone.amber,
        Icons.hourglass_top_rounded,
        'Your account is not approved yet',
        'Our team is reviewing your details. You will get a notification and an email as soon as your account is approved. You can still correct your details below.',
      ),
      'rejected' => (
        Tone.red,
        Icons.error_outline_rounded,
        'Please update your application',
        '${asString(app['note'])}\n\nCorrect the details below and send them again.',
      ),
      _ => (
        Tone.blue,
        Icons.assignment_outlined,
        'One more step',
        'Your email is verified. Send the details below; our team checks them and approves your account. Until then your account is not approved yet.',
      ),
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: context.t.headlineSmall),
        const SizedBox(height: 12),
        Notice(body, title: head, tone: tone, icon: icon),
      ],
    );
  }
}

/// The rider's or outlet's details, filled in from what was sent before.
class _Form extends StatefulWidget {
  const _Form({super.key, required this.app, required this.onSent});
  final Json app;
  final ValueChanged<Json> onSent;

  @override
  State<_Form> createState() => _FormState();
}

class _FormState extends State<_Form> {
  final _form = GlobalKey<FormState>();
  late final Map<String, TextEditingController> _text;
  late String _vehicle, _payout, _category, _commission;
  Area? _area;
  double? _lat, _lng;
  bool _busy = false, _locating = false;
  String? _error, _areaError;

  bool get _rider => asString(widget.app['kind']) == 'rider';
  static const _fields = [
    'cnic', 'vehicle_number', 'license_number', 'emergency_name', 'emergency_phone', 'about', //
    'business_name', 'business_phone', 'owner_name', 'owner_cnic', 'address', 'description', 'opens_at', 'closes_at',
    'payout_bank', 'payout_title', 'payout_account',
  ];

  @override
  void initState() {
    super.initState();
    final d = asMap(widget.app['details']);
    _text = {for (final f in _fields) f: TextEditingController(text: asString(d[f]))};
    _vehicle = asString(d['vehicle_type'], 'motorbike');
    _payout = asString(d['payout_method'], 'cash');
    _commission = asString(d['commission_type'], 'fixed');
    _category = asString(d['category']);
    final app = context.read<AppState>();
    _area = app.areaById(asString(d['location_id'], app.user?.locationId ?? ''));
    _lat = d['lat'] == null ? null : asDouble(d['lat']);
    _lng = d['lng'] == null ? null : asDouble(d['lng']);
  }

  @override
  void dispose() {
    for (final c in _text.values) {
      c.dispose();
    }
    super.dispose();
  }

  String _v(String k) => _text[k]!.text.trim();

  Future<void> _submit() async {
    if (_busy) return;
    final valid = _form.currentState?.validate() ?? false;
    if (!_rider) setState(() => _areaError = _area == null ? 'Choose your outlet’s area.' : null);
    if (!valid || (!_rider && _area == null)) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _busy = true;
      _error = null;
    });
    final body = <String, Object?>{
      if (_rider) ...{
        'cnic': _v('cnic'),
        'vehicle_type': _vehicle,
        'vehicle_number': _v('vehicle_number'),
        'license_number': _v('license_number'),
        'emergency_name': _v('emergency_name'),
        'emergency_phone': _v('emergency_phone'),
        'payout_method': _payout,
        'commission_type': _commission,
        'about': _v('about'),
      } else ...{
        'business_name': _v('business_name'),
        'category': _category,
        'business_phone': _v('business_phone'),
        'owner_name': _v('owner_name'),
        'owner_cnic': _v('owner_cnic'),
        'location_id': _area!.id,
        'address': _v('address'),
        'description': _v('description'),
        'opens_at': _v('opens_at'),
        'closes_at': _v('closes_at'),
        'lat': _lat,
        'lng': _lng,
      },
      if (!_rider || _payout != 'cash') ...{
        'payout_bank': _v('payout_bank'),
        'payout_title': _v('payout_title'),
        'payout_account': _v('payout_account'),
      },
    };
    try {
      final sent = asMap(await context.read<AppState>().api.put('/partner/application', body));
      if (mounted) widget.onSent(sent);
    } catch (e) {
      if (mounted) setState(() => _error = errorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _locate() async {
    setState(() => _locating = true);
    try {
      final f = await currentPosition();
      setState(() {
        _lat = f.lat;
        _lng = f.lng;
      });
    } catch (e) {
      if (mounted) context.read<AppState>().notice(errorText(e));
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  Future<void> _pickTime(String key) async {
    final now = _v(key).split(':');
    final picked = await showTimePicker(
      context: context,
      initialTime: now.length == 2
          ? TimeOfDay(hour: int.tryParse(now[0]) ?? 9, minute: int.tryParse(now[1]) ?? 0)
          : TimeOfDay(hour: key == 'opens_at' ? 9 : 22, minute: 0),
    );
    if (picked == null) return;
    setState(
      () => _text[key]!.text = '${picked.hour.toString().padLeft(2, '0')}:${picked.minute.toString().padLeft(2, '0')}',
    );
  }

  Widget _field(
    String key,
    String label, {
    bool required = false,
    String? hint,
    TextInputType? keyboard,
    int lines = 1,
    int max = 100,
    String? Function(String v)? check,
  }) => Padding(
    padding: const EdgeInsets.only(bottom: 14),
    child: TextFormField(
      controller: _text[key],
      maxLength: max,
      minLines: lines,
      maxLines: lines == 1 ? 1 : lines + 1,
      keyboardType: keyboard,
      textCapitalization: keyboard == null ? TextCapitalization.sentences : TextCapitalization.none,
      decoration: InputDecoration(labelText: label, hintText: hint, counterText: '', alignLabelWithHint: lines > 1),
      validator: (v) {
        final t = (v ?? '').trim();
        if (required && t.isEmpty) return 'Enter $label.'.replaceAll(' (if it has one)', '');
        return check?.call(t);
      },
    ),
  );

  String? _cnic(String v) => RegExp(r'^\d{5}-?\d{7}-?\d$').hasMatch(v) ? null : 'Enter the 13-digit CNIC, e.g. 35202-1234567-1.';
  String? _phone(String v) => RegExp(r'^\+?[\d ()-]{7,20}$').hasMatch(v) ? null : 'Enter a valid phone number.';

  Widget _select(String label, String value, Map<String, String> options, ValueChanged<String> onChanged) => Padding(
    padding: const EdgeInsets.only(bottom: 14),
    child: DropdownButtonFormField<String>(
      initialValue: options.containsKey(value) ? value : null,
      isExpanded: true,
      decoration: InputDecoration(labelText: label),
      items: [for (final e in options.entries) DropdownMenuItem(value: e.key, child: Text(e.value, overflow: TextOverflow.ellipsis))],
      onChanged: (v) => setState(() => onChanged(v ?? value)),
      validator: (v) => v == null ? 'Choose $label.'.toLowerCase().replaceFirst('choose', 'Choose') : null,
    ),
  );

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final site = context.watch<AppState>().site;
    final motor = ['motorbike', 'car', 'rickshaw'].contains(_vehicle);
    return Form(
      key: _form,
      child: AppCard(
        padding: const EdgeInsets.fromLTRB(16, 18, 16, 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(_rider ? 'Your rider details' : 'Your outlet details', style: context.t.titleMedium),
            const SizedBox(height: 14),
            if (_rider) ...[
              _field('cnic', 'CNIC number', required: true, hint: '35202-1234567-1', keyboard: TextInputType.number, max: 15, check: _cnic),
              _select('Vehicle', _vehicle, _vehicles, (v) => _vehicle = v),
              _field('vehicle_number', motor ? 'Vehicle number' : 'Vehicle number (if it has one)', required: motor, hint: 'RIM-1234', max: 30),
              _field('license_number', motor ? 'Driving licence number' : 'Driving licence number (optional)', required: motor, max: 40),
              _field('emergency_name', 'Emergency contact name', required: true),
              _field('emergency_phone', 'Emergency contact phone', required: true, hint: '03XX XXXXXXX', keyboard: TextInputType.phone, max: 20, check: _phone),
            ] else ...[
              _field('business_name', 'Outlet name', required: true, hint: 'e.g. Fresh Corner', max: 150),
              _select('Category', _category, {for (final k in site.categories) k.name: k.name}, (v) => _category = v),
              _field('business_phone', 'Outlet phone', required: true, keyboard: TextInputType.phone, max: 20, check: _phone),
              _field('owner_name', 'Owner name', required: true),
              _field('owner_cnic', 'Owner CNIC number', required: true, hint: '35202-1234567-1', keyboard: TextInputType.number, max: 15, check: _cnic),
              Padding(
                padding: const EdgeInsets.only(bottom: 14),
                child: AreaField(
                  area: _area,
                  error: _areaError,
                  label: 'Your outlet’s area',
                  onChanged: (a) => setState(() {
                    _area = a;
                    _areaError = null;
                  }),
                ),
              ),
              _field('address', 'Outlet address', required: true, lines: 2, max: 500),
              OutlinedButton.icon(
                onPressed: _locating ? null : _locate,
                icon: _locating
                    ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                    : Icon(_lat != null ? Icons.check_circle_outline_rounded : Icons.my_location_rounded, color: _lat != null ? c.green : null),
                label: Text(_lat != null ? 'Map location saved' : 'Use my current location (optional)'),
              ),
              const SizedBox(height: 14),
              _field('description', 'About your outlet (optional)', lines: 2, max: 500),
              Row(
                children: [
                  for (final (i, k) in ['opens_at', 'closes_at'].indexed) ...[
                    if (i > 0) const SizedBox(width: 10),
                    Expanded(
                      child: Padding(
                        padding: const EdgeInsets.only(bottom: 14),
                        child: TextFormField(
                          controller: _text[k],
                          readOnly: true,
                          onTap: () => _pickTime(k),
                          decoration: InputDecoration(
                            labelText: k == 'opens_at' ? 'Opens at' : 'Closes at',
                            hintText: 'Optional',
                            suffixIcon: const Icon(Icons.schedule_rounded),
                          ),
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ],
            const SizedBox(height: 4),
            Text('How you are paid', style: context.t.titleSmall),
            const SizedBox(height: 10),
            if (_rider) ...[
              _select('How you would like to earn', _commission, _commissions, (v) => _commission = v),
              Padding(
                padding: const EdgeInsets.only(bottom: 14),
                child: Text('Our team confirms the exact amount when your account is approved.', style: context.t.bodySmall),
              ),
              _select('Payment method', _payout, _payouts, (v) => _payout = v),
            ],
            if (!_rider || _payout != 'cash') ...[
              _field('payout_bank', _rider ? 'Bank or wallet name' : 'Bank or wallet name (optional)', required: _rider, hint: 'e.g. Meezan Bank, JazzCash'),
              _field('payout_title', _rider ? 'Account title' : 'Account title (optional)', required: _rider),
              _field('payout_account', _rider ? 'Account number or IBAN' : 'Account number or IBAN (optional)', required: _rider, max: 40),
            ],
            if (_rider) _field('about', 'Anything else we should know? (optional)', lines: 2, max: 500),
            if (_error != null) ...[Notice(_error!, tone: Tone.red), const SizedBox(height: 12)],
            AppButton(
              asString(widget.app['status']) == 'pending' ? 'Update my details' : 'Send for review',
              icon: Icons.send_rounded,
              busy: _busy,
              onPressed: _submit,
            ),
          ],
        ),
      ),
    );
  }
}
