import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/theme.dart';
import '../../models/models.dart';
import '../../state/app_state.dart';
import '../../widgets/common.dart';
import 'login_screen.dart';

String _mask(String email) {
  final at = email.indexOf('@');
  if (at < 2) return email;
  return '${email.substring(0, 2)}${'•' * (at - 2).clamp(1, 6).toInt()}${email.substring(at)}';
}

/// Where a new customer enters the 6-digit code emailed to them. Pops `true` once signed in.
class VerifyEmailScreen extends StatefulWidget {
  const VerifyEmailScreen({super.key, required this.email, required this.retryIn, this.message});
  final String email;

  /// Seconds until another code may be requested.
  final int retryIn;
  final String? message;

  @override
  State<VerifyEmailScreen> createState() => _VerifyEmailScreenState();
}

class _VerifyEmailScreenState extends State<VerifyEmailScreen> {
  final _code = TextEditingController();
  Timer? _timer;
  late int _wait = widget.retryIn;
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
    _code.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy || _code.text.length != 6) return;
    final app = context.read<AppState>();
    final nav = Navigator.of(context);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await app.verifyEmail(widget.email, _code.text);
      app.notice('Welcome to Dellvit, ${app.user!.name.split(' ').first}!');
      nav.pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = errorText(e);
      });
      _code.clear();
    }
  }

  Future<void> _resend() async {
    final app = context.read<AppState>();
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      final wait = await app.resendCode(widget.email);
      if (!mounted) return;
      setState(() => _wait = wait);
      app.notice('A new code is on its way.');
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _wait = asInt(e.data['retry_in'], _wait);
      });
    } catch (e) {
      if (mounted) setState(() => _error = errorText(e));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  String get _waitText => _wait >= 90 ? '${(_wait / 60).ceil()} min' : '${_wait}s';

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return AuthFrame(
      icon: Icons.mark_email_unread_outlined,
      title: 'Check your email',
      subtitle: 'Enter the 6-digit code we sent to ${_mask(widget.email)}. It works for 10 minutes.',
      children: [
        if (widget.message != null && _error == null) ...[Notice(widget.message!), const SizedBox(height: 14)],
        if (_error != null) ...[Notice(_error!, tone: Tone.red), const SizedBox(height: 14)],
        CodeBoxes(controller: _code, error: _error != null, onCompleted: _submit),
        const SizedBox(height: 22),
        AppButton('Verify and continue', busy: _busy, onPressed: _code.text.length == 6 ? _submit : null),
        const SizedBox(height: 12),
        Center(
          child: _wait > 0
              ? Padding(
                  padding: const EdgeInsets.all(12),
                  child: Text('You can ask for a new code in $_waitText', style: context.t.bodyMedium!.copyWith(color: c.muted)),
                )
              : TextButton(onPressed: _sending ? null : _resend, child: Text(_sending ? 'Sending…' : 'Send a new code')),
        ),
        const SizedBox(height: 6),
        Text(
          'No email? Check your spam folder, or go back and make sure the address is right.',
          textAlign: TextAlign.center,
          style: context.t.bodySmall,
        ),
      ],
    );
  }
}
