import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../core/launch_sound.dart';
import '../core/theme.dart';
import '../state/app_state.dart';
import '../widgets/brand.dart';

/// How long the logo intro takes. The app keeps this screen up at least this long (see AppState.boot).
const splashIntro = Duration(milliseconds: 1700);

/// The launch screen. The system's own launch screen is plain white, so this one starts empty:
/// the Dellvit logo fades in, its arrow draws itself from left to right, then the loader appears.
/// A short sound plays with the logo (assets/sounds/splash.wav), unless it is switched off in the
/// account settings.
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> with SingleTickerProviderStateMixin {
  late final AnimationController _intro = AnimationController(vsync: this, duration: splashIntro);

  @override
  void initState() {
    super.initState();
    _begin();
  }

  Future<void> _begin() async {
    final played = context.read<AppState>().introPlayed;
    // A beat on the empty screen first, so the logo does not appear during the hand-over. The
    // sound has been loading since main(); the logo waits for it, up to a limit, so the two start
    // together. Start-up waits for this screen (AppState.boot), so the app never opens mid-intro.
    await Future<void>.delayed(const Duration(milliseconds: 120));
    final player = await LaunchSound.ready.timeout(const Duration(milliseconds: 1500), onTimeout: () => null);
    if (!mounted) return;
    if (!kReleaseMode) debugPrint('Logo intro starts ${player != null ? 'with' : 'without'} the launch sound');
    player?.resume().catchError((_) {});
    await _intro.forward().orCancel.catchError((_) {});
    // A moment of the loader before the app opens.
    await Future<void>.delayed(const Duration(milliseconds: 700));
    if (!played.isCompleted) played.complete();
  }

  @override
  void dispose() {
    _intro.dispose();
    // The app may open before the sound's last ring fades; it is let go once it has finished.
    LaunchSound.release();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final loader = CurvedAnimation(parent: _intro, curve: const Interval(0.82, 1, curve: Curves.easeOut));
    final footer = CurvedAnimation(parent: _intro, curve: const Interval(0.45, 0.85, curve: Curves.easeOut));
    final width = (MediaQuery.sizeOf(context).width * 0.6).clamp(180.0, 280.0);
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: context.surfaceBars,
      child: Scaffold(
        backgroundColor: c.surface,
        body: Stack(
          children: [
            // Only the logo is centred; the loader hangs below it so it never pushes the logo up.
            Center(child: DellvitLogo(width: width, reveal: _intro)),
            Center(
              child: Transform.translate(
                offset: Offset(0, width * 0.27 + 46),
                child: FadeTransition(
                  opacity: loader,
                  child: SlideTransition(
                    position: Tween(begin: const Offset(0, 0.4), end: Offset.zero).animate(loader),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const BrandSpinner(size: 18, stroke: 2.2),
                        const SizedBox(width: 9),
                        Text(
                          'Loading…',
                          style: TextStyle(color: c.muted, fontSize: 14, fontWeight: FontWeight.w600),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: SafeArea(
                top: false,
                child: Padding(
                  padding: const EdgeInsets.only(bottom: 22),
                  child: Center(
                    child: FadeTransition(opacity: footer, child: const PoweredBy()),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
