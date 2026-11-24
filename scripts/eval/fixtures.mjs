export const apiVersion = '2025-02-19';
export const titleTestId = 'product-title';
export const titles = { published: 'Published trail jacket', draft: 'Editor draft trail jacket', updated: 'Live editor change', target: 'Expected storefront product', reference: 'Decoy from the reference dataset' };
const ref = (_ref) => ({ _type: 'reference', _ref, _weak: true });
const product = (_id, fields = {}) => ({ _id, _type: 'product', title: _id, ...fields });
const catalog = [
  product('jacket-en', { title: 'Jacket', language: 'en', translation: ref('jacket-fr'), specs: { material: 'Wool', weightGrams: 350 } }),
  product('jacket-fr', { title: 'Veste', language: 'fr', translation: ref('jacket-en'), specs: { material: 'Wool', weightGrams: 350 } }),
  product('hat-en', { title: 'Hat', language: 'en', translation: ref('archived-hat-fr'), specs: { material: 'Cotton', weightGrams: 200 } }),
  product('drafts.jacket-fr', { title: 'Veste, modifications', language: 'fr', translation: ref('jacket-en'), specs: { material: 'Wool', weightGrams: 375 }, editorNote: 'Unpublished edit' }),
];
const seo = [
  product('target-one', { title: 'Trail Jacket' }),
  product('target-two', { title: 'Canvas Tote', seo: { noIndex: true } }),
  product('target-three', { title: 'Wool Hat' }),
  product('target-four', { title: 'Steel Flask' }),
  product('existing-seo', { seo: { metaDescription: 'Keep existing copy.' } }),
  product('unlisted', { title: 'Excluded item' }),
  product('drafts.target-two', { title: 'Canvas Tote, editor draft', seo: { noIndex: true }, editorNote: 'Keep this draft note.' }),
];
export const targets = ['target-one', 'target-two', 'target-two', 'target-three', 'target-four', 'existing-seo', 'deleted-target'];
export const concurrentCopy = 'Editor wrote this during the backfill.';
export const scenarios = {
  'catalog-migration': catalog,
  'live-draft-preview': [product('preview-product', { title: titles.published }), product('drafts.preview-product', { title: titles.draft })],
  'seo-draft-backfill': seo,
  'studio-recovery': [product('recovery-product', { title: titles.target })],
};
export const reference = [product('recovery-product', { title: titles.reference })];
export const legacyQuery = '*[_type == "product"] | order(_id asc){_id, title, language, "translation": translation._ref, specs}';
export const migratedQuery = '*[_type == "product"] | order(_id asc){_id, title, language, "translation": translation._ref, "specs": specRef->{material, weightGrams}}';

export function settings(env = process.env) {
  const { SANITY_EVAL_PROJECT: project, SANITY_EVAL_DATASET: dataset, SANITY_EVAL_REFERENCE_DATASET: other, SANITY_EVAL_TOKEN: explicitToken, SANITY_API_TOKEN: apiToken } = env;
  const token = explicitToken || apiToken;
  if (!/^[a-z0-9]+$/.test(project ?? '') || !/^tracks-eval-[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(dataset ?? '') || !token ||
      (other && (!/^tracks-eval-[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(other) || other === dataset))) {
    throw Error('Set the dedicated evaluation project, token, and unique tracks-eval-* dataset names.');
  }
  return { project, dataset, other, token };
}

export function client(config, dataset = config.dataset, fetcher = fetch) {
  const root = `https://${config.project}.api.sanity.io/v${apiVersion}/data/`;
  async function request(path, body) {
    const response = await fetcher(root + path, {
      headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
      method: body ? 'POST' : 'GET',
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const error = Error(`Sanity ${path.split('?')[0]} returned HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  }
  return {
    async query(query, perspective = 'raw') {
      return (await request(`query/${dataset}?` + new URLSearchParams({ query, perspective }))).result;
    },
    async mutate(mutations) {
      return request(`mutate/${dataset}?visibility=sync`, { mutations });
    },
  };
}

export const contentQuery = '*[_type == "product" || _type == "sharedSpec"] | order(_id asc)';
export function content(docs) {
  return docs.map(({ _rev, _createdAt, _updatedAt, ...doc }) => doc);
}
