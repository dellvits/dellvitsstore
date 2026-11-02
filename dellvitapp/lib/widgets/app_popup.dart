import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../core/theme.dart';
import '../models/models.dart';
import '../state/app_state.dart';
import 'common.dart';
import 'product_widgets.dart';

/// Shows the pop-up an administrator set up for when the app opens: a headline and a row of
/// products the shopper can add straight to the cart.
Future<void> showAppPopup(BuildContext context, Json popup) {
  HapticFeedback.lightImpact();
  return showGeneralDialog<void>(
    context: context,
    barrierDismissible: true,
    barrierLabel: 'Close',
    barrierColor: Colors.black.withValues(alpha: 0.5),
    transitionDuration: const Duration(milliseconds: 520),
    pageBuilder: (_, _, _) => _AppPopup(popup),
    transitionBuilder: (_, a, _, child) {
      final rise = CurvedAnimation(parent: a, curve: Curves.easeOutBack, reverseCurve: Curves.easeInCubic);
      return FadeTransition(
        opacity: CurvedAnimation(parent: a, curve: Curves.easeOut),
        child: SlideTransition(
          position: Tween(begin: const Offset(0, 0.18), end: Offset.zero).animate(rise),
          child: ScaleTransition(scale: Tween(begin: 0.92, end: 1.0).animate(rise), child: child),
        ),
      );
    },
  );
}

class _AppPopup extends StatefulWidget {
  const _AppPopup(this.data);
  final Json data;

  @override
  State<_AppPopup> createState() => _AppPopupState();
}

class _AppPopupState extends State<_AppPopup> with SingleTickerProviderStateMixin {
  late final List<Product> _products = asList(widget.data['products']).map(Product.fromJson).toList();
  late final AnimationController _cards = AnimationController(vsync: this, duration: const Duration(milliseconds: 900));

  @override
  void initState() {
    super.initState();
    Future<void>.delayed(const Duration(milliseconds: 220), () {
      if (mounted) _cards.forward();
    });
  }

  @override
  void dispose() {
    _cards.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final title = asString(widget.data['title']);
    final message = asString(widget.data['message']);
    final image = asString(widget.data['image']);
    final size = MediaQuery.sizeOf(context);
    final cardWidth = math.min(size.width * 0.42, 172.0);
    return SafeArea(
      child: Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 18),
          child: Material(
            color: c.surface,
            borderRadius: BorderRadius.circular(30),
            clipBehavior: Clip.antiAlias,
            elevation: 0,
            child: ConstrainedBox(
              constraints: BoxConstraints(maxWidth: 460, maxHeight: size.height * 0.86),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Stack(
                    children: [
                      SizedBox(
                        height: image.isEmpty ? 120 : 150,
                        width: double.infinity,
                        child: image.isEmpty ? CustomPaint(painter: _GiftHeader(c.brand, c.orange)) : NetImage(image),
                      ),
                      Positioned(
                        right: 12,
                        top: 12,
                        child: Material(
                          color: c.surface,
                          shape: const CircleBorder(),
                          child: InkWell(
                            customBorder: const CircleBorder(),
                            onTap: () => Navigator.of(context).pop(),
                            child: Padding(
                              padding: const EdgeInsets.all(7),
                              child: Icon(Icons.close_rounded, size: 20, color: c.ink, semanticLabel: 'Close'),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(22, 18, 22, 4),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if (title.isNotEmpty)
                          Text(title, style: TextStyle(color: c.ink, fontSize: 22, fontWeight: FontWeight.w800, letterSpacing: -0.5, height: 1.2)),
                        if (message.isNotEmpty) ...[
                          const SizedBox(height: 6),
                          Text(message, style: context.t.bodyMedium!.copyWith(color: c.muted)),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    height: ProductCard.height - 6,
                    child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      padding: const EdgeInsets.symmetric(horizontal: 22),
                      itemCount: _products.length,
                      separatorBuilder: (_, _) => const SizedBox(width: 12),
                      itemBuilder: (context, i) {
                        // Each card slides in a moment after the one before it.
                        final start = (i * 0.12).clamp(0.0, 0.6);
                        final a = CurvedAnimation(parent: _cards, curve: Interval(start, start + 0.4, curve: Curves.easeOutCubic));
                        return FadeTransition(
                          opacity: a,
                          child: SlideTransition(
                            position: Tween(begin: const Offset(0.35, 0), end: Offset.zero).animate(a),
                            child: SizedBox(width: cardWidth, child: ProductCard(_products[i])),
                          ),
                        );
                      },
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(22, 16, 22, 20),
                    child: Row(
                      children: [
                        Expanded(
                          child: AppButton(
                            'Maybe later',
                            outlined: true,
                            onPressed: () => Navigator.of(context).pop(),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: AppButton(
                            'Shop now',
                            icon: Icons.shopping_bag_outlined,
                            onPressed: () {
                              final app = context.read<AppState>();
                              Navigator.of(context).pop();
                              // A cart with something in it is the natural next step.
                              app.goToTab(app.cartCount > 0 ? 2 : 1);
                            },
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The header when the pop-up has no picture: a warm gradient, confetti dots and a gift.
class _GiftHeader extends CustomPainter {
  _GiftHeader(this.brand, this.orange);
  final Color brand, orange;

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width, h = size.height;
    canvas.drawRect(
      Offset.zero & size,
      Paint()
        ..shader = LinearGradient(colors: [brand, orange], begin: Alignment.topLeft, end: Alignment.bottomRight)
            .createShader(Offset.zero & size),
    );
    final ring = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.4
      ..color = Colors.white.withValues(alpha: 0.18);
    for (var k = 0; k < 4; k++) {
      canvas.drawCircle(Offset(w * 0.85, h * 0.1), 30.0 + k * 26, ring);
    }
    final rnd = math.Random(7);
    for (var k = 0; k < 18; k++) {
      canvas.drawCircle(
        Offset(rnd.nextDouble() * w, rnd.nextDouble() * h),
        1.5 + rnd.nextDouble() * 2.5,
        Paint()..color = Colors.white.withValues(alpha: 0.25 + rnd.nextDouble() * 0.35),
      );
    }
    final icon = Icons.redeem_rounded;
    final text = TextPainter(
      text: TextSpan(
        text: String.fromCharCode(icon.codePoint),
        style: TextStyle(fontSize: 54, fontFamily: icon.fontFamily, package: icon.fontPackage, color: Colors.white),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    text.paint(canvas, Offset(24, h / 2 - text.height / 2));
  }

  @override
  bool shouldRepaint(_GiftHeader old) => old.brand != brand || old.orange != orange;
}
