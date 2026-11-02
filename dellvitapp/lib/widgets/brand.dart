import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../core/theme.dart';
import 'logo_paths.dart' as logo;

/// Reads the absolute M, L and C path data written by the logo tracer.
Path _parse(String d) {
  final path = Path()..fillType = PathFillType.evenOdd;
  final tokens = RegExp(r'[A-Za-z]|-?\d*\.?\d+').allMatches(d).map((m) => m[0]!).toList();
  var i = 0;
  var cmd = 'M';
  double n() => double.parse(tokens[i++]);
  while (i < tokens.length) {
    final t = tokens[i];
    if (RegExp(r'^[A-Za-z]$').hasMatch(t)) {
      cmd = t.toUpperCase();
      i++;
      if (cmd == 'Z') path.close();
      continue;
    }
    switch (cmd) {
      case 'M':
        path.moveTo(n(), n());
        // Numbers after a move are lines.
        cmd = 'L';
      case 'L':
        path.lineTo(n(), n());
      case 'C':
        path.cubicTo(n(), n(), n(), n(), n(), n());
      default:
        i++;
    }
  }
  return path;
}

Color _hex(String v) => Color(int.parse('FF$v', radix: 16));

/// The logo's shapes, parsed once.
class _Shapes {
  _Shapes._();
  static final instance = _Shapes._();

  final dell = _parse(logo.dellPath);
  final vit = _parse(logo.vitPath);
  final arrow = _parse(logo.arrowPath);
  final leafBig = _parse(logo.leafBigPath);
  final leafSmall = _parse(logo.leafSmallPath);
  final tagline = _parse(logo.taglinePath);

  late final arrowBounds = arrow.getBounds();
  late final leafBigBounds = leafBig.getBounds();
  late final leafSmallBounds = leafSmall.getBounds();
  late final taglineBounds = tagline.getBounds();

  final dellColor = _hex(logo.dellColor);
  final vitColor = _hex(logo.vitColor);
  final arrowColor = _hex(logo.arrowColor);
  final leafBigColor = _hex(logo.leafBigColor);
  final leafSmallColor = _hex(logo.leafSmallColor);
  final taglineColor = _hex(logo.taglineColor);
}

/// The height of the logo box without the tagline: just below the arrow.
const double _markHeight = 915;

/// The Dellvit wordmark, drawn as vector shapes so it is sharp at any size.
///
/// Give it a [reveal] animation running from 0 to 1 to play the intro: the name fades in, the
/// leaves pop up, the arrow draws itself from left to right and the tagline follows.
class DellvitLogo extends StatelessWidget {
  const DellvitLogo({super.key, this.width, this.height, this.tagline = true, this.reveal});

  /// Give one of the two; the other follows from the logo's shape.
  final double? width, height;
  final bool tagline;
  final Animation<double>? reveal;

  @override
  Widget build(BuildContext context) {
    final ratio = logo.logoWidth / (tagline ? logo.logoHeight : _markHeight);
    final w = width ?? (height != null ? height! * ratio : 200);
    return Semantics(
      label: 'Dellvit',
      image: true,
      child: SizedBox(
        width: w,
        height: w / ratio,
        child: RepaintBoundary(
          // The tagline's deep purple would vanish on a dark background.
          child: CustomPaint(painter: _LogoPainter(reveal, tagline, context.isDark ? const Color(0xFFE6D5EA) : null)),
        ),
      ),
    );
  }
}

class _LogoPainter extends CustomPainter {
  _LogoPainter(this.reveal, this.tagline, this.taglineColor) : super(repaint: reveal);
  final Animation<double>? reveal;
  final Color? taglineColor;
  final bool tagline;

  /// How far along [t] is between [a] and [b], eased.
  static double _part(double t, double a, double b, [Curve curve = Curves.easeOutCubic]) =>
      curve.transform(((t - a) / (b - a)).clamp(0.0, 1.0));

  @override
  void paint(Canvas canvas, Size size) {
    final s = _Shapes.instance;
    final t = reveal?.value ?? 1;
    final scale = size.width / logo.logoWidth;
    canvas.save();
    canvas.scale(scale);

    // The name: fades in while settling from slightly smaller and lower.
    final body = _part(t, 0, 0.42);
    if (body > 0) {
      final grow = 0.94 + 0.06 * body;
      canvas.save();
      canvas.translate(logo.logoWidth / 2, _markHeight / 2 + 28 * (1 - body));
      canvas.scale(grow);
      canvas.translate(-logo.logoWidth / 2, -_markHeight / 2);
      final paint = Paint()..isAntiAlias = true;
      canvas.drawPath(s.dell, paint..color = s.dellColor.withValues(alpha: body));
      canvas.drawPath(s.vit, paint..color = s.vitColor.withValues(alpha: body));
      canvas.restore();
    }

    // The leaves grow up from their stems, with a small overshoot.
    _leaf(canvas, s.leafSmall, s.leafSmallBounds, s.leafSmallColor, _part(t, 0.24, 0.6, Curves.easeOutBack),
        s.leafSmallBounds.bottomRight);
    _leaf(canvas, s.leafBig, s.leafBigBounds, s.leafBigColor, _part(t, 0.3, 0.68, Curves.easeOutBack),
        s.leafBigBounds.bottomLeft);

    // The arrow draws itself left to right, with a soft leading edge.
    final draw = _part(t, 0.36, 0.86, Curves.easeInOutCubic);
    if (draw > 0) {
      final b = s.arrowBounds;
      const feather = 120.0;
      final edge = b.left + (b.width + feather) * draw;
      final area = b.inflate(4);
      canvas.saveLayer(area, Paint());
      canvas.drawPath(s.arrow, Paint()..color = s.arrowColor);
      if (draw < 1) {
        canvas.drawRect(
          area,
          Paint()
            ..blendMode = BlendMode.dstIn
            ..shader = LinearGradient(
              colors: const [Colors.black, Colors.transparent],
              stops: const [0, 1],
            ).createShader(Rect.fromLTRB(edge - feather, b.top, edge, b.bottom)),
        );
      }
      canvas.restore();
    }

    // The tagline rises in last.
    if (tagline) {
      final line = _part(t, 0.7, 1);
      if (line > 0) {
        canvas.save();
        canvas.translate(0, 26 * (1 - line));
        canvas.drawPath(s.tagline, Paint()..color = (taglineColor ?? s.taglineColor).withValues(alpha: line));
        canvas.restore();
      }
    }
    canvas.restore();
  }

  void _leaf(Canvas canvas, Path path, Rect bounds, Color color, double grow, Offset stem) {
    if (grow <= 0) return;
    canvas.save();
    canvas.translate(stem.dx, stem.dy);
    canvas.scale(grow);
    canvas.rotate((1 - grow) * -0.35);
    canvas.translate(-stem.dx, -stem.dy);
    canvas.drawPath(path, Paint()..color = color.withValues(alpha: grow.clamp(0, 1)));
    canvas.restore();
  }

  @override
  bool shouldRepaint(_LogoPainter old) =>
      old.reveal != reveal || old.tagline != tagline || old.taglineColor != taglineColor;
}

/// The spinning open ring the website shows while it loads.
class BrandSpinner extends StatefulWidget {
  const BrandSpinner({super.key, this.size = 22, this.stroke = 2.4, this.color});
  final double size, stroke;
  final Color? color;

  @override
  State<BrandSpinner> createState() => _BrandSpinnerState();
}

class _BrandSpinnerState extends State<BrandSpinner> with SingleTickerProviderStateMixin {
  late final AnimationController _spin = AnimationController(vsync: this, duration: const Duration(milliseconds: 900))
    ..repeat();

  @override
  void dispose() {
    _spin.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => RotationTransition(
    turns: _spin,
    child: CustomPaint(
      size: Size.square(widget.size),
      painter: _RingPainter(widget.color ?? context.c.brand, widget.stroke),
    ),
  );
}

class _RingPainter extends CustomPainter {
  _RingPainter(this.color, this.stroke);
  final Color color;
  final double stroke;

  @override
  void paint(Canvas canvas, Size size) {
    final r = Rect.fromLTWH(stroke / 2, stroke / 2, size.width - stroke, size.height - stroke);
    canvas.drawArc(
      r,
      0,
      math.pi * 1.6,
      false,
      Paint()
        ..color = color
        ..style = PaintingStyle.stroke
        ..strokeWidth = stroke
        ..strokeCap = StrokeCap.round,
    );
  }

  @override
  bool shouldRepaint(_RingPainter old) => old.color != color || old.stroke != stroke;
}

/// "Powered By" and the Intelloplex logo, for the bottom of the launch screen.
class PoweredBy extends StatelessWidget {
  const PoweredBy({super.key});

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    crossAxisAlignment: CrossAxisAlignment.center,
    children: [
      Text(
        'Powered By',
        style: TextStyle(color: context.c.muted, fontSize: 11.5, fontWeight: FontWeight.w600, letterSpacing: 0.2),
      ),
      const SizedBox(width: 7),
      Padding(
        // The wordmark's letters sit high in the image; this lines them up with the text.
        padding: const EdgeInsets.only(top: 3),
        child: Image.asset(
          context.isDark ? 'assets/brand/intelloplex_white.png' : 'assets/brand/intelloplex.png',
          height: 15,
          filterQuality: FilterQuality.medium,
          semanticLabel: 'Intelloplex',
        ),
      ),
    ],
  );
}
