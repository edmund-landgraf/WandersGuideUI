import { describe, expect, it } from 'vitest';
import { cartFoundryTitle, cartLineKey, itemCopper } from './shops-cart';
import { shopFolderLabel, shopStockFoundryManifest } from './shops-export';

describe('shop cart', () => {
  it('splits a pack offer into a per-item copper price', () => {
    expect(itemCopper('15 sp for 10')).toBe(15);
    expect(itemCopper('2 gp 5 sp')).toBe(250);
    expect(itemCopper('—')).toBe(0);
  });

  it('keeps the same item from two shops on separate keys', () => {
    const row = { id: 12, name: 'Torch' };
    expect(cartLineKey('shop-a', row)).not.toBe(cartLineKey('shop-b', row));
  });

  it('exports every cart line and dates the shared shop folder', () => {
    const lines = [
      { key: 'a:1', shopId: 'iron', shopName: 'The Iron Measure — Kerse', folderName: 'Kerse', name: 'Backpack Ballista', id: 1, qty: 1, copper: 1800 },
      { key: 'a:2', shopId: 'iron', shopName: 'The Iron Measure — Kerse', folderName: 'Kerse', name: 'Backpack Catapult', id: 2, qty: 1, copper: 2000 },
      { key: 'a:3', shopId: 'iron', shopName: 'The Iron Measure — Kerse', folderName: 'Kerse', name: 'Ballista Bolt', id: 3, qty: 1, copper: 1 },
      { key: 'a:4', shopId: 'iron', shopName: 'The Iron Measure — Kerse', folderName: 'Kerse', name: 'Catapult Stone', id: 4, qty: 1, copper: 1 },
      { key: 'a:5', shopId: 'iron', shopName: 'The Iron Measure — Kerse', folderName: 'Kerse', name: 'Rope', id: 5, qty: 1, copper: 1 },
      { key: 'b:6', shopId: 'arena', shopName: "Barbarous Arena – Fighters' Exchange", folderName: 'Kerse', name: 'Breastplate', id: 6, qty: 1, copper: 1 },
    ];
    const when = new Date(2026, 10, 23);
    const title = cartFoundryTitle(lines, 'Kerse');
    expect(title).toBe('Kerse');
    expect(shopFolderLabel(title, when)).toBe('Kerse 11-23');
    const manifest = shopStockFoundryManifest(title, lines.map((line) => ({ id: line.id, name: line.name, quantity: line.qty })), when, {
      version: 1,
      rows: lines.map((line) => ({ wgId: line.id, pack: 'pf2e.equipment-srd', slug: line.name.toLowerCase().replace(/\s+/g, '-'), status: 'active' as const })),
    });
    expect(manifest.items).toHaveLength(6);
    expect(manifest.folder).toBe('Kerse 11-23');
    expect(cartFoundryTitle([{ shopId: 'arena', shopName: "Barbarous Arena – Fighters' Exchange" }])).toBe("Barbarous Arena – Fighters' Exchange");
  });
});
