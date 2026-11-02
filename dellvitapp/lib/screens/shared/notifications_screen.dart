import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/resource.dart';
import '../../core/theme.dart';
import '../../models/models.dart';
import '../../state/app_state.dart';
import '../../widgets/common.dart';
import '../links.dart';

({IconData icon, Tone tone}) _look(String type) => switch (type) {
  'order' => (icon: Icons.receipt_long_outlined, tone: Tone.brand),
  'delivery' => (icon: Icons.two_wheeler_rounded, tone: Tone.orange),
  'payment' => (icon: Icons.payments_outlined, tone: Tone.green),
  'earning' => (icon: Icons.savings_outlined, tone: Tone.green),
  'payout' => (icon: Icons.account_balance_wallet_outlined, tone: Tone.purple),
  'message' => (icon: Icons.support_agent_rounded, tone: Tone.blue),
  'update' => (icon: Icons.campaign_outlined, tone: Tone.amber),
  _ => (icon: Icons.notifications_none_rounded, tone: Tone.neutral),
};

/// The account's inbox.
class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  late final Resource<List<AppNotification>> _items;
  String _filter = 'all';

  @override
  void initState() {
    super.initState();
    final app = context.read<AppState>();
    _items = Resource<List<AppNotification>>(
      () async => app.user == null
          // Not signed in: Dellvit's announcements, read or not as kept on this phone.
          ? (await app.announcements()).where((n) => _filter == 'all' || n.read == (_filter == 'read')).toList()
          : asList(
              asMap(await app.api.get('/notifications', query: {'limit': '100', 'filter': _filter}))['items'],
            ).map(AppNotification.fromJson).toList(),
      every: const Duration(seconds: 20),
    )..start();
  }

  @override
  void dispose() {
    _items.dispose();
    super.dispose();
  }

  Future<void> _run(Future<dynamic> Function(Api api) action, String done) async {
    final app = context.read<AppState>();
    try {
      await action(app.api);
      app.notice(done);
      await Future.wait([_items.refresh(silent: true), app.refreshNotifications()]);
    } catch (e) {
      app.notice(errorText(e));
    }
  }

  void _open(AppNotification n) {
    final app = context.read<AppState>();
    app.markRead(n, true);
    setState(() {});
    // Links are written for the website; customers' (and guests') ones have matching screens here.
    if (app.user == null || app.user!.isCustomer) openLink(context, n.link);
  }

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final app = context.watch<AppState>();
    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [
          PopupMenuButton<String>(
            icon: const Icon(Icons.more_vert_rounded),
            onSelected: (v) async {
              final app = context.read<AppState>();
              if (app.user == null) {
                final all = _items.data ?? [];
                if (v == 'read') {
                  await app.readAnnouncements(all.map((n) => n.id));
                } else {
                  await app.removeAnnouncements(all.where((n) => v == 'all' || n.read).map((n) => n.id));
                }
                await _items.refresh(silent: true);
                return;
              }
              if (v == 'read') {
                await _run((api) => api.post('/notifications/read-all'), 'All marked as read.');
              } else {
                final all = v == 'all';
                final yes = await showConfirm(
                  context,
                  title: all ? 'Empty your inbox?' : 'Remove read notifications?',
                  message: all ? 'Every notification will be deleted.' : 'Unread notifications are kept.',
                  confirm: all ? 'Delete all' : 'Remove read',
                  danger: true,
                );
                if (yes) await _run((api) => api.delete('/notifications', query: {'all': all ? '1' : null}), 'Inbox cleaned up.');
              }
            },
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'read', child: Text('Mark all as read')),
              PopupMenuItem(value: 'clear', child: Text('Remove read')),
              PopupMenuItem(value: 'all', child: Text('Delete all')),
            ],
          ),
        ],
      ),
      body: Column(
        children: [
          Align(
            alignment: Alignment.centerLeft,
            child: ChoiceChips<String>(
              options: {'all': 'All', 'unread': 'Unread${app.unread > 0 ? ' (${app.unread})' : ''}', 'read': 'Read'},
              value: _filter,
              onChanged: (v) {
                setState(() => _filter = v);
                _items.refresh();
              },
            ),
          ),
          const SizedBox(height: 6),
          Expanded(
            child: RefreshIndicator(
              color: c.brand,
              onRefresh: () => _items.refresh(silent: true),
              child: ListenableBuilder(
                listenable: _items,
                builder: (context, _) {
                  final list = _items.data;
                  if (_items.loading && (list == null || list.isEmpty)) return const SkeletonList(height: 76);
                  if (list == null) return ListView(children: [ErrorState(_items.error ?? 'Could not load.', onRetry: _items.refresh)]);
                  if (list.isEmpty) {
                    return ListView(
                      children: [
                        EmptyState(
                          icon: Icons.notifications_none_rounded,
                          title: _filter == 'unread' ? 'You’re all caught up' : 'No notifications',
                          message: app.user == null
                              ? 'News and offers from Dellvit appear here. Log in to also get your order updates.'
                              : 'Order updates and messages from Dellvit appear here.',
                        ),
                      ],
                    );
                  }
                  return ListView.separated(
                    padding: const EdgeInsets.fromLTRB(16, 6, 16, 24),
                    itemCount: list.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 8),
                    itemBuilder: (context, i) {
                      final n = list[i];
                      final look = _look(n.type);
                      return Dismissible(
                        key: ValueKey(n.id),
                        direction: DismissDirection.endToStart,
                        background: Container(
                          alignment: Alignment.centerRight,
                          padding: const EdgeInsets.only(right: 22),
                          decoration: BoxDecoration(color: c.red50, borderRadius: BorderRadius.circular(18)),
                          child: Icon(Icons.delete_outline_rounded, color: c.brand),
                        ),
                        onDismissed: (_) {
                          _items.set(list.where((x) => x.id != n.id).toList());
                          if (app.user == null) {
                            app.removeAnnouncements([n.id]);
                            return;
                          }
                          app.api.delete('/notifications/${n.id}').then((_) => app.refreshNotifications()).catchError((_) {});
                        },
                        child: AppCard(
                          padding: const EdgeInsets.all(12),
                          color: n.read ? c.surface : c.brand50,
                          borderColor: n.read ? c.line : c.brand100,
                          onTap: () => _open(n),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              IconBubble(look.icon, tone: look.tone, size: 40),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      children: [
                                        Expanded(
                                          child: Text(n.title, style: context.t.titleSmall, maxLines: 2, overflow: TextOverflow.ellipsis),
                                        ),
                                        if (!n.read)
                                          Container(
                                            width: 8,
                                            height: 8,
                                            margin: const EdgeInsets.only(left: 8),
                                            decoration: BoxDecoration(color: c.brand, shape: BoxShape.circle),
                                          ),
                                      ],
                                    ),
                                    if (n.body.isNotEmpty) ...[
                                      const SizedBox(height: 2),
                                      Text(n.body, style: context.t.bodyMedium, maxLines: 3, overflow: TextOverflow.ellipsis),
                                    ],
                                    const SizedBox(height: 4),
                                    Text(ago(n.createdAt), style: context.t.bodySmall!.copyWith(fontSize: 11.5)),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  );
                },
              ),
            ),
          ),
        ],
      ),
    );
  }
}
