import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/links.dart';
import '../../core/theme.dart';
import '../../state/app_state.dart';
import '../../widgets/common.dart';

final _email = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$');

class AboutScreen extends StatelessWidget {
  const AboutScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final site = context.watch<AppState>().site;
    final socials = [
      (Icons.facebook_rounded, 'Facebook', site.text('facebook_url')),
      (Icons.camera_alt_outlined, 'Instagram', site.text('instagram_url')),
      (Icons.music_note_rounded, 'TikTok', site.text('tiktok_url')),
      (Icons.smart_display_outlined, 'YouTube', site.text('youtube_url')),
    ].where((s) => s.$3.isNotEmpty).toList();
    return Scaffold(
      appBar: AppBar(title: const Text('About Dellvit')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 28),
        children: [
          Container(
            padding: const EdgeInsets.all(22),
            decoration: BoxDecoration(color: const Color(0xFFFFF6EA), borderRadius: BorderRadius.circular(24)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Image.asset('assets/brand/logo.png', height: 64),
                const SizedBox(height: 16),
                Text(
                  site.text('about_title', 'Your neighbourhood, a little closer.'),
                  style: const TextStyle(color: Color(0xFF1C1420), fontSize: 22, fontWeight: FontWeight.w800, height: 1.2, letterSpacing: -0.4),
                ),
                const SizedBox(height: 8),
                Text(
                  site.text(
                    'about_description',
                    'Dellvit brings food, groceries and everyday essentials from local outlets to your doorstep, with riders close to you and a secure handover on every order.',
                  ),
                  style: const TextStyle(color: Color(0xFF5A5060), fontSize: 14, fontWeight: FontWeight.w500, height: 1.5),
                ),
              ],
            ),
          ),
          const SizedBox(height: 18),
          MenuGroup(
            title: 'Why Dellvit',
            children: const [
              MenuRow(icon: Icons.bolt_rounded, title: 'Fast delivery', subtitle: 'Riders close to you', tone: Tone.orange),
              MenuRow(icon: Icons.verified_user_outlined, title: 'Secure handover', subtitle: 'Every delivery is confirmed with your private code', tone: Tone.green),
              MenuRow(icon: Icons.storefront_outlined, title: 'Local outlets', subtitle: 'The shops and kitchens you already love', tone: Tone.brand),
              MenuRow(icon: Icons.payments_outlined, title: 'Pay your way', subtitle: 'Cash on delivery, bank transfer, wallets and Raast', tone: Tone.blue),
            ],
          ),
          if (socials.isNotEmpty) ...[
            const SizedBox(height: 18),
            MenuGroup(
              title: 'Follow us',
              children: [
                for (final s in socials) MenuRow(icon: s.$1, title: s.$2, tone: Tone.purple, onTap: () => openExternal(s.$3)),
              ],
            ),
          ],
          const SizedBox(height: 18),
          Center(
            child: Text(site.text('footer_note', '© Dellvit. Your everyday, delivered.'), textAlign: TextAlign.center, style: context.t.bodySmall!.copyWith(color: c.muted)),
          ),
        ],
      ),
    );
  }
}

class ContactScreen extends StatefulWidget {
  const ContactScreen({super.key});

  @override
  State<ContactScreen> createState() => _ContactScreenState();
}

class _ContactScreenState extends State<ContactScreen> {
  final _form = GlobalKey<FormState>();
  late final TextEditingController _name, _emailCtl;
  final _message = TextEditingController();
  bool _busy = false;
  bool _sent = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final user = context.read<AppState>().user;
    _name = TextEditingController(text: user?.name ?? '');
    _emailCtl = TextEditingController(text: user != null && user.email.contains('@') ? user.email : '');
  }

  @override
  void dispose() {
    _name.dispose();
    _emailCtl.dispose();
    _message.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    if (!(_form.currentState?.validate() ?? false)) return;
    FocusScope.of(context).unfocus();
    final app = context.read<AppState>();
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await app.api.post('/contact', {
        'name': _name.text.trim(),
        'email': _emailCtl.text.trim(),
        'message': _message.text.trim(),
      });
      if (mounted) setState(() => _sent = true);
    } catch (e) {
      if (mounted) setState(() => _error = errorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final site = context.watch<AppState>().site;
    final phone = site.text('support_phone');
    final email = site.text('support_email');
    final whatsapp = site.text('whatsapp');
    final hours = site.text('support_hours');
    final address = site.text('support_address');
    return Scaffold(
      appBar: AppBar(title: const Text('Contact us')),
      body: ListView(
        keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 28),
        children: [
          Text('We’re here to help', style: context.t.headlineSmall),
          const SizedBox(height: 4),
          Text(
            'Reach the Dellvit team about an order, a payment or anything else.',
            style: context.t.bodyMedium!.copyWith(color: context.c.muted),
          ),
          const SizedBox(height: 16),
          if (phone.isNotEmpty || email.isNotEmpty || whatsapp.isNotEmpty || hours.isNotEmpty || address.isNotEmpty) ...[
            MenuGroup(
              children: [
                if (phone.isNotEmpty) MenuRow(icon: Icons.call_outlined, title: 'Call us', subtitle: phone, tone: Tone.green, onTap: () => callPhone(phone)),
                if (whatsapp.isNotEmpty)
                  MenuRow(icon: Icons.chat_outlined, title: 'WhatsApp', subtitle: whatsapp, tone: Tone.green, onTap: () => openWhatsApp(whatsapp)),
                if (email.isNotEmpty) MenuRow(icon: Icons.mail_outline_rounded, title: 'Email', subtitle: email, tone: Tone.blue, onTap: () => sendEmail(email)),
                if (hours.isNotEmpty) MenuRow(icon: Icons.schedule_rounded, title: 'Support hours', subtitle: hours, tone: Tone.orange),
                if (address.isNotEmpty) MenuRow(icon: Icons.location_on_outlined, title: 'Address', subtitle: address, tone: Tone.brand),
              ],
            ),
            const SizedBox(height: 18),
          ],
          if (!site.on('contact_form_enabled'))
            const Notice('The contact form is closed right now. Please call or email us instead.', tone: Tone.amber)
          else if (_sent)
            AppCard(
              child: Column(
                children: [
                  const IconBubble(Icons.mark_email_read_outlined, tone: Tone.green, size: 56),
                  const SizedBox(height: 12),
                  Text('Message sent', style: context.t.titleLarge),
                  const SizedBox(height: 4),
                  Text('Thank you. The team will reply to your email soon.', textAlign: TextAlign.center, style: context.t.bodyMedium),
                  const SizedBox(height: 14),
                  AppButton(
                    'Send another message',
                    outlined: true,
                    small: true,
                    expand: false,
                    onPressed: () => setState(() {
                      _sent = false;
                      _message.clear();
                    }),
                  ),
                ],
              ),
            )
          else
            AppCard(
              child: Form(
                key: _form,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Send us a message', style: context.t.titleMedium),
                    const SizedBox(height: 14),
                    if (_error != null) ...[Notice(_error!, tone: Tone.red), const SizedBox(height: 12)],
                    TextFormField(
                      controller: _name,
                      maxLength: 100,
                      textCapitalization: TextCapitalization.words,
                      decoration: const InputDecoration(labelText: 'Your name', counterText: ''),
                      validator: (v) => (v ?? '').trim().isEmpty ? 'Enter your name.' : null,
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      controller: _emailCtl,
                      maxLength: 200,
                      keyboardType: TextInputType.emailAddress,
                      decoration: const InputDecoration(labelText: 'Your email', counterText: ''),
                      validator: (v) => _email.hasMatch((v ?? '').trim()) ? null : 'Enter a valid email address.',
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      controller: _message,
                      maxLength: 3000,
                      minLines: 4,
                      maxLines: 8,
                      textCapitalization: TextCapitalization.sentences,
                      decoration: const InputDecoration(labelText: 'How can we help?', alignLabelWithHint: true, counterText: ''),
                      validator: (v) => (v ?? '').trim().isEmpty ? 'Write your message.' : null,
                    ),
                    const SizedBox(height: 16),
                    AppButton('Send message', busy: _busy, icon: Icons.send_rounded, onPressed: _send),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}
