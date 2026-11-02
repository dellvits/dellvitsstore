import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

export 'auth_frame.dart';

import '../../core/api.dart';
import '../../models/models.dart';
import '../../state/app_state.dart';
import '../../widgets/common.dart';
import 'auth_frame.dart';
import 'forgot_password_screen.dart';
import 'signup_screen.dart';
import 'verify_email_screen.dart';

/// A password field with a show/hide eye.
class PasswordField extends StatefulWidget {
  const PasswordField({super.key, required this.controller, this.label = 'Password', this.validator, this.onSubmitted, this.helper});
  final TextEditingController controller;
  final String label;
  final String? helper;
  final FormFieldValidator<String>? validator;
  final ValueChanged<String>? onSubmitted;

  @override
  State<PasswordField> createState() => _PasswordFieldState();
}

class _PasswordFieldState extends State<PasswordField> {
  bool _hidden = true;

  @override
  Widget build(BuildContext context) => TextFormField(
    controller: widget.controller,
    obscureText: _hidden,
    maxLength: 100,
    autocorrect: false,
    enableSuggestions: false,
    validator: widget.validator,
    onFieldSubmitted: widget.onSubmitted,
    decoration: InputDecoration(
      labelText: widget.label,
      helperText: widget.helper,
      counterText: '',
      prefixIcon: const Icon(Icons.lock_outline_rounded),
      suffixIcon: IconButton(
        tooltip: _hidden ? 'Show password' : 'Hide password',
        icon: Icon(_hidden ? Icons.visibility_outlined : Icons.visibility_off_outlined),
        onPressed: () => setState(() => _hidden = !_hidden),
      ),
    ),
  );
}

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, this.reason});

  /// Why the person was sent here, e.g. "Sign in to check out".
  final String? reason;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _form = GlobalKey<FormState>();
  final _login = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _login.dispose();
    _password.dispose();
    super.dispose();
  }

  /// Leaves the sign-in pages. Customers go back to where they were; outlets and riders land
  /// in their own workspace.
  void _done() {
    final app = context.read<AppState>();
    final nav = Navigator.of(context);
    if (app.user != null && !app.user!.isCustomer) {
      nav.popUntil((r) => r.isFirst);
    } else {
      nav.pop(true);
    }
  }

  Future<void> _submit() async {
    if (_busy || !(_form.currentState?.validate() ?? false)) return;
    FocusScope.of(context).unfocus();
    final app = context.read<AppState>();
    final nav = Navigator.of(context);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await app.login(_login.text, _password.text);
      if (!mounted) return;
      app.notice('Welcome back, ${app.user!.name.split(' ').first}.');
      _done();
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      if (e.code == 'verify_email') {
        final ok = await nav.push<bool>(
          MaterialPageRoute(
            builder: (_) => VerifyEmailScreen(
              email: asString(e.data['email'], _login.text.trim()),
              retryIn: asInt(e.data['retry_in'], 60),
              message: e.message,
            ),
          ),
        );
        if (ok == true && mounted) _done();
        return;
      }
      setState(
        () => _error = e.status == 403 && e.message.contains('separate sign-in')
            ? 'Administrator accounts sign in on the Dellvit website, not in the app.'
            : e.message,
      );
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
    final app = context.watch<AppState>();
    return AuthFrame(
      title: 'Welcome back',
      subtitle: widget.reason ?? 'Log in to order, track deliveries and manage your account.',
      footer: app.site.on('signup_enabled')
          ? AuthSwitch(
              text: 'New to Dellvit?',
              action: 'Create an account',
              onTap: () async {
                final ok = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => const SignupScreen()));
                if (ok == true && context.mounted) _done();
              },
            )
          : null,
      children: [
        Form(
          key: _form,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (_error != null) ...[Notice(_error!, tone: Tone.red), const SizedBox(height: 14)],
              TextFormField(
                controller: _login,
                keyboardType: TextInputType.emailAddress,
                textInputAction: TextInputAction.next,
                autocorrect: false,
                maxLength: 200,
                autofillHints: const [AutofillHints.email, AutofillHints.username],
                decoration: const InputDecoration(
                  labelText: 'Email, rider ID or outlet ID',
                  helperText: 'Riders and outlets can use their ID, e.g. DRV-001 or DLV-001',
                  counterText: '',
                  prefixIcon: Icon(Icons.alternate_email_rounded),
                ),
                validator: (v) => (v ?? '').trim().isEmpty ? 'Enter your email or ID.' : null,
              ),
              const SizedBox(height: 14),
              PasswordField(
                controller: _password,
                validator: (v) => (v ?? '').isEmpty ? 'Enter your password.' : null,
                onSubmitted: (_) => _submit(),
              ),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton(
                  onPressed: () async {
                    final typed = _login.text.trim();
                    final ok = await Navigator.of(context).push<bool>(
                      MaterialPageRoute(builder: (_) => ForgotPasswordScreen(email: typed.contains('@') ? typed : '')),
                    );
                    if (ok == true && context.mounted) _done();
                  },
                  child: const Text('Forgot password?'),
                ),
              ),
              const SizedBox(height: 8),
              AppButton('Log in', busy: _busy, icon: Icons.arrow_forward_rounded, onPressed: _submit),
            ],
          ),
        ),
      ],
    );
  }
}
