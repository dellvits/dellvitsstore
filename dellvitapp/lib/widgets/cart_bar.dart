import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/format.dart';
import '../core/theme.dart';
import '../state/app_state.dart';

/// A floating shortcut to the cart, shown on browsing screens once something is in it.
class CartBar extends StatelessWidget {
  const CartBar({super.key});

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final app = context.watch<AppState>();
    if (app.cart.isEmpty) return const SizedBox.shrink();
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
        child: Material(
          color: Colors.transparent,
          elevation: 8,
          shadowColor: c.brand.withValues(alpha: 0.45),
          borderRadius: BorderRadius.circular(18),
          child: Ink(
            decoration: BoxDecoration(gradient: c.gradient, borderRadius: BorderRadius.circular(18)),
            child: InkWell(
              borderRadius: BorderRadius.circular(18),
              onTap: () => app.goToTab(2),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                      decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.22), borderRadius: BorderRadius.circular(9)),
                      child: Text(
                        '${app.cartCount}',
                        style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 14, height: 1.2),
                      ),
                    ),
                    const SizedBox(width: 12),
                    const Expanded(
                      child: Text(
                        'View cart',
                        style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 15, height: 1.2),
                      ),
                    ),
                    Text(
                      money(app.cartSubtotal),
                      style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 15, height: 1.2),
                    ),
                    const SizedBox(width: 6),
                    const Icon(Icons.arrow_forward_rounded, color: Colors.white, size: 18),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
