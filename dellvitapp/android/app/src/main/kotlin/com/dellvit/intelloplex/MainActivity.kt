package com.dellvit.intelloplex

import android.media.AudioManager
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        // The launch sound plays at media volume, but only when the phone is not on silent or
        // vibrate (lib/core/launch_sound.dart asks here).
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "dellvit/sound").setMethodCallHandler { call, result ->
            if (call.method == "ringerNormal") {
                val audio = getSystemService(AUDIO_SERVICE) as AudioManager
                result.success(audio.ringerMode == AudioManager.RINGER_MODE_NORMAL)
            } else {
                result.notImplemented()
            }
        }
    }
}
