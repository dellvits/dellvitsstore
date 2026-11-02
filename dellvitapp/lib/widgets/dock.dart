import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/theme.dart';

/// One tab in the [Dock].
class DockItem {
  const DockItem(this.icon, this.selectedIcon, this.label, {this.badge, this.dot = false});
  final IconData icon, selectedIcon;
  final String label;

  /// A number on the icon, e.g. how many items are in the cart.
  final String? badge;

  /// A small dot on the icon, e.g. unread messages.
  final bool dot;
}

/// The floating tab bar along the bottom of every workspace. The chosen tab grows into a tinted
/// pill with its name; a soft highlight slides between tabs.
class Dock extends StatelessWidget {
  const Dock({super.key, required this.index, required this.items, required this.onTap});
  final int index;
  final List<DockItem> items;
  final ValueChanged<int> onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 4, 12, 10),
        child: Container(
          height: 66,
          padding: const EdgeInsets.symmetric(horizontal: 6),
          decoration: BoxDecoration(
            color: c.surface,
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: c.line.withValues(alpha: 0.7)),
            boxShadow: const [
              BoxShadow(color: Color(0x1A1C1420), blurRadius: 24, offset: Offset(0, 8)),
              BoxShadow(color: Color(0x0A1C1420), blurRadius: 4, offset: Offset(0, 1)),
            ],
          ),
          child: Row(
            children: [
              for (var i = 0; i < items.length; i++)
                Expanded(
                  flex: i == index ? 7 : 3,
                  child: _DockButton(
                    item: items[i],
                    selected: i == index,
                    onTap: () {
                      if (i != index) HapticFeedback.selectionClick();
                      onTap(i);
                    },
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _DockButton extends StatelessWidget {
  const _DockButton({required this.item, required this.selected, required this.onTap});
  final DockItem item;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final icon = Icon(selected ? item.selectedIcon : item.icon, size: 24, color: selected ? c.brand : c.muted);
    return Semantics(
      button: true,
      selected: selected,
      label: item.label,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Center(
          // On a narrow phone the chosen tab shrinks to fit rather than overflowing.
          child: FittedBox(
            fit: BoxFit.scaleDown,
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 320),
              curve: Curves.easeOutCubic,
              height: 46,
              padding: EdgeInsets.symmetric(horizontal: selected ? 12 : 0),
              decoration: BoxDecoration(
                color: selected ? c.brand50 : Colors.transparent,
                borderRadius: BorderRadius.circular(16),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Badge(
                    isLabelVisible: item.badge != null || item.dot,
                    label: item.badge == null ? null : Text(item.badge!),
                    smallSize: 9,
                    backgroundColor: c.brand,
                    child: icon,
                  ),
                  // The name slides out beside the chosen tab's icon.
                  AnimatedSize(
                    duration: const Duration(milliseconds: 320),
                    curve: Curves.easeOutCubic,
                    child: selected
                        ? Padding(
                            padding: const EdgeInsets.only(left: 8),
                            child: Text(
                              item.label,
                              maxLines: 1,
                              overflow: TextOverflow.fade,
                              softWrap: false,
                              style: TextStyle(color: c.brand, fontSize: 13, fontWeight: FontWeight.w800),
                            ),
                          )
                        : const SizedBox.shrink(),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
