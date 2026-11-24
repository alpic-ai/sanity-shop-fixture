import { notFound } from 'next/navigation';
import { getProduct } from '../../../lib/catalog.mjs';
export const dynamic = 'force-dynamic';
export default async function Product({ params }) {
  const { id } = await params;
  const product = await getProduct(id);
  if (!product) notFound();
  return <main><h1>{product.title}</h1>{product.language && <p>Language: {product.language}</p>}{product.specs && <dl><dt>Material</dt><dd>{product.specs.material}</dd><dt>Weight</dt><dd>{product.specs.weightGrams} g</dd></dl>}</main>;
}
