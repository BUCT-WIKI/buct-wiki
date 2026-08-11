// @ts-check
import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import starlight from '@astrojs/starlight';
import vue from '@astrojs/vue';

// https://astro.build/config
export default defineConfig({
	markdown: {
		processor: unified({ gfm: true }),
	},
	integrations: [
		vue(),
		starlight({
			title: 'Buct Wiki',
			customCss: ['./src/styles/index.css'],
			components: {
				PageTitle: './src/components/PageTitle.astro',
				Footer: './src/components/Footer.astro',
			},
			sidebar: [
				{ label: '序', slug: '序' },
				{
					label: '简介',
					items: [{ autogenerate: { directory: 'content/简介' } }],
					collapsed: true,
				},
				{
					label: '招生',
					items: [{ autogenerate: { directory: 'content/招生' } }],
					collapsed: true,
				},
				{
					label: '新生',
					items: [{ autogenerate: { directory: 'content/新生' } }],
					collapsed: true,
				},
				{
					label: '学习',
					items: [{ autogenerate: { directory: 'content/学习' } }],
					collapsed: true,
				},
				{
					label: '生活',
					items: [{ autogenerate: { directory: 'content/生活' } }],
					collapsed: true,
				},
				{
					label: '实践',
					items: [{ autogenerate: { directory: 'content/实践' } }],
					collapsed: true,
				},
				{ label: '测试页', slug: 'test' },
			],
		}),
	],
});
