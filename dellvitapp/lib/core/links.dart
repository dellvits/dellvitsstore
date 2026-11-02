import 'package:url_launcher/url_launcher.dart';

/// Opens an address in whichever app handles it: the dialler, a browser, a maps app.
Future<bool> openExternal(String url) async {
  final uri = Uri.tryParse(url);
  if (uri == null) return false;
  try {
    return await launchUrl(uri, mode: LaunchMode.externalApplication);
  } catch (_) {
    return false;
  }
}

Future<bool> callPhone(String phone) => openExternal('tel:${phone.replaceAll(RegExp(r'[^\d+]'), '')}');

Future<bool> sendEmail(String email) => openExternal('mailto:$email');

Future<bool> openWhatsApp(String number) {
  var digits = number.replaceAll(RegExp(r'\D'), '');
  if (digits.startsWith('0')) digits = '92${digits.substring(1)}';
  return openExternal('https://wa.me/$digits');
}

/// Turn-by-turn directions to a point, in the phone's maps app.
Future<bool> openDirections(double lat, double lng) =>
    openExternal('https://www.google.com/maps/dir/?api=1&destination=$lat,$lng');

Future<bool> showOnMap(double lat, double lng) =>
    openExternal('https://www.google.com/maps/search/?api=1&query=$lat,$lng');
