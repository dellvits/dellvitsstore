import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../models/models.dart';
import '../../state/app_state.dart';
import '../../widgets/common.dart';
import '../auth/signup_screen.dart';

final _phone = RegExp(r'^\+?[\d ()-]{7,20}$');

/// The signed-in account's own details.
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  final _form = GlobalKey<FormState>();
  late final TextEditingController _name, _phoneCtl, _address;
  Area? _area;
  String? _areaError;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final app = context.read<AppState>();
    final u = app.user!;
    _name = TextEditingController(text: u.name);
    _phoneCtl = TextEditingController(text: u.phone);
    _address = TextEditingController(text: u.address);
    _area = app.areaById(u.locationId);
  }

  @override
  void dispose() {
    _name.dispose();
    _phoneCtl.dispose();
    _address.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final app = context.read<AppState>();
    final customer = app.user!.isCustomer;
    final valid = _form.currentState?.validate() ?? false;
    setState(() => _areaError = customer && _area == null ? 'Choose your delivery area.' : null);
    if (!valid || _areaError != null) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await app.updateProfile({
        'name': _name.text.trim(),
        'phone': _phoneCtl.text.trim(),
        'address': _address.text.trim(),
        // Staff accounts may leave the area as it is.
        if (_area != null) 'location_id': _area!.id,
      });
      app.notice('Profile saved.');
      if (mounted) Navigator.of(context).pop();
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
  Widget build(BuildContext context) {
    final c = context.c;
    final user = context.watch<AppState>().user;
    if (user == null) return const Scaffold(body: SizedBox.shrink());
    final customer = user.isCustomer;
    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: Form(
        key: _form,
        child: ListView(
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
          children: [
            AppCard(
              child: Row(
                children: [
                  Avatar(user.name, size: 52),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(customer ? user.email : (user.loginId.isEmpty ? user.email : user.loginId), style: context.t.titleSmall),
                        Text(
                          '${customer ? 'Customer' : label(user.role)} since ${dayText(user.createdAt)}',
                          style: context.t.bodySmall,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            if (_error != null) ...[Notice(_error!, tone: Tone.red), const SizedBox(height: 14)],
            TextFormField(
              controller: _name,
              maxLength: 100,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(labelText: 'Full name', counterText: '', prefixIcon: Icon(Icons.person_outline_rounded)),
              validator: (v) => (v ?? '').trim().isEmpty ? 'Enter your name.' : null,
            ),
            const SizedBox(height: 14),
            TextFormField(
              controller: _phoneCtl,
              maxLength: 20,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(labelText: 'Phone number', counterText: '', prefixIcon: Icon(Icons.call_outlined)),
              validator: (v) {
                final value = (v ?? '').trim();
                if (value.isEmpty && !customer) return null;
                return _phone.hasMatch(value) ? null : 'Enter a valid phone number.';
              },
            ),
            const SizedBox(height: 14),
            if (customer) ...[
              AreaField(area: _area, error: _areaError, onChanged: (a) => setState(() {
                _area = a;
                _areaError = null;
              })),
              const SizedBox(height: 14),
            ],
            TextFormField(
              controller: _address,
              maxLength: 500,
              minLines: 2,
              maxLines: 3,
              textCapitalization: TextCapitalization.sentences,
              decoration: InputDecoration(
                labelText: customer ? 'Delivery address' : 'Address',
                hintText: 'House, street and nearby landmark',
                counterText: '',
                alignLabelWithHint: true,
              ),
              validator: (v) => customer && (v ?? '').trim().isEmpty ? 'Enter your delivery address.' : null,
            ),
            const SizedBox(height: 10),
            Text(
              customer
                  ? 'Your email is how you sign in and cannot be changed here. Contact support if you need a new one.'
                  : 'Your sign-in ID and email are managed by Dellvit. Contact support to change them.',
              style: context.t.bodySmall!.copyWith(color: c.muted),
            ),
          ],
        ),
      ),
      bottomNavigationBar: BottomBar(child: AppButton('Save changes', busy: _busy, onPressed: _save)),
    );
  }
}
