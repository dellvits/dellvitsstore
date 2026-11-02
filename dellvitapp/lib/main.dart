import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'core/launch_sound.dart';
import 'core/push.dart';
import 'core/theme.dart';
import 'screens/customer/customer_shell.dart';
import 'screens/offline_screen.dart';
import 'screens/onboarding_screen.dart';
import 'screens/outlet/outlet_shell.dart';
import 'screens/partner_screen.dart';
import 'screens/links.dart';
import 'screens/rider/rider_shell.dart';
import 'screens/splash_screen.dart';
import 'state/app_state.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
  final app = AppState()..readLook(await SharedPreferences.getInstance());
  // Ready by the time the logo starts; see SplashScreen.
  if (app.startupSound) LaunchSound.preload();
  // A tapped notification opens its screen, once the app has loaded and the introduction is done.
  Push.instance
    ..canOpen = (() => app.ready && app.onboarded && app.navigatorKey.currentContext != null)
    ..onOpen = (link) => openNotificationLink(app.navigatorKey.currentContext!, link);
  runApp(ChangeNotifierProvider.value(value: app, child: const DellvitApp()));
  app.boot();
}

// Built once; the app switches between them without rebuilding every style.
final _light = buildTheme(Brightness.light);
final _dark = buildTheme(Brightness.dark);

class DellvitApp extends StatelessWidget {
  const DellvitApp({super.key});

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    return MaterialApp(
      title: 'Dellvit',
      debugShowCheckedModeBanner: false,
      theme: _light,
      darkTheme: _dark,
      themeMode: app.themeMode,
      navigatorKey: app.navigatorKey,
      scaffoldMessengerKey: app.messengerKey,
      // Very large system text would break the compact cards; allow a sensible range.
      builder: (context, child) => MediaQuery.withClampedTextScaling(
        minScaleFactor: 0.9,
        maxScaleFactor: 1.2,
        child: child ?? const SizedBox.shrink(),
      ),
      home: const RootGate(),
    );
  }
}

/// Decides what the person sees first: the launch screen, the introduction, or the workspace
/// that matches the account they are signed in with.
class RootGate extends StatelessWidget {
  const RootGate({super.key});

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final user = app.user;
    final (String key, Widget screen) = !app.ready
        ? ('splash', const SplashScreen())
        : app.bootError != null && app.areas.isEmpty
        ? ('offline', const OfflineScreen())
        : !app.onboarded
        ? ('intro', const OnboardingScreen())
        : user != null && user.isApplicant
        ? ('applicant-${user.id}', const PartnerScreen())
        : user != null && user.isRider
        ? ('rider-${user.id}', const RiderShell())
        : user != null && user.isOutlet
        ? ('outlet-${user.id}', const OutletShell())
        : ('customer', const CustomerShell());
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 380),
      switchInCurve: Curves.easeOut,
      child: KeyedSubtree(key: ValueKey(key), child: screen),
    );
  }
}
