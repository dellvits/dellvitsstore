import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';
import 'package:intl/intl.dart';

import '../../core/api.dart';
import '../../core/location.dart';
import '../../models/models.dart';

/// The rider's shift: whether they take deliveries, and whether their position is being shared
/// with the customers they are delivering to.
class RiderDuty extends ChangeNotifier {
  RiderDuty(this.api);
  final Api api;

  /// Unknown until the server answers.
  bool? onDuty;
  int capacity = 5;
  bool sharing = false;
  bool busy = false;
  String message = 'Location sharing is off';

  StreamSubscription<Position>? _positions;
  DateTime _lastSent = DateTime.fromMillisecondsSinceEpoch(0);
  bool _disposed = false;

  void _changed() {
    if (!_disposed) notifyListeners();
  }

  Future<void> load() async {
    try {
      final s = asMap(await api.get('/rider/state'));
      onDuty = asInt(s['available'], 1) != 0;
      capacity = asInt(s['capacity'], 5);
      _changed();
    } catch (_) {}
  }

  /// Returns an error message, or null when the change was saved.
  Future<String?> setDuty(bool value) async {
    busy = true;
    _changed();
    try {
      await api.patch('/rider/state', {'available': value});
      onDuty = value;
      // Going off duty clears the stored position on the server too.
      if (!value) stopSharing();
      return null;
    } catch (e) {
      return errorText(e);
    } finally {
      busy = false;
      _changed();
    }
  }

  Future<void> startSharing() async {
    if (sharing) return;
    try {
      await ensureLocationPermission();
    } catch (e) {
      message = errorText(e);
      _changed();
      return;
    }
    sharing = true;
    message = 'Waiting for your location…';
    _lastSent = DateTime.fromMillisecondsSinceEpoch(0);
    _changed();
    _positions =
        Geolocator.getPositionStream(
          locationSettings: AndroidSettings(
            accuracy: LocationAccuracy.high,
            distanceFilter: 5,
            intervalDuration: const Duration(seconds: 10),
            // Keeps the position flowing while the rider has the maps app in front.
            foregroundNotificationConfig: const ForegroundNotificationConfig(
              notificationTitle: 'Dellvit is sharing your location',
              notificationText: 'Customers can follow your active delivery.',
              enableWakeLock: true,
              setOngoing: true,
            ),
          ),
        ).listen(
          _send,
          onError: (Object _) => stopSharing('Your location is unavailable. Check GPS and try again.'),
        );
  }

  Future<void> _send(Position p) async {
    final now = DateTime.now();
    if (now.difference(_lastSent) < const Duration(seconds: 10)) return;
    _lastSent = now;
    try {
      await api.post('/rider/location', {'lat': p.latitude, 'lng': p.longitude, 'accuracy': p.accuracy});
      if (sharing) message = 'Shared at ${DateFormat('h:mm:ss a').format(now)} · ±${p.accuracy.round()} m';
    } on ApiException catch (e) {
      // The server accepts positions only while the rider has a delivery in hand.
      if (e.status == 409 || e.status == 401 || e.status == 403) {
        stopSharing(e.message);
        return;
      }
      message = e.message;
    } catch (_) {}
    _changed();
  }

  void stopSharing([String? why]) {
    _positions?.cancel();
    _positions = null;
    sharing = false;
    message = why ?? 'Location sharing is off';
    _changed();
  }

  @override
  void dispose() {
    _disposed = true;
    _positions?.cancel();
    super.dispose();
  }
}
