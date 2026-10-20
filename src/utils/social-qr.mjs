import QRCode from 'qrcode';
import sncSymbol from '../assets/snc-symbol.svg?raw';

const cache = new Map();

/** Generate branded SVG codes at build time, without storing generated assets. */
export function socialQrSource(value) {
	if (cache.has(value)) return cache.get(value);

	const { modules } = QRCode.create(value, { errorCorrectionLevel: 'H' });
	const size = modules.size;
	const edge = size + 8;
	const finders = [[0, 0], [size - 7, 0], [0, size - 7]];
	const dark = (x, y) => x >= 0 && y >= 0 && x < size && y < size && modules.get(y, x);
	const paths = [];
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			if (!dark(x, y) || finders.some(([fx, fy]) => x >= fx && x < fx + 7 && y >= fy && y < fy + 7)) continue;
			// Round exposed corners only; adjacent dark modules remain connected.
			const tl = !dark(x - 1, y) && !dark(x, y - 1) ? 0.2 : 0;
			const tr = !dark(x + 1, y) && !dark(x, y - 1) ? 0.2 : 0;
			const br = !dark(x + 1, y) && !dark(x, y + 1) ? 0.2 : 0;
			const bl = !dark(x - 1, y) && !dark(x, y + 1) ? 0.2 : 0;
			const px = x + 4, py = y + 4;
			paths.push(`M${px + tl} ${py}H${px + 1 - tr}Q${px + 1} ${py} ${px + 1} ${py + tr}V${py + 1 - br}Q${px + 1} ${py + 1} ${px + 1 - br} ${py + 1}H${px + bl}Q${px} ${py + 1} ${px} ${py + 1 - bl}V${py + tl}Q${px} ${py} ${px + tl} ${py}Z`);
		}
	}
	const shapes = [`<path fill="#164863" d="${paths.join('')}"/>`];
	for (const [x, y] of finders) {
		shapes.push(
			`<rect x="${x + 4}" y="${y + 4}" width="7" height="7" rx=".8" fill="#164863"/>`,
			`<rect x="${x + 5}" y="${y + 5}" width="5" height="5" rx=".4" fill="#fff"/>`,
			`<rect x="${x + 6}" y="${y + 6}" width="3" height="3" rx=".35" fill="#164863"/>`,
		);
	}
	const logoSize = size * 0.24;
	const panelSize = Math.ceil(size * 0.29);
	const origin = (edge - panelSize) / 2;
	shapes.push(`<rect x="${origin}" y="${origin}" width="${panelSize}" height="${panelSize}" rx="1" fill="#fff"/>`);
	const logo = sncSymbol.slice(sncSymbol.indexOf('<svg'))
		.replace(/<svg\b[^>]*>/, (opening) => opening
			.replace(/\s(?:width|height)="[^"]*"/g, '')
			.replace(/>$/, ` x="${(edge - logoSize) / 2}" y="${(edge - logoSize) / 2}" width="${logoSize}" height="${logoSize}">`));
	shapes.push(logo);
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${edge} ${edge}" width="${edge * 8}" height="${edge * 8}"><rect width="${edge}" height="${edge}" fill="#fff"/>${shapes.join('')}</svg>`;
	const source = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
	cache.set(value, source);
	return source;
}
