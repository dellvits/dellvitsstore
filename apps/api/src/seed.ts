import './platform.js';
import './riders.js';
import { randomUUID } from 'node:crypto';
import { db, one, run, transaction } from './db.js';
import { hashPassword } from './security.js';
export function seed() {
  if (one('SELECT id FROM locations LIMIT 1')) return;
  transaction(() => {
    for (const row of [
      ['rawalpindi', '6th Road, Rawalpindi', 33.6442, 73.0713],
      ['satellite-town', 'Satellite Town, Rawalpindi', 33.6523, 73.0645],
      ['islamabad', 'F-10, Islamabad', 33.6955, 73.0122],
    ])
      run('INSERT INTO locations VALUES(?,?,?,?)', ...row);
    const createUser = (
      id: string,
      name: string,
      email: string,
      role: string,
      login: string | null,
      loc = 'rawalpindi',
    ) =>
      run(
        'INSERT INTO users(id,name,email,phone,address,location_id,password_hash,role,login_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
        id,
        name,
        email,
        '03001234567',
        '6th Road, Rawalpindi',
        loc,
        hashPassword('Dellvit@2026'),
        role,
        login,
        new Date().toISOString(),
      );
    createUser('admin-1', 'Dellvit Admin', 'admin@dellvit.local', 'admin', null);
    run("INSERT OR IGNORE INTO admin_access VALUES('admin-1',1,'[]')");
    for (const name of ['Food', 'Groceries', 'Parcels', 'More'])
      run(
        'INSERT OR IGNORE INTO platform_records VALUES(?,?,?)',
        'categories',
        name,
        JSON.stringify({
          name,
          description: '',
          image: '',
          active: true,
          position: 0,
          show_on_home: true,
        }),
      );
    for (const [id, method] of Object.entries({
      'demo-bank': {
        name: 'Bank transfer (demo)',
        type: 'bank',
        bank_name: 'Meezan Bank',
        account_title: 'Dellvit Demo',
        account_number: '0123456789012',
        iban: 'PK36MEZN0000000123456789',
        instructions: 'Transfer the order total, then enter the transaction ID from your receipt.',
        require_proof: false,
        position: 1,
      },
      'demo-wallet': {
        name: 'Easypaisa (demo)',
        type: 'wallet',
        provider: 'Easypaisa',
        account_title: 'Dellvit Demo',
        mobile_number: '03001234567',
        instructions: 'Send money to this Easypaisa account and enter the TID.',
        require_proof: false,
        position: 2,
      },
    }))
      run(
        'INSERT OR IGNORE INTO platform_records VALUES(?,?,?)',
        'payments',
        id,
        JSON.stringify({ active: true, ...method }),
      );
    createUser('customer-1', 'Ayesha Khan', 'customer@dellvit.local', 'customer', null);
    createUser('rider-1', 'Ali Hassan', 'rider@dellvit.local', 'rider', 'DRV-001');
    createUser('rider-2', 'Bilal Ahmed', 'rider2@dellvit.local', 'rider', 'DRV-002', 'islamabad');
    run("INSERT INTO rider_settings VALUES('rider-1','fixed',10000,'delivery_fee')");
    run("INSERT INTO rider_settings VALUES('rider-2','percent',80,'delivery_fee')");
    const outlets = [
      [
        'outlet-1',
        'The Burger Kitchen',
        'Food',
        'food.webp',
        'DLV-001',
        'rawalpindi',
        33.6435,
        73.0698,
      ],
      [
        'outlet-2',
        'Fresh Basket',
        'Groceries',
        'groceries.webp',
        'DLV-002',
        'rawalpindi',
        33.6451,
        73.0704,
      ],
      [
        'outlet-3',
        'Dellvit Parcel Point',
        'Parcels',
        'parcel.webp',
        'DLV-003',
        'rawalpindi',
        33.6433,
        73.0701,
      ],
      [
        'outlet-4',
        'Everyday Essentials',
        'More',
        'essentials.webp',
        'DLV-004',
        'satellite-town',
        33.6526,
        73.0647,
      ],
      [
        'outlet-5',
        'Capital Burger Co.',
        'Food',
        'food.webp',
        'DLV-005',
        'islamabad',
        33.6957,
        73.0114,
      ],
    ];
    for (const [id, name, category, image, customer, loc, lat, lng] of outlets) {
      const uid = 'user-' + id;
      createUser(
        uid,
        String(name),
        String(id) + '@dellvit.local',
        'outlet',
        String(customer),
        String(loc),
      );
      const location = one('SELECT name FROM locations WHERE id=?', loc)!;
      run(
        'INSERT INTO outlets VALUES(?,?,?,?,?,?,?,?,?,?,?, ?,?)',
        id,
        name,
        '03001234567',
        String(id) + '@dellvit.local',
        loc,
        location.name,
        lat,
        lng,
        customer,
        uid,
        1,
        '/images/' + image,
        category,
      );
    }
    const products = [
      [
        'The classic burger meal',
        'Juicy chicken burger, crisp fries and a chilled drink.',
        'Food',
        69000,
        30,
        '1 meal',
        'outlet-1',
        'rawalpindi',
        15,
        'Lunch favourite',
        'food.webp',
        'Chicken burger, regular fries, 250ml drink',
        'Extra sauces and additional toppings',
      ],
      [
        'Family burger box',
        'Make a night of it with four complete burger meals.',
        'Food',
        239000,
        15,
        '4 meals',
        'outlet-1',
        'rawalpindi',
        10,
        'Family deal',
        'food.webp',
        '4 chicken burgers, 4 fries, 4 drinks',
        'Extra cheese',
      ],
      [
        'Fresh weekly basket',
        'A colourful mix of fresh seasonal produce.',
        'Groceries',
        145000,
        40,
        '1 basket',
        'outlet-2',
        'rawalpindi',
        10,
        'Fresh picks',
        'groceries.webp',
        'Tomatoes, carrots, leafy greens, seasonal fruit (approx. 3kg)',
        'Crate and imported fruit',
      ],
      [
        'Daily kitchen essentials',
        'Fresh produce to get your everyday cooking sorted.',
        'Groceries',
        85000,
        25,
        '2 kg',
        'outlet-2',
        'rawalpindi',
        0,
        '',
        'groceries.webp',
        'Seasonal vegetables, approx. 2 kg',
        'Fruit and pantry staples',
      ],
      [
        'Local parcel delivery',
        'Secure point-to-point delivery within your selected area.',
        'Parcels',
        25000,
        100,
        'up to 2 kg',
        'outlet-3',
        'rawalpindi',
        0,
        'Same area delivery',
        'parcel.webp',
        'One parcel pickup from the outlet and delivery',
        'Packaging, fragile goods, valuables, prohibited items',
      ],
      [
        'Home care basket',
        'The practical essentials for a fresh, tidy home.',
        'More',
        185000,
        20,
        '1 basket',
        'outlet-4',
        'satellite-town',
        5,
        'Home refresh',
        'essentials.webp',
        'Dish soap, surface cleaner, tissues and sponges',
        'Basket and any medicines',
      ],
      [
        'Capital crispy meal',
        'A crispy chicken burger with your favourite sides.',
        'Food',
        79000,
        30,
        '1 meal',
        'outlet-5',
        'islamabad',
        10,
        'Lunch favourite',
        'food.webp',
        'Chicken burger, fries and drink',
        'Extra toppings',
      ],
    ];
    for (const [i, p] of products.entries()) {
      const [name, desc, cat, price, stock, unit, outlet, loc, discount, deal, img, inc, exc] = p;
      run(
        'INSERT INTO products VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        'product-' + (i + 1),
        outlet,
        name,
        desc,
        cat,
        price,
        stock,
        unit,
        loc,
        discount,
        deal,
        JSON.stringify(['/images/' + img]),
        inc,
        exc,
        cat === 'Parcels' ? 45 : 30,
        1,
      );
    }
    run(
      'INSERT INTO settings VALUES(?,?)',
      'ad',
      JSON.stringify({
        title: 'Your next favourite is around the corner.',
        description: 'Discover local flavours and everyday essentials with Dellvit.',
        label: 'DELLVIT PICKS',
        link: '/search',
        image: '/images/rider.webp',
        active: true,
      }),
    );
  });
  console.log('Demo data ready. See README for local demo accounts.');
}
if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  seed();
  db.close();
}
