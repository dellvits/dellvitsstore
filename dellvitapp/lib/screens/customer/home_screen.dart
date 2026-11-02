import 'dart:math' as math;
import 'dart:ui' show lerpDouble;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../core/resource.dart';
import '../../core/theme.dart';
import '../../models/models.dart';
import '../../state/app_state.dart';
import '../../widgets/area_picker.dart';
import '../../widgets/common.dart';
import '../../widgets/product_widgets.dart';
import '../../widgets/promo.dart';
import '../auth/login_screen.dart';
import '../links.dart';
import '../shared/blog_screens.dart';
import '../shared/notifications_screen.dart';
import 'outlets_screen.dart';

/// What `/home` returns for one delivery area, or for every area when Nation Wide.
class HomeFeed {
  HomeFeed.fromJson(Json j)
    : nearby = asList(j['nearby']).map(Product.fromJson).toList(),
      // Older servers sent no separate deals; they came from the nearby picks.
      deals = asList(j['deals'] ?? j['nearby']).map(Product.fromJson).toList(),
      outlets = asList(j['outlets']).map(Outlet.fromJson).toList(),
      categories = [
        for (final c in asList(j['categories']))
          (
            name: asString(c['name']),
            description: asString(c['description']),
            products: asList(c['products']).map(Product.fromJson).toList(),
          ),
      ];

  final List<Product> nearby;
  final List<Product> deals;
  final List<Outlet> outlets;
  final List<({String name, String description, List<Product> products})> categories;
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  Resource<HomeFeed>? _feed;
  String? _areaId;

  /// Picks the random mix of products. It holds while the app is open, so going back to the
  /// home tab does not reshuffle it; pulling down to refresh brings a new mix.
  String _seed = _newSeed();
  static String _newSeed() => math.Random().nextInt(1 << 32).toRadixString(36);

  /// The feed belongs to one delivery area; a new area means a new feed.
  void _sync(AppState app) {
    final id = app.area?.id;
    if (id == _areaId && (_feed != null || id == null)) return;
    _areaId = id;
    _feed?.dispose();
    _feed = id == null
        ? null
        : (Resource<HomeFeed>(() async => HomeFeed.fromJson(asMap(await app.api.get('/home', query: {'location': id, 'seed': _seed}))))
            ..start());
  }

  @override
  void dispose() {
    _feed?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    _sync(app);
    final c = context.c;
    final top = MediaQuery.paddingOf(context).top;
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light.copyWith(statusBarColor: Colors.transparent),
      child: Scaffold(
        body: RefreshIndicator(
          color: c.brand,
          edgeOffset: top + 80,
          onRefresh: () {
            _seed = _newSeed();
            return Future.wait([app.refreshSession(), if (_feed != null) _feed!.refresh(silent: true)]);
          },
          child: CustomScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            slivers: [
              SliverPersistentHeader(pinned: true, delegate: _HeaderDelegate(top)),
              SliverToBoxAdapter(
                child: _feed == null
                    ? _NoArea(app)
                    : ListenableBuilder(
                        listenable: _feed!,
                        builder: (context, _) => _Body(feed: _feed!),
                      ),
              ),
              const SliverToBoxAdapter(child: SizedBox(height: 28)),
            ],
          ),
        ),
      ),
    );
  }
}

/// The curved gradient top of the home page. As the page scrolls it folds away until only the
/// search bar is left, pinned at the top.
class _HeaderDelegate extends SliverPersistentHeaderDelegate {
  _HeaderDelegate(this.top);
  final double top;

  @override
  double get maxExtent => top + 214;

  @override
  double get minExtent => top + 76;

  @override
  bool shouldRebuild(_HeaderDelegate old) => old.top != top;

  @override
  Widget build(BuildContext context, double shrinkOffset, bool overlapsContent) {
    final t = (shrinkOffset / (maxExtent - minExtent)).clamp(0.0, 1.0);
    return _Header(top: top, fold: t);
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.top, required this.fold});
  final double top;

  /// 0 when fully open, 1 when folded down to the search bar.
  final double fold;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final app = context.watch<AppState>();
    final detecting = app.areaStatus == AreaStatus.detecting;
    final first = app.user?.name.trim().split(' ').first ?? '';
    final area = app.area;
    final fade = (1 - fold * 1.8).clamp(0.0, 1.0);
    return Stack(
      fit: StackFit.expand,
      children: [
        CustomPaint(
          painter: _HeaderPainter(fold: fold, brand: c.brand, orange: c.orange),
        ),
        // Where we deliver, and the inbox or the way in.
        Positioned(
          left: 14,
          right: 12,
          top: top + 10 - fold * 30,
          child: Opacity(
            opacity: fade,
            child: IgnorePointer(
              ignoring: fade < 0.5,
              child: Row(
                children: [
                  Expanded(
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: _Glass(
                        onTap: () => showAreaPicker(context),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              area?.isNationwide == true ? Icons.public_rounded : Icons.location_on_rounded,
                              color: Colors.white,
                              size: 18,
                            ),
                            const SizedBox(width: 8),
                            Flexible(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Text(
                                    'Delivering to',
                                    style: TextStyle(
                                      color: Colors.white.withValues(alpha: 0.8),
                                      fontSize: 10.5,
                                      fontWeight: FontWeight.w600,
                                      height: 1.1,
                                    ),
                                  ),
                                  Text(
                                    detecting ? 'Finding you…' : area?.name ?? 'Choose your area',
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      color: Colors.white,
                                      fontSize: 14,
                                      fontWeight: FontWeight.w800,
                                      height: 1.25,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(width: 2),
                            const Icon(Icons.keyboard_arrow_down_rounded, color: Colors.white, size: 20),
                          ],
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  // Guests get the bell too: Dellvit's announcements reach them without an account.
                  _Glass(
                      round: true,
                      onTap: () =>
                          Navigator.of(context).push(MaterialPageRoute(builder: (_) => const NotificationsScreen())),
                      child: Badge(
                        isLabelVisible: app.unread > 0,
                        label: Text(app.unread > 9 ? '9+' : '${app.unread}'),
                        backgroundColor: Colors.white,
                        textColor: c.brand,
                        child: const Icon(Icons.notifications_none_rounded, color: Colors.white, size: 22),
                      ),
                    ),
                  if (app.user == null) ...[
                    const SizedBox(width: 8),
                    _Glass(
                      onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const LoginScreen())),
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.person_outline_rounded, color: Colors.white, size: 18),
                          SizedBox(width: 6),
                          Text(
                            'Log in',
                            style: TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w800),
                          ),
                        ],
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
        // The greeting.
        Positioned(
          left: 20,
          right: 20,
          top: top + 66 - fold * 40,
          child: Opacity(
            opacity: (1 - fold * 2.2).clamp(0.0, 1.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  first.isEmpty ? 'Hello there,' : 'Hi $first,',
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.88),
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 2),
                // Shrinks on a narrow phone rather than being cut off.
                const FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Text(
                    'What would you like today?',
                    maxLines: 1,
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 23,
                      fontWeight: FontWeight.w800,
                      height: 1.2,
                      letterSpacing: -0.6,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
        // The search bar: half over the curve when open, inside the bar when folded.
        Positioned(
          left: 16,
          right: 16,
          bottom: lerpDouble(4, 12, fold),
          height: 52,
          child: Material(
            color: c.surface,
            borderRadius: BorderRadius.circular(18),
            elevation: 0,
            child: InkWell(
              borderRadius: BorderRadius.circular(18),
              onTap: () => app.goToTab(1),
              child: Container(
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(18),
                  boxShadow: [
                    const BoxShadow(color: Color(0x141C1420), blurRadius: 14, offset: Offset(0, 5)),
                  ],
                ),
                padding: const EdgeInsets.only(left: 16, right: 6),
                child: Row(
                  children: [
                    Icon(Icons.search_rounded, color: c.brand),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'Search food, groceries, outlets…',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: context.t.bodyMedium!.copyWith(color: c.muted),
                      ),
                    ),
                    Container(
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(gradient: c.buttonGradient, borderRadius: BorderRadius.circular(13)),
                      child: const Icon(Icons.tune_rounded, color: Colors.white, size: 20),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// A frosted white chip on the gradient header.
class _Glass extends StatelessWidget {
  const _Glass({required this.child, required this.onTap, this.round = false});
  final Widget child;
  final VoidCallback onTap;
  final bool round;

  @override
  Widget build(BuildContext context) => Material(
    color: Colors.white.withValues(alpha: 0.18),
    shape: round
        ? const CircleBorder(side: BorderSide(color: Color(0x40FFFFFF)))
        : const StadiumBorder(side: BorderSide(color: Color(0x40FFFFFF))),
    child: InkWell(
      customBorder: round ? const CircleBorder() : const StadiumBorder(),
      onTap: onTap,
      child: Padding(padding: round ? const EdgeInsets.all(10) : const EdgeInsets.fromLTRB(12, 7, 10, 7), child: child),
    ),
  );
}

/// The header's gradient with soft rings, ending in a curve that flattens as the header folds.
class _HeaderPainter extends CustomPainter {
  _HeaderPainter({required this.fold, required this.brand, required this.orange});
  final double fold;
  final Color brand, orange;

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    // The gradient stops above the search bar when open and fills the bar when folded.
    final h = size.height - lerpDouble(30, 0, fold)!;
    final dip = 26 * (1 - fold);
    final shape = Path()
      ..moveTo(0, 0)
      ..lineTo(w, 0)
      ..lineTo(w, h - dip)
      ..cubicTo(w * 0.7, h + dip * 0.4, w * 0.3, h - dip * 1.6, 0, h)
      ..close();
    canvas.save();
    canvas.clipPath(shape);
    canvas.drawRect(
      Offset.zero & Size(w, h + dip),
      Paint()
        ..shader = LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [const Color(0xFFE21C45), Color.lerp(brand, orange, 0.45)!, orange],
          stops: const [0, 0.6, 1],
        ).createShader(Offset.zero & Size(w, h + dip)),
    );
    final ring = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.4
      ..color = Colors.white.withValues(alpha: 0.12 * (1 - fold * 0.6));
    for (var k = 0; k < 4; k++) {
      canvas.drawCircle(Offset(w * 0.92, h * 0.1), 40.0 + k * 34, ring);
    }
    canvas.drawCircle(Offset(w * 0.05, h * 0.95), 90, Paint()..color = Colors.white.withValues(alpha: 0.06));
    canvas.restore();
  }

  @override
  bool shouldRepaint(_HeaderPainter old) => old.fold != fold || old.brand != brand || old.orange != orange;
}

class _NoArea extends StatelessWidget {
  const _NoArea(this.app);
  final AppState app;

  @override
  Widget build(BuildContext context) {
    if (app.areaStatus == AreaStatus.detecting || app.areaStatus == AreaStatus.loading) {
      return const Padding(padding: EdgeInsets.only(top: 8), child: SkeletonList(count: 4, height: 110));
    }
    return const Padding(padding: EdgeInsets.only(top: 24), child: ChooseArea());
  }
}

class _Body extends StatelessWidget {
  const _Body({required this.feed});
  final Resource<HomeFeed> feed;

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final site = app.site;
    final area = app.area;
    final data = feed.data;
    final areaId = area?.id;
    final announcements = site.content.where((p) => p.format == 'announcement' && p.showsIn(areaId)).toList();
    Promo? hero;
    for (final p in site.content) {
      if (p.format == 'hero' && p.showsIn(areaId)) {
        hero = p;
        break;
      }
    }
    final shortcuts = site.categories.where((x) => x.showInFilters).toList();
    final deals = (data?.deals ?? []).where((p) => p.discount > 0 && !p.soldOut).toList()
      ..sort((a, b) => b.discount.compareTo(a.discount));
    final everywhere = area?.isNationwide == true;

    // The sections between the hero and the end of the page, in the order set in the admin panel
    // (Homepage content → Arrange sections). Each carries the slot for promotions that follows it.
    final sections = <String, List<Widget>>{
      'trust': [
            if (site.on('show_trust')) ...[
              const SizedBox(height: 18),
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Row(
                  children: [
                    for (final t in const [
                      (Icons.bolt_rounded, 'Fast delivery'),
                      (Icons.verified_user_outlined, 'OTP-secured handover'),
                      (Icons.storefront_outlined, 'Local outlets'),
                      (Icons.headset_mic_outlined, 'Real support'),
                    ])
                      Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: Pill(t.$2, icon: t.$1),
                      ),
                  ],
                ),
              ),
            ],

      ],
      'categories': [
            if (site.on('show_categories') && shortcuts.length > 1) ...[
              SectionHeader(
                'Shop by category',
                eyebrow: 'What are you looking for?',
                action: 'See all',
                onAction: () => app.goToTab(1, category: 'All'),
              ),
              SizedBox(
                height: 108,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  itemCount: shortcuts.length,
                  separatorBuilder: (_, _) => const SizedBox(width: 12),
                  itemBuilder: (_, i) => _CategoryTile(shortcuts[i], index: i),
                ),
              ),
            ],

            const PromoSlot('top'),

      ],
      'nearby': [
            if (site.on('show_nearby')) ...[
              SectionHeader(
                everywhere ? 'Popular across Pakistan' : 'Good things near you',
                eyebrow: everywhere ? 'Nation Wide' : 'Made nearby. Loved locally.',
                action: data != null && data.nearby.isNotEmpty ? 'Explore' : null,
                onAction: () => app.goToTab(1, category: 'All'),
              ),
              if (data == null && feed.error != null)
                ErrorState(feed.error!, onRetry: feed.refresh)
              else if (data == null)
                const _GridSkeleton()
              else if (data.nearby.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: AppCard(
                    child: EmptyState(
                      icon: Icons.storefront_outlined,
                      title: 'Nothing available in ${area?.name ?? 'this area'} yet',
                      message: 'Try another delivery area to discover products.',
                      action: 'Change area',
                      onAction: () => showAreaPicker(context),
                    ),
                  ),
                )
              else
                GridView.builder(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  gridDelegate: productGrid,
                  itemCount: data.nearby.length,
                  itemBuilder: (_, i) => ProductCard(data.nearby[i]),
                ),
            ],

      ],
      'deals': [
            if (site.on('show_nearby') && deals.length >= 3) ...[
              SectionHeader(
                'Deals for you',
                eyebrow: 'Save today',
                action: 'More',
                onAction: () => app.goToTab(1, category: 'All'),
              ),
              ProductRail(deals.take(8).toList()),
            ],

            const PromoSlot('after_nearby'),

      ],
      'category_products': [
            if (site.on('show_category_products') && data != null)
              for (final section in data.categories) ...[
                SectionHeader(
                  section.name,
                  eyebrow: section.description.isEmpty ? 'Category' : section.description,
                  action: 'Explore',
                  onAction: () => app.goToTab(1, category: section.name),
                ),
                ProductRail(section.products),
              ],

            const PromoSlot('after_categories'),

      ],
      'outlets': [
            if (site.on('show_outlets') && data != null && data.outlets.isNotEmpty) ...[
              SectionHeader(
                everywhere ? 'Outlets on Dellvit' : 'Outlets near you',
                eyebrow: 'Shops & kitchens',
                action: 'Explore',
                onAction: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const OutletsScreen())),
              ),
              SizedBox(
                height: 196,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  itemCount: data.outlets.length,
                  separatorBuilder: (_, _) => const SizedBox(width: 12),
                  itemBuilder: (_, i) => OutletCard(data.outlets[i]),
                ),
              ),
            ],

            const PromoSlot('after_outlets'),

      ],
      'blog': [
        if (site.blogOn && site.blog['show_on_home'] != false) BlogHomeSection(count: asInt(site.blog['home_count'], 3)),
      ],
      'how': [
            if (site.on('show_how')) ...[
              const SectionHeader('How Dellvit works', eyebrow: 'Simple as 1-2-3'),
              SizedBox(
                height: 150,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  children: [
                    for (final (i, step) in const [
                      (Icons.location_on_outlined, 'Set your location', 'We show outlets that deliver to you.'),
                      (Icons.shopping_bag_outlined, 'Fill your cart', 'Pay cash on delivery or online.'),
                      (Icons.verified_user_outlined, 'Track & receive', 'Share your code when it arrives.'),
                    ].indexed)
                      Padding(
                        padding: const EdgeInsets.only(right: 12),
                        child: _StepCard(i + 1, step.$1, step.$2, step.$3),
                      ),
                  ],
                ),
              ),
            ],

            const PromoSlot('bottom'),
      ],
    };
    final order = {...asStrings(site.settings['home_sections']).where(sections.containsKey), ...sections.keys};

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (site.notice.isNotEmpty)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
            child: Notice(site.notice, tone: Tone.amber, icon: Icons.campaign_rounded),
          ),
        if (site.checkoutPaused)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
            child: Notice(site.checkoutMessage, tone: Tone.amber, icon: Icons.pause_circle_outline_rounded),
          ),
        for (final a in announcements)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
            child: PromoCard(a, key: ValueKey(a.id)),
          ),
        Padding(padding: const EdgeInsets.fromLTRB(16, 24, 16, 0), child: _Hero(hero)),

        for (final key in order) ...sections[key]!,
      ],
    );
  }
}

/// The headline card: the administrator's hero when there is one, otherwise the brand's own,
/// with the food picture breaking out over its top edge.
class _Hero extends StatelessWidget {
  const _Hero(this.hero);
  final Promo? hero;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final app = context.read<AppState>();
    final title = hero?.title.isNotEmpty == true ? hero!.title : 'Everything you need, delivered fast.';
    final text = hero?.description.isNotEmpty == true
        ? hero!.description
        : 'Meals, groceries and essentials from outlets near you.';
    final button = hero?.button.isNotEmpty == true ? hero!.button : 'Start shopping';
    final label = hero?.label.isNotEmpty == true ? hero!.label : 'Fast local delivery';
    final picture = hero != null && hero!.image.isNotEmpty ? hero!.image : null;
    void open() =>
        hero != null && hero!.link.isNotEmpty ? openLink(context, hero!.link) : app.goToTab(1, category: 'All');
    // The picture takes a share of the width, so the words keep enough room on a narrow phone.
    final art = (MediaQuery.sizeOf(context).width * 0.42).clamp(124.0, 176.0);
    final roomy = MediaQuery.sizeOf(context).width - 32 - art > 180;
    return GestureDetector(
      onTap: open,
      child: SizedBox(
        height: 176,
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            Positioned.fill(
              child: Container(
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(26),
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: context.isDark ? [c.orange50, c.brand100] : const [Color(0xFFFFF1E6), Color(0xFFFFE1E7)],
                  ),
                  boxShadow: [
                    BoxShadow(color: c.brand.withValues(alpha: 0.1), blurRadius: 20, offset: const Offset(0, 8)),
                  ],
                ),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(26),
                  child: CustomPaint(painter: _HeroRings(c.brand, c.orange)),
                ),
              ),
            ),
            // The picture: a cut-out that rises above the card, or the administrator's photo.
            if (picture == null)
              Positioned(
                right: -6,
                bottom: 6,
                width: art,
                height: art * 1.08,
                child: Image.asset(
                  'assets/images/onboarding/food.webp',
                  fit: BoxFit.contain,
                  alignment: Alignment.bottomCenter,
                ),
              )
            else
              Positioned(
                right: 12,
                top: 12,
                bottom: 12,
                width: art - 40,
                child: ClipRRect(borderRadius: BorderRadius.circular(20), child: NetImage(picture)),
              ),
            Positioned(
              left: 18,
              top: 16,
              bottom: 16,
              right: art - 8,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: c.surface.withValues(alpha: 0.85),
                      borderRadius: BorderRadius.circular(99),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.bolt_rounded, size: 13, color: c.brand),
                        const SizedBox(width: 3),
                        Flexible(
                          child: Text(
                            label.toUpperCase(),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              color: c.brandDark,
                              fontSize: 9.5,
                              fontWeight: FontWeight.w800,
                              letterSpacing: 0.7,
                              height: 1.2,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: c.ink,
                      fontSize: 17.5,
                      fontWeight: FontWeight.w800,
                      height: 1.18,
                      letterSpacing: -0.4,
                    ),
                  ),
                  if (roomy) ...[
                    const SizedBox(height: 4),
                    Text(
                      text,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: c.text,
                        fontSize: 11.5,
                        fontWeight: FontWeight.w500,
                        height: 1.35,
                      ),
                    ),
                  ],
                  const SizedBox(height: 10),
                  Container(
                    padding: const EdgeInsets.fromLTRB(13, 8, 10, 8),
                    decoration: BoxDecoration(
                      gradient: c.buttonGradient,
                      borderRadius: BorderRadius.circular(99),
                      boxShadow: [
                        BoxShadow(color: c.brand.withValues(alpha: 0.3), blurRadius: 10, offset: const Offset(0, 4)),
                      ],
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Flexible(
                          child: Text(
                            button,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 12,
                              fontWeight: FontWeight.w800,
                              height: 1.2,
                            ),
                          ),
                        ),
                        const SizedBox(width: 4),
                        const Icon(Icons.arrow_forward_rounded, color: Colors.white, size: 15),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Soft circles behind the hero picture.
class _HeroRings extends CustomPainter {
  _HeroRings(this.brand, this.orange);
  final Color brand, orange;

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width - 80, size.height * 0.62);
    canvas.drawCircle(center, 92, Paint()..color = orange.withValues(alpha: 0.16));
    canvas.drawCircle(center, 64, Paint()..color = brand.withValues(alpha: 0.10));
    final ring = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.2
      ..color = brand.withValues(alpha: 0.12);
    canvas.drawCircle(center, 118, ring);
    for (var k = 0; k < 6; k++) {
      final a = k / 6 * math.pi * 2 + 0.4;
      canvas.drawCircle(
        center + Offset(math.cos(a) * 118, math.sin(a) * 118),
        2.6,
        Paint()..color = orange.withValues(alpha: 0.5),
      );
    }
  }

  @override
  bool shouldRepaint(_HeroRings old) => old.brand != brand || old.orange != orange;
}

/// A category as a soft-coloured rounded tile with its picture.
class _CategoryTile extends StatelessWidget {
  const _CategoryTile(this.category, {required this.index});
  final Category category;
  final int index;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final tints = [c.brand50, c.orange50, c.green50, c.blue50, c.purple50, c.amber50];
    final tint = tints[index % tints.length];
    return GestureDetector(
      onTap: () => context.read<AppState>().goToTab(1, category: category.name),
      child: SizedBox(
        width: 78,
        child: Column(
          children: [
            Container(
              width: 72,
              height: 72,
              padding: const EdgeInsets.all(5),
              decoration: BoxDecoration(color: tint, borderRadius: BorderRadius.circular(24)),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(19),
                child: category.image.isEmpty
                    ? Icon(Icons.shopping_bag_outlined, color: c.brand)
                    : NetImage(category.image, icon: Icons.shopping_bag_outlined),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              category.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: c.ink, fontSize: 12, fontWeight: FontWeight.w700),
            ),
          ],
        ),
      ),
    );
  }
}

/// One step of "How Dellvit works".
class _StepCard extends StatelessWidget {
  const _StepCard(this.number, this.icon, this.title, this.text);
  final int number;
  final IconData icon;
  final String title, text;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return SizedBox(
      width: 200,
      child: AppCard(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(gradient: c.buttonGradient, borderRadius: BorderRadius.circular(13)),
                  child: Icon(icon, color: Colors.white, size: 21),
                ),
                const Spacer(),
                Text(
                  '0$number',
                  style: TextStyle(color: c.lineStrong, fontSize: 26, fontWeight: FontWeight.w800, height: 1),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(title, style: context.t.titleSmall),
            const SizedBox(height: 3),
            Text(text, maxLines: 2, overflow: TextOverflow.ellipsis, style: context.t.bodySmall),
          ],
        ),
      ),
    );
  }
}

class _GridSkeleton extends StatelessWidget {
  const _GridSkeleton();

  @override
  Widget build(BuildContext context) => GridView.builder(
    shrinkWrap: true,
    physics: const NeverScrollableScrollPhysics(),
    padding: const EdgeInsets.symmetric(horizontal: 16),
    gridDelegate: productGrid,
    itemCount: 4,
    itemBuilder: (_, _) => const Skeleton(height: ProductCard.height, radius: 20),
  );
}
