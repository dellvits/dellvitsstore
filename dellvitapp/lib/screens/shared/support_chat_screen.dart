import 'dart:io';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/config.dart';
import '../../core/format.dart';
import '../../core/links.dart';
import '../../core/pick_image.dart';
import '../../core/resource.dart';
import '../../core/theme.dart';
import '../../models/models.dart';
import '../../state/app_state.dart';
import '../../widgets/common.dart';
import '../auth/login_screen.dart';
import 'image_view_screen.dart';

typedef _Chat = ({List<ChatMessage> messages, String status, String deliveredAt, String seenAt});

/// The account's one conversation with the support team. It is re-read every few seconds
/// while open; it is not a live socket.
class SupportChatScreen extends StatefulWidget {
  const SupportChatScreen({super.key, this.embedded = false});

  /// Shown as a tab (no back button) rather than as a page of its own.
  final bool embedded;

  @override
  State<SupportChatScreen> createState() => _SupportChatScreenState();
}

class _SupportChatScreenState extends State<SupportChatScreen> {
  final _text = TextEditingController();
  final _scroll = ScrollController();
  Resource<_Chat>? _chat;
  String? _attachment;
  bool _sending = false;
  int _count = 0;

  @override
  void initState() {
    super.initState();
    final app = context.read<AppState>();
    if (app.user == null) return;
    _chat = Resource<_Chat>(() async {
      final r = asMap(await app.api.get('/support'));
      final thread = asMap(r['thread']);
      return (
        messages: asList(r['messages']).map(ChatMessage.fromJson).toList(),
        status: asString(thread['status'], 'open'),
        deliveredAt: asString(thread['delivered_at']),
        seenAt: asString(thread['seen_at']),
      );
    }, every: const Duration(seconds: 4))
      ..addListener(_onData)
      ..start();
  }

  void _onData() {
    final n = _chat?.data?.messages.length ?? 0;
    if (n != _count) {
      _count = n;
      // Opening the chat marks replies as read, so the badge can go.
      context.read<AppState>().refreshNotifications();
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_scroll.hasClients) {
          _scroll.animateTo(_scroll.position.maxScrollExtent, duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
        }
      });
    }
  }

  @override
  void dispose() {
    _chat?.dispose();
    _text.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _attach() async {
    final picked = await pickAndCropImage(context);
    if (picked != null && mounted) setState(() => _attachment = picked);
  }

  Future<void> _send() async {
    final body = _text.text.trim();
    final file = _attachment;
    if (_sending || (body.isEmpty && file == null)) return;
    final app = context.read<AppState>();
    setState(() => _sending = true);
    try {
      if (file != null) {
        await app.api.upload('/support/messages', file, fields: {'body': body});
      } else {
        await app.api.post('/support/messages', {'body': body});
      }
      _text.clear();
      _attachment = null;
      await _chat?.refresh(silent: true);
    } catch (e) {
      app.notice(errorText(e));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  /// Sent, delivered or seen, for the account's own messages.
  Widget _ticks(ChatMessage m, _Chat chat) {
    final c = context.c;
    final seen = chat.seenAt.isNotEmpty && chat.seenAt.compareTo(m.createdAt) >= 0;
    final delivered = seen || (chat.deliveredAt.isNotEmpty && chat.deliveredAt.compareTo(m.createdAt) >= 0);
    return Icon(
      delivered ? Icons.done_all_rounded : Icons.done_rounded,
      size: 15,
      color: seen ? const Color(0xFF9BE7FF) : Colors.white.withValues(alpha: 0.8),
      semanticLabel: seen
          ? 'Seen'
          : delivered
          ? 'Delivered'
          : 'Sent',
      shadows: seen ? [Shadow(color: c.shadow, blurRadius: 1)] : null,
    );
  }

  Widget _bubble(ChatMessage m, _Chat chat) {
    final c = context.c;
    final mine = !m.staff;
    final fg = mine ? Colors.white : c.ink;
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.78),
        margin: const EdgeInsets.symmetric(vertical: 3),
        padding: const EdgeInsets.fromLTRB(12, 9, 12, 7),
        decoration: BoxDecoration(
          color: mine ? null : c.surface,
          gradient: mine ? c.gradient : null,
          border: mine ? null : Border.all(color: c.line),
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(18),
            topRight: const Radius.circular(18),
            bottomLeft: Radius.circular(mine ? 18 : 5),
            bottomRight: Radius.circular(mine ? 5 : 18),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            if (m.hasImage)
              Padding(
                padding: EdgeInsets.only(bottom: m.body.isEmpty ? 4 : 8),
                child: GestureDetector(
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => ImageViewScreen(path: '/api/support/files/${m.id}', title: 'Attachment', private: true),
                    ),
                  ),
                  child: NetImage('/api/support/files/${m.id}', width: 200, height: 160, radius: 12, private: true),
                ),
              )
            else if (m.hasFile)
              Padding(
                padding: EdgeInsets.only(bottom: m.body.isEmpty ? 4 : 8),
                child: InkWell(
                  // Documents need the website's sign-in to download.
                  onTap: () => openExternal(AppConfig.origin + (context.read<AppState>().user!.isCustomer ? '/support' : '/')),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.picture_as_pdf_outlined, color: fg, size: 20),
                      const SizedBox(width: 8),
                      Flexible(
                        child: Text(
                          m.fileName.isEmpty ? 'Document' : m.fileName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(color: fg, fontWeight: FontWeight.w700, fontSize: 13.5, decoration: TextDecoration.underline, decorationColor: fg),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            if (m.body.isNotEmpty) Text(m.body, style: TextStyle(color: fg, fontSize: 14.5, fontWeight: FontWeight.w500, height: 1.4)),
            const SizedBox(height: 3),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  timeText(m.createdAt),
                  style: TextStyle(color: mine ? Colors.white.withValues(alpha: 0.85) : c.muted, fontSize: 10.5, fontWeight: FontWeight.w600),
                ),
                if (mine) ...[const SizedBox(width: 4), _ticks(m, chat)],
              ],
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final app = context.watch<AppState>();
    final closed = !app.site.on('chat_enabled');
    final appBar = AppBar(
      automaticallyImplyLeading: !widget.embedded,
      titleSpacing: widget.embedded ? 20 : 4,
      title: Row(
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(gradient: c.gradient, shape: BoxShape.circle),
            child: const Icon(Icons.support_agent_rounded, color: Colors.white, size: 21),
          ),
          const SizedBox(width: 10),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Dellvit support', style: context.t.titleMedium),
              Text(app.site.text('support_hours', 'We usually reply within minutes'), style: context.t.bodySmall),
            ],
          ),
        ],
      ),
    );
    if (_chat == null) {
      return Scaffold(
        appBar: appBar,
        body: EmptyState(
          icon: Icons.forum_outlined,
          title: 'Log in to chat with support',
          message: 'Your conversation is kept with your account.',
          action: 'Log in',
          onAction: () => Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => const LoginScreen())),
        ),
      );
    }
    return Scaffold(
      appBar: appBar,
      body: ListenableBuilder(
        listenable: _chat!,
        builder: (context, _) {
          final chat = _chat!.data;
          if (chat == null) {
            return _chat!.error != null ? ErrorState(_chat!.error!, onRetry: _chat!.refresh) : const LoadingView();
          }
          final greeting = app.site.text('chat_greeting', 'Hi! How can we help you today?');
          return Column(
            children: [
              Expanded(
                child: ListView(
                  controller: _scroll,
                  keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                  padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
                  children: [
                    if (chat.messages.isEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 40),
                        child: EmptyState(icon: Icons.waving_hand_outlined, title: greeting, message: 'Send us a message and the team will reply here.'),
                      ),
                    for (final (i, m) in chat.messages.indexed) ...[
                      if (i == 0 || dayText(chat.messages[i - 1].createdAt) != dayText(m.createdAt))
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 10),
                          child: Center(child: Pill(dayText(m.createdAt), dense: true)),
                        ),
                      _bubble(m, chat),
                    ],
                    if (chat.status == 'closed' && chat.messages.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 12),
                        child: Center(child: Text('This conversation was closed. Send a message to reopen it.', style: context.t.bodySmall)),
                      ),
                  ],
                ),
              ),
              if (closed)
                const Padding(
                  padding: EdgeInsets.fromLTRB(14, 0, 14, 14),
                  child: Notice('Support chat is closed right now. Please use the contact page.', tone: Tone.amber),
                )
              else
                Container(
                  decoration: BoxDecoration(
                    color: c.surface,
                    border: Border(top: BorderSide(color: c.line)),
                  ),
                  child: SafeArea(
                    top: false,
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(8, 8, 10, 8),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          if (_attachment != null)
                            Padding(
                              padding: const EdgeInsets.fromLTRB(8, 0, 4, 8),
                              child: Row(
                                children: [
                                  ClipRRect(
                                    borderRadius: BorderRadius.circular(10),
                                    child: Image.file(File(_attachment!), width: 48, height: 48, fit: BoxFit.cover),
                                  ),
                                  const SizedBox(width: 10),
                                  Expanded(child: Text('Picture attached', style: context.t.bodySmall)),
                                  IconButton(icon: const Icon(Icons.close_rounded, size: 20), onPressed: () => setState(() => _attachment = null)),
                                ],
                              ),
                            ),
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              IconButton(
                                tooltip: 'Attach a picture',
                                icon: Icon(Icons.add_photo_alternate_outlined, color: c.muted),
                                onPressed: _sending ? null : _attach,
                              ),
                              Expanded(
                                child: TextField(
                                  controller: _text,
                                  minLines: 1,
                                  maxLines: 4,
                                  maxLength: 2000,
                                  textCapitalization: TextCapitalization.sentences,
                                  decoration: InputDecoration(
                                    hintText: 'Type a message',
                                    counterText: '',
                                    fillColor: c.soft,
                                    contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 11),
                                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(22), borderSide: BorderSide.none),
                                    enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(22), borderSide: BorderSide.none),
                                    focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(22), borderSide: BorderSide.none),
                                  ),
                                ),
                              ),
                              const SizedBox(width: 8),
                              Material(
                                color: c.brand,
                                shape: const CircleBorder(),
                                child: InkWell(
                                  customBorder: const CircleBorder(),
                                  onTap: _sending ? null : _send,
                                  child: SizedBox(
                                    width: 46,
                                    height: 46,
                                    child: _sending
                                        ? const Padding(
                                            padding: EdgeInsets.all(13),
                                            child: CircularProgressIndicator(strokeWidth: 2.2, color: Colors.white),
                                          )
                                        : const Icon(Icons.send_rounded, color: Colors.white, size: 20),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}
