import type { Placement } from '@/components/ContentBlocks';

/**
 * The home page sections an administrator can put in any order (Homepage content → Arrange
 * sections). The announcement bar and hero stay at the top and the footer at the bottom.
 * Keep in step with homeSections in apps/api/src/platform.ts.
 */
export const homeSections = ['trust', 'categories', 'nearby', 'deals', 'category_products', 'outlets', 'blog', 'how'] as const;
export type HomeSection = (typeof homeSections)[number];

export const sectionInfo: Record<HomeSection, { title: string; setting: string; slot?: Placement }> = {
  trust: { title: 'Benefits bar', setting: 'show_trust' },
  // Each section carries the slot for the administrator's own blocks that follows it.
  categories: { title: 'Shop by category', setting: 'show_categories', slot: 'top' },
  nearby: { title: 'Good things near you', setting: 'show_nearby' },
  deals: { title: 'Deals near you', setting: 'show_nearby', slot: 'after_nearby' },
  category_products: { title: 'Category sections', setting: 'show_category_products', slot: 'after_categories' },
  outlets: { title: 'Outlets near you', setting: 'show_outlets', slot: 'after_outlets' },
  blog: { title: 'From the blog', setting: '' },
  how: { title: 'How it works', setting: 'show_how', slot: 'bottom' },
};

/** The saved order, with any section it does not list (such as a new one) at the end. */
export function sectionOrder(saved?: unknown): HomeSection[] {
  const list = Array.isArray(saved) ? saved.filter((s): s is HomeSection => homeSections.includes(s)) : [];
  return [...new Set([...list, ...homeSections])];
}
