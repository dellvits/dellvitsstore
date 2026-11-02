import 'package:flutter/material.dart';
import 'package:image_cropper/image_cropper.dart';
import 'package:image_picker/image_picker.dart';

/// Lets the person choose a picture (any format the phone can open, HEIC included) and crop or
/// turn it before it is uploaded. Answers the file to upload, or null when they backed out.
/// The picture keeps its full quality here; the server stores it as WebP.
Future<String?> pickAndCropImage(
  BuildContext context, {
  ImageSource source = ImageSource.gallery,
  String title = 'Crop picture',
  bool square = false,
}) async {
  final brand = Theme.of(context).colorScheme.primary;
  final picked = await ImagePicker().pickImage(source: source, requestFullMetadata: false);
  if (picked == null) return null;
  final cropped = await ImageCropper().cropImage(
    sourcePath: picked.path,
    // JPEG at top quality: every phone can write it, and the server turns it into WebP.
    compressFormat: ImageCompressFormat.jpg,
    compressQuality: 95,
    maxWidth: 3000,
    maxHeight: 3000,
    uiSettings: [
      AndroidUiSettings(
        toolbarTitle: title,
        toolbarColor: brand,
        toolbarWidgetColor: Colors.white,
        statusBarLight: false,
        activeControlsWidgetColor: brand,
        initAspectRatio: square ? CropAspectRatioPreset.square : CropAspectRatioPreset.original,
        lockAspectRatio: false,
        aspectRatioPresets: [
          CropAspectRatioPreset.original,
          CropAspectRatioPreset.square,
          CropAspectRatioPreset.ratio4x3,
          CropAspectRatioPreset.ratio3x2,
          CropAspectRatioPreset.ratio16x9,
        ],
      ),
    ],
  );
  return cropped?.path;
}
