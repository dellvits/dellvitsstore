import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/theme.dart';

/// The brand-gradient top used by the account page and the workspace dashboards: soft rings in
/// the corner and a curved bottom edge. Cards placed after it can overlap the curve.
class CurvedHeader extends StatelessWidget {
  const CurvedHeader({super.key, required this.child, this.bottom = 44});
  final Widget child;

  /// Space under the content, part of which the curve takes.
  final double bottom;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light.copyWith(statusBarColor: Colors.transparent),
      child: CustomPaint(
        painter: _CurvePainter(c.brand, c.orange),
        child: Padding(
          padding: EdgeInsets.fromLTRB(20, MediaQuery.paddingOf(context).top + 14, 20, bottom),
          child: child,
        ),
      ),
    );
  }
}

class _CurvePainter extends CustomPainter {
  _CurvePainter(this.brand, this.orange);
  final Color brand, orange;

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width, h = size.height;
    final shape = Path()
      ..moveTo(0, 0)
      ..lineTo(w, 0)
      ..lineTo(w, h - 34)
      ..cubicTo(w * 0.72, h + 2, w * 0.3, h - 52, 0, h - 14)
      ..close();
    canvas.save();
    canvas.clipPath(shape);
    canvas.drawRect(
      Offset.zero & size,
      Paint()
        ..shader = LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [const Color(0xFFE21C45), Color.lerp(brand, orange, 0.45)!, orange],
          stops: const [0, 0.62, 1],
        ).createShader(Offset.zero & size),
    );
    final ring = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.4
      ..color = Colors.white.withValues(alpha: 0.12);
    for (var k = 0; k < 4; k++) {
      canvas.drawCircle(Offset(w * 0.95, h * 0.05), 46.0 + k * 34, ring);
    }
    canvas.drawCircle(Offset(w * 0.08, h * 0.9), 80, Paint()..color = Colors.white.withValues(alpha: 0.07));
    canvas.restore();
  }

  @override
  bool shouldRepaint(_CurvePainter old) => old.brand != brand || old.orange != orange;
}

/// A frosted chip or button for use on a [CurvedHeader].
class GlassButton extends StatelessWidget {
  const GlassButton({super.key, required this.child, required this.onTap, this.round = false, this.tooltip});
  final Widget child;
  final VoidCallback onTap;
  final bool round;
  final String? tooltip;

  @override
  Widget build(BuildContext context) {
    final button = Material(
      color: Colors.white.withValues(alpha: 0.18),
      shape: round
          ? const CircleBorder(side: BorderSide(color: Color(0x40FFFFFF)))
          : const StadiumBorder(side: BorderSide(color: Color(0x40FFFFFF))),
      child: InkWell(
        customBorder: round ? const CircleBorder() : const StadiumBorder(),
        onTap: onTap,
        child: Padding(
          padding: round ? const EdgeInsets.all(10) : const EdgeInsets.fromLTRB(12, 7, 12, 7),
          child: IconTheme(data: const IconThemeData(color: Colors.white, size: 20), child: child),
        ),
      ),
    );
    return tooltip == null ? button : Tooltip(message: tooltip, child: button);
  }
}
