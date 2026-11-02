import 'package:dellvit/core/config.dart';
import 'package:dellvit/core/format.dart';
import 'package:dellvit/models/models.dart';
import 'package:dellvit/screens/customer/checkout_screen.dart';
import 'package:dellvit/state/app_state.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  test('money shows paisa as rupees', () {
    expect(money(14550), 'Rs 145.5');
    expect(money(100000), 'Rs 1,000');
    expect(money(0), 'Rs 0');
  });

  test('labels and opening hours read naturally', () {
    expect(label('picked_up'), 'Picked Up');
    expect(openingHours('09:00', '23:30'), '9 am – 11:30 pm');
    expect(openingHours('', ''), '');
  });

  test('server paths become full addresses', () {
    expect(AppConfig.url('/api/media/a.webp'), '${AppConfig.origin}/api/media/a.webp');
    expect(AppConfig.url('https://example.com/x.png'), 'https://example.com/x.png');
    expect(AppConfig.url(''), '');
  });

  test('checkout keys are version 4 UUIDs', () {
    final id = checkoutId();
    expect(RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$').hasMatch(id), isTrue);
    expect(checkoutId(), isNot(id));
  });

  test('a product from the API keeps its cart limits', () {
    final p = Product.fromJson({
      'id': 'p1',
      'outlet_id': 'o1',
      'name': 'Cherry',
      'price': 15000,
      'effective_price': 14550,
      'stock': 5,
      'max_per_order': 99,
      'discount': 3,
      'images': ['/api/media/x.webp'],
      'payment_methods': ['cod'],
      'active': 1,
    });
    expect(p.maxQuantity, 5);
    expect(p.image, '/api/media/x.webp');
    expect(CartItem(p, 2).total, 29100);
  });

  test('an order knows what the customer should read', () {
    final o = Order.fromJson({
      'id': 'x',
      'reference': 'DLV-1',
      'status': 'placed',
      'payment_type': 'bank',
      'payment_status': 'submitted',
      'flow': {'payment_verified_at': null, 'outlet_status': 'unsent', 'rider_status': 'unsent'},
      'items': [
        {'id': 'i', 'name': 'Cherry', 'quantity': 2, 'unit_price': 14550, 'image': ''},
      ],
    });
    expect(o.paymentLabel, 'Verifying');
    expect(o.customerHeadline, 'Verifying payment');
    expect(o.itemsText, '2× Cherry');
    expect(o.closed, isFalse);
  });

  test('new installs start in the light theme; a chosen look is remembered', () async {
    SharedPreferences.setMockInitialValues({});
    final fresh = AppState()..readLook(await SharedPreferences.getInstance());
    expect(fresh.themeMode, ThemeMode.light);
    expect(fresh.startupSound, isTrue);

    await fresh.setThemeMode(ThemeMode.dark);
    await fresh.setStartupSound(false);
    final again = AppState()..readLook(await SharedPreferences.getInstance());
    expect(again.themeMode, ThemeMode.dark);
    expect(again.startupSound, isFalse);
  });
}
