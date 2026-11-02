import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/theme.dart';
import '../../widgets/brand.dart';

/// The frame every sign-in screen shares: a curved brand header with the Dellvit logo, then a
/// white sheet with the headline and the form. The header folds away while the keyboard is open.
class AuthFrame extends StatefulWidget {
  const AuthFrame({
    super.key,
    required this.title,
    required this.subtitle,
    required this.children,
    this.step,
    this.steps,
    this.footer,
    this.icon,
  });
  final String title, subtitle;
  final List<Widget> children;

  /// For a flow in steps: which one this is (from 1) and how many there are.
  final int? step, steps;

  /// Kept at the bottom of the screen, e.g. a link to the other sign-in screen.
  final Widget? footer;

  /// Shown in a bubble above the headline instead of nothing, e.g. a mail icon on a code screen.
  final IconData? icon;

  @override
  State<AuthFrame> createState() => _AuthFrameState();
}

class _AuthFrameState extends State<AuthFrame> with TickerProviderStateMixin {
  late final AnimationController _enter = AnimationController(vsync: this, duration: const Duration(milliseconds: 750))
    ..forward();
  late final AnimationController _ambient = AnimationController(vsync: this, duration: const Duration(seconds: 9))
    ..repeat();

  @override
  void dispose() {
    _enter.dispose();
    _ambient.dispose();
    super.dispose();
  }

  /// Fades and lifts the [i]th item in, a little after the one before it.
  Widget _stagger(int i, Widget child) {
    final start = (0.12 + i * 0.07).clamp(0.0, 0.7);
    final a = CurvedAnimation(parent: _enter, curve: Interval(start, (start + 0.45).clamp(0, 1), curve: Curves.easeOutCubic));
    return FadeTransition(
      opacity: a,
      child: SlideTransition(position: Tween(begin: const Offset(0, 0.18), end: Offset.zero).animate(a), child: child),
    );
  }

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final media = MediaQuery.of(context);
    final typing = media.viewInsets.bottom > 0;
    final canPop = Navigator.of(context).canPop();
    final header = (typing ? 128.0 : media.size.height * 0.3).clamp(128.0, 270.0) + media.padding.top;
    final theme = Theme.of(context);
    InputBorder border(Color color, [double width = 0]) => OutlineInputBorder(
      borderRadius: BorderRadius.circular(16),
      borderSide: width == 0 ? BorderSide.none : BorderSide(color: color, width: width),
    );
    // Filled, borderless fields with a coloured outline only while typing: the app look.
    final fields = theme.copyWith(
      inputDecorationTheme: theme.inputDecorationTheme.copyWith(
        filled: true,
        fillColor: c.soft,
        contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 18),
        border: border(c.soft),
        enabledBorder: border(c.soft),
        disabledBorder: border(c.soft),
        focusedBorder: border(c.brand, 1.6),
        errorBorder: border(c.brand, 1.2),
        focusedErrorBorder: border(c.brand, 1.6),
      ),
    );
    var i = 0;
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: context.surfaceBars,
      child: Scaffold(
        backgroundColor: c.surface,
        body: Column(
          children: [
            AnimatedContainer(
              duration: const Duration(milliseconds: 320),
              curve: Curves.easeOutCubic,
              height: header,
              child: Stack(
                children: [
                  Positioned.fill(
                    child: AnimatedBuilder(
                      animation: _ambient,
                      builder: (_, _) => CustomPaint(painter: _HeaderPainter(time: _ambient.value, colors: c)),
                    ),
                  ),
                  Positioned.fill(
                    top: media.padding.top,
                    bottom: 34,
                    child: Center(
                      child: AnimatedSwitcher(
                        duration: const Duration(milliseconds: 260),
                        child: typing
                            ? const DellvitLogo(key: ValueKey('small'), height: 40, tagline: false)
                            : DellvitLogo(
                                key: const ValueKey('big'),
                                width: math.min(media.size.width * 0.5, 210),
                                reveal: _enter,
                              ),
                      ),
                    ),
                  ),
                  if (canPop)
                    Positioned(
                      left: 14,
                      top: media.padding.top + 8,
                      child: _RoundButton(
                        icon: Icons.arrow_back_rounded,
                        tooltip: 'Back',
                        onTap: () => Navigator.of(context).maybePop(),
                      ),
                    ),
                ],
              ),
            ),
            Expanded(
              child: Theme(
                data: fields,
                child: ListView(
                  keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                  padding: EdgeInsets.fromLTRB(24, 4, 24, 24 + (widget.footer == null ? media.padding.bottom : 0)),
                  children: [
                    if (widget.steps != null)
                      _stagger(i++, Padding(padding: const EdgeInsets.only(bottom: 18), child: _Steps(widget.step!, widget.steps!))),
                    if (widget.icon != null)
                      _stagger(
                        i++,
                        Align(
                          alignment: Alignment.centerLeft,
                          child: Container(
                            margin: const EdgeInsets.only(bottom: 16),
                            width: 54,
                            height: 54,
                            decoration: BoxDecoration(color: c.brand50, borderRadius: BorderRadius.circular(18)),
                            child: Icon(widget.icon, color: c.brand, size: 26),
                          ),
                        ),
                      ),
                    _stagger(
                      i++,
                      Text(
                        widget.title,
                        style: TextStyle(color: c.ink, fontSize: 27, fontWeight: FontWeight.w800, letterSpacing: -0.7, height: 1.15),
                      ),
                    ),
                    const SizedBox(height: 8),
                    _stagger(i++, Text(widget.subtitle, style: context.t.bodyLarge!.copyWith(color: c.muted))),
                    const SizedBox(height: 26),
                    for (final child in widget.children) _stagger(i++, child),
                  ],
                ),
              ),
            ),
            if (widget.footer != null)
              SafeArea(
                top: false,
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.fromLTRB(24, 10, 24, 12),
                  decoration: BoxDecoration(border: Border(top: BorderSide(color: c.line))),
                  child: widget.footer,
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// A white circle with an icon, floating on the header.
class _RoundButton extends StatelessWidget {
  const _RoundButton({required this.icon, required this.onTap, required this.tooltip});
  final IconData icon;
  final VoidCallback onTap;
  final String tooltip;

  @override
  Widget build(BuildContext context) => Tooltip(
    message: tooltip,
    child: Material(
      color: context.c.surface,
      shape: const CircleBorder(),
      elevation: 0,
      shadowColor: Colors.transparent,
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onTap,
        child: Container(
          width: 42,
          height: 42,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            boxShadow: [BoxShadow(color: context.c.shadow, blurRadius: 14, offset: const Offset(0, 4))],
          ),
          child: Icon(icon, size: 22, color: context.c.ink),
        ),
      ),
    ),
  );
}

/// Segments that fill in as a flow moves through its steps.
class _Steps extends StatelessWidget {
  const _Steps(this.step, this.steps);
  final int step, steps;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return Row(
      children: [
        for (var k = 1; k <= steps; k++) ...[
          if (k > 1) const SizedBox(width: 6),
          Expanded(
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 400),
              curve: Curves.easeOutCubic,
              height: 5,
              decoration: BoxDecoration(
                gradient: k <= step ? c.gradient : null,
                color: k <= step ? null : c.line,
                borderRadius: BorderRadius.circular(5),
              ),
            ),
          ),
        ],
        const SizedBox(width: 12),
        Text('Step $step of $steps', style: context.t.labelMedium),
      ],
    );
  }
}

/// The header backdrop: a warm wash, drifting rings and a wave that the white sheet rises from.
class _HeaderPainter extends CustomPainter {
  _HeaderPainter({required this.time, required this.colors});
  final double time;
  final AppColors colors;

  @override
  void paint(Canvas canvas, Size size) {
    final brand = colors.brand, orange = colors.orange;
    final w = size.width, h = size.height;
    final t = time * 2 * math.pi;
    canvas.drawRect(
      Offset.zero & size,
      Paint()
        ..shader = LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [colors.brand50, colors.orange50],
        ).createShader(Offset.zero & size),
    );
    // Soft glows that drift slowly.
    canvas.drawCircle(
      Offset(w * 0.12 + math.sin(t) * 12, h * 0.2),
      w * 0.38,
      Paint()
        ..shader = RadialGradient(colors: [brand.withValues(alpha: 0.16), brand.withValues(alpha: 0)])
            .createShader(Rect.fromCircle(center: Offset(w * 0.12, h * 0.2), radius: w * 0.38)),
    );
    canvas.drawCircle(
      Offset(w * 0.9 + math.cos(t) * 12, h * 0.35),
      w * 0.4,
      Paint()
        ..shader = RadialGradient(colors: [orange.withValues(alpha: 0.2), orange.withValues(alpha: 0)])
            .createShader(Rect.fromCircle(center: Offset(w * 0.9, h * 0.35), radius: w * 0.4)),
    );
    // Thin concentric rings in the corner.
    final ring = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.2;
    for (var k = 0; k < 3; k++) {
      ring.color = brand.withValues(alpha: 0.10 - k * 0.025);
      canvas.drawCircle(Offset(w * 0.95, -h * 0.05), w * (0.22 + k * 0.12) + math.sin(t + k) * 4, ring);
    }
    ring.color = orange.withValues(alpha: 0.12);
    canvas.drawCircle(Offset(-w * 0.05, h * 0.92), w * 0.2 + math.cos(t) * 3, ring);
    // The sheet's wavy top edge.
    final wave = Path()
      ..moveTo(0, h - 18)
      ..cubicTo(w * 0.28, h - 40 + math.sin(t) * 5, w * 0.62, h + 4 - math.sin(t) * 5, w, h - 30)
      ..lineTo(w, h)
      ..lineTo(0, h)
      ..close();
    canvas.drawPath(wave, Paint()..color = colors.surface);
  }

  @override
  bool shouldRepaint(_HeaderPainter old) => old.time != time || old.colors != colors;
}

/// Six boxes for an emailed code. Typing fills them in turn; paste and autofill work too.
class CodeBoxes extends StatefulWidget {
  const CodeBoxes({super.key, required this.controller, required this.onCompleted, this.autofocus = true, this.error = false});
  final TextEditingController controller;
  final VoidCallback onCompleted;
  final bool autofocus, error;

  @override
  State<CodeBoxes> createState() => _CodeBoxesState();
}

class _CodeBoxesState extends State<CodeBoxes> {
  final _focus = FocusNode();

  @override
  void initState() {
    super.initState();
    _focus.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final code = widget.controller.text;
    return GestureDetector(
      onTap: () => _focus.requestFocus(),
      child: Stack(
        children: [
          // The real field is invisible; the boxes show what it holds.
          Opacity(
            opacity: 0,
            child: SizedBox(
              height: 64,
              child: TextField(
                controller: widget.controller,
                focusNode: _focus,
                autofocus: widget.autofocus,
                keyboardType: TextInputType.number,
                maxLength: 6,
                showCursor: false,
                enableInteractiveSelection: false,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                autofillHints: const [AutofillHints.oneTimeCode],
                decoration: const InputDecoration(counterText: '', border: InputBorder.none),
                onChanged: (v) {
                  setState(() {});
                  if (v.length == 6) widget.onCompleted();
                },
              ),
            ),
          ),
          IgnorePointer(
            child: Row(
              children: [
                for (var k = 0; k < 6; k++) ...[
                  if (k > 0) SizedBox(width: k == 3 ? 14 : 8),
                  Expanded(
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 180),
                      height: 64,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: k < code.length ? c.brand50 : c.soft,
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(
                          width: 1.6,
                          color: widget.error
                              ? c.brand
                              : _focus.hasFocus && k == code.length.clamp(0, 5)
                              ? c.brand
                              : Colors.transparent,
                        ),
                      ),
                      child: AnimatedSwitcher(
                        duration: const Duration(milliseconds: 160),
                        transitionBuilder: (child, a) => ScaleTransition(scale: a, child: child),
                        child: Text(
                          k < code.length ? code[k] : '',
                          key: ValueKey('$k${k < code.length ? code[k] : ''}'),
                          style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800, color: c.ink),
                        ),
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// A short line with a link button after it, e.g. "New to Dellvit? Create an account".
class AuthSwitch extends StatelessWidget {
  const AuthSwitch({super.key, required this.text, required this.action, required this.onTap});
  final String text, action;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisAlignment: MainAxisAlignment.center,
    children: [
      Flexible(child: Text(text, style: context.t.bodyMedium!.copyWith(color: context.c.muted))),
      TextButton(onPressed: onTap, child: Text(action)),
    ],
  );
}
