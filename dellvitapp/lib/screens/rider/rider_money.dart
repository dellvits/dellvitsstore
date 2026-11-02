import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/resource.dart';
import '../../core/theme.dart';
import '../../models/models.dart';
import '../../state/app_state.dart';
import '../../widgets/common.dart';

const _depositMethods = {
  'cash_handover': 'Cash handover',
  'bank': 'Bank transfer',
  'wallet': 'Mobile wallet',
  'raast': 'Raast',
};
const _payoutMethods = {'cash': 'Cash', 'bank': 'Bank transfer', 'wallet': 'Mobile wallet', 'raast': 'Raast'};

/// Rupees typed by a person, as paisa. Null when it is not a positive amount.
int? _paisa(String text) {
  final value = double.tryParse(text.replaceAll(',', '').trim());
  if (value == null || value <= 0) return null;
  return (value * 100).round();
}

String _rupees(int paisa) => (paisa / 100).toStringAsFixed(paisa % 100 == 0 ? 0 : 2);

String commissionText(Json s) {
  final value = asDouble(s['commission_value']);
  if (asString(s['commission_type']) == 'fixed') return '${money(value)} per delivery';
  final base = switch (asString(s['commission_base'])) {
    'subtotal' => 'the items subtotal',
    'total' => 'the order total',
    _ => 'the delivery fee',
  };
  return '${value % 1 == 0 ? value.toStringAsFixed(0) : value}% of $base';
}

/// The big figure at the top of a money page.
class _Balance extends StatelessWidget {
  const _Balance({required this.title, required this.amount, required this.lines, this.action});
  final String title;
  final int amount;
  final List<(String, String)> lines;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(gradient: c.gradient, borderRadius: BorderRadius.circular(22)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: TextStyle(color: Colors.white.withValues(alpha: 0.9), fontSize: 13, fontWeight: FontWeight.w700)),
          const SizedBox(height: 4),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(
              money(amount),
              style: const TextStyle(color: Colors.white, fontSize: 34, fontWeight: FontWeight.w800, letterSpacing: -1, height: 1.15),
            ),
          ),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.16), borderRadius: BorderRadius.circular(14)),
            child: Column(
              children: [
                for (final l in lines)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(l.$1, style: TextStyle(color: Colors.white.withValues(alpha: 0.92), fontSize: 13, fontWeight: FontWeight.w500)),
                        ),
                        Text(l.$2, style: const TextStyle(color: Colors.white, fontSize: 13.5, fontWeight: FontWeight.w800)),
                      ],
                    ),
                  ),
              ],
            ),
          ),
          if (action != null) ...[const SizedBox(height: 14), action!],
        ],
      ),
    );
  }
}

class _WhiteButton extends StatelessWidget {
  const _WhiteButton(this.text, {required this.icon, required this.onPressed});
  final String text;
  final IconData icon;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) => FilledButton.icon(
    onPressed: onPressed,
    icon: Icon(icon, size: 19),
    label: Text(text),
    style: FilledButton.styleFrom(
      backgroundColor: Colors.white,
      foregroundColor: context.c.brandDark,
      disabledBackgroundColor: Colors.white38,
      disabledForegroundColor: Colors.white,
      minimumSize: const Size(double.infinity, 48),
    ),
  );
}

/// A line in a money history: what it was, when, how much and its state.
class _Entry extends StatelessWidget {
  const _Entry({required this.title, required this.subtitle, required this.amount, this.status, this.note, this.onWithdraw});
  final String title, subtitle;
  final int amount;
  final String? status, note;
  final VoidCallback? onWithdraw;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: context.t.titleSmall, maxLines: 1, overflow: TextOverflow.ellipsis),
                  const SizedBox(height: 2),
                  Text(subtitle, style: context.t.bodySmall, maxLines: 2, overflow: TextOverflow.ellipsis),
                ],
              ),
            ),
            const SizedBox(width: 10),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(money(amount), style: context.t.titleSmall!.copyWith(fontWeight: FontWeight.w800)),
                if (status != null) ...[const SizedBox(height: 4), StatusBadge(status!, dense: true)],
              ],
            ),
          ],
        ),
        if (note != null && note!.isNotEmpty) ...[
          const SizedBox(height: 6),
          Text(note!, style: context.t.bodySmall!.copyWith(fontStyle: FontStyle.italic)),
        ],
        if (onWithdraw != null)
          Align(
            alignment: Alignment.centerRight,
            child: TextButton(
              onPressed: onWithdraw,
              style: TextButton.styleFrom(minimumSize: const Size(0, 32), tapTargetSize: MaterialTapTargetSize.shrinkWrap),
              child: const Text('Withdraw'),
            ),
          ),
      ],
    ),
  );
}

class _History extends StatelessWidget {
  const _History({required this.title, required this.empty, required this.children});
  final String title, empty;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(6, 20, 6, 8),
          child: Text(title.toUpperCase(), style: context.t.labelSmall!.copyWith(letterSpacing: 0.9)),
        ),
        AppCard(
          padding: EdgeInsets.zero,
          child: children.isEmpty
              ? Padding(
                  padding: const EdgeInsets.all(18),
                  child: SizedBox(width: double.infinity, child: Text(empty, style: context.t.bodySmall)),
                )
              : Column(
                  children: [
                    for (final (i, child) in children.indexed) ...[if (i > 0) Divider(color: c.line), child],
                  ],
                ),
        ),
      ],
    );
  }
}

/// The form both money pages use: an amount, a method, an account or reference, and a note.
class _MoneyForm extends StatefulWidget {
  const _MoneyForm({
    required this.title,
    required this.hint,
    required this.max,
    required this.methods,
    required this.freeMethod,
    required this.detailLabel,
    required this.confirm,
    required this.onSubmit,
  });

  final String title, hint, detailLabel, confirm;
  final int max;
  final Map<String, String> methods;

  /// The method that needs no account or reference (cash).
  final String freeMethod;
  final Future<void> Function(int amount, String method, String detail, String note) onSubmit;

  @override
  State<_MoneyForm> createState() => _MoneyFormState();
}

class _MoneyFormState extends State<_MoneyForm> {
  late final _amount = TextEditingController(text: _rupees(widget.max));
  final _detail = TextEditingController();
  final _note = TextEditingController();
  late String _method = widget.methods.keys.first;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _amount.dispose();
    _detail.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final amount = _paisa(_amount.text);
    final needsDetail = _method != widget.freeMethod;
    if (amount == null) return setState(() => _error = 'Enter an amount.');
    if (amount > widget.max) return setState(() => _error = 'The most you can enter is ${money(widget.max)}.');
    if (needsDetail && _detail.text.trim().length < 4) return setState(() => _error = 'Enter the ${widget.detailLabel.toLowerCase()}.');
    final nav = Navigator.of(context);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.onSubmit(amount, _method, _detail.text.trim(), _note.text.trim());
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

  @override
  Widget build(BuildContext context) => SafeArea(
    child: SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(widget.title, style: context.t.headlineSmall),
          const SizedBox(height: 4),
          Text(widget.hint, style: context.t.bodyMedium!.copyWith(color: context.c.muted)),
          const SizedBox(height: 16),
          if (_error != null) ...[Notice(_error!, tone: Tone.red), const SizedBox(height: 12)],
          TextField(
            controller: _amount,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[\d.]'))],
            decoration: InputDecoration(labelText: 'Amount (Rs)', helperText: 'Up to ${money(widget.max)}', prefixText: 'Rs  '),
          ),
          const SizedBox(height: 14),
          ChoiceChips<String>(
            padding: EdgeInsets.zero,
            options: widget.methods,
            value: _method,
            onChanged: (v) => setState(() => _method = v),
          ),
          const SizedBox(height: 14),
          if (_method != widget.freeMethod) ...[
            TextField(
              controller: _detail,
              maxLength: 80,
              decoration: InputDecoration(labelText: widget.detailLabel, counterText: ''),
            ),
            const SizedBox(height: 14),
          ],
          TextField(
            controller: _note,
            maxLength: 300,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(labelText: 'Note (optional)', counterText: ''),
          ),
          const SizedBox(height: 18),
          AppButton(widget.confirm, busy: _busy, onPressed: _submit),
        ],
      ),
    ),
  );
}

/// Cash on delivery a rider is holding, and what they have handed to Dellvit.
class RiderCashScreen extends StatefulWidget {
  const RiderCashScreen({super.key});

  @override
  State<RiderCashScreen> createState() => _RiderCashScreenState();
}

class _RiderCashScreenState extends State<RiderCashScreen> {
  late final Resource<Json> _cash;
  StatRange _range = StatRange.week;

  @override
  void initState() {
    super.initState();
    final api = context.read<AppState>().api;
    _cash = Resource<Json>(() async => asMap(await api.get('/rider/cash', query: _range.query)), every: const Duration(seconds: 30))
      ..start();
  }

  @override
  void dispose() {
    _cash.dispose();
    super.dispose();
  }

  Future<void> _submit(int inHand) async {
    final app = context.read<AppState>();
    final done = await showSheet<bool>(
      context,
      builder: (_) => _MoneyForm(
        title: 'Submit COD cash',
        hint: 'Tell Dellvit how much you are handing over or transferring. It is verified before your cash in hand goes down.',
        max: inHand,
        methods: _depositMethods,
        freeMethod: 'cash_handover',
        detailLabel: 'Transaction ID',
        confirm: 'Submit for verification',
        onSubmit: (amount, method, detail, note) =>
            app.api.post('/rider/cash/deposits', {'amount': amount, 'method': method, 'reference': detail, 'note': note}),
      ),
    );
    if (done == true) {
      app.notice('Cash submitted. Dellvit will verify it.');
      _cash.refresh(silent: true);
    }
  }

  Future<void> _withdraw(Json d) async {
    final app = context.read<AppState>();
    final yes = await showConfirm(
      context,
      title: 'Withdraw this submission?',
      message: '${money(asInt(d['amount']))} will count as cash in hand again.',
      confirm: 'Withdraw',
      danger: true,
    );
    if (!yes) return;
    try {
      await app.api.delete('/rider/cash/deposits/${d['id']}');
      app.notice('Submission withdrawn.');
      _cash.refresh(silent: true);
    } catch (e) {
      app.notice(errorText(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return Scaffold(
      appBar: AppBar(title: const Text('COD cash'), titleSpacing: 20),
      body: RefreshIndicator(
        color: c.brand,
        onRefresh: () => _cash.refresh(silent: true),
        child: ResourceView<Json>(
          resource: _cash,
          builder: (context, d) {
            final inHand = asInt(d['in_hand']);
            final deposits = asList(d['deposits']);
            final collections = asList(d['collections']);
            return ListView(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 28),
              children: [
                _Balance(
                  title: 'Cash in hand',
                  amount: inHand,
                  lines: [
                    ('Collected from customers', money(asInt(d['collected']))),
                    ('Verified by Dellvit', money(asInt(d['approved']))),
                    ('Awaiting review', money(asInt(d['pending']))),
                  ],
                  action: _WhiteButton('Submit cash to Dellvit', icon: Icons.upload_rounded, onPressed: inHand > 0 ? () => _submit(inHand) : null),
                ),
                const SizedBox(height: 16),
                ChoiceChips<StatRange>(
                  padding: EdgeInsets.zero,
                  options: {for (final r in StatRange.values) r: r.title},
                  value: _range,
                  onChanged: (v) {
                    setState(() => _range = v);
                    _cash.refresh(silent: true);
                  },
                ),
                const SizedBox(height: 12),
                StatGrid([
                  StatTile(icon: Icons.south_west_rounded, name: 'Collected', value: money(asInt(d['collected_range'])), tone: Tone.blue),
                  StatTile(icon: Icons.verified_outlined, name: 'Verified', value: money(asInt(d['submitted_range'])), tone: Tone.green),
                ]),
                _History(
                  title: 'Your submissions',
                  empty: 'Nothing submitted yet.',
                  children: [
                    for (final x in deposits)
                      _Entry(
                        title: _depositMethods[asString(x['method'])] ?? label(asString(x['method'])),
                        subtitle: [dateTime(asString(x['created_at'])), if (asString(x['reference']).isNotEmpty) 'TID ${x['reference']}'].join(' · '),
                        amount: asInt(x['amount']),
                        status: asString(x['status']),
                        note: asString(x['review_note']).isNotEmpty ? 'Dellvit: ${x['review_note']}' : asString(x['note']),
                        onWithdraw: asString(x['status']) == 'pending' ? () => _withdraw(x) : null,
                      ),
                  ],
                ),
                _History(
                  title: 'Cash collected',
                  empty: 'Cash you collect on delivery appears here.',
                  children: [
                    for (final x in collections.take(50))
                      _Entry(
                        title: asString(x['reference']),
                        subtitle: '${asString(x['customer'])} · ${dateTime(asString(x['created_at']))}',
                        amount: asInt(x['amount']),
                      ),
                  ],
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

/// Commission earned, payouts received and payout requests.
class RiderEarningsScreen extends StatefulWidget {
  const RiderEarningsScreen({super.key});

  @override
  State<RiderEarningsScreen> createState() => _RiderEarningsScreenState();
}

class _RiderEarningsScreenState extends State<RiderEarningsScreen> {
  late final Resource<Json> _earnings;
  StatRange _range = StatRange.week;

  @override
  void initState() {
    super.initState();
    final api = context.read<AppState>().api;
    _earnings = Resource<Json>(
      () async => asMap(await api.get('/rider/earnings', query: _range.query)),
      every: const Duration(seconds: 30),
    )..start();
  }

  @override
  void dispose() {
    _earnings.dispose();
    super.dispose();
  }

  Future<void> _request(int available) async {
    final app = context.read<AppState>();
    final done = await showSheet<bool>(
      context,
      builder: (_) => _MoneyForm(
        title: 'Request a payout',
        hint: 'Dellvit reviews the request and pays it out to you.',
        max: available,
        methods: _payoutMethods,
        freeMethod: 'cash',
        detailLabel: 'Account or wallet number',
        confirm: 'Send request',
        onSubmit: (amount, method, detail, note) =>
            app.api.post('/rider/payout-requests', {'amount': amount, 'method': method, 'account': detail, 'note': note}),
      ),
    );
    if (done == true) {
      app.notice('Payout requested.');
      _earnings.refresh(silent: true);
    }
  }

  Future<void> _withdraw(Json r) async {
    final app = context.read<AppState>();
    final yes = await showConfirm(context, title: 'Withdraw this request?', message: 'You can send a new one at any time.', confirm: 'Withdraw', danger: true);
    if (!yes) return;
    try {
      await app.api.delete('/rider/payout-requests/${r['id']}');
      app.notice('Request withdrawn.');
      _earnings.refresh(silent: true);
    } catch (e) {
      app.notice(errorText(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return Scaffold(
      appBar: AppBar(title: const Text('Earnings & payouts'), titleSpacing: 20),
      body: RefreshIndicator(
        color: c.brand,
        onRefresh: () => _earnings.refresh(silent: true),
        child: ResourceView<Json>(
          resource: _earnings,
          builder: (context, d) {
            final available = asInt(d['available']);
            final requests = asList(d['requests']);
            final payouts = asList(d['payouts']);
            final earnings = asList(d['earnings']);
            return ListView(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 28),
              children: [
                _Balance(
                  title: 'Available to withdraw',
                  amount: available,
                  lines: [
                    ('Earned in total', money(asInt(d['earned']))),
                    ('Paid out', money(asInt(d['paid']))),
                    ('In pending requests', money(asInt(d['pending_requests']))),
                  ],
                  action: _WhiteButton('Request payout', icon: Icons.north_east_rounded, onPressed: available > 0 ? () => _request(available) : null),
                ),
                const SizedBox(height: 12),
                Notice('Your commission: ${commissionText(asMap(d['settings']))}.', tone: Tone.neutral, icon: Icons.percent_rounded),
                const SizedBox(height: 16),
                ChoiceChips<StatRange>(
                  padding: EdgeInsets.zero,
                  options: {for (final r in StatRange.values) r: r.title},
                  value: _range,
                  onChanged: (v) {
                    setState(() => _range = v);
                    _earnings.refresh(silent: true);
                  },
                ),
                const SizedBox(height: 12),
                StatGrid([
                  StatTile(icon: Icons.savings_outlined, name: 'Earned', value: money(asInt(d['earned_range'])), tone: Tone.green),
                  StatTile(icon: Icons.two_wheeler_rounded, name: 'Deliveries', value: '${asInt(d['deliveries_range'])}', tone: Tone.blue),
                  StatTile(icon: Icons.north_east_rounded, name: 'Paid out', value: money(asInt(d['paid_range'])), tone: Tone.purple),
                  StatTile(icon: Icons.payments_outlined, name: 'COD collected (all time)', value: money(asInt(d['cash_collected'])), tone: Tone.orange),
                ]),
                _History(
                  title: 'Payout requests',
                  empty: 'You have not requested a payout yet.',
                  children: [
                    for (final x in requests)
                      _Entry(
                        title: _payoutMethods[asString(x['method'])] ?? label(asString(x['method'])),
                        subtitle: [dateTime(asString(x['created_at'])), if (asString(x['account']).isNotEmpty) asString(x['account'])].join(' · '),
                        amount: asInt(x['amount']),
                        status: asString(x['status']),
                        note: asString(x['review_note']).isNotEmpty ? 'Dellvit: ${x['review_note']}' : asString(x['note']),
                        onWithdraw: asString(x['status']) == 'pending' ? () => _withdraw(x) : null,
                      ),
                  ],
                ),
                _History(
                  title: 'Payouts received',
                  empty: 'Payouts from Dellvit appear here.',
                  children: [
                    for (final x in payouts)
                      _Entry(
                        title: _payoutMethods[asString(x['method'])] ?? 'Payout',
                        subtitle: [
                          dateTime(asString(x['created_at'])),
                          if (asString(x['reference']).isNotEmpty) 'Ref ${x['reference']}',
                        ].join(' · '),
                        amount: asInt(x['amount']),
                        status: 'paid',
                        note: asString(x['note']),
                      ),
                  ],
                ),
                _History(
                  title: 'Commission history',
                  empty: 'Commission is added when a delivery is verified.',
                  children: [
                    for (final x in earnings.take(50))
                      _Entry(
                        title: asString(x['reference']),
                        subtitle: [
                          dateTime(asString(x['created_at'])),
                          if (asInt(x['cash_collected']) > 0) 'collected ${money(asInt(x['cash_collected']))}',
                        ].join(' · '),
                        amount: asInt(x['amount']),
                      ),
                  ],
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}
