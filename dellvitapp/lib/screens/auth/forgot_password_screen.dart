import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/theme.dart';
import '../../models/models.dart';
import '../../state/app_state.dart';
import '../../widgets/common.dart';
import 'login_screen.dart';

enum _Step { email, code, password }

/// Forgot password, for customers: the email, then the 6-digit code that was emailed, then a new
/// password. The server checks every step. Pops `true` once signed in with the new password.
class ForgotPasswordScreen extends StatefulWidget {
  const ForgotPasswordScreen({super.key, this.email = ''});

  /// What was typed on the login screen, if it looks like an email.
  final String email;

  @override
  State<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends State<ForgotPasswordScreen> {
  final _form = GlobalKey<FormState>();
  late final _email = TextEditingController(text: widget.email);
  final _code = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  _Step _step = _Step.email;
  // Proves the code was right; the server accepts it once, for 15 minutes.
  String _token = '';
  Timer? _timer;
  int _wait = 0;
  bool _busy = false;
  bool _sending = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    // The button below turns on once all six digits are in.
    _code.addListener(() => setState(() {}));
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (_wait > 0 && mounted) setState(() => _wait--);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _email.dispose();
    _code.dispose();
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  String get _address => _email.text.trim().toLowerCase();

  /// Asks for a code. Asking too soon still moves on, because the last code is still valid.
  Future<bool> _sendCode() async {
    final app = context.read<AppState>();
    setState(() => _error = null);
    try {
      final wait = await app.forgotPassword(_address);
      if (!mounted) return false;
      setState(() {
        _wait = wait;
        _step = _Step.code;
      });
      _code.clear();
      return true;
    } on ApiException catch (e) {
      if (!mounted) return false;
      setState(() {
        _error = e.message;
        if (e.data['retry_in'] != null) {
          _wait = asInt(e.data['retry_in'], _wait);
          _step = _Step.code;
        }
      });
    } catch (e) {
      if (mounted) setState(() => _error = errorText(e));
    }
    return false;
  }

  Future<void> _request() async {
    if (_busy || !(_form.currentState?.validate() ?? false)) return;
    FocusScope.of(context).unfocus();
    setState(() => _busy = true);
    await _sendCode();
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _resend() async {
    final app = context.read<AppState>();
    setState(() => _sending = true);
    if (await _sendCode()) app.notice('If this email has a customer account, a new code is on its way.');
    if (mounted) setState(() => _sending = false);
  }

  Future<void> _verify() async {
    if (_busy || _code.text.length != 6) return;
    final app = context.read<AppState>();
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final token = await app.verifyResetCode(_address, _code.text);
      if (!mounted) return;
      setState(() {
        _token = token;
        _step = _Step.password;
        _busy = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = errorText(e);
      });
      _code.clear();
    }
  }

  Future<void> _save() async {
    if (_busy || !(_form.currentState?.validate() ?? false)) return;
    FocusScope.of(context).unfocus();
    final app = context.read<AppState>();
    final nav = Navigator.of(context);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await app.resetPassword(_address, _token, _password.text);
      app.notice('Password changed. Welcome back, ${app.user!.name.split(' ').first}.');
      nav.pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = errorText(e);
      });
    }
  }

  void _startAgain() => setState(() {
    _step = _Step.email;
    _token = '';
    _error = null;
    _code.clear();
    _password.clear();
    _confirm.clear();
  });

  String get _waitText => _wait >= 90 ? '${(_wait / 60).ceil()} min' : '${_wait}s';

  String _mask(String email) {
    final at = email.indexOf('@');
    if (at < 2) return email;
    return '${email.substring(0, 2)}${'•' * (at - 2).clamp(1, 6).toInt()}${email.substring(at)}';
  }

  @override
  Widget build(BuildContext context) {
    final error = _error == null ? const <Widget>[] : [Notice(_error!, tone: Tone.red), const SizedBox(height: 14)];
    return switch (_step) {
      _Step.email => AuthFrame(
        step: 1,
        steps: 3,
        title: 'Forgot password?',
        subtitle: 'Enter the email you use on Dellvit and we will send you a 6-digit code.',
        children: [
          Form(
            key: _form,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                ...error,
                TextFormField(
                  controller: _email,
                  autofocus: widget.email.isEmpty,
                  keyboardType: TextInputType.emailAddress,
                  textInputAction: TextInputAction.done,
                  autocorrect: false,
                  maxLength: 200,
                  autofillHints: const [AutofillHints.email],
                  decoration: const InputDecoration(
                    labelText: 'Email',
                    counterText: '',
                    prefixIcon: Icon(Icons.mail_outline_rounded),
                  ),
                  validator: (v) => RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch((v ?? '').trim()) ? null : 'Enter a valid email.',
                  onFieldSubmitted: (_) => _request(),
                ),
                const SizedBox(height: 22),
                AppButton('Send code', busy: _busy, onPressed: _request),
              ],
            ),
          ),
          const SizedBox(height: 18),
          const Notice('Outlet and rider accounts cannot reset here. Please ask the Dellvit team.'),
        ],
      ),
      _Step.code => AuthFrame(
        step: 2,
        steps: 3,
        title: 'Check your email',
        subtitle: 'If ${_mask(_address)} has a Dellvit account, we sent it a 6-digit code. It works for 10 minutes.',
        children: [
          ...error,
          CodeBoxes(controller: _code, error: _error != null, onCompleted: _verify),
          const SizedBox(height: 22),
          AppButton('Continue', busy: _busy, onPressed: _code.text.length == 6 ? _verify : null),
          const SizedBox(height: 12),
          Center(
            child: _wait > 0
                ? Padding(
                    padding: const EdgeInsets.all(12),
                    child: Text(
                      'You can ask for a new code in $_waitText',
                      style: context.t.bodyMedium!.copyWith(color: context.c.muted),
                    ),
                  )
                : TextButton(onPressed: _sending ? null : _resend, child: Text(_sending ? 'Sending…' : 'Send a new code')),
          ),
          Center(child: TextButton(onPressed: _startAgain, child: const Text('Use another email'))),
          const SizedBox(height: 6),
          Text(
            'No email? Check your spam folder. Never share this code with anyone.',
            textAlign: TextAlign.center,
            style: context.t.bodySmall,
          ),
        ],
      ),
      _Step.password => AuthFrame(
        step: 3,
        steps: 3,
        title: 'New password',
        subtitle: 'Choose a new password. You will be signed out on every other device.',
        children: [
          Form(
            key: _form,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                ...error,
                PasswordField(
                  controller: _password,
                  label: 'New password',
                  helper: 'At least 10 characters.',
                  validator: (v) => (v ?? '').length < 10 ? 'Use at least 10 characters.' : null,
                ),
                const SizedBox(height: 14),
                PasswordField(
                  controller: _confirm,
                  label: 'Repeat the new password',
                  validator: (v) => v != _password.text ? 'The two passwords do not match.' : null,
                  onSubmitted: (_) => _save(),
                ),
                const SizedBox(height: 22),
                AppButton('Save new password', busy: _busy, onPressed: _save),
              ],
            ),
          ),
          const SizedBox(height: 12),
          Center(
            child: TextButton(onPressed: _startAgain, child: const Text('Finish within 15 minutes, or start again')),
          ),
        ],
      ),
    };
  }
}
