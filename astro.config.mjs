// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import vue from '@astrojs/vue';

// https://astro.build/config
export default defineConfig({
	markdown: {
		gfm: true,
	},
	integrations: [
		vue(),
		starlight({
			title: 'Buct Wiki',
			components: {
				PageTitle: './src/components/PageTitle.astro',
			},
			// social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/withastro/starlight' }],
			sidebar: [
				{ label: '测试', slug: 'test' },
				{ autogenerate: { directory: 'content' } },
				// {
				// 	label: 'Guides',
				// 	items: [
				// 		// Each item here is one entry in the navigation menu.
				// 		{ label: 'Example Guide', slug: 'guides/example' },
				// 	],
				// },
				// {
				// 	label: 'Reference',
				// 	items: [{ autogenerate: { directory: 'reference' } }],
				// },
			],
		}),
	],
});
