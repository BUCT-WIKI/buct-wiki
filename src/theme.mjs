import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const themeSeed = '#006A96';

// Import only the palette modules: MCU 0.4's root entry has extensionless imports.
const require = createRequire(import.meta.url);
const utilities = dirname(require.resolve('@material/material-color-utilities'));
const load = (path) => import(/* @vite-ignore */ pathToFileURL(join(utilities, path)).href);
const [{ Hct }, { TonalPalette }, { argbFromHex, hexFromArgb }] = await Promise.all([
	load('hct/hct.js'),
	load('palettes/tonal_palette.js'),
	load('utils/string_utils.js'),
]);

export function wikiSurfaceColors() {
	const hue = Hct.fromInt(argbFromHex(themeSeed)).hue;
	const neutral = TonalPalette.fromHueAndChroma(hue, 12);
	const variant = TonalPalette.fromHueAndChroma(hue, 16);
	const tones = {
		light: {
			background: 98, surface: 98, 'surface-dim': 87, 'surface-bright': 98,
			'surface-container-lowest': 100, 'surface-container-low': 96,
			'surface-container': 94, 'surface-container-high': 92, 'surface-container-highest': 90,
			'on-background': 10, 'on-surface': 10, 'inverse-surface': 20, 'inverse-on-surface': 95,
		},
		dark: {
			background: 6, surface: 6, 'surface-dim': 6, 'surface-bright': 24,
			'surface-container-lowest': 4, 'surface-container-low': 10,
			'surface-container': 12, 'surface-container-high': 17, 'surface-container-highest': 22,
			'on-background': 90, 'on-surface': 90, 'inverse-surface': 90, 'inverse-on-surface': 20,
		},
	};
	const css = Object.entries(tones).map(([mode, roles]) => {
		const dark = mode === 'dark';
		const colors = Object.fromEntries(
			Object.entries(roles).map(([role, tone]) => [role, hexFromArgb(neutral.tone(tone))]),
		);
		for (const [role, tone] of Object.entries({
			'surface-variant': dark ? 30 : 90,
			'on-surface-variant': dark ? 80 : 30,
			outline: dark ? 60 : 50,
			'outline-variant': dark ? 30 : 80,
		})) {
			colors[role] = hexFromArgb(variant.tone(tone));
		}
		return `:root[data-theme="${mode}"] {\n${Object.entries(colors)
			.map(([role, color]) => `--md-sys-color-${role}: ${color};`).join('\n')}\n}`;
	}).join('\n');

	return {
		name: 'wiki-surface-colors',
		hooks: {
			'config:setup'({ config, updateConfig }) {
				// Apply after MD3's seed colors so every component shares these surface roles.
				updateConfig({
					head: [...(config.head ?? []), {
						tag: 'style',
						attrs: { 'data-wiki-theme': 'surfaces' },
						content: css,
					}],
				});
			},
		},
	};
}
