import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/config.dart';
import '../../core/theme.dart';
import '../../models/models.dart';
import '../../state/app_state.dart';
import '../../widgets/area_picker.dart';
import '../../widgets/brand.dart';
import '../../widgets/common.dart';
import '../../widgets/curved_header.dart';
import '../auth/login_screen.dart';
import '../auth/signup_screen.dart';
import '../customer/find_product_screen.dart';
import 'blog_screens.dart';
import 'info_screens.dart';
import 'notification_settings_screen.dart';
import 'notifications_screen.dart';
import 'profile_screen.dart';
import 'security_screen.dart';
import 'support_chat_screen.dart';

/// The account tab: the same for customers, outlets and riders, and a sign-in invitation for guests.
class AccountScreen extends StatelessWidget {
  const AccountScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final user = app.user;
    void push(Widget screen) => Navigator.of(context).push(MaterialPageRoute(builder: (_) => screen));
    return Scaffold(
      body: CustomScrollView(
        slivers: [
          SliverToBoxAdapter(child: _AccountHeader(push: push)),
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 28),
            sliver: SliverList.list(
              children: [
                if (user != null && user.isCustomer)
                  // Shortcuts that sit over the curve of the header.
                  Transform.translate(
                    offset: const Offset(0, -26),
                    child: Row(
                      children: [
                        Expanded(child: _Quick(Icons.receipt_long_rounded, 'Orders', Tone.brand, () => app.goToTab(3))),
                        const SizedBox(width: 10),
                        Expanded(
                          child: _Quick(
                            Icons.notifications_rounded,
                            'Alerts',
                            Tone.orange,
                            () => push(const NotificationsScreen()),
                            count: app.unread,
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: _Quick(
                            Icons.support_agent_rounded,
                            'Support',
                            Tone.green,
                            () => push(const SupportChatScreen()),
                            count: app.supportUnread,
                          ),
                        ),
                      ],
                    ),
                  )
                else
                  const SizedBox(height: 4),
                // Find my product is for customers; the blog is for everyone.
                if ((user?.isCustomer ?? false) || app.site.blogOn) ...[
                  MenuGroup(
                    title: 'Discover',
                    children: [
                      if (user?.isCustomer ?? false)
                        MenuRow(
                          icon: Icons.manage_search_rounded,
                          title: 'Find my product',
                          subtitle: 'Tell us what you want; we notify you when it arrives',
                          tone: Tone.brand,
                          onTap: () => push(const FindProductScreen()),
                        ),
                      if (app.site.blogOn)
                        MenuRow(
                          icon: Icons.article_outlined,
                          title: asString(app.site.blog['title'], 'Blog'),
                          subtitle: 'News, guides and offers',
                          tone: Tone.blue,
                          onTap: () => push(const BlogListScreen()),
                        ),
                    ],
                  ),
                  const SizedBox(height: 18),
                ],
                if (user != null) ...[
                  MenuGroup(
                    title: 'Account',
                    children: [
                      MenuRow(
                        icon: Icons.person_outline_rounded,
                        title: 'Profile',
                        subtitle: 'Name, phone${user.isCustomer ? ' and delivery address' : ''}',
                        tone: Tone.brand,
                        onTap: () => push(const ProfileScreen()),
                      ),
                      MenuRow(
                        icon: Icons.shield_outlined,
                        title: 'Password & devices',
                        subtitle: 'Change your password, sign out other devices',
                        tone: Tone.purple,
                        onTap: () => push(const SecurityScreen()),
                      ),
                    ],
                  ),
                  const SizedBox(height: 18),
                  MenuGroup(
                    title: 'Inbox',
                    children: [
                      MenuRow(
                        icon: Icons.notifications_none_rounded,
                        title: 'Notifications',
                        subtitle: app.unread > 0 ? '${app.unread} unread' : 'You’re all caught up',
                        tone: Tone.orange,
                        trailing: app.unread > 0 ? Pill('${app.unread}', tone: Tone.brand, dense: true) : null,
                        onTap: () => push(const NotificationsScreen()),
                      ),
                      MenuRow(
                        icon: Icons.support_agent_rounded,
                        title: 'Support chat',
                        subtitle: app.supportUnread > 0 ? 'Support replied to you' : 'Talk to the Dellvit team',
                        tone: Tone.green,
                        trailing: app.supportUnread > 0
                            ? Pill('${app.supportUnread}', tone: Tone.brand, dense: true)
                            : null,
                        onTap: () => push(const SupportChatScreen()),
                      ),
                      MenuRow(
                        icon: Icons.tune_rounded,
                        title: 'Notification settings',
                        subtitle: 'Choose which alerts pop up',
                        tone: Tone.blue,
                        onTap: () => push(const NotificationSettingsScreen()),
                      ),
                    ],
                  ),
                  const SizedBox(height: 18),
                ],
                if (user == null) ...[
                  MenuGroup(
                    title: 'Inbox',
                    children: [
                      MenuRow(
                        icon: Icons.notifications_none_rounded,
                        title: 'Notifications',
                        subtitle: app.unread > 0 ? '${app.unread} new from Dellvit' : 'News and offers from Dellvit',
                        tone: Tone.orange,
                        trailing: app.unread > 0 ? Pill('${app.unread}', tone: Tone.brand, dense: true) : null,
                        onTap: () => push(const NotificationsScreen()),
                      ),
                    ],
                  ),
                  const SizedBox(height: 18),
                  // Riders and outlets sign up here too, then wait for an administrator's approval.
                  if (app.site.on('signup_enabled')) ...[
                    MenuGroup(
                      title: 'Work with Dellvit',
                      children: [
                        MenuRow(
                          icon: Icons.two_wheeler_rounded,
                          title: 'Ride with Dellvit',
                          subtitle: 'Deliver orders and earn',
                          tone: Tone.green,
                          onTap: () => push(const SignupScreen(kind: 'rider')),
                        ),
                        MenuRow(
                          icon: Icons.storefront_outlined,
                          title: 'Sell on Dellvit',
                          subtitle: 'Put your shop or restaurant online',
                          tone: Tone.blue,
                          onTap: () => push(const SignupScreen(kind: 'outlet')),
                        ),
                      ],
                    ),
                    const SizedBox(height: 18),
                  ],
                ],
                MenuGroup(
                  title: 'Preferences',
                  children: [
                    if (user == null || user.isCustomer)
                      MenuRow(
                        icon: Icons.location_on_outlined,
                        title: 'Delivery area',
                        subtitle: app.area?.name ?? 'Not chosen yet',
                        tone: Tone.brand,
                        onTap: () => showAreaPicker(context),
                      ),
                    MenuRow(
                      icon: context.isDark ? Icons.dark_mode_outlined : Icons.light_mode_outlined,
                      title: 'Appearance',
                      subtitle: switch (app.themeMode) {
                        ThemeMode.dark => 'Dark',
                        ThemeMode.system => 'Same as the phone',
                        _ => 'Light',
                      },
                      tone: Tone.purple,
                      onTap: () => showSheet<void>(context, builder: (_) => const _ThemeSheet()),
                    ),
                    MenuRow(
                      icon: Icons.music_note_outlined,
                      title: 'Start-up sound',
                      subtitle: 'A short sound with the logo when the app opens',
                      tone: Tone.orange,
                      trailing: Switch(value: app.startupSound, onChanged: app.setStartupSound),
                      onTap: () => app.setStartupSound(!app.startupSound),
                    ),
                  ],
                ),
                const SizedBox(height: 18),
                MenuGroup(
                  title: 'Help',
                  children: [
                    MenuRow(
                      icon: Icons.mail_outline_rounded,
                      title: 'Contact us',
                      subtitle: 'Phone, email and a message form',
                      tone: Tone.blue,
                      onTap: () => push(const ContactScreen()),
                    ),
                    MenuRow(
                      icon: Icons.info_outline_rounded,
                      title: 'About Dellvit',
                      tone: Tone.neutral,
                      onTap: () => push(const AboutScreen()),
                    ),
                  ],
                ),
                if (user != null) ...[
                  const SizedBox(height: 18),
                  AppButton(
                    'Log out',
                    outlined: true,
                    danger: true,
                    icon: Icons.logout_rounded,
                    onPressed: () async {
                      final yes = await showConfirm(
                        context,
                        title: 'Log out?',
                        message: 'You will need your password to sign in again.',
                        confirm: 'Log out',
                        cancel: 'Stay signed in',
                        danger: true,
                      );
                      if (yes) await app.logout();
                    },
                  ),
                ],
                const SizedBox(height: 28),
                const Center(child: Opacity(opacity: 0.85, child: DellvitLogo(height: 34, tagline: false))),
                const SizedBox(height: 6),
                Center(
                  child: Text(
                    'Version 1.0.0 · ${Uri.parse(AppConfig.origin).host.replaceFirst(RegExp(r'^www\.'), '')}',
                    textAlign: TextAlign.center,
                    style: context.t.bodySmall,
                  ),
                ),
                const SizedBox(height: 14),
                const Center(child: PoweredBy()),
                const SizedBox(height: 8),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// The top of the account page: who is signed in, or an invitation to sign in.
class _AccountHeader extends StatelessWidget {
  const _AccountHeader({required this.push});
  final void Function(Widget screen) push;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final app = context.watch<AppState>();
    final user = app.user;
    return CurvedHeader(
      bottom: user != null && user.isCustomer ? 62 : 44,
      child: user == null
          ? Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Welcome to Dellvit',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 26,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.6,
                    height: 1.2,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  'Log in to place orders, track deliveries and chat with support.',
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.92),
                    fontSize: 14,
                    fontWeight: FontWeight.w500,
                    height: 1.4,
                  ),
                ),
                const SizedBox(height: 18),
                Row(
                  children: [
                    Expanded(
                      child: FilledButton(
                        style: FilledButton.styleFrom(
                          minimumSize: const Size(0, 52),
                          backgroundColor: Colors.white,
                          foregroundColor: c.brandDark,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                        ),
                        onPressed: () => push(const LoginScreen()),
                        child: const Text('Log in'),
                      ),
                    ),
                    if (app.site.on('signup_enabled')) ...[
                      const SizedBox(width: 10),
                      Expanded(
                        child: OutlinedButton(
                          style: OutlinedButton.styleFrom(
                            minimumSize: const Size(0, 52),
                            backgroundColor: Colors.white.withValues(alpha: 0.12),
                            foregroundColor: Colors.white,
                            side: const BorderSide(color: Colors.white70),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                          ),
                          onPressed: () => push(const SignupScreen()),
                          child: const Text('Sign up'),
                        ),
                      ),
                    ],
                  ],
                ),
              ],
            )
          : Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(3),
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(color: Colors.white.withValues(alpha: 0.6), width: 2),
                  ),
                  child: Container(
                    width: 60,
                    height: 60,
                    alignment: Alignment.center,
                    decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
                    child: Text(
                      user.name.trim().isEmpty ? '?' : user.name.trim()[0].toUpperCase(),
                      style: TextStyle(color: c.brandDark, fontSize: 25, fontWeight: FontWeight.w800, height: 1),
                    ),
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        user.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 20,
                          fontWeight: FontWeight.w800,
                          height: 1.2,
                          letterSpacing: -0.3,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        user.isCustomer ? user.email : (user.loginId.isNotEmpty ? user.loginId : user.email),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: Colors.white.withValues(alpha: 0.9),
                          fontSize: 13,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.22),
                          borderRadius: BorderRadius.circular(99),
                        ),
                        child: Text(
                          user.isRider
                              ? 'Rider'
                              : user.isOutlet
                              ? 'Outlet'
                              : 'Customer',
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 11.5,
                            fontWeight: FontWeight.w800,
                            height: 1.2,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                GlassButton(
                  round: true,
                  tooltip: 'Edit profile',
                  onTap: () => push(const ProfileScreen()),
                  child: const Icon(Icons.edit_outlined),
                ),
              ],
            ),
    );
  }
}

/// A shortcut tile under the account header.
class _Quick extends StatelessWidget {
  const _Quick(this.icon, this.label, this.tone, this.onTap, {this.count = 0});
  final IconData icon;
  final String label;
  final Tone tone;
  final VoidCallback onTap;
  final int count;

  @override
  Widget build(BuildContext context) => AppCard(
    onTap: onTap,
    padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 8),
    child: Column(
      children: [
        Badge(
          isLabelVisible: count > 0,
          label: Text(count > 9 ? '9+' : '$count'),
          backgroundColor: context.c.brand,
          child: IconBubble(icon, tone: tone, size: 42),
        ),
        const SizedBox(height: 8),
        Text(label, style: context.t.labelLarge!.copyWith(fontSize: 13)),
      ],
    ),
  );
}

/// Light, dark or the phone's own setting, each with a small picture of the app in it.
class _ThemeSheet extends StatelessWidget {
  const _ThemeSheet();

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final c = context.c;
    Widget option(ThemeMode mode, String title) {
      final on = app.themeMode == mode;
      return Expanded(
        child: GestureDetector(
          onTap: () => app.setThemeMode(mode),
          child: Column(
            children: [
              AnimatedContainer(
                duration: const Duration(milliseconds: 200),
                height: 118,
                padding: const EdgeInsets.all(3),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(color: on ? c.brand : c.line, width: on ? 2.4 : 1.2),
                ),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(14),
                  child: switch (mode) {
                    ThemeMode.light => const _MiniApp(AppColors.light),
                    ThemeMode.dark => const _MiniApp(AppColors.dark),
                    // Light and dark split on a slant: whichever the phone is set to.
                    _ => Stack(
                      fit: StackFit.expand,
                      children: [
                        const _MiniApp(AppColors.light),
                        ClipPath(clipper: _Slant(), child: const _MiniApp(AppColors.dark)),
                      ],
                    ),
                  },
                ),
              ),
              const SizedBox(height: 10),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(on ? Icons.radio_button_checked_rounded : Icons.radio_button_off_rounded, size: 18, color: on ? c.brand : c.muted),
                  const SizedBox(width: 5),
                  Flexible(child: Text(title, style: context.t.titleSmall, maxLines: 1, overflow: TextOverflow.ellipsis)),
                ],
              ),
            ],
          ),
        ),
      );
    }

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 18),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Appearance', style: context.t.headlineSmall),
            const SizedBox(height: 6),
            Text('Choose how Dellvit looks on this phone.', style: context.t.bodyMedium!.copyWith(color: c.muted)),
            const SizedBox(height: 20),
            Row(
              children: [
                option(ThemeMode.light, 'Light'),
                const SizedBox(width: 10),
                option(ThemeMode.dark, 'Dark'),
                const SizedBox(width: 10),
                option(ThemeMode.system, 'Phone'),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// The dark half of the "Phone" choice: everything right of a slanted line.
class _Slant extends CustomClipper<Path> {
  @override
  Path getClip(Size s) => Path()
    ..moveTo(s.width * 0.62, 0)
    ..lineTo(s.width, 0)
    ..lineTo(s.width, s.height)
    ..lineTo(s.width * 0.38, s.height)
    ..close();

  @override
  bool shouldReclip(_Slant old) => false;
}

/// A tiny drawing of a Dellvit screen in one set of colours. It is drawn at one fixed size and
/// scaled to fill its box, so it fits any phone width without overflowing.
class _MiniApp extends StatelessWidget {
  const _MiniApp(this.c);
  final AppColors c;

  @override
  Widget build(BuildContext context) {
    Widget bar(double w, Color color, [double h = 6]) =>
        Container(width: w, height: h, decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(3)));
    return ColoredBox(
      color: c.bg,
      child: FittedBox(
        fit: BoxFit.cover,
        alignment: Alignment.topCenter,
        child: SizedBox(width: 90, height: 120, child: _drawing(bar)),
      ),
    );
  }

  Widget _drawing(Widget Function(double w, Color color, [double h]) bar) {
    return Container(
      color: c.bg,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            height: 30,
            width: double.infinity,
            decoration: BoxDecoration(gradient: c.gradient),
            padding: const EdgeInsets.fromLTRB(8, 10, 8, 0),
            alignment: Alignment.topLeft,
            child: bar(26, Colors.white.withValues(alpha: 0.85), 5),
          ),
          Padding(
            padding: const EdgeInsets.all(7),
            child: Column(
              children: [
                for (var i = 0; i < 2; i++) ...[
                  Container(
                    height: 30,
                    padding: const EdgeInsets.all(5),
                    decoration: BoxDecoration(
                      color: c.surface,
                      borderRadius: BorderRadius.circular(7),
                      border: Border.all(color: c.line),
                    ),
                    child: Row(
                      children: [
                        Container(width: 18, decoration: BoxDecoration(color: c.brand50, borderRadius: BorderRadius.circular(4))),
                        const SizedBox(width: 5),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [bar(30, c.ink, 4), const SizedBox(height: 4), bar(18, c.muted, 4)],
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 6),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
