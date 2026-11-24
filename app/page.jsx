import Link from 'next/link';
import { featuredProductId, getProduct } from '../lib/catalog.mjs';
export const dynamic = 'force-dynamic';
export default async function Page() {
  const featured = await getProduct(featuredProductId);
  return <main><p>Featured product</p><h1 data-testid="product-title">{featured?.title}</h1><Link href={'/products/' + featuredProductId}>Product details</Link></main>;
}
