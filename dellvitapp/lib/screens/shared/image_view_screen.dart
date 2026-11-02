import 'package:flutter/material.dart';

import '../../widgets/common.dart';

/// A picture on its own, with pinch to zoom: receipts and chat attachments.
class ImageViewScreen extends StatelessWidget {
  const ImageViewScreen({super.key, required this.path, this.title = 'Picture', this.private = false});
  final String path, title;
  final bool private;

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: Colors.black,
    appBar: AppBar(
      backgroundColor: Colors.black,
      foregroundColor: Colors.white,
      title: Text(title, style: const TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.w700)),
    ),
    body: InteractiveViewer(
      maxScale: 5,
      child: Center(child: NetImage(path, fit: BoxFit.contain, private: private)),
    ),
  );
}
