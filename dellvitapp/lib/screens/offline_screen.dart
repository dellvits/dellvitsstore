import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../core/theme.dart';
import '../state/app_state.dart';
import '../widgets/brand.dart';
import '../widgets/common.dart';

/// Shown after the launch screen when the app could not load: no internet, a connection too weak
/// to load, or the server not answering. It keeps trying by itself, so the app opens on its own
/// once the phone is back online.
class OfflineScreen extends StatefulWidget {
  const OfflineScreen({super.key});

  @override
  State<OfflineScreen> createState() => _OfflineScreenState();
}

class _OfflineScreenState extends State<OfflineScreen> with SingleTickerProviderStateMixin {
  late final AnimationController _pulse = AnimationController(vsync: this, duration: const Duration(milliseconds: 2400))
    ..repeat();
  Timer? _timer;
  bool _busy = false;

  /// Seconds until the next automatic try.
  int _next = _every;
  static const _every = 8;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted || _busy) return;
      if (_next <= 1) {
        _retry();
      } else {
        setState(() => _next--);
      }
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _pulse.dispose();
    super.dispose();
  }

  Future<void> _retry({bool tapped = false}) async {
    if (_busy) return;
    if (tapped) HapticFeedback.lightImpact();
    setState(() => _busy = true);
    // When this works the app moves on and this page goes away.
    await context.read<AppState>().load();
    if (mounted) {
      setState(() {
        _busy = false;
        _next = _every;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final app = context.watch<AppState>();
    final offline = app.bootOffline;
    final title = offline ? 'No internet connection' : 'Can’t reach Dellvit';
    final message = offline
        ? (app.bootError?.contains('too slow') == true
              ? 'Your connection is too weak to load Dellvit. Move to a better signal, or connect to Wi-Fi or mobile data.'
              : 'Please connect to Wi-Fi or mobile data. Dellvit will open as soon as you are back online.')
        : (app.bootError ?? 'Dellvit is not answering right now. Please try again in a moment.');
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: context.surfaceBars,
      child: Scaffold(
        backgroundColor: c.surface,
        body: SafeArea(
          child: LayoutBuilder(
            builder: (context, box) => SingleChildScrollView(
              child: ConstrainedBox(
                constraints: BoxConstraints(minHeight: box.maxHeight),
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(28, 20, 28, 20),
                  child: Column(
                    children: [
                      const DellvitLogo(height: 34, tagline: false),
                      const SizedBox(height: 28),
                      SizedBox(
                        width: 220,
                        height: 220,
                        child: AnimatedBuilder(
                          animation: _pulse,
                          builder: (_, _) => CustomPaint(
                            painter: _NoSignalPainter(
                              time: _pulse.value,
                              brand: c.brand,
                              orange: c.orange,
                              disc: [c.brand50, c.brand100],
                              offline: offline,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 26),
                      Text(
                        title,
                        textAlign: TextAlign.center,
                        style: TextStyle(color: c.ink, fontSize: 25, fontWeight: FontWeight.w800, letterSpacing: -0.6, height: 1.2),
                      ),
                      const SizedBox(height: 10),
                      Text(
                        message,
                        textAlign: TextAlign.center,
                        style: context.t.bodyLarge!.copyWith(color: c.muted),
                      ),
                      if (offline) ...[
                        const SizedBox(height: 22),
                        // What usually fixes it, at a glance.
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          alignment: WrapAlignment.center,
                          children: const [
                            Pill('Turn on Wi-Fi', icon: Icons.wifi_rounded),
                            Pill('Turn on mobile data', icon: Icons.signal_cellular_alt_rounded),
                            Pill('Turn off airplane mode', icon: Icons.airplanemode_inactive_rounded),
                          ],
                        ),
                      ],
                      const SizedBox(height: 30),
                      AppButton('Try again', icon: Icons.refresh_rounded, busy: _busy, onPressed: () => _retry(tapped: true)),
                      const SizedBox(height: 14),
                      AnimatedSwitcher(
                        duration: const Duration(milliseconds: 200),
                        child: _busy
                            ? Row(
                                key: const ValueKey('busy'),
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  const BrandSpinner(size: 14, stroke: 2),
                                  const SizedBox(width: 8),
                                  Text('Connecting…', style: context.t.bodySmall),
                                ],
                              )
                            : Text(
                                'Trying again in $_next s',
                                key: const ValueKey('wait'),
                                style: context.t.bodySmall,
                              ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Wi-Fi waves with a slash through them (or a cloud for a server problem), inside soft rings
/// that pulse outwards.
class _NoSignalPainter extends CustomPainter {
  _NoSignalPainter({required this.time, required this.brand, required this.orange, required this.disc, required this.offline});
  final double time;
  final Color brand, orange;
  final List<Color> disc;
  final bool offline;

  @override
  void paint(Canvas canvas, Size size) {
    final c = size.center(Offset.zero);
    final r = size.width / 2;
    // Rings travelling outwards, fading as they grow.
    for (var k = 0; k < 3; k++) {
      final t = (time + k / 3) % 1;
      canvas.drawCircle(
        c,
        r * (0.45 + 0.55 * t),
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2
          ..color = brand.withValues(alpha: 0.22 * (1 - t)),
      );
    }
    // The disc.
    canvas.drawCircle(
      c,
      r * 0.46,
      Paint()
        ..shader = RadialGradient(colors: disc).createShader(Rect.fromCircle(center: c, radius: r * 0.46)),
    );
    final ink = Paint()
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeWidth = r * 0.055
      ..shader = LinearGradient(colors: [brand, orange]).createShader(Rect.fromCircle(center: c, radius: r * 0.3));
    if (offline) {
      // Three waves and a dot, the top wave breathing gently.
      final base = c.translate(0, r * 0.14);
      for (var k = 0; k < 3; k++) {
        final radius = r * (0.1 + k * 0.085);
        final fade = k == 2 ? 0.45 + 0.55 * (0.5 + 0.5 * math.sin(time * math.pi * 2)) : 1.0;
        canvas.drawArc(
          Rect.fromCircle(center: base, radius: radius),
          math.pi * 1.25,
          math.pi * 0.5,
          false,
          ink..color = Colors.black.withValues(alpha: fade),
        );
      }
      canvas.drawCircle(base, r * 0.035, Paint()..color = brand);
      // The slash.
      canvas.drawLine(
        c.translate(-r * 0.24, -r * 0.24),
        c.translate(r * 0.24, r * 0.24),
        Paint()
          ..strokeWidth = r * 0.06
          ..strokeCap = StrokeCap.round
          ..color = disc.first,
      );
      canvas.drawLine(c.translate(-r * 0.24, -r * 0.24), c.translate(r * 0.24, r * 0.24), ink..color = Colors.black);
    } else {
      // A cloud with an exclamation mark, for a server that is not answering.
      final cloud = Path()
        ..addOval(Rect.fromCircle(center: c.translate(-r * 0.12, r * 0.02), radius: r * 0.13))
        ..addOval(Rect.fromCircle(center: c.translate(r * 0.06, -r * 0.06), radius: r * 0.17))
        ..addOval(Rect.fromCircle(center: c.translate(r * 0.2, r * 0.05), radius: r * 0.11))
        ..addRRect(RRect.fromRectAndRadius(
          Rect.fromLTRB(c.dx - r * 0.25, c.dy, c.dx + r * 0.31, c.dy + r * 0.16),
          Radius.circular(r * 0.08),
        ));
      canvas.drawPath(cloud, Paint()..shader = LinearGradient(colors: [brand, orange]).createShader(cloud.getBounds()));
      canvas.drawLine(c.translate(r * 0.03, -r * 0.08), c.translate(r * 0.03, r * 0.04), Paint()
        ..strokeWidth = r * 0.045
        ..strokeCap = StrokeCap.round
        ..color = Colors.white);
      canvas.drawCircle(c.translate(r * 0.03, r * 0.11), r * 0.025, Paint()..color = Colors.white);
    }
  }

  @override
  bool shouldRepaint(_NoSignalPainter old) => old.time != time || old.offline != offline;
}
