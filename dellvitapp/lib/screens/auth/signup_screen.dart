import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/theme.dart';
import '../../models/models.dart';
import '../../state/app_state.dart';
import '../../widgets/common.dart';
import 'login_screen.dart';
import 'verify_email_screen.dart';

final _phone = RegExp(r'^\+?[\d ()-]{7,20}$');
final _email = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$');

/// Lets the person pick one of the delivery areas, in a sheet.
Future<Area?> pickArea(BuildContext context, {String? selected}) {
  final areas = context.read<AppState>().areas;
  return showModalBottomSheet<Area>(
    context: context,
    builder: (context) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
            child: Text('Your delivery area', style: context.t.headlineSmall),
          ),
          Flexible(
            child: ListView(
              shrinkWrap: true,
              children: [
                for (final a in areas)
                  ListTile(
                    leading: const Icon(Icons.location_on_outlined),
                    title: Text(a.name),
                    trailing: a.id == selected ? Icon(Icons.check_rounded, color: context.c.brand) : null,
                    onTap: () => Navigator.pop(context, a),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 8),
        ],
      ),
    ),
  );
}

/// A form field that opens the area sheet instead of a keyboard.
class AreaField extends StatelessWidget {
  const AreaField({super.key, required this.area, required this.onChanged, this.error, this.label = 'Delivery area'});
  final Area? area;
  final ValueChanged<Area> onChanged;
  final String? error;
  final String label;

  @override
  Widget build(BuildContext context) => InkWell(
    borderRadius: BorderRadius.circular(14),
    onTap: () async {
      FocusScope.of(context).unfocus();
      final picked = await pickArea(context, selected: area?.id);
      if (picked != null) onChanged(picked);
    },
    child: InputDecorator(
      isEmpty: area == null,
      decoration: InputDecoration(
        labelText: label,
        errorText: error,
        prefixIcon: const Icon(Icons.location_on_outlined),
        suffixIcon: const Icon(Icons.keyboard_arrow_down_rounded),
      ),
      child: area == null ? null : Text(area!.name, style: context.t.bodyLarge!.copyWith(color: context.c.ink)),
    ),
  );
}

/// What the new account is for. Riders and outlets verify their email, then send their details
/// and wait for an administrator's approval (PartnerScreen).
const _kinds = <({String key, String title, String hint, IconData icon})>[
  (key: 'customer', title: 'User', hint: 'Order food & more', icon: Icons.shopping_bag_outlined),
  (key: 'rider', title: 'Rider', hint: 'Deliver & earn', icon: Icons.two_wheeler_rounded),
  (key: 'outlet', title: 'Outlet', hint: 'Sell my products', icon: Icons.storefront_outlined),
];

class SignupScreen extends StatefulWidget {
  const SignupScreen({super.key, this.kind = 'customer'});

  /// 'customer', 'rider' or 'outlet': the choice the screen opens with.
  final String kind;

  @override
  State<SignupScreen> createState() => _SignupScreenState();
}

class _SignupScreenState extends State<SignupScreen> {
  final _details = GlobalKey<FormState>();
  final _form = GlobalKey<FormState>();
  int _step = 1;
  final _name = TextEditingController();
  final _emailCtl = TextEditingController();
  final _phoneCtl = TextEditingController();
  final _password = TextEditingController();
  final _address = TextEditingController();
  Area? _area;
  String? _areaError;
  bool _busy = false;
  String? _error;
  late String _kind = widget.kind;

  @override
  void initState() {
    super.initState();
    final area = context.read<AppState>().area;
    _area = area == null || area.isNationwide ? null : area;
  }

  @override
  void dispose() {
    for (final c in [_name, _emailCtl, _phoneCtl, _password, _address]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _verify(String email, int retryIn, {String? message}) async {
    final ok = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => VerifyEmailScreen(email: email, retryIn: retryIn, message: message)),
    );
    if (ok == true && mounted) Navigator.of(context).pop(true);
  }

  Future<void> _submit() async {
    if (_busy) return;
    final valid = _form.currentState?.validate() ?? false;
    setState(() => _areaError = _area == null ? 'Choose your delivery area.' : null);
    if (!valid || _area == null) return;
    FocusScope.of(context).unfocus();
    final app = context.read<AppState>();
    final email = _emailCtl.text.trim().toLowerCase();
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final retryIn = await app.register({
        'name': _name.text.trim(),
        'email': email,
        'phone': _phoneCtl.text.trim(),
        'password': _password.text,
        'address': _address.text.trim(),
        'location_id': _area!.id,
        'account_type': _kind,
      });
      if (!mounted) return;
      setState(() => _busy = false);
      await _verify(email, retryIn);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      // The sign-up was started before but never finished: carry on at the code page.
      if (e.code == 'verify_email') {
        await _verify(asString(e.data['email'], email), asInt(e.data['retry_in'], 60), message: e.message);
        return;
      }
      setState(() => _error = e.message);
    } catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = errorText(e);
        });
      }
    }
  }

  /// Checks the first step's fields, then moves on to the address.
  void _continue() {
    if (!(_details.currentState?.validate() ?? false)) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _step = 2;
      _error = null;
    });
  }

  @override
  Widget build(BuildContext context) => PopScope(
    // Back on the address step returns to the first step instead of leaving.
    canPop: _step == 1,
    onPopInvokedWithResult: (popped, _) {
      if (!popped) setState(() => _step = 1);
    },
    child: AuthFrame(
      title: _step == 1
          ? 'Create your account'
          : _kind == 'rider'
          ? 'Where will you deliver?'
          : _kind == 'outlet'
          ? 'Where is your outlet?'
          : 'Where do we deliver?',
      subtitle: _step == 1
          ? (_kind == 'customer'
                ? 'It takes a minute. We’ll email you a 6-digit code to confirm it’s you.'
                : 'Confirm your email, then send your details. Our team approves every partner account.')
          : _kind == 'rider'
          ? 'Choose the area you will deliver in and add your home address.'
          : _kind == 'outlet'
          ? 'Choose your outlet’s area and add its address.'
          : 'Choose your area and add the address your orders should come to.',
      step: _step,
      steps: 2,
      footer: AuthSwitch(text: 'Already have an account?', action: 'Log in', onTap: () => Navigator.of(context).pop()),
      children: [
        AnimatedSwitcher(
          duration: const Duration(milliseconds: 320),
          switchInCurve: Curves.easeOutCubic,
          transitionBuilder: (child, a) => FadeTransition(
            opacity: a,
            child: SlideTransition(
              position: Tween(begin: Offset(child.key == const ValueKey(2) ? 0.15 : -0.15, 0), end: Offset.zero).animate(a),
              child: child,
            ),
          ),
          child: _step == 1 ? _detailsForm() : _addressForm(),
        ),
      ],
    ),
  );

  Widget _detailsForm() => Form(
    key: _details,
    child: Column(
      key: const ValueKey(1),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_error != null) ...[Notice(_error!, tone: Tone.red), const SizedBox(height: 14)],
        Text('Sign up as', style: context.t.labelMedium),
        const SizedBox(height: 8),
        Row(
          children: [
            for (final (i, k) in _kinds.indexed) ...[
              if (i > 0) const SizedBox(width: 8),
              Expanded(child: _KindCard(kind: k, selected: _kind == k.key, onTap: () => setState(() => _kind = k.key))),
            ],
          ],
        ),
        const SizedBox(height: 16),
        TextFormField(
          controller: _name,
          maxLength: 100,
          textCapitalization: TextCapitalization.words,
          textInputAction: TextInputAction.next,
          autofillHints: const [AutofillHints.name],
          decoration: InputDecoration(
            labelText: _kind == 'outlet' ? 'Your full name (owner)' : 'Full name',
            counterText: '',
            prefixIcon: const Icon(Icons.person_outline_rounded),
          ),
          validator: (v) => (v ?? '').trim().isEmpty ? 'Enter your name.' : null,
        ),
        const SizedBox(height: 14),
        TextFormField(
          controller: _emailCtl,
          maxLength: 200,
          keyboardType: TextInputType.emailAddress,
          textInputAction: TextInputAction.next,
          autocorrect: false,
          autofillHints: const [AutofillHints.email],
          decoration: const InputDecoration(labelText: 'Email', counterText: '', prefixIcon: Icon(Icons.mail_outline_rounded)),
          validator: (v) => _email.hasMatch((v ?? '').trim()) ? null : 'Enter a valid email address.',
        ),
        const SizedBox(height: 14),
        TextFormField(
          controller: _phoneCtl,
          maxLength: 20,
          keyboardType: TextInputType.phone,
          textInputAction: TextInputAction.next,
          autofillHints: const [AutofillHints.telephoneNumber],
          decoration: const InputDecoration(
            labelText: 'Phone number',
            hintText: '03XX XXXXXXX',
            counterText: '',
            prefixIcon: Icon(Icons.call_outlined),
          ),
          validator: (v) => _phone.hasMatch((v ?? '').trim()) ? null : 'Enter a valid phone number.',
        ),
        const SizedBox(height: 14),
        PasswordField(
          controller: _password,
          helper: 'At least 10 characters',
          validator: (v) => (v ?? '').length < 10 ? 'Use at least 10 characters.' : null,
          onSubmitted: (_) => _continue(),
        ),
        const SizedBox(height: 24),
        AppButton('Continue', icon: Icons.arrow_forward_rounded, onPressed: _continue),
      ],
    ),
  );

  Widget _addressForm() => Form(
    key: _form,
    child: Column(
      key: const ValueKey(2),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_error != null) ...[Notice(_error!, tone: Tone.red), const SizedBox(height: 14)],
        AreaField(
          area: _area,
          error: _areaError,
          label: _kind == 'rider' ? 'Area you will deliver in' : _kind == 'outlet' ? 'Your outlet’s area' : 'Delivery area',
          onChanged: (a) => setState(() {
            _area = a;
            _areaError = null;
          }),
        ),
        const SizedBox(height: 14),
        TextFormField(
          controller: _address,
          maxLength: 500,
          minLines: 3,
          maxLines: 4,
          textCapitalization: TextCapitalization.sentences,
          autofillHints: const [AutofillHints.fullStreetAddress],
          decoration: InputDecoration(
            labelText: _kind == 'rider' ? 'Home address' : _kind == 'outlet' ? 'Outlet address' : 'Delivery address',
            hintText: _kind == 'outlet' ? 'Shop number, street and nearby landmark' : 'House, street and nearby landmark',
            counterText: '',
            alignLabelWithHint: true,
          ),
          validator: (v) => (v ?? '').trim().isEmpty ? 'Enter the address.' : null,
        ),
        const SizedBox(height: 24),
        AppButton('Create account', busy: _busy, icon: Icons.check_rounded, onPressed: _submit),
        const SizedBox(height: 8),
        Center(
          child: TextButton.icon(
            onPressed: _busy ? null : () => setState(() => _step = 1),
            icon: const Icon(Icons.arrow_back_rounded, size: 18),
            label: const Text('Back to your details'),
          ),
        ),
      ],
    ),
  );
}

/// One of the three sign-up choices: user, rider or outlet.
class _KindCard extends StatelessWidget {
  const _KindCard({required this.kind, required this.selected, required this.onTap});
  final ({String key, String title, String hint, IconData icon}) kind;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return Material(
      color: selected ? c.brand50 : c.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: selected ? c.brand : c.lineStrong, width: selected ? 1.6 : 1.1),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 12),
          child: Column(
            children: [
              Icon(kind.icon, color: selected ? c.brand : c.muted, size: 24),
              const SizedBox(height: 6),
              Text(kind.title, style: context.t.titleSmall, maxLines: 1, overflow: TextOverflow.ellipsis),
              const SizedBox(height: 2),
              Text(
                kind.hint,
                style: context.t.bodySmall!.copyWith(fontSize: 11),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
