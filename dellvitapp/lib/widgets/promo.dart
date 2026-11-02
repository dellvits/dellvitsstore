import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/theme.dart';
import '../models/models.dart';
import '../screens/links.dart';
import '../state/app_state.dart';
import 'common.dart';

/// Colours for the five themes an administrator can give a promotion.
({Color bg, Color fg, Color sub, Gradient? gradient, bool onColour}) _promoColors(BuildContext context, String theme) {
  final c = context.c;
  return switch (theme) {
    'brand' => (bg: c.brand, fg: Colors.white, sub: Colors.white.withValues(alpha: 0.88), gradient: c.gradient, onColour: true),
    'dark' => (
      bg: const Color(0xFF1C1420),
      fg: Colors.white,
      sub: Colors.white.withValues(alpha: 0.78),
      gradient: null,
      onColour: true,
    ),
    'warm' => (bg: c.orange50, fg: c.ink, sub: c.text, gradient: null, onColour: false),
    'soft' => (bg: c.soft, fg: c.ink, sub: c.text, gradient: null, onColour: false),
    _ => (bg: c.surface, fg: c.ink, sub: c.text, gradient: null, onColour: false),
  };
}

/// One home page block or advertisement, drawn for a phone.
class PromoCard extends StatefulWidget {
  const PromoCard(this.promo, {super.key});
  final Promo promo;

  /// Height of the wide designs, so several can share one carousel.
  static const double height = 156;

  @override
  State<PromoCard> createState() => _PromoCardState();
}

class _PromoCardState extends State<PromoCard> {
  @override
  void initState() {
    super.initState();
    if (widget.promo.isAd) context.read<AppState>().trackAdView(widget.promo.id);
  }

  void _open() {
    final p = widget.promo;
    if (p.target.isEmpty) return;
    if (p.isAd) context.read<AppState>().trackAdClick(p.id);
    openLink(context, p.target);
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.promo;
    final c = context.c;
    final slim = p.format == 'strip' || p.format == 'announcement' || (!p.isAd && p.format == 'banner');
    final cover = p.image.isNotEmpty && (p.format == 'cover' || (!p.isAd && p.layout == 'image-background'));
    final colors = _promoColors(context, cover ? 'dark' : p.theme);
    final radius = BorderRadius.circular(20);
    final tappable = p.target.isNotEmpty;

    Widget frame(Widget child, {double? height}) => Material(
      color: Colors.transparent,
      child: Ink(
        height: height,
        decoration: BoxDecoration(
          color: colors.gradient == null ? colors.bg : null,
          gradient: colors.gradient,
          borderRadius: radius,
          border: colors.onColour ? null : Border.all(color: c.line),
        ),
        child: InkWell(borderRadius: radius, onTap: tappable ? _open : null, child: child),
      ),
    );

    if (p.format == 'image' && p.image.isNotEmpty) {
      return GestureDetector(
        onTap: tappable ? _open : null,
        child: NetImage(p.image, height: PromoCard.height, width: double.infinity, radius: 20),
      );
    }

    if (slim) {
      return frame(
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Row(
            children: [
              if (p.image.isNotEmpty)
                NetImage(p.image, width: 40, height: 40, radius: 10)
              else
                Icon(Icons.campaign_rounded, color: colors.fg, size: 22),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      p.title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(color: colors.fg, fontWeight: FontWeight.w700, fontSize: 14, height: 1.3),
                    ),
                    if (p.description.isNotEmpty && p.format != 'strip')
                      Text(
                        p.description,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(color: colors.sub, fontWeight: FontWeight.w500, fontSize: 12.5, height: 1.35),
                      ),
                  ],
                ),
              ),
              if (tappable) Icon(Icons.chevron_right_rounded, color: colors.fg),
            ],
          ),
        ),
      );
    }

    final video = !p.isAd && p.format == 'embed';
    final buttonText = p.button.isNotEmpty
        ? p.button
        : video
        ? 'Watch video'
        : tappable
        ? 'Explore'
        : '';
    final copy = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisAlignment: cover ? MainAxisAlignment.end : MainAxisAlignment.center,
      children: [
        if (p.label.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Text(
              p.label.toUpperCase(),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: colors.onColour ? colors.sub : c.brand,
                fontSize: 10.5,
                fontWeight: FontWeight.w800,
                letterSpacing: 0.9,
                height: 1.2,
              ),
            ),
          ),
        Text(
          p.title,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(color: colors.fg, fontSize: 17, fontWeight: FontWeight.w800, height: 1.2, letterSpacing: -0.3),
        ),
        if (p.description.isNotEmpty) ...[
          const SizedBox(height: 4),
          Text(
            p.description.replaceAll('\n', ' '),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(color: colors.sub, fontSize: 12.5, fontWeight: FontWeight.w500, height: 1.35),
          ),
        ],
        if (buttonText.isNotEmpty && tappable) ...[
          const SizedBox(height: 9),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
            decoration: BoxDecoration(color: colors.onColour ? Colors.white : c.brand, borderRadius: BorderRadius.circular(99)),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (video) ...[
                  Icon(Icons.play_arrow_rounded, size: 16, color: colors.onColour ? const Color(0xFF1C1420) : Colors.white),
                  const SizedBox(width: 2),
                ],
                Flexible(
                  child: Text(
                    buttonText,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: colors.onColour ? const Color(0xFF1C1420) : Colors.white,
                      fontSize: 12.5,
                      fontWeight: FontWeight.w800,
                      height: 1.2,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ],
    );

    if (cover) {
      return ClipRRect(
        borderRadius: radius,
        child: SizedBox(
          height: PromoCard.height,
          child: Stack(
            fit: StackFit.expand,
            children: [
              NetImage(p.image),
              const DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.centerLeft,
                    end: Alignment.centerRight,
                    colors: [Color(0xD91C1420), Color(0x331C1420)],
                  ),
                ),
              ),
              Material(
                color: Colors.transparent,
                child: InkWell(
                  onTap: tappable ? _open : null,
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(16, 16, 80, 16),
                    child: Align(alignment: Alignment.centerLeft, child: copy),
                  ),
                ),
              ),
            ],
          ),
        ),
      );
    }

    return frame(
      height: PromoCard.height,
      Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          children: [
            Expanded(child: copy),
            if (p.image.isNotEmpty) ...[
              const SizedBox(width: 12),
              NetImage(p.image, width: 112, height: PromoCard.height - 28, radius: 14),
            ],
          ],
        ),
      ),
    );
  }
}

/// Everything an administrator placed in one slot of a page: content blocks, then ads. Several
/// wide ones take turns in a carousel.
class PromoSlot extends StatelessWidget {
  const PromoSlot(this.placement, {super.key, this.padding = const EdgeInsets.fromLTRB(16, 18, 16, 0)});
  final String placement;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final areaId = app.area?.id;
    final items = [
      ...app.site.content.where(
        (p) => p.format != 'hero' && p.format != 'announcement' && p.placements.contains(placement) && p.showsIn(areaId),
      ),
      ...app.site.ads.where((p) => p.placements.contains(placement) && p.showsIn(areaId)),
    ];
    if (items.isEmpty) return const SizedBox.shrink();
    bool slim(Promo p) => p.format == 'strip' || (!p.isAd && p.format == 'banner');
    final wide = items.where((p) => !slim(p)).toList();
    final strips = items.where(slim).toList();
    return Padding(
      padding: padding,
      child: Column(
        children: [
          for (final p in strips) Padding(padding: const EdgeInsets.only(bottom: 10), child: PromoCard(p, key: ValueKey(p.id))),
          if (wide.length == 1) PromoCard(wide.first, key: ValueKey(wide.first.id)),
          if (wide.length > 1) _PromoCarousel(wide),
        ],
      ),
    );
  }
}

class _PromoCarousel extends StatefulWidget {
  const _PromoCarousel(this.items);
  final List<Promo> items;

  @override
  State<_PromoCarousel> createState() => _PromoCarouselState();
}

class _PromoCarouselState extends State<_PromoCarousel> {
  final _pages = PageController();
  Timer? _timer;
  int _index = 0;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 6), (_) {
      if (!_pages.hasClients) return;
      _pages.animateToPage(
        (_index + 1) % widget.items.length,
        duration: const Duration(milliseconds: 450),
        curve: Curves.easeOutCubic,
      );
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _pages.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return Column(
      children: [
        SizedBox(
          height: PromoCard.height,
          child: PageView.builder(
            controller: _pages,
            itemCount: widget.items.length,
            onPageChanged: (i) => setState(() => _index = i),
            itemBuilder: (_, i) => PromoCard(widget.items[i], key: ValueKey(widget.items[i].id)),
          ),
        ),
        const SizedBox(height: 8),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            for (var i = 0; i < widget.items.length; i++)
              AnimatedContainer(
                duration: const Duration(milliseconds: 200),
                margin: const EdgeInsets.symmetric(horizontal: 3),
                width: i == _index ? 18 : 6,
                height: 6,
                decoration: BoxDecoration(color: i == _index ? c.brand : c.lineStrong, borderRadius: BorderRadius.circular(9)),
              ),
          ],
        ),
      ],
    );
  }
}
