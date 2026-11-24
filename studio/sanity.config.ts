import {defineConfig} from 'sanity';
import {structureTool} from 'sanity/structure';
import {product} from './schema/product';

export default defineConfig({
  name: 'default',
  title: 'Fieldwork Shop',
  projectId: process.env.SANITY_STUDIO_PROJECT_ID || '',
  dataset: process.env.SANITY_STUDIO_DATASET || '',
  plugins: [structureTool()],
  schema: {types: [product]},
});
