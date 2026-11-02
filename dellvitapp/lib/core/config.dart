/// Where the app finds the Dellvit server.
///
/// The app talks to the same Express API as the website, so both share one database.
/// To point a build at another server:
/// `flutter run --dart-define=DELLVIT_ORIGIN=http://10.0.2.2:3000`
class AppConfig {
  static const String origin = String.fromEnvironment(
    'DELLVIT_ORIGIN',
    // The live site. Use the www address: the others redirect, and a redirected login or
    // sign-up is not followed, so it would fail.
    defaultValue: 'https://www.dellvit.com',
  );
  static const String api = '$origin/api';

  /// Shown in the account's list of signed-in devices.
  static const String userAgent = 'Dellvit Android app';
  static const String packageName = 'com.dellvit.intelloplex';

  /// Turns a path the API returns (`/api/media/x.webp`, `/images/food.webp`) into a full address.
  static String url(String? path) {
    if (path == null || path.isEmpty) return '';
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    return origin + (path.startsWith('/') ? path : '/$path');
  }
}
