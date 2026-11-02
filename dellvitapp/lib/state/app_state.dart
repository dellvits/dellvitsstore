import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../core/location.dart';
import '../core/push.dart';
import '../models/models.dart';

enum AreaStatus { loading, detecting, ready, outside, unknown }

/// What happened when a product was added to the cart.
enum AddResult { added, soldOut, otherArea, limit, stock }

/// Everything the whole app shares: the signed-in account, the delivery area, the cart,
/// store settings and the notification inbox.
class AppState extends ChangeNotifier with WidgetsBindingObserver {
  final messengerKey = GlobalKey<ScaffoldMessengerState>();
  final navigatorKey = GlobalKey<NavigatorState>();
  final Api api = Api.instance;
  static const _secure = FlutterSecureStorage();
  late SharedPreferences _prefs;

  bool ready = false;
  bool onboarded = false;
  String? bootError;

  /// True when the last start-up load failed because the phone could not reach the server.
  bool bootOffline = false;

  User? user;
  Site site = Site.empty();
  List<Area> areas = [];
  Area? area;
  AreaStatus areaStatus = AreaStatus.loading;
  ({double lat, double lng})? coords;
  List<CartItem> cart = [];

  List<AppNotification> notifications = [];
  int unread = 0;
  int supportUnread = 0;
  Set<String>? _seen;
  Timer? _poll;

  /// Customer tab to show: other screens switch tabs through this.
  int customerTab = 0;

  /// What the search tab should show next; [searchRequest] changes each time another screen asks.
  String searchCategory = 'All';
  String searchQuery = '';
  int searchRequest = 0;

  /// Light, dark, or following the phone. New installs start light.
  ThemeMode themeMode = ThemeMode.light;

  /// Whether the launch screen plays its short sound with the logo.
  bool startupSound = true;

  /// Completed by the launch screen once its logo intro has played; start-up waits for it.
  final introPlayed = Completer<void>();

  /* ---------- Start-up ---------- */

  /// Reads the look of the app before the first frame, so the launch screen already has it.
  void readLook(SharedPreferences prefs) {
    _prefs = prefs;
    themeMode = switch (prefs.getString('theme')) {
      'dark' => ThemeMode.dark,
      'system' => ThemeMode.system,
      _ => ThemeMode.light,
    };
    startupSound = prefs.getBool('startup_sound') ?? true;
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    themeMode = mode;
    notifyListeners();
    await _prefs.setString('theme', mode.name);
  }

  Future<void> setStartupSound(bool on) async {
    startupSound = on;
    notifyListeners();
    await _prefs.setBool('startup_sound', on);
  }

  Future<void> boot() async {
    WidgetsBinding.instance.addObserver(this);
    _prefs = await SharedPreferences.getInstance();
    onboarded = _prefs.getBool('onboarded') ?? false;
    _readCart();
    try {
      final c = jsonDecode(_prefs.getString('coords') ?? 'null');
      if (c is Map) coords = (lat: asDouble(c['lat']), lng: asDouble(c['lng']));
    } catch (_) {}
    try {
      api.token = await _secure.read(key: 'token');
    } catch (_) {
      api.token = null;
    }
    api.onSessionExpired = _sessionExpired;
    // A push that arrives while the app is open is already a banner: the inbox refreshes
    // without its own pop-up for it.
    Push.instance.onForeground = (id) {
      _seen = {...?_seen, id};
      refreshNotifications();
    };
    notifyListeners();
    // The launch screen stays until its logo intro and a moment of the loader have played,
    // however fast the server answers (with a limit, should the screen never report back).
    await Future.wait([
      load(),
      Push.instance.init(),
      introPlayed.future.timeout(const Duration(seconds: 6), onTimeout: () {}),
    ]);
    ready = true;
    notifyListeners();
    // After the introduction, so the permission question does not cover it.
    if (onboarded) Push.instance.register(api);
    // A notification tapped while the app was closed opens once the app is ready.
    WidgetsBinding.instance.addPostFrameCallback((_) => Push.instance.openPending());
  }

  /// Loads areas, store settings and the saved session. Safe to call again after a failure.
  Future<void> load() async {
    bootError = null;
    bootOffline = false;
    try {
      // On a very weak connection the start-up gives up sooner than a single request would,
      // so the person sees the no-internet page instead of a long wait.
      final results = await Future.wait<dynamic>([
        api.get('/locations'),
        api.get('/site'),
        if (api.token != null) api.get('/session'),
      ]).timeout(const Duration(seconds: 20));
      areas = asList(results[0]).map(Area.fromJson).toList();
      site = Site.fromJson(asMap(results[1]));
      if (results.length > 2) {
        final u = asMap(results[2])['user'];
        if (u is Map) {
          user = User.fromJson(asMap(u));
        } else {
          await _forgetToken();
        }
      }
      // People browse Nation Wide until they choose an area themselves.
      area = _areaById(_prefs.getString('area')) ?? Area.nationwide;
      areaStatus = AreaStatus.ready;
      _startPolling();
    } on TimeoutException {
      bootOffline = true;
      bootError = 'Your connection is too slow to load Dellvit right now.';
    } catch (e) {
      bootOffline = e is ApiException && e.network;
      bootError = errorText(e);
    }
    notifyListeners();
  }

  Area? _areaById(String? id) {
    if (id == null || id.isEmpty) return null;
    for (final a in areas) {
      if (a.id == id) return a;
    }
    return null;
  }

  Area? areaById(String? id) => _areaById(id);

  Future<void> finishOnboarding() async {
    onboarded = true;
    await _prefs.setBool('onboarded', true);
    notifyListeners();
    Push.instance.register(api);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && ready) {
      refreshSession();
      refreshNotifications();
      // If linking this phone for notifications failed earlier (no signal, server not ready), try again.
      if (onboarded && !Push.instance.registered) Push.instance.register(api);
    }
  }

  /// Picks up changes made elsewhere: a blocked account, a new area fee, paused ordering.
  Future<void> refreshSession() async {
    try {
      final results = await Future.wait<dynamic>([
        api.get('/locations'),
        api.get('/site'),
        if (api.token != null) api.get('/session'),
      ]);
      areas = asList(results[0]).map(Area.fromJson).toList();
      site = Site.fromJson(asMap(results[1]));
      // An area that has closed falls back to Nation Wide.
      if (area != null && !area!.isNationwide) area = _areaById(area!.id) ?? Area.nationwide;
      area ??= Area.nationwide;
      if (results.length > 2) {
        final u = asMap(results[2])['user'];
        if (u is Map) {
          user = User.fromJson(asMap(u));
        } else {
          await _sessionExpired();
          return;
        }
      }
      notifyListeners();
    } catch (_) {}
  }

  /* ---------- Messages ---------- */

  void notice(String message, {String? actionLabel, VoidCallback? onAction}) {
    final messenger = messengerKey.currentState;
    if (messenger == null) return;
    messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          duration: const Duration(seconds: 3),
          action: actionLabel == null ? null : SnackBarAction(label: actionLabel, onPressed: onAction ?? () {}),
        ),
      );
  }

  /* ---------- Account ---------- */

  Future<void> login(String login, String password) async {
    await _signedIn(await api.post('/auth/login', {'login': login.trim(), 'password': password}));
  }

  /// Creates a customer account. The account opens once the emailed code is entered.
  Future<int> register(Json body) async {
    final r = asMap(await api.post('/auth/register', body));
    return asInt(r['retry_in'], 60);
  }

  Future<void> verifyEmail(String email, String code) async {
    await _signedIn(await api.post('/auth/verify-email', {'email': email, 'code': code}));
  }

  Future<int> resendCode(String email) async {
    final r = asMap(await api.post('/auth/resend-code', {'email': email}));
    return asInt(r['retry_in'], 60);
  }

  /// Forgot password (customers only): emails a 6-digit code. Returns the seconds until another
  /// code may be requested.
  Future<int> forgotPassword(String email) async {
    final r = asMap(await api.post('/auth/forgot-password', {'email': email}));
    return asInt(r['retry_in'], 60);
  }

  /// Swaps a correct reset code for the one-time token that sets the new password.
  Future<String> verifyResetCode(String email, String code) async {
    final r = asMap(await api.post('/auth/forgot-password/verify', {'email': email, 'code': code}));
    return asString(r['reset_token']);
  }

  /// Sets the new password and signs in. Every other device is signed out by the server.
  Future<void> resetPassword(String email, String resetToken, String password) async {
    await _signedIn(
      await api.post('/auth/forgot-password/reset', {'email': email, 'reset_token': resetToken, 'password': password}),
    );
  }

  Future<void> _signedIn(dynamic response) async {
    final r = asMap(response);
    final token = r['token'];
    if (token is! String || r['user'] is! Map) {
      throw ApiException('The server did not start a session. Please try again.');
    }
    api.token = token;
    try {
      await _secure.write(key: 'token', value: token);
    } catch (_) {}
    user = User.fromJson(asMap(r['user']));
    Push.instance.register(api);
    if (area == null) {
      final own = _areaById(user!.locationId);
      if (own != null) setArea(own);
    }
    customerTab = 0;
    _startPolling();
    notifyListeners();
  }

  Future<void> logout() async {
    // This phone stops getting the account's notifications.
    await Push.instance.unregister(api);
    try {
      await api.post('/auth/logout');
    } catch (_) {}
    await _forgetToken();
    user = null;
    customerTab = 0;
    _startPolling();
    notifyListeners();
    // The phone stays on as a guest, for Dellvit's announcements.
    Push.instance.register(api);
  }

  Future<void> _forgetToken() async {
    api.token = null;
    try {
      await _secure.delete(key: 'token');
    } catch (_) {}
  }

  Future<void> _sessionExpired() async {
    if (api.token == null && user == null) return;
    await _forgetToken();
    user = null;
    customerTab = 0;
    _startPolling();
    notifyListeners();
    navigatorKey.currentState?.popUntil((r) => r.isFirst);
    notice('You were signed out. Please log in again.');
  }

  Future<void> updateProfile(Json body) async {
    user = User.fromJson(asMap(await api.patch('/profile', body)));
    notifyListeners();
  }

  Future<void> setMuted(List<String> muted) async {
    await api.put('/notifications/preferences', {'muted': muted});
    await refreshSession();
  }

  /* ---------- Delivery area ---------- */

  void setArea(Area a) {
    area = a;
    areaStatus = AreaStatus.ready;
    _prefs.setString('area', a.id);
    notifyListeners();
  }

  /// Finds the nearest delivery area that covers the phone's position.
  Future<String?> detectArea() async {
    final fallback = area;
    areaStatus = AreaStatus.detecting;
    notifyListeners();
    try {
      final p = await currentPosition();
      coords = (lat: p.lat, lng: p.lng);
      _prefs.setString('coords', jsonEncode({'lat': p.lat, 'lng': p.lng}));
      Area? best;
      double bestKm = double.infinity;
      for (final a in areas) {
        final km = distanceKm(p.lat, p.lng, a.lat, a.lng);
        if (km < bestKm) {
          best = a;
          bestKm = km;
        }
      }
      if (best != null && bestKm <= best.radius) {
        setArea(best);
        return null;
      }
      area = fallback;
      areaStatus = fallback != null ? AreaStatus.ready : AreaStatus.outside;
      notifyListeners();
      return 'We don’t deliver to your location yet. Choose an area to browse.';
    } catch (e) {
      area = fallback;
      areaStatus = fallback != null ? AreaStatus.ready : AreaStatus.unknown;
      notifyListeners();
      return errorText(e);
    }
  }

  /* ---------- App pop-up ---------- */

  bool _popupChecked = false;

  /// The pop-up to show as the storefront opens, if one is due on this phone. Asked once per
  /// launch; how often a pop-up repeats is set by the administrator.
  Future<Json?> duePopup() async {
    if (_popupChecked) return null;
    _popupChecked = true;
    try {
      final data = await api.get('/app/popup', query: {'location': area?.id});
      if (data is! Map) return null;
      final p = asMap(data);
      if (asList(p['products']).isEmpty) return null;
      final last = _prefs.getInt('popup:${asString(p['id'])}');
      final seen = last == null ? null : DateTime.fromMillisecondsSinceEpoch(last);
      final now = DateTime.now();
      final due = switch (asString(p['frequency'], 'daily')) {
        'every_open' => true,
        'once' => seen == null,
        _ => seen == null || seen.year != now.year || seen.month != now.month || seen.day != now.day,
      };
      return due ? p : null;
    } catch (_) {
      // A pop-up is a nice extra; a failure to fetch one is not worth a message.
      return null;
    }
  }

  void popupShown(String id) => _prefs.setInt('popup:$id', DateTime.now().millisecondsSinceEpoch);

  /* ---------- Cart ---------- */

  void _readCart() {
    try {
      final saved = jsonDecode(_prefs.getString('cart') ?? '[]');
      cart = [
        for (final x in asList(saved))
          if (x['product'] is Map && asInt(x['quantity']) > 0)
            CartItem(Product.fromJson(asMap(x['product'])), asInt(x['quantity'])),
      ];
    } catch (_) {
      cart = [];
    }
  }

  void _saveCart() {
    _prefs.setString('cart', jsonEncode(cart.map((i) => i.toJson()).toList()));
    notifyListeners();
  }

  int get cartCount => cart.fold(0, (n, i) => n + i.quantity);
  int get cartSubtotal => cart.fold(0, (n, i) => n + i.total);
  int get cartSavings => cart.fold(0, (n, i) => n + (i.product.price - i.product.effectivePrice) * i.quantity);
  int quantityOf(String productId) {
    for (final i in cart) {
      if (i.product.id == productId) return i.quantity;
    }
    return 0;
  }

  AddResult add(Product p, [int quantity = 1]) {
    if (p.soldOut) return AddResult.soldOut;
    // Products from different outlets share one cart; checkout places one order per outlet.
    if (area != null && !area!.isNationwide && !p.sellsIn(area!.id)) return AddResult.otherArea;
    final wanted = quantityOf(p.id) + quantity;
    if (wanted > p.orderLimit && p.orderLimit < p.stock) return AddResult.limit;
    if (wanted > p.stock) return AddResult.stock;
    final index = cart.indexWhere((i) => i.product.id == p.id);
    if (index >= 0) {
      cart[index] = CartItem(p, wanted);
    } else {
      cart.add(CartItem(p, quantity));
    }
    HapticFeedback.lightImpact();
    _saveCart();
    return AddResult.added;
  }

  void setQuantity(String productId, int quantity) {
    final index = cart.indexWhere((i) => i.product.id == productId);
    if (index < 0) return;
    if (quantity <= 0) {
      cart.removeAt(index);
    } else {
      final max = cart[index].product.maxQuantity;
      cart[index].quantity = quantity > max ? max : quantity;
    }
    HapticFeedback.selectionClick();
    _saveCart();
  }

  void clearCart() {
    cart = [];
    _saveCart();
  }

  /* ---------- Navigation helpers ---------- */

  void goToTab(int index, {String? category, String? query}) {
    customerTab = index;
    if (category != null || query != null) {
      searchCategory = category ?? 'All';
      searchQuery = query ?? '';
      searchRequest++;
    }
    navigatorKey.currentState?.popUntil((r) => r.isFirst);
    notifyListeners();
  }

  /* ---------- Notifications ---------- */

  void _startPolling() {
    _poll?.cancel();
    _seen = null;
    notifications = [];
    unread = 0;
    supportUnread = 0;
    refreshNotifications();
    // Announcements for guests change rarely; an account's own notifications more often.
    _poll = Timer.periodic(Duration(seconds: user == null ? 60 : 15), (_) => refreshNotifications());
  }

  /* Guests: without an account the inbox holds Dellvit's announcements for everyone and for
     customers. What a guest has read or removed is kept on this phone. */

  Set<String> _kept(String key) => (_prefs.getStringList(key) ?? const []).toSet();

  // The newest few hundred are enough to remember.
  Future<void> _keep(String key, Iterable<String> ids) =>
      _prefs.setStringList(key, {...ids, ..._kept(key)}.take(300).toList());

  /// The announcements a guest sees, newest first.
  Future<List<AppNotification>> announcements() async {
    final read = _kept('read_announcements'), removed = _kept('removed_announcements');
    return asList(await api.get('/announcements'))
        .map(AppNotification.fromJson)
        .where((n) => !removed.contains(n.id))
        .map((n) => n..read = read.contains(n.id))
        .toList();
  }

  Future<void> readAnnouncements(Iterable<String> ids) async {
    await _keep('read_announcements', ids);
    await refreshNotifications();
  }

  Future<void> removeAnnouncements(Iterable<String> ids) async {
    await _keep('removed_announcements', ids);
    await refreshNotifications();
  }

  Future<void> _refreshAnnouncements() async {
    try {
      final items = await announcements();
      if (user != null) return;
      notifications = items;
      unread = items.where((n) => !n.read).length;
      supportUnread = 0;
      final known = _seen;
      final fresh = known == null ? <AppNotification>[] : items.where((n) => !n.read && !known.contains(n.id)).toList();
      _seen = {...?known, ...items.map((n) => n.id)};
      notifyListeners();
      if (fresh.isNotEmpty) {
        final n = fresh.first;
        notice(n.body.isEmpty ? n.title : '${n.title}\n${n.body}');
      }
    } catch (_) {}
  }

  Future<void> refreshNotifications() async {
    final me = user;
    if (me == null) return _refreshAnnouncements();
    try {
      final d = asMap(await api.get('/notifications', query: {'limit': '30'}));
      if (user?.id != me.id) return;
      final items = asList(d['items']).map(AppNotification.fromJson).toList();
      notifications = items;
      unread = asInt(d['unread']);
      supportUnread = asInt(d['support_unread']);
      final known = _seen;
      // Silenced kinds still arrive in the inbox, without the pop-up.
      final fresh = known == null
          ? <AppNotification>[]
          : items.where((n) => !n.read && !known.contains(n.id) && !me.notifyMuted.contains(n.type)).toList();
      _seen = {...?known, ...items.map((n) => n.id)};
      notifyListeners();
      if (fresh.isNotEmpty) {
        HapticFeedback.vibrate();
        final n = fresh.first;
        notice(n.body.isEmpty ? n.title : '${n.title}\n${n.body}');
      }
    } catch (_) {}
  }

  Future<void> markRead(AppNotification n, bool read) async {
    if (n.read == read) return;
    n.read = read;
    unread = (unread + (read ? -1 : 1)).clamp(0, 9999);
    notifyListeners();
    if (user == null) {
      if (read) await _keep('read_announcements', [n.id]);
      return;
    }
    try {
      await api.patch('/notifications/${n.id}', {'read': read});
    } catch (_) {}
  }

  /* ---------- Advertising counts ---------- */

  final Set<String> _adViews = {};
  final List<String> _adQueue = [];
  Timer? _adTimer;

  /// Counts an ad once per app session, like the website does per browser session.
  void trackAdView(String id) {
    if (user != null && !user!.isCustomer) return;
    if (!_adViews.add(id)) return;
    _adQueue.add(id);
    _adTimer?.cancel();
    _adTimer = Timer(const Duration(milliseconds: 1500), () {
      final views = _adQueue.take(20).toList();
      _adQueue.clear();
      api.post('/ads/track', {'views': views}).catchError((_) => null);
    });
  }

  void trackAdClick(String id) {
    if (user != null && !user!.isCustomer) return;
    api.post('/ads/track', {'click': id}).catchError((_) => null);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _poll?.cancel();
    _adTimer?.cancel();
    super.dispose();
  }
}
