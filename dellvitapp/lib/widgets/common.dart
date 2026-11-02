import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/api.dart';
import '../core/config.dart';
import '../core/format.dart';
import '../core/payment_logos.dart';
import '../core/resource.dart';
import '../core/theme.dart';
import '../models/models.dart';
import 'brand.dart';

export 'brand.dart' show BrandSpinner;

/* ---------- Tones ---------- */

enum Tone { neutral, brand, green, amber, blue, purple, orange, red }

({Color fg, Color bg}) toneColors(BuildContext context, Tone tone) {
  final c = context.c;
  return switch (tone) {
    Tone.brand => (fg: c.brand, bg: c.brand50),
    Tone.green => (fg: c.successInk, bg: c.green50),
    Tone.amber => (fg: c.warnInk, bg: c.amber50),
    Tone.blue => (fg: c.infoInk, bg: c.blue50),
    Tone.purple => (fg: c.purple, bg: c.purple50),
    Tone.orange => (fg: c.orange, bg: c.orange50),
    Tone.red => (fg: c.dangerInk, bg: c.red50),
    Tone.neutral => (fg: c.text, bg: c.soft),
  };
}

Tone statusTone(String status) => switch (status) {
  'delivered' || 'paid' || 'approved' || 'accepted' || 'open' || 'verified' => Tone.green,
  'cancelled' || 'rejected' || 'failed' || 'refund_due' => Tone.red,
  'placed' || 'due' || 'submitted' || 'pending' => Tone.amber,
  'confirmed' || 'ready' => Tone.blue,
  'preparing' => Tone.orange,
  'picked_up' || 'refunded' => Tone.purple,
  _ => Tone.neutral,
};

/* ---------- Images ---------- */

/// A picture from the Dellvit server. [private] files are sent with the session token.
class NetImage extends StatelessWidget {
  const NetImage(
    this.path, {
    super.key,
    this.width,
    this.height,
    this.fit = BoxFit.cover,
    this.radius = 0,
    this.private = false,
    this.icon = Icons.image_outlined,
  });

  final String path;
  final double? width, height;
  final BoxFit fit;
  final double radius;
  final bool private;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final url = AppConfig.url(path);
    final blank = Container(
      width: width,
      height: height,
      color: c.soft,
      alignment: Alignment.center,
      child: Icon(icon, color: c.lineStrong, size: 26),
    );
    final image = url.isEmpty
        ? blank
        : CachedNetworkImage(
            imageUrl: url,
            httpHeaders: private ? Api.instance.authHeaders : null,
            width: width,
            height: height,
            fit: fit,
            fadeInDuration: const Duration(milliseconds: 180),
            placeholder: (_, _) => Container(width: width, height: height, color: c.soft),
            errorWidget: (_, _, _) => blank,
          );
    return radius > 0 ? ClipRRect(borderRadius: BorderRadius.circular(radius), child: image) : image;
  }
}

class PaymentLogo extends StatelessWidget {
  const PaymentLogo(this.method, {super.key, this.size = 42});
  final PaymentMethod method;
  final double size;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final url = paymentLogoUrl(method);
    final icon = switch (method.type) {
      'cod' => Icons.payments_outlined,
      'wallet' => Icons.phone_iphone_rounded,
      'raast' => Icons.bolt_rounded,
      _ => Icons.account_balance_outlined,
    };
    // The tile stays white in both themes, so bank logos look as their makers drew them.
    const ink = Color(0xFF3A3240);
    final fallback = Icon(icon, size: size * 0.5, color: ink);
    return Container(
      width: size,
      height: size,
      padding: EdgeInsets.all(size * 0.14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(size * 0.28),
        border: Border.all(color: c.line),
      ),
      child: url.isEmpty
          ? fallback
          : CachedNetworkImage(
              imageUrl: url,
              fit: BoxFit.contain,
              placeholder: (_, _) => const SizedBox.shrink(),
              errorWidget: (_, _, _) => Icon(icon, size: size * 0.5, color: ink),
            ),
    );
  }
}

/* ---------- Surfaces ---------- */

class AppCard extends StatelessWidget {
  const AppCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
    this.onTap,
    this.color,
    this.borderColor,
    this.radius = 20,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final VoidCallback? onTap;
  final Color? color, borderColor;
  final double radius;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    // White cards float on a soft shadow; tinted ones sit flat with their own edge.
    final plain = color == null && borderColor == null;
    final card = Material(
      color: color ?? c.surface,
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(radius),
        side: BorderSide(color: borderColor ?? c.line.withValues(alpha: plain ? 0.7 : 1)),
      ),
      child: InkWell(
        onTap: onTap,
        child: Padding(padding: padding, child: child),
      ),
    );
    if (!plain) return card;
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(radius),
        boxShadow: const [BoxShadow(color: Color(0x0F1C1420), blurRadius: 18, offset: Offset(0, 6))],
      ),
      child: card,
    );
  }
}

class SectionHeader extends StatelessWidget {
  const SectionHeader(this.title, {super.key, this.eyebrow, this.action, this.onAction, this.padding});
  final String title;
  final String? eyebrow, action;
  final VoidCallback? onAction;
  final EdgeInsetsGeometry? padding;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return Padding(
      padding: padding ?? const EdgeInsets.fromLTRB(20, 22, 12, 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (eyebrow != null && eyebrow!.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 3),
                    child: Text(
                      eyebrow!.toUpperCase(),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: context.t.labelSmall!.copyWith(color: c.brand, letterSpacing: 0.9),
                    ),
                  ),
                Text(
                  title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: c.ink, fontSize: 19, fontWeight: FontWeight.w800, letterSpacing: -0.45, height: 1.2),
                ),
              ],
            ),
          ),
          if (action != null && onAction != null)
            Padding(
              padding: const EdgeInsets.only(left: 8, right: 4),
              child: Material(
                color: c.brand50,
                shape: const StadiumBorder(),
                child: InkWell(
                  customBorder: const StadiumBorder(),
                  onTap: onAction,
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(12, 7, 8, 7),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(action!, style: TextStyle(color: c.brand, fontSize: 12.5, fontWeight: FontWeight.w700, height: 1.2)),
                        const SizedBox(width: 2),
                        Icon(Icons.arrow_forward_rounded, size: 15, color: c.brand),
                      ],
                    ),
                  ),
                ),
              ),
            )
          else
            const SizedBox(width: 8),
        ],
      ),
    );
  }
}

class Pill extends StatelessWidget {
  const Pill(this.text, {super.key, this.tone = Tone.neutral, this.icon, this.dense = false});
  final String text;
  final Tone tone;
  final IconData? icon;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final colors = toneColors(context, tone);
    return Container(
      padding: EdgeInsets.symmetric(horizontal: dense ? 8 : 10, vertical: dense ? 3 : 5),
      decoration: BoxDecoration(color: colors.bg, borderRadius: BorderRadius.circular(99)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[Icon(icon, size: dense ? 12 : 14, color: colors.fg), const SizedBox(width: 4)],
          Flexible(
            child: Text(
              text,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: dense ? 11 : 12, fontWeight: FontWeight.w700, color: colors.fg, height: 1.2),
            ),
          ),
        ],
      ),
    );
  }
}

class StatusBadge extends StatelessWidget {
  const StatusBadge(this.status, {super.key, this.text, this.dense = false});
  final String status;
  final String? text;
  final bool dense;

  @override
  Widget build(BuildContext context) => Pill(text ?? label(status), tone: statusTone(status), dense: dense);
}

/// A coloured message box: something the person should read before going on.
class Notice extends StatelessWidget {
  const Notice(this.text, {super.key, this.tone = Tone.blue, this.icon, this.title});
  final String text;
  final String? title;
  final Tone tone;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final colors = toneColors(context, tone);
    final defaultIcon = switch (tone) {
      Tone.red => Icons.error_outline_rounded,
      Tone.amber => Icons.warning_amber_rounded,
      Tone.green => Icons.check_circle_outline_rounded,
      _ => Icons.info_outline_rounded,
    };
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(color: colors.bg, borderRadius: BorderRadius.circular(14)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon ?? defaultIcon, size: 19, color: colors.fg),
          const SizedBox(width: 10),
          Expanded(
            child: Text.rich(
              TextSpan(
                children: [
                  if (title != null) TextSpan(text: '$title ', style: const TextStyle(fontWeight: FontWeight.w800)),
                  TextSpan(text: text),
                ],
              ),
              style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: colors.fg, height: 1.4),
            ),
          ),
        ],
      ),
    );
  }
}

class Avatar extends StatelessWidget {
  const Avatar(this.name, {super.key, this.size = 44});
  final String name;
  final double size;

  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    alignment: Alignment.center,
    decoration: BoxDecoration(gradient: context.c.gradient, shape: BoxShape.circle),
    child: Text(
      initial(name),
      style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: size * 0.42, height: 1),
    ),
  );
}

/// A round tinted icon, used at the start of menu rows and stat tiles.
class IconBubble extends StatelessWidget {
  const IconBubble(this.icon, {super.key, this.tone = Tone.brand, this.size = 42});
  final IconData icon;
  final Tone tone;
  final double size;

  @override
  Widget build(BuildContext context) {
    final colors = toneColors(context, tone);
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(color: colors.bg, borderRadius: BorderRadius.circular(size * 0.32)),
      child: Icon(icon, color: colors.fg, size: size * 0.5),
    );
  }
}

/* ---------- States ---------- */

class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.title, this.message, this.icon = Icons.inbox_outlined, this.action, this.onAction});
  final String title;
  final String? message, action;
  final IconData icon;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 36, vertical: 40),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 132,
              height: 112,
              child: Stack(
                alignment: Alignment.center,
                children: [
                  Container(
                    width: 112,
                    height: 112,
                    decoration: BoxDecoration(shape: BoxShape.circle, color: c.brand50.withValues(alpha: 0.6)),
                  ),
                  Container(
                    width: 80,
                    height: 80,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: c.surface,
                      boxShadow: [BoxShadow(color: c.brand.withValues(alpha: 0.16), blurRadius: 20, offset: const Offset(0, 8))],
                    ),
                    child: ShaderMask(
                      shaderCallback: (r) => c.buttonGradient.createShader(r),
                      child: Icon(icon, size: 36, color: Colors.white),
                    ),
                  ),
                  Positioned(left: 8, top: 18, child: _Dot(8, c.orange)),
                  Positioned(right: 10, top: 8, child: _Dot(6, c.brand)),
                  Positioned(right: 4, bottom: 22, child: _Dot(10, c.orange.withValues(alpha: 0.5))),
                ],
              ),
            ),
            const SizedBox(height: 18),
            Text(title, textAlign: TextAlign.center, style: context.t.titleLarge),
            if (message != null) ...[
              const SizedBox(height: 6),
              Text(message!, textAlign: TextAlign.center, style: context.t.bodyMedium!.copyWith(color: c.muted)),
            ],
            if (action != null && onAction != null) ...[
              const SizedBox(height: 20),
              AppButton(action!, expand: false, onPressed: onAction),
            ],
          ],
        ),
      ),
    );
  }
}

class _Dot extends StatelessWidget {
  const _Dot(this.size, this.color);
  final double size;
  final Color color;

  @override
  Widget build(BuildContext context) =>
      Container(width: size, height: size, decoration: BoxDecoration(color: color, shape: BoxShape.circle));
}

class ErrorState extends StatelessWidget {
  const ErrorState(this.message, {super.key, this.onRetry});
  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) => EmptyState(
    icon: Icons.cloud_off_rounded,
    title: 'Something went wrong',
    message: message,
    action: onRetry == null ? null : 'Try again',
    onAction: onRetry,
  );
}

class LoadingView extends StatelessWidget {
  const LoadingView({super.key});
  @override
  Widget build(BuildContext context) => const Center(
    child: Padding(padding: EdgeInsets.all(40), child: BrandSpinner(size: 30, stroke: 3)),
  );
}

/// A softly pulsing placeholder shown while content loads.
class Skeleton extends StatefulWidget {
  const Skeleton({super.key, this.width, this.height = 16, this.radius = 10});
  final double? width;
  final double height, radius;

  @override
  State<Skeleton> createState() => _SkeletonState();
}

class _SkeletonState extends State<Skeleton> with SingleTickerProviderStateMixin {
  late final AnimationController _pulse = AnimationController(vsync: this, duration: const Duration(milliseconds: 900))
    ..repeat(reverse: true);

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return AnimatedBuilder(
      animation: _pulse,
      builder: (_, _) => Container(
        width: widget.width,
        height: widget.height,
        decoration: BoxDecoration(
          color: Color.lerp(c.soft, c.line, _pulse.value),
          borderRadius: BorderRadius.circular(widget.radius),
        ),
      ),
    );
  }
}

class SkeletonList extends StatelessWidget {
  const SkeletonList({super.key, this.count = 5, this.height = 92});
  final int count;
  final double height;

  @override
  Widget build(BuildContext context) => ListView.separated(
    padding: const EdgeInsets.all(16),
    physics: const NeverScrollableScrollPhysics(),
    shrinkWrap: true,
    itemCount: count,
    separatorBuilder: (_, _) => const SizedBox(height: 12),
    itemBuilder: (_, _) => Skeleton(height: height, radius: 18),
  );
}

/// Shows a [Resource]: placeholders while it loads, a retry on failure, then [builder].
class ResourceView<T> extends StatelessWidget {
  const ResourceView({super.key, required this.resource, required this.builder, this.loading});
  final Resource<T> resource;
  final Widget Function(BuildContext context, T data) builder;
  final Widget? loading;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: resource,
    builder: (context, _) {
      final data = resource.data;
      if (data != null) return builder(context, data);
      if (resource.error != null) {
        return ListView(children: [ErrorState(resource.error!, onRetry: resource.refresh)]);
      }
      return loading ?? const SkeletonList();
    },
  );
}

/* ---------- Controls ---------- */

class AppButton extends StatelessWidget {
  const AppButton(
    this.text, {
    super.key,
    required this.onPressed,
    this.busy = false,
    this.icon,
    this.outlined = false,
    this.danger = false,
    this.expand = true,
    this.small = false,
    this.color,
  });

  final String text;
  final VoidCallback? onPressed;
  final bool busy, outlined, danger, expand, small;
  final IconData? icon;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final height = small ? 42.0 : 52.0;
    final fg = outlined ? (danger ? c.brand : c.ink) : Colors.white;
    final child = busy
        ? SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2.4, color: fg))
        : Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[Icon(icon, size: small ? 17 : 19), const SizedBox(width: 8)],
              Flexible(child: Text(text, maxLines: 1, overflow: TextOverflow.ellipsis)),
            ],
          );
    final size = Size(expand ? double.infinity : 0, height);
    final text0 = TextStyle(
      fontFamily: 'PlusJakartaSans',
      fontSize: small ? 13.5 : 15,
      fontWeight: FontWeight.w700,
      height: 1.2,
    );
    final tap = busy ? null : onPressed;
    if (outlined) {
      return OutlinedButton(
        onPressed: tap,
        style: OutlinedButton.styleFrom(
          minimumSize: size,
          foregroundColor: fg,
          textStyle: text0,
          padding: EdgeInsets.symmetric(horizontal: small ? 14 : 20),
          side: BorderSide(color: danger ? c.brand100 : c.lineStrong),
        ),
        child: child,
      );
    }
    // Filled buttons carry the brand gradient and a soft coloured shadow, and dip when pressed.
    final solid = color ?? (danger ? c.brandDark : null);
    // A busy button keeps its colour; only a disabled one turns grey.
    final on = onPressed != null;
    final radius = BorderRadius.circular(small ? 13 : 16);
    return _Pressable(
      enabled: on,
      child: Container(
        constraints: BoxConstraints(minWidth: size.width == double.infinity ? double.infinity : 0, minHeight: height),
        decoration: BoxDecoration(
          gradient: on && solid == null ? c.buttonGradient : null,
          color: on ? solid : c.lineStrong,
          borderRadius: radius,
          boxShadow: on
              ? [BoxShadow(color: (solid ?? c.brand).withValues(alpha: 0.28), blurRadius: 16, offset: const Offset(0, 6))]
              : null,
        ),
        child: Material(
          type: MaterialType.transparency,
          child: InkWell(
            onTap: tap,
            borderRadius: radius,
            child: Padding(
              padding: EdgeInsets.symmetric(horizontal: small ? 14 : 20),
              child: Center(
                widthFactor: 1,
                heightFactor: 1,
                child: SizedBox(
                  height: height,
                  child: Center(
                    widthFactor: 1,
                    child: DefaultTextStyle(
                      style: text0.copyWith(color: on || busy ? Colors.white : c.muted),
                      child: IconTheme(data: IconThemeData(color: on || busy ? Colors.white : c.muted), child: child),
                    ),
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

/// Shrinks its child a touch while a finger is down on it.
class _Pressable extends StatefulWidget {
  const _Pressable({required this.child, this.enabled = true});
  final Widget child;
  final bool enabled;

  @override
  State<_Pressable> createState() => _PressableState();
}

class _PressableState extends State<_Pressable> {
  bool _down = false;

  void _set(bool v) {
    if (widget.enabled && v != _down) setState(() => _down = v);
  }

  @override
  Widget build(BuildContext context) => Listener(
    onPointerDown: (_) => _set(true),
    onPointerUp: (_) => _set(false),
    onPointerCancel: (_) => _set(false),
    child: AnimatedScale(
      scale: _down ? 0.97 : 1,
      duration: const Duration(milliseconds: 120),
      curve: Curves.easeOut,
      child: widget.child,
    ),
  );
}

class QuantityStepper extends StatelessWidget {
  const QuantityStepper({
    super.key,
    required this.value,
    required this.max,
    required this.onChanged,
    this.compact = false,
    this.removable = true,
  });
  final int value, max;
  final ValueChanged<int> onChanged;
  final bool compact;

  /// Whether going below one removes the item (a bin is shown) or is simply not allowed.
  final bool removable;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final side = compact ? 30.0 : 38.0;
    Widget button(IconData icon, VoidCallback? onTap, {bool filled = false}) => Material(
      color: filled ? c.brand : c.soft,
      shape: const CircleBorder(),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onTap,
        child: SizedBox(
          width: side,
          height: side,
          child: Icon(
            icon,
            size: compact ? 16 : 19,
            color: onTap == null
                ? c.lineStrong
                : filled
                ? Colors.white
                : c.ink,
          ),
        ),
      ),
    );
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        button(
          value <= 1 && removable ? Icons.delete_outline_rounded : Icons.remove_rounded,
          value <= 1 && !removable ? null : () => onChanged(value - 1),
        ),
        SizedBox(
          width: compact ? 30 : 38,
          child: Text(
            '$value',
            textAlign: TextAlign.center,
            style: TextStyle(fontWeight: FontWeight.w800, fontSize: compact ? 14 : 16, color: c.ink),
          ),
        ),
        button(Icons.add_rounded, value >= max ? null : () => onChanged(value + 1), filled: true),
      ],
    );
  }
}

class SummaryLine extends StatelessWidget {
  const SummaryLine(this.name, this.value, {super.key, this.bold = false, this.tone});
  final String name, value;
  final bool bold;
  final Tone? tone;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final color = tone == null ? (bold ? c.ink : c.text) : toneColors(context, tone!).fg;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        children: [
          Expanded(
            child: Text(
              name,
              style: TextStyle(fontSize: bold ? 16 : 14, fontWeight: bold ? FontWeight.w800 : FontWeight.w500, color: color),
            ),
          ),
          Text(
            value,
            style: TextStyle(fontSize: bold ? 18 : 14, fontWeight: bold ? FontWeight.w800 : FontWeight.w700, color: color),
          ),
        ],
      ),
    );
  }
}

/// A labelled value with a copy button, for account numbers and references.
class CopyRow extends StatelessWidget {
  const CopyRow(this.name, this.value, {super.key});
  final String name, value;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(name, style: context.t.bodySmall),
                const SizedBox(height: 1),
                Text(value, style: context.t.titleSmall!.copyWith(fontSize: 15)),
              ],
            ),
          ),
          IconButton(
            tooltip: 'Copy $name',
            visualDensity: VisualDensity.compact,
            icon: Icon(Icons.copy_rounded, size: 18, color: c.muted),
            onPressed: () {
              Clipboard.setData(ClipboardData(text: value));
              ScaffoldMessenger.of(context)
                ..hideCurrentSnackBar()
                ..showSnackBar(SnackBar(content: Text('$name copied'), duration: const Duration(seconds: 2)));
            },
          ),
        ],
      ),
    );
  }
}

class StatTile extends StatelessWidget {
  const StatTile({
    super.key,
    required this.icon,
    required this.name,
    required this.value,
    this.tone = Tone.brand,
    this.hint,
    this.child,
  });
  final IconData icon;
  final String name, value;
  final String? hint;
  final Tone tone;

  /// Shown in place of [value], for figures that change by themselves such as a countdown.
  final Widget? child;

  @override
  Widget build(BuildContext context) => AppCard(
    padding: const EdgeInsets.all(14),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        IconBubble(icon, tone: tone, size: 36),
        const SizedBox(height: 10),
        FittedBox(
          fit: BoxFit.scaleDown,
          alignment: Alignment.centerLeft,
          child: child ?? Text(value, style: context.t.titleLarge!.copyWith(fontWeight: FontWeight.w800)),
        ),
        const SizedBox(height: 2),
        Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.t.bodySmall),
        if (hint != null) Text(hint!, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.t.bodySmall),
      ],
    ),
  );
}

/// Two stat tiles to a row, each as tall as its content.
class StatGrid extends StatelessWidget {
  const StatGrid(this.tiles, {super.key});
  final List<Widget> tiles;

  @override
  Widget build(BuildContext context) => Column(
    children: [
      for (var i = 0; i < tiles.length; i += 2)
        Padding(
          padding: EdgeInsets.only(bottom: i + 2 < tiles.length ? 12 : 0),
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(child: tiles[i]),
                const SizedBox(width: 12),
                Expanded(child: i + 1 < tiles.length ? tiles[i + 1] : const SizedBox.shrink()),
              ],
            ),
          ),
        ),
    ],
  );
}

/// The time frames the dashboards offer for their figures.
enum StatRange {
  today('Today'),
  week('7 days'),
  month('30 days'),
  all('All time');

  const StatRange(this.title);
  final String title;

  /// The `from` bound the API expects; nothing for all time.
  Map<String, String?> get query {
    final now = DateTime.now();
    final from = switch (this) {
      StatRange.today => DateTime(now.year, now.month, now.day),
      StatRange.week => now.subtract(const Duration(days: 7)),
      StatRange.month => now.subtract(const Duration(days: 30)),
      StatRange.all => null,
    };
    return {'from': from?.toUtc().toIso8601String()};
  }
}

class ChoiceChips<T> extends StatelessWidget {
  const ChoiceChips({
    super.key,
    required this.options,
    required this.value,
    required this.onChanged,
    this.padding,
    this.leading,
  });
  final Map<T, String> options;
  final T value;
  final ValueChanged<T> onChanged;
  final EdgeInsetsGeometry? padding;

  /// Shown before the choices, in the same scrolling row.
  final Widget? leading;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: padding ?? const EdgeInsets.symmetric(horizontal: 16),
      child: Row(
        children: [
          if (leading != null) Padding(padding: const EdgeInsets.only(right: 8), child: leading),
          for (final e in options.entries)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: ChoiceChip(
                label: Text(e.value),
                selected: e.key == value,
                onSelected: (_) => onChanged(e.key),
                labelStyle: TextStyle(
                  fontFamily: 'PlusJakartaSans',
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: e.key == value ? c.surface : c.text,
                ),
                side: BorderSide(color: e.key == value ? c.ink : c.lineStrong),
              ),
            ),
        ],
      ),
    );
  }
}

/// A row in a settings-style menu.
class MenuRow extends StatelessWidget {
  const MenuRow({super.key, required this.icon, required this.title, this.subtitle, this.onTap, this.tone = Tone.neutral, this.trailing});
  final IconData icon;
  final String title;
  final String? subtitle;
  final VoidCallback? onTap;
  final Tone tone;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) => ListTile(
    onTap: onTap,
    contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 2),
    leading: IconBubble(icon, tone: tone, size: 40),
    title: Text(title),
    subtitle: subtitle == null ? null : Text(subtitle!, maxLines: 2, overflow: TextOverflow.ellipsis),
    trailing: trailing ?? (onTap == null ? null : Icon(Icons.chevron_right_rounded, color: context.c.muted)),
  );
}

/// A group of [MenuRow]s inside one card, separated by hairlines.
class MenuGroup extends StatelessWidget {
  const MenuGroup({super.key, required this.children, this.title});
  final List<Widget> children;
  final String? title;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      if (title != null)
        Padding(
          padding: const EdgeInsets.fromLTRB(6, 0, 6, 8),
          child: Text(title!.toUpperCase(), style: context.t.labelSmall!.copyWith(letterSpacing: 0.9)),
        ),
      AppCard(
        padding: EdgeInsets.zero,
        child: Column(
          children: [
            for (var i = 0; i < children.length; i++) ...[
              if (i > 0) Divider(indent: 68, color: context.c.line),
              children[i],
            ],
          ],
        ),
      ),
    ],
  );
}

/// The bar that holds a screen's main button, above the system navigation.
class BottomBar extends StatelessWidget {
  const BottomBar({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return Container(
      decoration: BoxDecoration(
        color: c.surface,
        border: Border(top: BorderSide(color: c.line)),
        boxShadow: [BoxShadow(color: c.shadow.withValues(alpha: 0.08), blurRadius: 18, offset: const Offset(0, -6))],
      ),
      child: SafeArea(
        top: false,
        child: Padding(padding: const EdgeInsets.fromLTRB(16, 12, 16, 12), child: child),
      ),
    );
  }
}

/* ---------- Dialogs ---------- */

Future<bool> showConfirm(
  BuildContext context, {
  required String title,
  String? message,
  String confirm = 'Confirm',
  String cancel = 'Not now',
  bool danger = false,
}) async {
  final result = await showModalBottomSheet<bool>(
    context: context,
    builder: (context) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: context.t.headlineSmall),
            if (message != null) ...[
              const SizedBox(height: 8),
              Text(message, style: context.t.bodyLarge!.copyWith(color: context.c.muted)),
            ],
            const SizedBox(height: 22),
            AppButton(confirm, danger: danger, onPressed: () => Navigator.pop(context, true)),
            const SizedBox(height: 10),
            AppButton(cancel, outlined: true, onPressed: () => Navigator.pop(context, false)),
          ],
        ),
      ),
    ),
  );
  return result ?? false;
}

/// Asks for a line of text (a reason, a note). Returns null when dismissed.
Future<String?> showPrompt(
  BuildContext context, {
  required String title,
  String? message,
  required String fieldLabel,
  String? hint,
  String confirm = 'Send',
  bool required = false,
  bool danger = false,
}) {
  final controller = TextEditingController();
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    builder: (context) => Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SafeArea(
        child: StatefulBuilder(
          builder: (context, setState) => Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: context.t.headlineSmall),
                if (message != null) ...[
                  const SizedBox(height: 8),
                  Text(message, style: context.t.bodyMedium!.copyWith(color: context.c.muted)),
                ],
                const SizedBox(height: 16),
                TextField(
                  controller: controller,
                  autofocus: true,
                  maxLines: 3,
                  minLines: 2,
                  maxLength: 300,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: InputDecoration(labelText: fieldLabel, hintText: hint, alignLabelWithHint: true),
                  onChanged: (_) => setState(() {}),
                ),
                const SizedBox(height: 8),
                AppButton(
                  confirm,
                  danger: danger,
                  onPressed: required && controller.text.trim().length < 3
                      ? null
                      : () => Navigator.pop(context, controller.text.trim()),
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}

/// Opens a sheet that grows with its content and moves above the keyboard.
Future<T?> showSheet<T>(BuildContext context, {required WidgetBuilder builder}) => showModalBottomSheet<T>(
  context: context,
  isScrollControlled: true,
  useSafeArea: true,
  builder: (context) => Padding(
    padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
    child: builder(context),
  ),
);
