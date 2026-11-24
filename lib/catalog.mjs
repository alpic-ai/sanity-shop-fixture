export const catalogQuery = "*[_type == \"product\"] | order(_id asc){_id, title, language, \"translation\": translation._ref, specs}";
export const featuredProductId = process.env.SANITY_FEATURED_PRODUCT || 'jacket-en';

async function query(query, params = {}) {
  const project = process.env.SANITY_PROJECT_ID;
  const dataset = process.env.SANITY_STOREFRONT_DATASET || process.env.SANITY_DATASET;
  if (!project || !dataset) throw Error('Configure SANITY_PROJECT_ID and SANITY_DATASET');
  const url = new URL(`https://${project}.api.sanity.io/v2025-02-19/data/query/${dataset}`);
  url.searchParams.set('query', query);
  url.searchParams.set('perspective', 'published');
  for (const [key, value] of Object.entries(params)) url.searchParams.set('$' + key, JSON.stringify(value));
  const response = await fetch(url, {
    headers: process.env.SANITY_API_TOKEN ? { authorization: 'Bearer ' + process.env.SANITY_API_TOKEN } : {},
    cache: 'no-store',
  });
  if (!response.ok) throw Error('Content Lake request failed');
  return (await response.json()).result;
}

export const getProducts = () => query(catalogQuery);
export const getProduct = (id) => query('*[_type == "product" && _id == $id][0]{_id,title,language,specs}', { id });
