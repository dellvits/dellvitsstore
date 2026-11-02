import 'dart:math' as math;

import 'package:intl/intl.dart';

final NumberFormat _amount = NumberFormat('#,##0.##', 'en');
final DateFormat _dateTime = DateFormat('d MMM, h:mm a');
final DateFormat _dayOnly = DateFormat('d MMM yyyy');
final DateFormat _timeOnly = DateFormat('h:mm a');

/// Amounts travel as integer paisa; people read rupees.
String money(num paisa) => 'Rs ${_amount.format(paisa / 100)}';

DateTime? parseTime(String? iso) => iso == null || iso.isEmpty ? null : DateTime.tryParse(iso)?.toLocal();

String dateTime(String? iso) {
  final t = parseTime(iso);
  return t == null ? '—' : _dateTime.format(t);
}

String dayText(String? iso) {
  final t = parseTime(iso);
  return t == null ? '—' : _dayOnly.format(t);
}

String timeText(String? iso) {
  final t = parseTime(iso);
  return t == null ? '' : _timeOnly.format(t);
}

/// `picked_up` becomes `Picked Up`.
String label(String value) => value
    .split('_')
    .where((w) => w.isNotEmpty)
    .map((w) => w[0].toUpperCase() + w.substring(1))
    .join(' ');

String ago(String? iso) {
  final t = parseTime(iso);
  if (t == null) return '';
  final s = math.max(0, DateTime.now().difference(t).inSeconds);
  if (s < 60) return 'Just now';
  if (s < 3600) return '${s ~/ 60}m ago';
  if (s < 86400) return '${s ~/ 3600}h ago';
  if (s < 604800) return '${s ~/ 86400}d ago';
  return _dateTime.format(t);
}

String _clock(String time) {
  final parts = time.split(':');
  final h = int.tryParse(parts.first) ?? 0;
  final m = parts.length > 1 ? int.tryParse(parts[1]) ?? 0 : 0;
  final hour = h % 12 == 0 ? 12 : h % 12;
  return '$hour${m > 0 ? ':${m.toString().padLeft(2, '0')}' : ''} ${h < 12 ? 'am' : 'pm'}';
}

/// Opening hours such as "9 am – 11:30 pm"; empty when open around the clock.
String openingHours(String opensAt, String closesAt) =>
    opensAt.isNotEmpty && closesAt.isNotEmpty ? '${_clock(opensAt)} – ${_clock(closesAt)}' : '';

/// Great-circle distance in kilometres.
double distanceKm(double lat1, double lng1, double lat2, double lng2) {
  double r(double d) => d * math.pi / 180;
  final h =
      math.pow(math.sin(r(lat2 - lat1) / 2), 2) +
      math.cos(r(lat1)) * math.cos(r(lat2)) * math.pow(math.sin(r(lng2 - lng1) / 2), 2);
  return 12742 * math.asin(math.sqrt(h));
}

String plural(int n, String word) => '$n $word${n == 1 ? '' : 's'}';

String initial(String name) => name.trim().isEmpty ? '?' : name.trim()[0].toUpperCase();
