import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../core/api.dart';
import '../core/config.dart';
import '../core/format.dart';
import '../core/location.dart';
import '../core/theme.dart';
import '../models/models.dart';
import 'common.dart';

const _tiles = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

TileLayer _tileLayer() => TileLayer(urlTemplate: _tiles, userAgentPackageName: AppConfig.packageName, maxZoom: 19);

Widget _credit(BuildContext context) => Align(
  alignment: Alignment.bottomRight,
  child: Container(
    margin: const EdgeInsets.all(6),
    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
    decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.85), borderRadius: BorderRadius.circular(6)),
    child: const Text('© OpenStreetMap', style: TextStyle(fontSize: 9.5, color: Color(0xFF3A3240), height: 1.2)),
  ),
);

class _Pin extends StatelessWidget {
  const _Pin(this.icon, this.color);
  final IconData icon;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
    decoration: BoxDecoration(
      color: color,
      shape: BoxShape.circle,
      border: Border.all(color: Colors.white, width: 3),
      boxShadow: const [BoxShadow(color: Color(0x40000000), blurRadius: 8, offset: Offset(0, 3))],
    ),
    child: Icon(icon, color: Colors.white, size: 18),
  );
}

/// Shows where an order is going: the outlet, the doorstep and, while it is on its way, the rider.
class DeliveryMap extends StatelessWidget {
  const DeliveryMap({super.key, required this.drop, this.pickup, this.rider, this.height = 210});
  final LatLng drop;
  final LatLng? pickup, rider;
  final double height;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final points = [drop, ?pickup, ?rider];
    final spread = points.length > 1 && points.any((p) => p.latitude != drop.latitude || p.longitude != drop.longitude);
    return ClipRRect(
      borderRadius: BorderRadius.circular(16),
      child: SizedBox(
        height: height,
        child: Stack(
          children: [
            FlutterMap(
              // A new set of points (the rider appeared) re-frames the map.
              key: ValueKey('${pickup != null}-${rider != null}'),
              options: MapOptions(
                initialCenter: drop,
                initialZoom: 15,
                initialCameraFit: spread
                    ? CameraFit.bounds(bounds: LatLngBounds.fromPoints(points), padding: const EdgeInsets.all(46), maxZoom: 16)
                    : null,
                interactionOptions: const InteractionOptions(flags: InteractiveFlag.all & ~InteractiveFlag.rotate),
              ),
              children: [
                _tileLayer(),
                if (pickup != null)
                  PolylineLayer(
                    polylines: [
                      Polyline(points: [pickup!, ?rider, drop], color: c.brand.withValues(alpha: 0.55), strokeWidth: 3.5),
                    ],
                  ),
                MarkerLayer(
                  markers: [
                    if (pickup != null)
                      Marker(point: pickup!, width: 38, height: 38, child: _Pin(Icons.storefront_rounded, c.orange)),
                    Marker(point: drop, width: 38, height: 38, child: _Pin(Icons.home_rounded, c.brand)),
                    if (rider != null)
                      Marker(point: rider!, width: 42, height: 42, child: _Pin(Icons.two_wheeler_rounded, c.green)),
                  ],
                ),
              ],
            ),
            _credit(context),
          ],
        ),
      ),
    );
  }
}

/// A small map preview of one point, used at checkout.
class PinPreview extends StatelessWidget {
  const PinPreview({super.key, required this.point, this.height = 150, this.onTap});
  final LatLng point;
  final double height;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => ClipRRect(
    borderRadius: BorderRadius.circular(16),
    child: SizedBox(
      height: height,
      child: Stack(
        children: [
          FlutterMap(
            key: ValueKey('${point.latitude},${point.longitude}'),
            options: MapOptions(
              initialCenter: point,
              initialZoom: 16,
              interactionOptions: const InteractionOptions(flags: InteractiveFlag.none),
            ),
            children: [
              _tileLayer(),
              MarkerLayer(
                markers: [Marker(point: point, width: 38, height: 38, child: _Pin(Icons.home_rounded, context.c.brand))],
              ),
            ],
          ),
          _credit(context),
          Positioned.fill(
            child: Material(color: Colors.transparent, child: InkWell(onTap: onTap)),
          ),
        ],
      ),
    ),
  );
}

/// Full-screen picker: the map moves under a fixed pin, as delivery apps do.
class MapPickerScreen extends StatefulWidget {
  const MapPickerScreen({super.key, required this.initial, this.area});
  final LatLng initial;
  final Area? area;

  @override
  State<MapPickerScreen> createState() => _MapPickerScreenState();
}

class _MapPickerScreenState extends State<MapPickerScreen> {
  final _map = MapController();
  late LatLng _center = widget.initial;
  bool _locating = false;

  double get _km {
    final a = widget.area;
    return a == null ? 0 : distanceKm(_center.latitude, _center.longitude, a.lat, a.lng);
  }

  Future<void> _locate() async {
    setState(() => _locating = true);
    try {
      final p = await currentPosition();
      final here = LatLng(p.lat, p.lng);
      _map.move(here, 17);
      setState(() => _center = here);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(e))));
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  @override
  void dispose() {
    _map.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final area = widget.area;
    final outside = area != null && _km > area.radius;
    return Scaffold(
      appBar: AppBar(title: const Text('Pin your doorstep')),
      body: Stack(
        children: [
          FlutterMap(
            mapController: _map,
            options: MapOptions(
              initialCenter: widget.initial,
              initialZoom: 16,
              interactionOptions: const InteractionOptions(flags: InteractiveFlag.all & ~InteractiveFlag.rotate),
              onPositionChanged: (camera, hasGesture) {
                _center = camera.center;
                // The first report arrives while the map is still being laid out.
                if (hasGesture && mounted) setState(() {});
              },
            ),
            children: [
              _tileLayer(),
              if (area != null)
                CircleLayer(
                  circles: [
                    CircleMarker(
                      point: LatLng(area.lat, area.lng),
                      radius: area.radius * 1000,
                      useRadiusInMeter: true,
                      color: c.brand.withValues(alpha: 0.06),
                      borderColor: c.brand.withValues(alpha: 0.45),
                      borderStrokeWidth: 1.5,
                    ),
                  ],
                ),
            ],
          ),
          _credit(context),
          // The pin's tip marks the chosen point, so the icon sits above the centre.
          IgnorePointer(
            child: Center(
              child: Padding(
                padding: const EdgeInsets.only(bottom: 44),
                child: Icon(Icons.location_on_rounded, size: 50, color: c.brand, shadows: const [
                  Shadow(color: Color(0x55000000), blurRadius: 10, offset: Offset(0, 4)),
                ]),
              ),
            ),
          ),
          Positioned(
            right: 16,
            bottom: 16,
            child: FloatingActionButton.small(
              heroTag: 'locate',
              backgroundColor: c.surface,
              foregroundColor: c.brand,
              onPressed: _locating ? null : _locate,
              child: _locating
                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2.2))
                  : const Icon(Icons.my_location_rounded),
            ),
          ),
        ],
      ),
      bottomNavigationBar: BottomBar(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (outside) ...[
              Notice(
                'This pin is ${_km.toStringAsFixed(1)} km from ${area.name}. Deliveries reach up to ${_amountKm(area.radius)} km.',
                tone: Tone.amber,
              ),
              const SizedBox(height: 10),
            ] else ...[
              Text('Move the map until the pin is on your door.', style: context.t.bodyMedium!.copyWith(color: c.muted)),
              const SizedBox(height: 10),
            ],
            AppButton('Confirm location', icon: Icons.check_rounded, onPressed: () => Navigator.pop(context, _center)),
          ],
        ),
      ),
    );
  }
}

String _amountKm(double km) => km == km.roundToDouble() ? km.toStringAsFixed(0) : km.toStringAsFixed(1);
