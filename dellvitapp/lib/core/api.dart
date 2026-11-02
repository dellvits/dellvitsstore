import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

import 'config.dart';

/// A failed request. [code] names failures the app reacts to, such as `verify_email`.
class ApiException implements Exception {
  ApiException(this.message, {this.status = 0, this.code, this.data = const {}, this.network = false});
  final String message;
  final int status;
  final String? code;
  final Map<String, dynamic> data;

  /// True when the server was never reached: no internet, a weak connection or a timeout.
  final bool network;

  @override
  String toString() => message;
}

/// The message to show for anything a request can throw.
String errorText(Object error) => error is ApiException ? error.message : 'Something went wrong. Please try again.';

/// Talks to the Dellvit API. Signed-in requests carry the bearer token the server issues to
/// mobile clients; no cookies are kept.
class Api {
  Api._();
  static final Api instance = Api._();

  final http.Client _client = http.Client();
  String? token;

  /// Called when the server no longer accepts the saved token.
  void Function()? onSessionExpired;

  /// Headers for loading private files (receipts, chat attachments) as images.
  Map<String, String> get authHeaders => {
    'User-Agent': AppConfig.userAgent,
    if (token != null) 'Authorization': 'Bearer $token',
  };

  Map<String, String> _headers({bool json = false}) => {
    'Accept': 'application/json',
    'X-Client': 'mobile',
    if (json) 'Content-Type': 'application/json',
    ...authHeaders,
  };

  Uri _uri(String path, [Map<String, String?>? query]) {
    final uri = Uri.parse(AppConfig.api + path);
    final extra = <String, String>{
      for (final e in (query ?? const <String, String?>{}).entries)
        if (e.value != null && e.value!.isNotEmpty) e.key: e.value!,
    };
    if (extra.isEmpty) return uri;
    return uri.replace(queryParameters: {...uri.queryParameters, ...extra});
  }

  Future<dynamic> get(String path, {Map<String, String?>? query}) =>
      _run(() => _client.get(_uri(path, query), headers: _headers()));

  Future<dynamic> post(String path, [Object? body]) => _send('POST', path, body);
  Future<dynamic> put(String path, [Object? body]) => _send('PUT', path, body);
  Future<dynamic> patch(String path, [Object? body]) => _send('PATCH', path, body);
  Future<dynamic> delete(String path, {Map<String, String?>? query}) =>
      _run(() => _client.delete(_uri(path, query), headers: _headers()));

  Future<dynamic> _send(String method, String path, Object? body) => _run(() async {
    var uri = _uri(path);
    // When the site moves to a new address, the old one answers with a redirect. The http
    // package follows those only for GET, so a login or sign-up is sent again to the new address
    // here (secure addresses only, a few hops at most).
    for (var hop = 0; ; hop++) {
      final request = http.Request(method, uri)
        ..followRedirects = false
        ..headers.addAll(_headers(json: true))
        ..body = jsonEncode(body ?? const <String, dynamic>{});
      final response = await http.Response.fromStream(await _client.send(request));
      final next = response.headers['location'];
      final moved = response.statusCode == 307 || response.statusCode == 308;
      if (moved && next != null && hop < 3) {
        final target = uri.resolve(next);
        if (target.scheme == 'https') {
          uri = target;
          continue;
        }
      }
      return response;
    }
  });

  /// Sends one file as multipart form data in the `file` field, as the upload routes expect.
  Future<dynamic> upload(String path, String filePath, {Map<String, String> fields = const {}}) => _run(() async {
    final request = http.MultipartRequest('POST', _uri(path))
      ..headers.addAll(_headers())
      ..fields.addAll(fields)
      ..files.add(await http.MultipartFile.fromPath('file', filePath));
    return http.Response.fromStream(await _client.send(request));
  }, timeout: const Duration(seconds: 90));

  Future<dynamic> _run(
    Future<http.Response> Function() call, {
    Duration timeout = const Duration(seconds: 40),
  }) async {
    final http.Response response;
    try {
      response = await call().timeout(timeout);
    } on SocketException {
      throw ApiException('No internet connection. Check your network and try again.', network: true);
    } on TimeoutException {
      throw ApiException('The server took too long to answer. Please try again.', network: true);
    } on http.ClientException {
      throw ApiException('Could not reach Dellvit. Check your connection and try again.', network: true);
    } on HandshakeException {
      throw ApiException('A secure connection could not be made. Please try again.', network: true);
    }
    dynamic data;
    try {
      data = response.body.isEmpty ? null : jsonDecode(utf8.decode(response.bodyBytes));
    } catch (_) {
      data = null;
    }
    if (response.statusCode >= 200 && response.statusCode < 300) return data;
    final map = data is Map<String, dynamic> ? data : const <String, dynamic>{};
    if (response.statusCode == 401 && token != null) onSessionExpired?.call();
    throw ApiException(
      map['error'] is String ? map['error'] as String : _fallback(response.statusCode),
      status: response.statusCode,
      code: map['code'] is String ? map['code'] as String : null,
      data: map,
    );
  }

  String _fallback(int status) {
    if (status == 413) return 'That file is too large. Choose a smaller picture.';
    if (status == 429) return 'Too many attempts. Please wait a moment and try again.';
    if (status >= 500) return 'Dellvit is having trouble right now. Please try again shortly.';
    return 'Request failed. Please try again.';
  }
}
