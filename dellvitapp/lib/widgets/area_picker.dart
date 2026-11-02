import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/format.dart';
import '../core/theme.dart';
import '../models/models.dart';
import '../state/app_state.dart';
import 'common.dart';

/// The sheet where a customer chooses where they want delivery.
Future<void> showAreaPicker(BuildContext context) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  useSafeArea: true,
  builder: (_) => const _AreaSheet(),
);

class _AreaSheet extends StatelessWidget {
  const _AreaSheet();

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final app = context.watch<AppState>();
    final detecting = app.areaStatus == AreaStatus.detecting;
    return ConstrainedBox(
      constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.8),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 4),
            child: Text('Where should we deliver?', style: context.t.headlineSmall),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 14),
            child: Text(
              'Products and outlets are shown for your delivery area.',
              style: context.t.bodyMedium!.copyWith(color: c.muted),
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: AppCard(
              color: c.brand50,
              borderColor: c.brand100,
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              onTap: detecting
                  ? null
                  : () async {
                      final problem = await app.detectArea();
                      if (!context.mounted) return;
                      if (problem == null) {
                        Navigator.pop(context);
                        app.notice('Delivering to ${app.area?.name}.');
                      } else {
                        app.notice(problem);
                      }
                    },
              child: Row(
                children: [
                  detecting
                      ? SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.4, color: c.brand))
                      : Icon(Icons.my_location_rounded, color: c.brand),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      detecting ? 'Finding your location…' : 'Use my current location',
                      style: context.t.titleSmall!.copyWith(color: c.brand),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 8),
          Flexible(
            child: app.areas.isEmpty
                ? const Padding(
                    padding: EdgeInsets.all(24),
                    child: Text('No delivery areas are open right now.'),
                  )
                : ListView.builder(
                    shrinkWrap: true,
                    padding: const EdgeInsets.fromLTRB(8, 0, 8, 16),
                    itemCount: app.areas.length + 1,
                    itemBuilder: (context, i) {
                      if (i == 0) {
                        final selected = app.area?.isNationwide ?? false;
                        return ListTile(
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                          leading: IconBubble(Icons.public_rounded, tone: selected ? Tone.brand : Tone.neutral, size: 40),
                          title: const Text('Nation Wide'),
                          subtitle: const Text('Products and outlets from every area in Pakistan'),
                          trailing: selected ? Icon(Icons.check_circle_rounded, color: c.brand) : null,
                          onTap: () {
                            app.setArea(Area.nationwide);
                            Navigator.pop(context);
                          },
                        );
                      }
                      final a = app.areas[i - 1];
                      final selected = a.id == app.area?.id;
                      final here = app.coords;
                      final km = here == null ? null : distanceKm(here.lat, here.lng, a.lat, a.lng);
                      return ListTile(
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                        leading: IconBubble(Icons.location_on_outlined, tone: selected ? Tone.brand : Tone.neutral, size: 40),
                        title: Text(a.name),
                        subtitle: Text(
                          [
                            a.fee > 0 ? 'Delivery ${money(a.fee)}' : 'Free delivery',
                            if (a.freeDeliveryOver > 0 && a.fee > 0) 'free over ${money(a.freeDeliveryOver)}',
                            // A far-away figure (a phone abroad, a wrong fix) helps nobody.
                            if (km != null && km < 100) '${km.toStringAsFixed(1)} km away',
                          ].join(' · '),
                        ),
                        trailing: selected ? Icon(Icons.check_circle_rounded, color: c.brand) : null,
                        onTap: () {
                          app.setArea(a);
                          Navigator.pop(context);
                        },
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}

/// Shown where products would be, when no delivery area is chosen yet.
class ChooseArea extends StatelessWidget {
  const ChooseArea({super.key});

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    return EmptyState(
      icon: Icons.location_on_outlined,
      title: app.areaStatus == AreaStatus.outside
          ? 'We don’t deliver to your location yet'
          : 'Choose your delivery area',
      message: 'Products and outlets are shown for the area you choose.',
      action: 'Select area',
      onAction: () => showAreaPicker(context),
    );
  }
}
