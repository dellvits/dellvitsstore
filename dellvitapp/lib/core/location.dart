import 'dart:async';

import 'package:geolocator/geolocator.dart';

import 'api.dart';

class Fix {
  const Fix(this.lat, this.lng, this.accuracy);
  final double lat, lng, accuracy;
}

/// Asks for location permission when needed. Throws a readable [ApiException] when the phone's
/// location is off or the permission is refused.
Future<void> ensureLocationPermission() async {
  if (!await Geolocator.isLocationServiceEnabled()) {
    throw ApiException('Turn on location (GPS) on your phone and try again.');
  }
  var permission = await Geolocator.checkPermission();
  if (permission == LocationPermission.denied) permission = await Geolocator.requestPermission();
  if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
    throw ApiException('Location permission was denied. Allow it for Dellvit in your phone settings.');
  }
}

/// Whether the app may already read the location, without showing the permission prompt.
Future<bool> hasLocationPermission() async {
  try {
    if (!await Geolocator.isLocationServiceEnabled()) return false;
    final p = await Geolocator.checkPermission();
    return p == LocationPermission.always || p == LocationPermission.whileInUse;
  } catch (_) {
    return false;
  }
}

Future<Fix> currentPosition() async {
  await ensureLocationPermission();
  try {
    final p = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, timeLimit: Duration(seconds: 15)),
    );
    return Fix(p.latitude, p.longitude, p.accuracy);
  } catch (_) {
    final last = await Geolocator.getLastKnownPosition();
    if (last != null) return Fix(last.latitude, last.longitude, last.accuracy);
    throw ApiException('We could not detect your location. Try again or choose your area yourself.');
  }
}
