import {defineField, defineType} from 'sanity';

export const product = defineType({
  name: 'product',
  type: 'document',
  fields: [
    defineField({name: 'title', type: 'string', validation: rule => rule.required()}),
    defineField({name: 'language', type: 'string', options: {list: ['en', 'fr']}}),
    defineField({name: 'translation', type: 'reference', to: [{type: 'product'}], weak: true}),
    defineField({
      name: 'specs',
      type: 'object',
      fields: [
        defineField({name: 'material', type: 'string'}),
        defineField({name: 'weightGrams', type: 'number'}),
      ],
    }),
    defineField({
      name: 'seo',
      type: 'object',
      fields: [
        defineField({name: 'metaDescription', type: 'text', validation: rule => rule.max(155)}),
        defineField({name: 'noIndex', type: 'boolean'}),
      ],
    }),
    defineField({name: 'editorNote', type: 'text'}),
  ],
});
