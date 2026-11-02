import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/resource.dart';
import '../../core/theme.dart';
import '../../models/models.dart';
import '../../state/app_state.dart';
import '../../widgets/common.dart';
import '../auth/login_screen.dart';

/// A readable name for the browser or app a session was started from.
({String name, IconData icon}) _device(String agent) {
  if (agent.contains('Dellvit')) return (name: 'Dellvit app on Android', icon: Icons.phone_android_rounded);
  final browser = agent.contains('Edg/')
      ? 'Edge'
      : agent.contains('OPR/')
      ? 'Opera'
      : agent.contains('Firefox/')
      ? 'Firefox'
      : agent.contains('Chrome/')
      ? 'Chrome'
      : agent.contains('Safari/')
      ? 'Safari'
      : 'Browser';
  final system = agent.contains('Android')
      ? 'Android'
      : agent.contains('iPhone') || agent.contains('iPad')
      ? 'iOS'
      : agent.contains('Windows')
      ? 'Windows'
      : agent.contains('Mac OS')
      ? 'Mac'
      : agent.contains('Linux')
      ? 'Linux'
      : '';
  final phone = system == 'Android' || system == 'iOS';
  return (
    name: system.isEmpty ? (agent.isEmpty ? 'Unknown device' : browser) : '$browser on $system',
    icon: phone ? Icons.phone_android_rounded : Icons.computer_rounded,
  );
}

/// Password change and the list of devices the account is signed in on.
class SecurityScreen extends StatefulWidget {
  const SecurityScreen({super.key});

  @override
  State<SecurityScreen> createState() => _SecurityScreenState();
}

class _SecurityScreenState extends State<SecurityScreen> {
  final _form = GlobalKey<FormState>();
  final _current = TextEditingController();
  final _next = TextEditingController();
  late final Resource<List<Json>> _sessions;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final api = context.read<AppState>().api;
    _sessions = Resource<List<Json>>(() async => asList(await api.get('/profile/sessions')))..start();
  }

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    _sessions.dispose();
    super.dispose();
  }

  Future<void> _changePassword() async {
    if (!(_form.currentState?.validate() ?? false)) return;
    FocusScope.of(context).unfocus();
    final app = context.read<AppState>();
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await app.api.post('/auth/password', {'current': _current.text, 'password': _next.text});
      _current.clear();
      _next.clear();
      app.notice('Password changed. Other devices were signed out.');
      _sessions.refresh(silent: true);
    } catch (e) {
      if (mounted) setState(() => _error = errorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _signOut([String? id]) async {
    final app = context.read<AppState>();
    final yes = await showConfirm(
      context,
      title: id == null ? 'Sign out everywhere else?' : 'Sign out this device?',
      message: id == null ? 'Every other phone and browser will need to log in again.' : 'It will need to log in again.',
      confirm: 'Sign out',
      danger: true,
    );
    if (!yes) return;
    try {
      await app.api.delete('/profile/sessions${id == null ? '' : '/$id'}');
      app.notice(id == null ? 'Other devices signed out.' : 'Device signed out.');
      _sessions.refresh(silent: true);
    } catch (e) {
      app.notice(errorText(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return Scaffold(
      appBar: AppBar(title: const Text('Password & devices')),
      body: ListView(
        keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 28),
        children: [
          AppCard(
            child: Form(
              key: _form,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Change password', style: context.t.titleMedium),
                  const SizedBox(height: 4),
                  Text('Changing it signs you out on your other devices.', style: context.t.bodySmall),
                  const SizedBox(height: 14),
                  if (_error != null) ...[Notice(_error!, tone: Tone.red), const SizedBox(height: 12)],
                  PasswordField(
                    controller: _current,
                    label: 'Current password',
                    validator: (v) => (v ?? '').isEmpty ? 'Enter your current password.' : null,
                  ),
                  const SizedBox(height: 12),
                  PasswordField(
                    controller: _next,
                    label: 'New password',
                    helper: 'At least 10 characters',
                    validator: (v) => (v ?? '').length < 10 ? 'Use at least 10 characters.' : null,
                  ),
                  const SizedBox(height: 16),
                  AppButton('Update password', busy: _busy, onPressed: _changePassword),
                ],
              ),
            ),
          ),
          const SizedBox(height: 20),
          ListenableBuilder(
            listenable: _sessions,
            builder: (context, _) {
              final list = _sessions.data;
              if (list == null) {
                return _sessions.error != null
                    ? ErrorState(_sessions.error!, onRetry: _sessions.refresh)
                    : const Skeleton(height: 140, radius: 18);
              }
              final others = list.where((s) => !asBool(s['current'])).length;
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Padding(
                          padding: const EdgeInsets.only(left: 6),
                          child: Text('SIGNED-IN DEVICES', style: context.t.labelSmall!.copyWith(letterSpacing: 0.9)),
                        ),
                      ),
                      if (others > 0) TextButton(onPressed: () => _signOut(), child: const Text('Sign out all others')),
                    ],
                  ),
                  const SizedBox(height: 4),
                  AppCard(
                    padding: EdgeInsets.zero,
                    child: Column(
                      children: [
                        for (final (i, s) in list.indexed) ...[
                          if (i > 0) Divider(indent: 68, color: c.line),
                          () {
                            final d = _device(asString(s['user_agent']));
                            final current = asBool(s['current']);
                            return ListTile(
                              contentPadding: const EdgeInsets.fromLTRB(14, 4, 8, 4),
                              leading: IconBubble(d.icon, tone: current ? Tone.green : Tone.neutral, size: 40),
                              title: Text(d.name),
                              subtitle: Text(current ? 'This device' : 'Signed in ${ago(asString(s['created_at'])).toLowerCase()}'),
                              trailing: current
                                  ? const Pill('Active', tone: Tone.green, dense: true)
                                  : IconButton(
                                      tooltip: 'Sign out',
                                      icon: Icon(Icons.logout_rounded, color: c.brand, size: 20),
                                      onPressed: () => _signOut(asString(s['id'])),
                                    ),
                            );
                          }(),
                        ],
                      ],
                    ),
                  ),
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}
