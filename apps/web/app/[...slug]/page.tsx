import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { Catalog, Outlets, ProductDetail } from '@/components/Catalog';
import { Auth, Account } from '@/components/Auth';
import { Cart, Checkout } from '@/components/Checkout';
import { Orders, OrderDetail } from '@/components/Orders';
import { About, Contact } from '@/components/Info';
import Portal from '@/components/Portals';
import { Loading } from '@/components/UI';
import { NotificationsPage } from '@/components/Notifications';
export async function generateMetadata({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const titles: Record<string, string> = {
    search: 'Explore nearby',
    outlets: 'Local outlets',
    products: 'Product details',
    login: 'Log in',
    signup: 'Create account',
    account: 'Your account',
    cart: 'Your basket',
    checkout: 'Checkout',
    orders: 'Your orders',
    about: 'About us',
    contact: 'Contact us',
    notifications: 'Notifications',
    admin: 'Administration',
    portal: 'Your portal',
  };
  return {
    title: titles[slug[0]] || 'Dellvit',
    ...(['account', 'cart', 'checkout', 'orders', 'admin', 'portal', 'notifications'].includes(slug[0])
      ? { robots: { index: false, follow: false } }
      : {}),
  };
}
export default async function Page({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const [s, id] = slug;
  let content;
  if (s === 'search' && slug.length === 1) content = <Catalog />;
  else if (s === 'outlets' && slug.length === 1) content = <Outlets />;
  else if (s === 'outlets' && slug.length === 2) content = <Catalog outletId={id} />;
  else if (s === 'products' && slug.length === 2) content = <ProductDetail id={id} />;
  else if (s === 'orders' && slug.length === 2) content = <OrderDetail id={id} />;
  else if (s === 'portal' && slug.length === 2 && (id === 'outlet' || id === 'rider'))
    content = <Portal role={id} />;
  else if (s === 'admin' && id === 'login' && slug.length === 2) content = <Auth admin />;
  else if (slug.length === 1) {
    switch (s) {
      case 'login':
        content = <Auth />;
        break;
      case 'signup':
        content = <Auth signup />;
        break;
      case 'account':
        content = <Account />;
        break;
      case 'cart':
        content = <Cart />;
        break;
      case 'checkout':
        content = <Checkout />;
        break;
      case 'orders':
        content = <Orders />;
        break;
      case 'about':
        content = <About />;
        break;
      case 'contact':
        content = <Contact />;
        break;
      case 'notifications':
        content = <NotificationsPage />;
        break;
      case 'admin':
        content = <Portal role="admin" />;
        break;
      default:
        notFound();
    }
  } else notFound();
  return <Suspense fallback={<Loading />}>{content}</Suspense>;
}
