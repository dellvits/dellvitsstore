import 'package:dellvit/core/theme.dart';
import 'package:dellvit/screens/shared/account_screen.dart';
import 'package:dellvit/state/app_state.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  for (final width in [320.0, 360.0, 412.0]) {
    testWidgets('the appearance sheet fits a ${width.toInt()} px wide phone', (tester) async {
      SharedPreferences.setMockInitialValues({});
      final app = AppState()..readLook(await SharedPreferences.getInstance());
      tester.view.physicalSize = Size(width, 760);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: app,
          child: MaterialApp(theme: buildTheme(Brightness.light), home: const AccountScreen()),
        ),
      );
      await tester.scrollUntilVisible(find.text('Appearance'), 200);
      await tester.ensureVisible(find.text('Appearance'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Appearance'));
      await tester.pumpAndSettle();
      expect(find.text('Phone'), findsOneWidget);
      // Switching theme redraws every preview; an overflow anywhere fails the test.
      await tester.tap(find.text('Dark'));
      await tester.pumpAndSettle();
      expect(app.themeMode, ThemeMode.dark);
    });
  }
}
