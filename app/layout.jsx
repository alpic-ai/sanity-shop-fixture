import Link from 'next/link';
export default function Layout({children}) {
  return <html lang="en"><body><header><Link href="/">Fieldwork Shop</Link> · <Link href="/products">Catalog</Link></header>{children}</body></html>;
}
