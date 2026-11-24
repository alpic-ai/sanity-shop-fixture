import Link from 'next/link';
import { getProducts } from '../../lib/catalog.mjs';
export const dynamic = 'force-dynamic';
export default async function Catalog() {
  const products = await getProducts();
  return <main><h1>Catalog</h1><ul>{products.map(product => <li key={product._id}><Link href={'/products/' + product._id}>{product.title}</Link></li>)}</ul></main>;
}
