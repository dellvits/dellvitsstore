import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/theme.dart';
import '../../state/app_state.dart';
import '../../widgets/common.dart';

const _kinds = <String, ({String title, String hint, IconData icon, List<String> roles})>{
  'order': (
    title: 'Orders',
    hint: 'Placed, confirmed, on the way, delivered',
    icon: Icons.receipt_long_outlined,
    roles: ['customer', 'outlet', 'rider'],
  ),
  'delivery': (
    title: 'Deliveries',
    hint: 'New delivery requests and pickups',
    icon: Icons.two_wheeler_rounded,
    roles: ['rider'],
  ),
  'payment': (
    title: 'Payments',
    hint: 'Payment verified, rejected or refunded',
    icon: Icons.payments_outlined,
    roles: ['customer', 'rider'],
  ),
  'earning': (title: 'Earnings', hint: 'Commission for each delivery', icon: Icons.savings_outlined, roles: ['rider']),
  'payout': (title: 'Payouts', hint: 'Payout requests and payments', icon: Icons.account_balance_wallet_outlined, roles: ['rider']),
  'message': (
    title: 'Support messages',
    hint: 'Replies from the Dellvit team',
    icon: Icons.support_agent_rounded,
    roles: ['customer', 'outlet', 'rider'],
  ),
  'update': (
    title: 'Dellvit updates',
    hint: 'News and announcements from Dellvit',
    icon: Icons.campaign_outlined,
    roles: ['customer', 'outlet', 'rider'],
  ),
};

/// Which kinds of notification pop up. Silenced kinds still arrive in the inbox.
class NotificationSettingsScreen extends StatefulWidget {
  const NotificationSettingsScreen({super.key});

  @override
  State<NotificationSettingsScreen> createState() => _NotificationSettingsScreenState();
}

class _NotificationSettingsScreenState extends State<NotificationSettingsScreen> {
  String? _saving;
  bool _testing = false;

  Future<void> _toggle(String kind, bool on) async {
    final app = context.read<AppState>();
    final muted = {...app.user!.notifyMuted};
    on ? muted.remove(kind) : muted.add(kind);
    setState(() => _saving = kind);
    try {
      await app.setMuted(muted.toList());
    } catch (e) {
      app.notice(errorText(e));
    } finally {
      if (mounted) setState(() => _saving = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final app = context.watch<AppState>();
    final user = app.user;
    if (user == null) return const Scaffold(body: SizedBox.shrink());
    final kinds = _kinds.entries.where((e) => e.value.roles.contains(user.role)).toList();
    return Scaffold(
      appBar: AppBar(title: const Text('Notification settings')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 28),
        children: [
          const Notice(
            'Alerts appear while the app is open. A silenced kind still arrives in your inbox, without the pop-up.',
            icon: Icons.notifications_active_outlined,
          ),
          const SizedBox(height: 16),
          AppCard(
            padding: EdgeInsets.zero,
            child: Column(
              children: [
                for (final (i, e) in kinds.indexed) ...[
                  if (i > 0) Divider(indent: 68, color: c.line),
                  SwitchListTile(
                    contentPadding: const EdgeInsets.fromLTRB(14, 4, 10, 4),
                    secondary: IconBubble(e.value.icon, tone: Tone.brand, size: 40),
                    title: Text(e.value.title),
                    subtitle: Text(e.value.hint),
                    value: !user.notifyMuted.contains(e.key),
                    onChanged: _saving == null ? (v) => _toggle(e.key, v) : null,
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 18),
          AppButton(
            'Send a test notification',
            outlined: true,
            busy: _testing,
            icon: Icons.send_outlined,
            onPressed: () async {
              setState(() => _testing = true);
              try {
                await app.api.post('/notifications/test');
                await app.refreshNotifications();
              } catch (e) {
                app.notice(errorText(e));
              } finally {
                if (mounted) setState(() => _testing = false);
              }
            },
          ),
        ],
      ),
    );
  }
}
