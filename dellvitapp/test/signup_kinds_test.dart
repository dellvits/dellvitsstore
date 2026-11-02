import 'package:dellvit/core/theme.dart';
import 'package:dellvit/screens/auth/signup_screen.dart';
import 'package:dellvit/state/app_state.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  for (final width in [320.0, 412.0]) {
    testWidgets('sign-up offers user, rider and outlet on a ${width.toInt()} px phone', (tester) async {
      SharedPreferences.setMockInitialValues({});
      final app = AppState()..readLook(await SharedPreferences.getInstance());
      tester.view.physicalSize = Size(width, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: app,
          child: MaterialApp(theme: buildTheme(Brightness.light), home: const SignupScreen()),
        ),
      );
      await tester.pump(const Duration(milliseconds: 500));
      for (final t in ['User', 'Rider', 'Outlet']) {
        expect(find.text(t), findsOneWidget);
      }
      await tester.tap(find.text('Outlet'));
      await tester.pump();
      expect(find.text('Your full name (owner)'), findsOneWidget);
    });
  }
}
