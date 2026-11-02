import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// The short sound that plays with the Dellvit logo on the launch screen
/// (assets/sounds/splash.wav, made by tool/make_splash_sound.cjs).
///
/// Loading starts in main(), before the first frame, so the sound is ready when the logo starts.
/// It plays at media volume through Android's short-sound player, without pausing music that is
/// playing, and not at all while the phone is on silent or vibrate.
class LaunchSound {
  LaunchSound._();

  static const _channel = MethodChannel('dellvit/sound');
  static Future<AudioPlayer?>? _ready;
  static final _watch = Stopwatch();

  /// Starts getting the sound ready. Safe to call more than once.
  static void preload() {
    _watch.start();
    _ready ??= _load();
  }

  /// The ready sound, or null when it is off, the phone is silent, or it could not load.
  static Future<AudioPlayer?> get ready => _ready ?? Future.value(null);

  static Future<AudioPlayer?> _load() async {
    try {
      // On silent or vibrate the launch stays quiet.
      if (await _channel.invokeMethod<bool>('ringerNormal') == false) return null;
      final p = AudioPlayer();
      await p.setPlayerMode(PlayerMode.lowLatency);
      await p.setAudioContext(
        AudioContext(
          android: const AudioContextAndroid(
            contentType: AndroidContentType.sonification,
            usageType: AndroidUsageType.media,
            audioFocus: AndroidAudioFocus.none,
          ),
        ),
      );
      await p.setReleaseMode(ReleaseMode.stop);
      await p.setSource(AssetSource('sounds/splash.wav'));
      if (!kReleaseMode) debugPrint('Launch sound ready after ${_watch.elapsedMilliseconds} ms');
      return p;
    } catch (e) {
      debugPrint('The launch sound could not load: $e');
      return null;
    }
  }

  /// Lets go of the sound once it has finished.
  static void release() {
    final ready = _ready;
    _ready = null;
    ready?.then((p) => Future<void>.delayed(const Duration(seconds: 4), () => p?.dispose().catchError((_) {})));
  }
}
