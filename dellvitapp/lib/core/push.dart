import 'dart:async';
import 'dart:convert';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import 'api.dart';
import 'config.dart';

/// Push notifications in the phone's notification centre, through Firebase Cloud Messaging.
///
/// When the app is closed or in the background, Android shows them itself. While it is open, they
/// are shown here as the same kind of banner. Firebase is set up from
/// `assets/firebase/google-services.json`, downloaded from the Firebase console; without that
/// file push stays off and the app works as before.
class Push {
  Push._();
  static final Push instance = Push._();

  /// High importance, so alerts drop down as a banner with sound. The id matches the manifest.
  static const channel = AndroidNotificationChannel(
    'dellvit_alerts',
    'Dellvit alerts',
    description: 'Orders, deliveries, payments, earnings and support replies.',
    importance: Importance.high,
  );

  final _local = FlutterLocalNotificationsPlugin();
  StreamSubscription<String>? _refresh;
  String? _token;
  String? _pending;

  /// True once Firebase is set up on this phone.
  bool ready = false;

  /// True once the server has this phone, for the signed-in account or as a guest.
  bool registered = false;

  /// Opens the screen a tapped notification points to.
  void Function(String link)? onOpen;

  /// Whether [onOpen] can run yet; until then a tapped notification waits (see [openPending]).
  bool Function()? canOpen;

  /// A notification that arrived while the app was open: the inbox should refresh and not show
  /// its own pop-up for it.
  void Function(String notificationId)? onForeground;

  Future<void> init() async {
    try {
      final options = await _options();
      if (options == null) return;
      await Firebase.initializeApp(options: options);
      await _local.initialize(
        settings: const InitializationSettings(android: AndroidInitializationSettings('ic_notification')),
        onDidReceiveNotificationResponse: (r) => _open(r.payload),
      );
      await _local
          .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
          ?.createNotificationChannel(channel);
      FirebaseMessaging.onMessage.listen(_showWhileOpen);
      FirebaseMessaging.onMessageOpenedApp.listen((m) => _open(m.data['link']?.toString()));
      // The app was started by tapping a notification.
      final first = await FirebaseMessaging.instance.getInitialMessage();
      final launch = await _local.getNotificationAppLaunchDetails();
      _pending = first?.data['link']?.toString() ??
          (launch?.didNotificationLaunchApp == true ? launch!.notificationResponse?.payload : null);
      ready = true;
    } catch (e) {
      debugPrint('Push notifications are off: $e');
      ready = false;
    }
  }

  /// Firebase's app details, read from the google-services.json the Firebase console gives.
  Future<FirebaseOptions?> _options() async {
    final String text;
    try {
      text = await rootBundle.loadString('assets/firebase/google-services.json');
    } catch (_) {
      return null;
    }
    final json = jsonDecode(text) as Map<String, dynamic>;
    final project = json['project_info'] as Map<String, dynamic>;
    final client = (json['client'] as List).cast<Map<String, dynamic>>().firstWhere(
      (c) => c['client_info']?['android_client_info']?['package_name'] == AppConfig.packageName,
    );
    return FirebaseOptions(
      apiKey: (client['api_key'] as List).first['current_key'] as String,
      appId: client['client_info']['mobilesdk_app_id'] as String,
      messagingSenderId: project['project_number'].toString(),
      projectId: project['project_id'] as String,
      storageBucket: project['storage_bucket'] as String?,
    );
  }

  /// Links this phone to the signed-in account so its notifications reach the notification
  /// centre. Signed out, the phone is kept as a guest and gets Dellvit's announcements for
  /// everyone and for customers. Asks for permission the first time (Android 13 and newer).
  Future<void> register(Api api) async {
    if (!ready) return;
    try {
      await FirebaseMessaging.instance.requestPermission();
      final token = await FirebaseMessaging.instance.getToken();
      if (token == null) return;
      _token = token;
      await api.post('/push/device', {'token': token, 'platform': 'android'});
      registered = true;
      _refresh ??= FirebaseMessaging.instance.onTokenRefresh.listen((t) {
        _token = t;
        api.post('/push/device', {'token': t, 'platform': 'android'}).catchError((_) => null);
      });
    } catch (e) {
      debugPrint('Could not register for push: $e');
    }
  }

  /// Stops this phone getting the account's notifications. Call before signing out.
  Future<void> unregister(Api api) async {
    registered = false;
    final token = _token;
    if (!ready || token == null || api.token == null) return;
    try {
      await api.delete('/push/device', query: {'token': token});
    } catch (_) {}
  }

  /// Opens a notification that was tapped before the app was ready.
  void openPending() {
    final link = _pending;
    _pending = null;
    if (link != null) _open(link);
  }

  void _open(String? link) {
    if (link == null) return;
    if (canOpen?.call() == true && onOpen != null) {
      onOpen!(link);
    } else {
      _pending = link;
    }
  }

  Future<void> _showWhileOpen(RemoteMessage m) async {
    final n = m.notification;
    final id = m.data['id']?.toString() ?? '';
    if (id.isNotEmpty) onForeground?.call(id);
    if (n == null) return;
    await _local.show(
      id: id.hashCode & 0x7fffffff,
      title: n.title,
      body: n.body,
      payload: m.data['link']?.toString() ?? '',
      notificationDetails: NotificationDetails(
        android: AndroidNotificationDetails(
          channel.id,
          channel.name,
          channelDescription: channel.description,
          importance: Importance.high,
          priority: Priority.high,
          icon: 'ic_notification',
          color: const Color(0xFFD91E45),
          styleInformation: BigTextStyleInformation(n.body ?? ''),
        ),
      ),
    );
  }
}
