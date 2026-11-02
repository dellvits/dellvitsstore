import 'dart:async';

import 'package:flutter/foundation.dart';

import 'api.dart';

/// Data loaded from the server, with its loading and error state. With [every] it is re-read in
/// the background on that interval, which keeps order screens live without sockets.
class Resource<T> extends ChangeNotifier {
  Resource(this._fetch, {this.every});

  final Future<T> Function() _fetch;
  final Duration? every;

  T? data;
  String? error;
  bool loading = true;

  Timer? _timer;
  bool _disposed = false;
  int _run = 0;

  void start() {
    refresh();
    if (every != null) _timer = Timer.periodic(every!, (_) => refresh(silent: true));
  }

  /// A silent refresh keeps what is on screen and ignores a failed attempt.
  Future<void> refresh({bool silent = false}) async {
    final run = ++_run;
    if (!silent) {
      loading = true;
      _changed();
    }
    try {
      final value = await _fetch();
      if (_disposed || run != _run) return;
      data = value;
      error = null;
    } catch (e) {
      if (_disposed || run != _run) return;
      if (!silent || data == null) error = errorText(e);
    }
    loading = false;
    _changed();
  }

  void set(T value) {
    data = value;
    _changed();
  }

  void _changed() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _timer?.cancel();
    super.dispose();
  }
}
