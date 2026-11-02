import 'dart:math' as math;
import 'dart:ui' show lerpDouble;

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../state/app_state.dart';
import '../widgets/brand.dart';

/// One introduction page: its picture, words and colours.
class _Page {
  const _Page({
    required this.image,
    required this.scale,
    required this.eyebrow,
    required this.title,
    required this.text,
    required this.accent,
    required this.tint,
    required this.deep,
  });
  final String image;

  /// The picture's width as a share of the screen width.
  final double scale;
  final String eyebrow, title, text;

  /// The page's colour, its palest wash and the blob behind the picture.
  final Color accent, tint, deep;
}

const _pages = [
  _Page(
    image: 'assets/images/onboarding/food.webp',
    scale: 0.7,
    eyebrow: 'A little local. A lot to love.',
    title: 'Food, groceries\nand more',
    text: 'From your favourite meals to everyday essentials, delivered from outlets near you.',
    accent: Color(0xFFE21C45),
    tint: Color(0xFFFFF1F3),
    deep: Color(0xFFFFC9D4),
  ),
  _Page(
    image: 'assets/images/onboarding/groceries.webp',
    scale: 0.72,
    eyebrow: 'Shops you already love',
    title: 'Fresh from\nlocal outlets',
    text: 'Choose your area, fill your cart and pay with cash on delivery or an online transfer.',
    accent: Color(0xFF14966B),
    tint: Color(0xFFEFFAF4),
    deep: Color(0xFFC2EBD5),
  ),
  _Page(
    image: 'assets/images/onboarding/rider.webp',
    scale: 0.9,
    eyebrow: 'Fast and secure',
    title: 'Track it to\nyour door',
    text: 'Follow your rider on the map and hand over safely with your private delivery code.',
    accent: Color(0xFFF58A1F),
    tint: Color(0xFFFFF5EA),
    deep: Color(0xFFFFD6AB),
  ),
];

/// The page's colours part way between two pages, for a swipe in progress.
({Color accent, Color tint, Color deep}) _colorsAt(double page) {
  final i = page.floor().clamp(0, _pages.length - 1);
  final j = (i + 1).clamp(0, _pages.length - 1);
  final f = (page - i).clamp(0.0, 1.0);
  final a = _pages[i], b = _pages[j];
  return (
    accent: Color.lerp(a.accent, b.accent, f)!,
    tint: Color.lerp(a.tint, b.tint, f)!,
    deep: Color.lerp(a.deep, b.deep, f)!,
  );
}

/// Where the white sheet with the words begins, as a share of the screen height.
double _sheetTop(Size size) => size.height * (size.height < 720 ? 0.55 : 0.58);

/// Shown once, on the first launch. The whole screen swipes between pages.
class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> with TickerProviderStateMixin {
  final _controller = PageController();

  /// Drives the gentle floating and morphing that never stops.
  late final AnimationController _ambient = AnimationController(vsync: this, duration: const Duration(seconds: 7))
    ..repeat();

  /// The first appearance of the screen.
  late final AnimationController _enter = AnimationController(vsync: this, duration: const Duration(milliseconds: 1100))
    ..forward();
  int _index = 0;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    for (final p in _pages) {
      precacheImage(AssetImage(p.image), context);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    _ambient.dispose();
    _enter.dispose();
    super.dispose();
  }

  double get _page =>
      _controller.hasClients && _controller.position.haveDimensions ? _controller.page ?? 0 : _index.toDouble();

  void _finish() => context.read<AppState>().finishOnboarding();

  void _next() {
    HapticFeedback.lightImpact();
    if (_index >= _pages.length - 1) {
      _finish();
    } else {
      _controller.nextPage(duration: const Duration(milliseconds: 650), curve: Curves.easeInOutCubic);
    }
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.sizeOf(context);
    final pad = MediaQuery.paddingOf(context);
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.dark.copyWith(
        statusBarColor: Colors.transparent,
        systemNavigationBarColor: Colors.white,
        systemNavigationBarIconBrightness: Brightness.dark,
      ),
      child: Scaffold(
        backgroundColor: Colors.white,
        body: Stack(
          children: [
            // Everything that moves with the swipe is drawn here, under the pager.
            Positioned.fill(
              child: AnimatedBuilder(
                animation: Listenable.merge([_controller, _ambient, _enter]),
                builder: (context, _) {
                  final page = _page;
                  final enter = _enter.value;
                  return Stack(
                    children: [
                      Positioned.fill(
                        child: CustomPaint(
                          painter: _StagePainter(page: page, time: _ambient.value, enter: enter, top: pad.top),
                        ),
                      ),
                      for (var i = 0; i < _pages.length; i++) ..._picture(i, page, size, pad),
                      for (var i = 0; i < _pages.length; i++) _words(i, page, size),
                    ],
                  );
                },
              ),
            ),
            // A see-through pager over the whole screen, so a swipe works anywhere.
            Positioned.fill(
              child: PageView.builder(
                controller: _controller,
                itemCount: _pages.length,
                onPageChanged: (i) {
                  HapticFeedback.selectionClick();
                  setState(() => _index = i);
                },
                itemBuilder: (_, _) => const SizedBox.expand(),
              ),
            ),
            // The controls pass sideways drags on to the pager too.
            Positioned(
              left: 0,
              right: 0,
              top: 0,
              child: _SwipeThrough(
                controller: _controller,
                child: Padding(
                  padding: EdgeInsets.fromLTRB(22, pad.top + 12, 10, 0),
                  child: _TopBar(controller: _controller, enter: _enter, onSkip: _finish),
                ),
              ),
            ),
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: _SwipeThrough(
                controller: _controller,
                child: Padding(
                  padding: EdgeInsets.fromLTRB(28, 12, 24, pad.bottom + 24),
                  child: _BottomBar(controller: _controller, enter: _enter, onNext: _next),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// A page's picture: it floats, and slides, tilts and shrinks away as its page is swiped off.
  List<Widget> _picture(int i, double page, Size size, EdgeInsets pad) {
    final d = i - page;
    if (d.abs() >= 1.2) return const [];
    final p = _pages[i];
    final away = d.abs().clamp(0.0, 1.0);
    final enter = Curves.easeOutBack.transform(Interval(0.15, 0.85).transform(_enter.value));
    final t = _ambient.value * 2 * math.pi;
    final float = math.sin(t + i * 1.3) * 7;
    final width = size.width * p.scale;
    final stageTop = pad.top + 56;
    final centerY = stageTop + (_sheetTop(size) - stageTop) * 0.5;
    final dx = d * size.width * 0.78;
    final scale = (1 - 0.28 * away) * (0.6 + 0.4 * enter);
    final opacity = ((1 - away * 1.15) * Interval(0.1, 0.6).transform(_enter.value)).clamp(0.0, 1.0);
    // The shadow stays on the ground and shrinks while the picture floats up.
    final shadowWidth = width * (0.62 - float * 0.006) * scale;
    return [
      Positioned(
        left: size.width / 2 + dx - shadowWidth / 2,
        top: centerY + width * 0.36 * scale,
        child: Opacity(
          opacity: opacity * 0.9,
          child: Container(
            width: shadowWidth,
            height: 22 * scale,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.all(Radius.elliptical(shadowWidth / 2, 11 * scale)),
              gradient: RadialGradient(
                colors: [p.accent.withValues(alpha: 0.28), p.accent.withValues(alpha: 0)],
              ),
            ),
          ),
        ),
      ),
      Positioned(
        left: size.width / 2 - width / 2,
        top: centerY - width * 0.42,
        width: width,
        child: Opacity(
          opacity: opacity,
          child: Transform(
            alignment: Alignment.center,
            transform: Matrix4.identity()
              ..translateByDouble(dx, float - 6, 0, 1)
              ..rotateZ(d * 0.22 + math.sin(t * 0.5 + i) * 0.015)
              ..scaleByDouble(scale, scale, 1, 1),
            child: Image.asset(p.image, fit: BoxFit.contain, filterQuality: FilterQuality.medium),
          ),
        ),
      ),
    ];
  }

  /// A page's words. The body travels a little faster than the title, so they part as they go.
  Widget _words(int i, double page, Size size) {
    final d = i - page;
    if (d.abs() >= 1) return const SizedBox.shrink();
    final p = _pages[i];
    final enter = Curves.easeOutCubic.transform(Interval(0.35, 1).transform(_enter.value));
    Widget layer(double speed, double fade, Widget child) => Opacity(
      opacity: ((1 - d.abs() * fade) * enter).clamp(0.0, 1.0),
      child: Transform.translate(offset: Offset(d * size.width * speed, 24 * (1 - enter)), child: child),
    );
    return Positioned(
      left: 28,
      right: 28,
      top: _sheetTop(size) + 34,
      bottom: 112 + MediaQuery.paddingOf(context).bottom,
      child: IgnorePointer(
        child: FittedBox(
          fit: BoxFit.scaleDown,
          alignment: Alignment.topLeft,
          child: SizedBox(
            width: size.width - 56,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                layer(
                  0.7,
                  2,
                  Container(
                    padding: const EdgeInsets.fromLTRB(10, 6, 12, 6),
                    decoration: BoxDecoration(color: p.tint, borderRadius: BorderRadius.circular(30)),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Container(
                          width: 7,
                          height: 7,
                          decoration: BoxDecoration(color: p.accent, shape: BoxShape.circle),
                        ),
                        const SizedBox(width: 8),
                        Text(
                          p.eyebrow.toUpperCase(),
                          style: TextStyle(
                            color: Color.lerp(p.accent, Colors.black, 0.25),
                            fontSize: 10.5,
                            fontWeight: FontWeight.w800,
                            letterSpacing: 1.1,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 14),
                layer(
                  1,
                  1.6,
                  Text(
                    p.title,
                    style: const TextStyle(
                      color: Color(0xFF1C1420),
                      fontSize: 31,
                      fontWeight: FontWeight.w800,
                      height: 1.12,
                      letterSpacing: -0.8,
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                layer(
                  1.3,
                  1.8,
                  Text(
                    p.text,
                    style: const TextStyle(color: Color(0xFF7B7382), fontSize: 15, fontWeight: FontWeight.w500, height: 1.5),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Lets a sideways drag that starts on a button still swipe the pages.
class _SwipeThrough extends StatefulWidget {
  const _SwipeThrough({required this.controller, required this.child});
  final PageController controller;
  final Widget child;

  @override
  State<_SwipeThrough> createState() => _SwipeThroughState();
}

class _SwipeThroughState extends State<_SwipeThrough> {
  Drag? _drag;

  @override
  Widget build(BuildContext context) => GestureDetector(
    behavior: HitTestBehavior.translucent,
    dragStartBehavior: DragStartBehavior.down,
    onHorizontalDragStart: (d) {
      if (widget.controller.hasClients) _drag = widget.controller.position.drag(d, () => _drag = null);
    },
    onHorizontalDragUpdate: (d) => _drag?.update(d),
    onHorizontalDragEnd: (d) => _drag?.end(d),
    onHorizontalDragCancel: () => _drag?.cancel(),
    child: widget.child,
  );
}

class _TopBar extends StatelessWidget {
  const _TopBar({required this.controller, required this.enter, required this.onSkip});
  final PageController controller;
  final Animation<double> enter;
  final VoidCallback onSkip;

  @override
  Widget build(BuildContext context) => FadeTransition(
    opacity: CurvedAnimation(parent: enter, curve: const Interval(0.3, 0.9)),
    child: Row(
      children: [
        const DellvitLogo(height: 30, tagline: false),
        const Spacer(),
        AnimatedBuilder(
          animation: controller,
          builder: (context, _) {
            final page = controller.hasClients && controller.position.haveDimensions ? controller.page ?? 0 : 0.0;
            // Fades away on the way to the last page, where the main button finishes instead.
            final shown = (_pages.length - 1 - page).clamp(0.0, 1.0);
            return IgnorePointer(
              ignoring: shown < 0.5,
              child: Opacity(
                opacity: shown,
                child: TextButton(
                  onPressed: onSkip,
                  style: TextButton.styleFrom(
                    foregroundColor: const Color(0xFF3A3240),
                    backgroundColor: Colors.white.withValues(alpha: 0.7),
                    shape: const StadiumBorder(),
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                  ),
                  child: const Text('Skip'),
                ),
              ),
            );
          },
        ),
      ],
    ),
  );
}

/// The page dots on the left and the round next button on the right, which grows into
/// "Get started" on the last page.
class _BottomBar extends StatelessWidget {
  const _BottomBar({required this.controller, required this.enter, required this.onNext});
  final PageController controller;
  final Animation<double> enter;
  final VoidCallback onNext;

  @override
  Widget build(BuildContext context) => FadeTransition(
    opacity: CurvedAnimation(parent: enter, curve: const Interval(0.5, 1)),
    child: AnimatedBuilder(
      animation: controller,
      builder: (context, _) {
        final page = controller.hasClients && controller.position.haveDimensions ? controller.page ?? 0 : 0.0;
        final colors = _colorsAt(page);
        // 0 until the swipe towards the last page begins, 1 on it.
        final last = (page - (_pages.length - 2)).clamp(0.0, 1.0);
        final width = lerpDouble(64, 178, Curves.easeInOut.transform(last))!;
        return Row(
          children: [
            CustomPaint(
              size: Size(18.0 * (_pages.length - 1) + 8, 8),
              painter: _DotsPainter(page: page, color: colors.accent),
            ),
            const Spacer(),
            Semantics(
              button: true,
              label: last > 0.5 ? 'Get started' : 'Next',
              child: GestureDetector(
                onTap: onNext,
                child: SizedBox(
                  width: width + 12,
                  height: 76,
                  child: CustomPaint(
                    painter: _ButtonPainter(
                      progress: (page + 1) / _pages.length,
                      last: last,
                      color: colors.accent,
                    ),
                    child: Center(
                      child: Stack(
                        alignment: Alignment.center,
                        children: [
                          Opacity(
                            opacity: 1 - last,
                            child: const Icon(Icons.arrow_forward_rounded, color: Colors.white, size: 26),
                          ),
                          Opacity(
                            opacity: last,
                            child: const Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(
                                  'Get started',
                                  maxLines: 1,
                                  style: TextStyle(color: Colors.white, fontSize: 15.5, fontWeight: FontWeight.w800),
                                ),
                                SizedBox(width: 8),
                                Icon(Icons.arrow_forward_rounded, color: Colors.white, size: 20),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
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

/// Page dots with a "worm" that stretches from one dot to the next as the page is swiped.
class _DotsPainter extends CustomPainter {
  _DotsPainter({required this.page, required this.color});
  final double page;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    const gap = 18.0, r = 4.0;
    final y = size.height / 2;
    final dot = Paint()..color = const Color(0xFFDDD4D9);
    for (var i = 0; i < _pages.length; i++) {
      canvas.drawCircle(Offset(r + i * gap, y), r, dot);
    }
    final i = page.floor().clamp(0, _pages.length - 1);
    final f = (page - i).clamp(0.0, 1.0);
    // The front runs ahead in the first half of the swipe; the back catches up in the second.
    final front = r + i * gap + gap * Curves.easeOut.transform((f * 2).clamp(0.0, 1.0));
    final back = r + i * gap + gap * Curves.easeIn.transform((f * 2 - 1).clamp(0.0, 1.0));
    canvas.drawRRect(
      RRect.fromLTRBR(back - r - 4, y - r, (i == _pages.length - 1 ? back : front) + r + 4, y + r, const Radius.circular(r)),
      Paint()..color = color,
    );
  }

  @override
  bool shouldRepaint(_DotsPainter old) => old.page != page || old.color != color;
}

/// The next button: a filled circle in the page colour with a ring around it showing how far
/// through the introduction the person is. On the last page it becomes a wide pill.
class _ButtonPainter extends CustomPainter {
  _ButtonPainter({required this.progress, required this.last, required this.color});
  final double progress, last;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final c = size.center(Offset.zero);
    const h = 64.0;
    final w = size.width - 12;
    final body = RRect.fromRectAndRadius(Rect.fromCenter(center: c, width: w, height: h - 8 * last), const Radius.circular(40));
    canvas.drawRRect(
      body.shift(const Offset(0, 6)),
      Paint()
        ..color = color.withValues(alpha: 0.35)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 12),
    );
    canvas.drawRRect(
      body,
      Paint()
        ..shader = LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color.lerp(color, Colors.white, 0.12)!, Color.lerp(color, Colors.black, 0.12)!],
        ).createShader(body.outerRect),
    );
    // The progress ring fades out as the button stretches.
    if (last < 1) {
      final ring = Rect.fromCircle(center: c, radius: h / 2 + 5);
      final track = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2.6
        ..strokeCap = StrokeCap.round
        ..color = color.withValues(alpha: 0.16 * (1 - last));
      canvas.drawArc(ring, 0, math.pi * 2, false, track);
      canvas.drawArc(
        ring,
        -math.pi / 2,
        math.pi * 2 * progress.clamp(0.0, 1.0),
        false,
        track..color = color.withValues(alpha: 1 - last),
      );
    }
  }

  @override
  bool shouldRepaint(_ButtonPainter old) => old.progress != progress || old.last != last || old.color != color;
}

/// The moving backdrop: a soft colour wash, sweeping curves, a living blob behind the picture with
/// orbit rings and sparkles, and the white sheet whose wavy top edge ripples during a swipe.
class _StagePainter extends CustomPainter {
  _StagePainter({required this.page, required this.time, required this.enter, required this.top});
  final double page, time, enter, top;

  @override
  void paint(Canvas canvas, Size size) {
    final colors = _colorsAt(page);
    final w = size.width;
    final sheet = _sheetTop(size);
    final t = time * 2 * math.pi;
    // How far a swipe is between pages: 0 at rest, 1 half way.
    final swipe = math.sin((page - page.floorToDouble()) * math.pi).abs();

    // The wash.
    canvas.drawRect(
      Offset.zero & size,
      Paint()
        ..shader = LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [colors.tint, Color.lerp(colors.tint, colors.deep, 0.35)!],
        ).createShader(Rect.fromLTWH(0, 0, w, sheet + 40)),
    );

    // Sweeping curves across the top, drifting sideways with the swipe.
    final drift = -page * w * 0.18;
    for (var k = 0; k < 3; k++) {
      final y = top + 70 + k * 46.0;
      final path = Path()
        ..moveTo(-w * 0.2 + drift, y + 60)
        ..cubicTo(w * 0.2 + drift, y - 50 + math.sin(t + k) * 14, w * 0.6 + drift, y + 120, w * 1.3 + drift, y - 10);
      canvas.drawPath(
        path,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.4
          ..color = colors.accent.withValues(alpha: 0.10 - k * 0.025),
      );
    }

    final stageTop = top + 56;
    final center = Offset(w / 2 - (page - page.roundToDouble()) * w * 0.12, stageTop + (sheet - stageTop) * 0.5);
    final grow = Curves.easeOutBack.transform(enter.clamp(0.0, 1.0));
    final radius = math.min(w * 0.4, (sheet - stageTop) * 0.46) * (0.55 + 0.45 * grow);

    // A large faint blob, then the main one. Both breathe; a swipe stretches them sideways.
    _blob(canvas, center.translate(0, 6), radius * 1.22, t * 0.6 + 2, page, swipe,
        Paint()..color = colors.deep.withValues(alpha: 0.35));
    _blob(
      canvas,
      center,
      radius,
      t,
      page,
      swipe,
      Paint()
        ..shader = RadialGradient(
          center: const Alignment(-0.3, -0.4),
          radius: 1,
          colors: [Color.lerp(colors.deep, Colors.white, 0.35)!, colors.deep],
        ).createShader(Rect.fromCircle(center: center, radius: radius * 1.2)),
    );

    // Orbit rings, tilted, each with a small planet travelling round.
    for (var k = 0; k < 2; k++) {
      final rx = radius * (1.42 + k * 0.2), ry = radius * (0.5 + k * 0.1);
      canvas.save();
      canvas.translate(center.dx, center.dy + radius * 0.1);
      canvas.rotate(-0.32 + k * 0.5 + page * 0.25);
      final ring = Rect.fromCenter(center: Offset.zero, width: rx * 2, height: ry * 2);
      _dashedOval(canvas, ring, Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.3
        ..color = colors.accent.withValues(alpha: 0.22 * grow));
      final a = t * (k == 0 ? 1 : -0.7) + k * 2;
      canvas.drawCircle(
        Offset(math.cos(a) * rx, math.sin(a) * ry),
        k == 0 ? 5 : 3.5,
        Paint()..color = colors.accent.withValues(alpha: 0.85 * grow),
      );
      canvas.restore();
    }

    // Sparkles that twinkle in turn.
    const spots = [Offset(-1.25, -0.85), Offset(1.15, -0.6), Offset(-1.05, 0.55), Offset(1.3, 0.75), Offset(0.15, -1.25)];
    for (var k = 0; k < spots.length; k++) {
      final glow = (math.sin(t * 2 + k * 1.7) + 1) / 2;
      _sparkle(
        canvas,
        center + Offset(spots[k].dx * radius, spots[k].dy * radius),
        (4 + glow * 4) * grow,
        colors.accent.withValues(alpha: (0.25 + glow * 0.5) * grow),
      );
    }

    // The sheet. Its top edge is a wave that swells and rolls while swiping.
    final amp = 18 + 34 * swipe;
    final phase = page * math.pi;
    final edge = Path()
      ..moveTo(0, sheet + 10 + math.sin(phase) * 10)
      ..cubicTo(
        w * 0.3,
        sheet - amp + math.cos(phase) * 8,
        w * 0.62,
        sheet + amp * 0.9 - math.sin(phase) * 8,
        w,
        sheet - 6 + math.cos(phase) * 10,
      )
      ..lineTo(w, size.height)
      ..lineTo(0, size.height)
      ..close();
    canvas.drawShadow(edge, colors.accent.withValues(alpha: 0.5), 10, false);
    canvas.drawPath(edge, Paint()..color = Colors.white);
  }

  /// A smooth closed blob through points around [c], each breathing at its own pace.
  void _blob(Canvas canvas, Offset c, double r, double t, double page, double swipe, Paint paint) {
    const n = 7;
    final points = <Offset>[];
    for (var k = 0; k < n; k++) {
      final a = k / n * math.pi * 2 + page * 0.9;
      final wobble = 1 + 0.07 * math.sin(t + k * 1.9) + 0.045 * math.sin(t * 2 + k * 0.7 + page * 2);
      points.add(c + Offset(math.cos(a) * r * wobble * (1 + 0.16 * swipe), math.sin(a) * r * wobble * (1 - 0.08 * swipe)));
    }
    // Catmull-Rom through the points, written as cubic curves.
    final path = Path()..moveTo(points[0].dx, points[0].dy);
    for (var k = 0; k < n; k++) {
      final p0 = points[(k - 1 + n) % n], p1 = points[k], p2 = points[(k + 1) % n], p3 = points[(k + 2) % n];
      final c1 = p1 + (p2 - p0) / 6, c2 = p2 - (p3 - p1) / 6;
      path.cubicTo(c1.dx, c1.dy, c2.dx, c2.dy, p2.dx, p2.dy);
    }
    canvas.drawPath(path..close(), paint);
  }

  void _dashedOval(Canvas canvas, Rect r, Paint paint) {
    const dashes = 46;
    for (var k = 0; k < dashes; k++) {
      canvas.drawArc(r, k / dashes * math.pi * 2, math.pi * 2 / dashes * 0.55, false, paint);
    }
  }

  /// A four-pointed star.
  void _sparkle(Canvas canvas, Offset c, double s, Color color) {
    if (s <= 0) return;
    final p = Path()
      ..moveTo(c.dx, c.dy - s)
      ..quadraticBezierTo(c.dx, c.dy, c.dx + s, c.dy)
      ..quadraticBezierTo(c.dx, c.dy, c.dx, c.dy + s)
      ..quadraticBezierTo(c.dx, c.dy, c.dx - s, c.dy)
      ..quadraticBezierTo(c.dx, c.dy, c.dx, c.dy - s)
      ..close();
    canvas.drawPath(p, Paint()..color = color);
  }

  @override
  bool shouldRepaint(_StagePainter old) =>
      old.page != page || old.time != time || old.enter != enter || old.top != top;
}
