import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// The Dellvit colours, taken from the website's design tokens so both feel like one product.
@immutable
class AppColors extends ThemeExtension<AppColors> {
  const AppColors({
    required this.brand,
    required this.brandDark,
    required this.brand50,
    required this.brand100,
    required this.orange,
    required this.orange50,
    required this.ink,
    required this.text,
    required this.muted,
    required this.line,
    required this.lineStrong,
    required this.bg,
    required this.surface,
    required this.soft,
    required this.green,
    required this.green50,
    required this.amber,
    required this.amber50,
    required this.blue,
    required this.blue50,
    required this.purple,
    required this.purple50,
    required this.red50,
    required this.dangerInk,
    required this.warnInk,
    required this.infoInk,
    required this.successInk,
    required this.inverse,
    required this.shadow,
  });

  final Color brand, brandDark, brand50, brand100;
  final Color orange, orange50;
  final Color ink, text, muted, line, lineStrong;
  final Color bg, surface, soft;
  final Color green, green50, amber, amber50, blue, blue50, purple, purple50, red50;
  final Color dangerInk, warnInk, infoInk, successInk;
  final Color inverse, shadow;

  static const light = AppColors(
    brand: Color(0xFFD91E45),
    brandDark: Color(0xFFBB1639),
    brand50: Color(0xFFFFF1F3),
    brand100: Color(0xFFFFE0E6),
    orange: Color(0xFFF58A1F),
    orange50: Color(0xFFFFF4E8),
    ink: Color(0xFF1C1420),
    text: Color(0xFF3A3240),
    muted: Color(0xFF7B7382),
    line: Color(0xFFEBE5E8),
    lineStrong: Color(0xFFDDD4D9),
    bg: Color(0xFFFAF8F7),
    surface: Color(0xFFFFFFFF),
    soft: Color(0xFFF5F1F2),
    green: Color(0xFF14966B),
    green50: Color(0xFFE8F7F0),
    amber: Color(0xFFB86E00),
    amber50: Color(0xFFFFF5E0),
    blue: Color(0xFF2563EB),
    blue50: Color(0xFFEAF1FF),
    purple: Color(0xFF7C3AED),
    purple50: Color(0xFFF3EDFF),
    red50: Color(0xFFFDECEE),
    dangerInk: Color(0xFF9C1630),
    warnInk: Color(0xFF83500A),
    infoInk: Color(0xFF1E4FB8),
    successInk: Color(0xFF0C6B4B),
    inverse: Color(0xFF1C1420),
    shadow: Color(0x1F1C1420),
  );

  static const dark = AppColors(
    brand: Color(0xFFEE3D62),
    brandDark: Color(0xFFD91E45),
    brand50: Color(0xFF2C1620),
    brand100: Color(0xFF4A2030),
    orange: Color(0xFFF79A3C),
    orange50: Color(0xFF2F2113),
    ink: Color(0xFFF6F0F8),
    text: Color(0xFFD6CCDB),
    muted: Color(0xFFA297A9),
    line: Color(0xFF2F2637),
    lineStrong: Color(0xFF43374D),
    bg: Color(0xFF120D16),
    surface: Color(0xFF1B1421),
    soft: Color(0xFF271E2F),
    green: Color(0xFF3FCF9B),
    green50: Color(0xFF12301F),
    amber: Color(0xFFF0B352),
    amber50: Color(0xFF33270F),
    blue: Color(0xFF7EA6FF),
    blue50: Color(0xFF17223F),
    purple: Color(0xFFB79BFF),
    purple50: Color(0xFF261C42),
    red50: Color(0xFF3A1822),
    dangerInk: Color(0xFFFFA3B5),
    warnInk: Color(0xFFF6C877),
    infoInk: Color(0xFFA6C2FF),
    successInk: Color(0xFF7FE3BB),
    inverse: Color(0xFF3A2E45),
    shadow: Color(0x66000000),
  );

  /// The red-to-orange sweep of the Dellvit logo.
  LinearGradient get gradient => const LinearGradient(
    begin: Alignment.topRight,
    end: Alignment.bottomLeft,
    colors: [Color(0xFFE21C45), Color(0xFFF0452C), Color(0xFFF58A1F)],
    stops: [0, 0.55, 1],
  );

  /// The left-to-right sweep on filled buttons.
  LinearGradient get buttonGradient => LinearGradient(
    begin: Alignment.centerLeft,
    end: Alignment.centerRight,
    colors: [brand, Color.lerp(brand, orange, 0.38)!],
  );

  @override
  AppColors copyWith() => this;

  @override
  AppColors lerp(ThemeExtension<AppColors>? other, double t) => other is AppColors && t >= 0.5 ? other : this;
}

extension AppTheme on BuildContext {
  AppColors get c => Theme.of(this).extension<AppColors>()!;
  TextTheme get t => Theme.of(this).textTheme;
  bool get isDark => Theme.of(this).brightness == Brightness.dark;

  /// Status and navigation bars for a full screen drawn on the surface colour.
  SystemUiOverlayStyle get surfaceBars => (isDark ? SystemUiOverlayStyle.light : SystemUiOverlayStyle.dark).copyWith(
    statusBarColor: Colors.transparent,
    systemNavigationBarColor: c.surface,
    systemNavigationBarIconBrightness: isDark ? Brightness.light : Brightness.dark,
  );
}

const String _font = 'PlusJakartaSans';

ThemeData buildTheme(Brightness brightness) {
  final dark = brightness == Brightness.dark;
  final c = dark ? AppColors.dark : AppColors.light;
  final scheme = ColorScheme.fromSeed(seedColor: c.brand, brightness: brightness).copyWith(
    primary: c.brand,
    onPrimary: Colors.white,
    primaryContainer: c.brand50,
    onPrimaryContainer: c.brand,
    secondary: c.orange,
    onSecondary: Colors.white,
    secondaryContainer: c.orange50,
    onSecondaryContainer: c.orange,
    surface: c.surface,
    onSurface: c.ink,
    onSurfaceVariant: c.muted,
    surfaceContainerLowest: c.surface,
    surfaceContainerLow: c.surface,
    surfaceContainer: c.surface,
    surfaceContainerHigh: c.soft,
    surfaceContainerHighest: c.soft,
    outline: c.lineStrong,
    outlineVariant: c.line,
    error: c.brand,
    onError: Colors.white,
    surfaceTint: Colors.transparent,
  );

  TextStyle style(double size, FontWeight weight, Color color, {double height = 1.35, double spacing = 0}) =>
      TextStyle(
        fontFamily: _font,
        fontSize: size,
        fontWeight: weight,
        color: color,
        height: height,
        letterSpacing: spacing,
      );

  final textTheme = TextTheme(
    displaySmall: style(30, FontWeight.w800, c.ink, height: 1.15, spacing: -0.6),
    headlineMedium: style(26, FontWeight.w800, c.ink, height: 1.18, spacing: -0.5),
    headlineSmall: style(22, FontWeight.w800, c.ink, height: 1.2, spacing: -0.4),
    titleLarge: style(19, FontWeight.w700, c.ink, height: 1.25, spacing: -0.3),
    titleMedium: style(16, FontWeight.w700, c.ink, height: 1.3, spacing: -0.1),
    titleSmall: style(14, FontWeight.w700, c.ink, height: 1.3),
    bodyLarge: style(15, FontWeight.w500, c.text, height: 1.5),
    bodyMedium: style(14, FontWeight.w500, c.text, height: 1.45),
    bodySmall: style(12.5, FontWeight.w500, c.muted, height: 1.4),
    labelLarge: style(15, FontWeight.w700, c.ink, height: 1.2),
    labelMedium: style(12.5, FontWeight.w600, c.muted, height: 1.2),
    labelSmall: style(11, FontWeight.w700, c.muted, height: 1.2, spacing: 0.4),
  );

  // Fields are filled and borderless; a coloured edge appears only while typing or on an error.
  OutlineInputBorder border(Color color, [double width = 1]) => OutlineInputBorder(
    borderRadius: BorderRadius.circular(16),
    borderSide: width == 0 ? BorderSide.none : BorderSide(color: color, width: width),
  );
  final buttonShape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(16));
  final buttonText = style(15, FontWeight.w700, c.ink, height: 1.2);

  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: scheme,
    fontFamily: _font,
    textTheme: textTheme,
    scaffoldBackgroundColor: c.bg,
    canvasColor: c.bg,
    dividerColor: c.line,
    splashFactory: InkSparkle.splashFactory,
    extensions: [c],
    appBarTheme: AppBarTheme(
      backgroundColor: c.bg,
      foregroundColor: c.ink,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0.6,
      shadowColor: c.shadow,
      centerTitle: false,
      titleSpacing: 6,
      toolbarHeight: 62,
      titleTextStyle: style(20, FontWeight.w800, c.ink, height: 1.2, spacing: -0.4),
      systemOverlayStyle: (dark ? SystemUiOverlayStyle.light : SystemUiOverlayStyle.dark).copyWith(
        statusBarColor: Colors.transparent,
        systemNavigationBarColor: c.surface,
        systemNavigationBarIconBrightness: dark ? Brightness.light : Brightness.dark,
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: c.brand,
        foregroundColor: Colors.white,
        disabledBackgroundColor: c.lineStrong,
        disabledForegroundColor: c.muted,
        minimumSize: const Size(0, 52),
        padding: const EdgeInsets.symmetric(horizontal: 20),
        shape: buttonShape,
        textStyle: buttonText,
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: c.ink,
        backgroundColor: c.surface,
        minimumSize: const Size(0, 52),
        padding: const EdgeInsets.symmetric(horizontal: 20),
        side: BorderSide(color: c.lineStrong),
        shape: buttonShape,
        textStyle: buttonText,
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: c.brand,
        textStyle: style(14, FontWeight.w700, c.brand, height: 1.2),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
    ),
    iconButtonTheme: IconButtonThemeData(style: IconButton.styleFrom(foregroundColor: c.ink)),
    // Back buttons are soft round buttons, as in most phone apps.
    actionIconTheme: ActionIconThemeData(
      backButtonIconBuilder: (_) => Container(
        width: 38,
        height: 38,
        decoration: BoxDecoration(color: c.surface, shape: BoxShape.circle, border: Border.all(color: c.line)),
        child: Icon(Icons.arrow_back_rounded, size: 20, color: c.ink),
      ),
      closeButtonIconBuilder: (_) => Container(
        width: 38,
        height: 38,
        decoration: BoxDecoration(color: c.surface, shape: BoxShape.circle, border: Border.all(color: c.line)),
        child: Icon(Icons.close_rounded, size: 20, color: c.ink),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: c.soft,
      contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 17),
      border: border(c.soft, 0),
      enabledBorder: border(c.soft, 0),
      focusedBorder: border(c.brand, 1.6),
      errorBorder: border(c.brand, 1.2),
      focusedErrorBorder: border(c.brand, 1.6),
      disabledBorder: border(c.soft, 0),
      labelStyle: style(14, FontWeight.w500, c.muted),
      floatingLabelStyle: WidgetStateTextStyle.resolveWith(
        (s) => style(14, FontWeight.w600, s.contains(WidgetState.focused) || s.contains(WidgetState.error) ? c.brand : c.muted),
      ),
      hintStyle: style(14, FontWeight.w500, c.muted.withValues(alpha: 0.75)),
      errorStyle: style(12, FontWeight.w600, c.brand),
      prefixIconColor: c.muted,
      suffixIconColor: c.muted,
    ),
    cardTheme: CardThemeData(
      color: c.surface,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: BorderSide(color: c.line),
      ),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: c.surface,
      selectedColor: c.ink,
      disabledColor: c.soft,
      checkmarkColor: c.surface,
      side: BorderSide(color: c.lineStrong),
      shape: const StadiumBorder(),
      labelStyle: style(13, FontWeight.w600, c.text, height: 1.2),
      secondaryLabelStyle: style(13, FontWeight.w600, c.surface, height: 1.2),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      showCheckmark: false,
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: c.surface,
      surfaceTintColor: Colors.transparent,
      indicatorColor: c.brand50,
      elevation: 0,
      height: 68,
      labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
      iconTheme: WidgetStateProperty.resolveWith(
        (s) => IconThemeData(size: 24, color: s.contains(WidgetState.selected) ? c.brand : c.muted),
      ),
      labelTextStyle: WidgetStateProperty.resolveWith(
        (s) => style(
          11.5,
          s.contains(WidgetState.selected) ? FontWeight.w700 : FontWeight.w600,
          s.contains(WidgetState.selected) ? c.brand : c.muted,
          height: 1.2,
        ),
      ),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: c.surface,
      modalBackgroundColor: c.surface,
      surfaceTintColor: Colors.transparent,
      showDragHandle: true,
      dragHandleColor: c.lineStrong,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(30))),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: c.surface,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(26)),
      titleTextStyle: textTheme.titleLarge,
      contentTextStyle: textTheme.bodyMedium,
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: c.inverse,
      contentTextStyle: style(13.5, FontWeight.w600, Colors.white, height: 1.35),
      actionTextColor: c.orange,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      insetPadding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
    ),
    dividerTheme: DividerThemeData(color: c.line, thickness: 1, space: 1),
    listTileTheme: ListTileThemeData(
      iconColor: c.text,
      titleTextStyle: style(15, FontWeight.w600, c.ink, height: 1.3),
      subtitleTextStyle: style(12.5, FontWeight.w500, c.muted, height: 1.35),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16),
    ),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith(
        (s) => s.contains(WidgetState.selected) ? Colors.white : c.muted,
      ),
      trackColor: WidgetStateProperty.resolveWith(
        (s) => s.contains(WidgetState.selected) ? c.green : c.soft,
      ),
      trackOutlineColor: WidgetStateProperty.resolveWith(
        (s) => s.contains(WidgetState.selected) ? Colors.transparent : c.lineStrong,
      ),
    ),
    checkboxTheme: CheckboxThemeData(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(5)),
      side: BorderSide(color: c.lineStrong, width: 1.5),
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(color: c.brand, linearTrackColor: c.soft),
    tabBarTheme: TabBarThemeData(
      labelColor: c.brand,
      unselectedLabelColor: c.muted,
      indicatorColor: c.brand,
      dividerColor: c.line,
      labelStyle: style(14, FontWeight.w700, c.brand, height: 1.2),
      unselectedLabelStyle: style(14, FontWeight.w600, c.muted, height: 1.2),
    ),
    floatingActionButtonTheme: FloatingActionButtonThemeData(
      backgroundColor: c.brand,
      foregroundColor: Colors.white,
      elevation: 3,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
    ),
    popupMenuTheme: PopupMenuThemeData(
      color: c.surface,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      textStyle: style(14, FontWeight.w600, c.ink),
    ),
  );
}
