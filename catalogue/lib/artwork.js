/**
 * Catalogue artwork. Icons are 256×256; banners 1600×900. Both are SVG,
 * rasterised to PNG on apply and re-hosted as WebP by the API.
 *
 * Visual language is in catalogue/STYLE.md: dark card, amber accent, one
 * glyph, no lettering in the image.
 */
const PALETTE = Object.freeze({
	bg: '#121212',
	card: '#1E1E1E',
	ink: '#E0E0E0',
	muted: '#757575',
	amber: '#FF9800',
	gold: '#FFB74D',
	teal: '#10B981',
	sky: '#64B5F6',
	rose: '#F48FB1',
	violet: '#B39DDB',
	crimson: '#E57373'
});

const ICON_SIZE = 256;
const BANNER_WIDTH = 1600;
const BANNER_HEIGHT = 900;

function artIds() {
	return new Set([
		'tower-bridge',
		'erasmusbrug',
		'commons',
		'commons-bell',
		'capitol',
		'uk-pm',
		'us-president',
		'pope',
		'conclave',
		'ballot',
		'aurora',
		'christmas',
		'easter',
		'ramadan',
		'eid',
		'diwali',
		'hanukkah',
		'yom-kippur',
		'lunar-new-year',
		'earth-hour',
		'new-year',
		'pride',
		'full-moon',
		'sweden-election',
		'oresund',
		'storebaelt',
		'halloween',
		'harvest',
		'solstice',
		'holi',
		'quake',
		'underground',
		'lucia',
		'shamrock',
		'rocket',
		'volcano',
		'crown',
		'disaster'
	]);
}

function glyph(artId, color) {
	switch (artId) {
		case 'tower-bridge':
			return `
				<rect x="28" y="168" width="200" height="14" fill="${color}" opacity="0.45"/>
				<rect x="52" y="72" width="36" height="110" rx="4" fill="${color}"/>
				<rect x="168" y="72" width="36" height="110" rx="4" fill="${color}"/>
				<rect x="58" y="48" width="24" height="28" fill="${color}"/>
				<rect x="174" y="48" width="24" height="28" fill="${color}"/>
				<rect x="88" y="96" width="80" height="10" fill="${color}"/>
				<rect x="88" y="118" width="80" height="8" fill="${PALETTE.sky}"/>`;
		case 'erasmusbrug':
			return `
				<polygon points="48,176 208,176 208,188 48,188" fill="${color}" opacity="0.4"/>
				<polygon points="150,40 166,40 166,176 150,176" fill="${color}"/>
				<polygon points="150,40 210,176 194,176" fill="${color}" opacity="0.7"/>
				<line x1="150" y1="56" x2="60" y2="176" stroke="${PALETTE.sky}" stroke-width="6"/>
				<line x1="150" y1="72" x2="88" y2="176" stroke="${PALETTE.sky}" stroke-width="5"/>
				<line x1="150" y1="88" x2="116" y2="176" stroke="${PALETTE.sky}" stroke-width="4"/>`;
		case 'commons':
			return `
				<rect x="88" y="48" width="80" height="16" fill="${color}"/>
				<rect x="108" y="64" width="40" height="96" fill="${color}"/>
				<rect x="72" y="160" width="112" height="28" rx="4" fill="${color}"/>
				<rect x="96" y="88" width="16" height="36" fill="${PALETTE.bg}"/>
				<rect x="144" y="88" width="16" height="36" fill="${PALETTE.bg}"/>`;
		case 'commons-bell':
			return `
				<rect x="120" y="40" width="16" height="28" fill="${color}"/>
				<ellipse cx="128" cy="72" rx="22" ry="12" fill="${color}"/>
				<path d="M70 88 C74 168 100 188 128 188 C156 188 182 168 186 88 Z" fill="${color}"/>
				<circle cx="128" cy="204" r="14" fill="${PALETTE.gold}"/>
				<rect x="122" y="184" width="12" height="12" fill="${color}"/>`;
		case 'capitol':
			return `
				<circle cx="128" cy="72" r="28" fill="${color}"/>
				<rect x="120" y="36" width="16" height="22" fill="${color}"/>
				<rect x="64" y="100" width="128" height="16" fill="${color}"/>
				<rect x="56" y="116" width="24" height="64" fill="${color}"/>
				<rect x="176" y="116" width="24" height="64" fill="${color}"/>
				<rect x="88" y="116" width="80" height="64" fill="${color}" opacity="0.85"/>
				<rect x="48" y="180" width="160" height="16" fill="${color}"/>`;
		case 'uk-pm':
			return `
				<rect x="72" y="48" width="112" height="144" rx="6" fill="${color}"/>
				<rect x="88" y="64" width="32" height="40" fill="${PALETTE.bg}"/>
				<rect x="136" y="64" width="32" height="40" fill="${PALETTE.bg}"/>
				<rect x="108" y="128" width="40" height="64" fill="${PALETTE.bg}"/>
				<circle cx="140" cy="164" r="4" fill="${color}"/>
				<rect x="184" y="96" width="12" height="36" fill="${PALETTE.gold}"/>
				<circle cx="190" cy="90" r="10" fill="${PALETTE.gold}"/>`;
		case 'us-president':
			return `
				<polygon points="128,40 208,88 48,88" fill="${color}"/>
				<rect x="60" y="88" width="136" height="88" fill="${color}"/>
				<rect x="84" y="112" width="22" height="40" fill="${PALETTE.bg}"/>
				<rect x="117" y="112" width="22" height="64" fill="${PALETTE.bg}"/>
				<rect x="150" y="112" width="22" height="40" fill="${PALETTE.bg}"/>
				<rect x="48" y="176" width="160" height="14" fill="${color}"/>`;
		case 'pope':
			return `
				<circle cx="128" cy="96" r="36" fill="${color}"/>
				<rect x="92" y="128" width="72" height="16" rx="8" fill="${color}"/>
				<path d="M80 176 Q128 140 176 176" fill="none" stroke="${PALETTE.gold}" stroke-width="10" stroke-linecap="round"/>
				<circle cx="80" cy="176" r="10" fill="${PALETTE.gold}"/>
				<circle cx="176" cy="176" r="10" fill="${PALETTE.gold}"/>`;
		case 'conclave':
			return `
				<rect x="64" y="120" width="128" height="64" fill="${color}"/>
				<polygon points="64,120 128,72 192,120" fill="${color}"/>
				<rect x="116" y="40" width="24" height="40" fill="${color}"/>
				<ellipse cx="128" cy="36" rx="18" ry="22" fill="${PALETTE.muted}"/>
				<ellipse cx="140" cy="24" rx="14" ry="18" fill="${PALETTE.ink}" opacity="0.5"/>`;
		case 'ballot':
			return `
				<rect x="68" y="64" width="120" height="128" rx="8" fill="${color}"/>
				<rect x="88" y="88" width="80" height="16" fill="${PALETTE.bg}"/>
				<rect x="88" y="116" width="80" height="16" fill="${PALETTE.bg}"/>
				<rect x="88" y="144" width="48" height="16" fill="${PALETTE.bg}"/>
				<polyline points="108,168 124,184 156,140" fill="none" stroke="${PALETTE.teal}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`;
		case 'aurora':
			return `
				<circle cx="64" cy="64" r="18" fill="${PALETTE.gold}"/>
				<path d="M24 200 C 60 80, 100 160, 128 120 C 156 80, 196 160, 232 96" fill="none" stroke="${PALETTE.teal}" stroke-width="14" stroke-linecap="round"/>
				<path d="M24 216 C 72 120, 112 180, 160 140 C 200 108, 220 168, 232 148" fill="none" stroke="${PALETTE.violet}" stroke-width="10" stroke-linecap="round"/>`;
		case 'christmas':
			return `
				<polygon points="128,36 176,108 80,108" fill="${PALETTE.teal}"/>
				<polygon points="128,72 192,160 64,160" fill="${PALETTE.teal}"/>
				<rect x="116" y="160" width="24" height="36" fill="${color}"/>
				<circle cx="128" cy="64" r="8" fill="${PALETTE.gold}"/>
				<circle cx="108" cy="124" r="6" fill="${PALETTE.crimson}"/>
				<circle cx="148" cy="132" r="6" fill="${PALETTE.gold}"/>`;
		case 'easter':
			return `
				<ellipse cx="128" cy="128" rx="52" ry="68" fill="${PALETTE.ink}"/>
				<ellipse cx="128" cy="128" rx="40" ry="54" fill="${PALETTE.rose}"/>
				<path d="M88 120 C 128 96, 128 96, 168 120" fill="none" stroke="${PALETTE.gold}" stroke-width="8"/>
				<path d="M92 148 C 128 172, 128 172, 164 148" fill="none" stroke="${PALETTE.gold}" stroke-width="8"/>`;
		case 'ramadan':
			return `
				<circle cx="120" cy="128" r="64" fill="${PALETTE.gold}"/>
				<circle cx="144" cy="112" r="52" fill="${PALETTE.bg}"/>
				<polygon points="188,72 196,96 220,96 200,112 208,136 188,120 168,136 176,112 156,96 180,96" fill="${PALETTE.gold}"/>`;
		case 'eid':
			return `
				<rect x="108" y="48" width="40" height="24" rx="6" fill="${PALETTE.gold}"/>
				<path d="M84 84 h88 a8 8 0 0 1 8 8 v88 a20 20 0 0 1 -20 20 h-64 a20 20 0 0 1 -20 -20 v-88 a8 8 0 0 1 8 -8 z" fill="${color}"/>
				<circle cx="128" cy="140" r="18" fill="${PALETTE.gold}"/>
				<rect x="120" y="72" width="16" height="28" fill="${PALETTE.gold}"/>`;
		case 'diwali':
			return `
				<ellipse cx="128" cy="168" rx="56" ry="18" fill="${color}"/>
				<path d="M72 160 Q128 48 184 160" fill="${PALETTE.gold}"/>
				<ellipse cx="128" cy="132" rx="18" ry="28" fill="${PALETTE.amber}"/>
				<ellipse cx="128" cy="112" rx="8" ry="16" fill="${PALETTE.ink}"/>`;
		case 'hanukkah':
			return `
				<rect x="124" y="168" width="8" height="24" fill="${color}"/>
				<rect x="64" y="160" width="128" height="10" fill="${color}"/>
				<rect x="72" y="88" width="8" height="72" fill="${color}"/>
				<rect x="96" y="88" width="8" height="72" fill="${color}"/>
				<rect x="120" y="64" width="16" height="96" fill="${color}"/>
				<rect x="152" y="88" width="8" height="72" fill="${color}"/>
				<rect x="176" y="88" width="8" height="72" fill="${color}"/>
				<ellipse cx="76" cy="76" rx="6" ry="10" fill="${PALETTE.gold}"/>
				<ellipse cx="100" cy="76" rx="6" ry="10" fill="${PALETTE.gold}"/>
				<ellipse cx="128" cy="52" rx="7" ry="12" fill="${PALETTE.gold}"/>
				<ellipse cx="156" cy="76" rx="6" ry="10" fill="${PALETTE.gold}"/>
				<ellipse cx="180" cy="76" rx="6" ry="10" fill="${PALETTE.gold}"/>`;
		case 'yom-kippur':
			return `
				<circle cx="128" cy="128" r="72" fill="none" stroke="${color}" stroke-width="10"/>
				<line x1="128" y1="128" x2="128" y2="72" stroke="${color}" stroke-width="10" stroke-linecap="round"/>
				<line x1="128" y1="128" x2="176" y2="128" stroke="${PALETTE.gold}" stroke-width="8" stroke-linecap="round"/>
				<circle cx="128" cy="128" r="8" fill="${PALETTE.gold}"/>`;
		case 'lunar-new-year':
			return `
				<rect x="108" y="40" width="40" height="28" rx="6" fill="${PALETTE.gold}"/>
				<rect x="96" y="68" width="64" height="112" rx="32" fill="${PALETTE.crimson}"/>
				<rect x="118" y="84" width="20" height="80" fill="${PALETTE.gold}"/>
				<circle cx="128" cy="196" r="10" fill="${PALETTE.gold}"/>`;
		case 'earth-hour':
			return `
				<circle cx="128" cy="128" r="72" fill="${PALETTE.sky}"/>
				<ellipse cx="128" cy="128" rx="28" ry="72" fill="none" stroke="${PALETTE.bg}" stroke-width="8"/>
				<line x1="56" y1="128" x2="200" y2="128" stroke="${PALETTE.bg}" stroke-width="8"/>
				<circle cx="128" cy="128" r="72" fill="${PALETTE.bg}" opacity="0.55"/>
				<rect x="120" y="96" width="16" height="40" fill="${PALETTE.gold}"/>
				<ellipse cx="128" cy="92" rx="10" ry="8" fill="${PALETTE.gold}"/>`;
		case 'new-year':
			return `
				<circle cx="128" cy="128" r="16" fill="${PALETTE.gold}"/>
				<line x1="128" y1="40" x2="128" y2="72" stroke="${PALETTE.amber}" stroke-width="8" stroke-linecap="round"/>
				<line x1="128" y1="184" x2="128" y2="216" stroke="${PALETTE.amber}" stroke-width="8" stroke-linecap="round"/>
				<line x1="48" y1="88" x2="88" y2="104" stroke="${PALETTE.crimson}" stroke-width="8" stroke-linecap="round"/>
				<line x1="208" y1="88" x2="168" y2="104" stroke="${PALETTE.teal}" stroke-width="8" stroke-linecap="round"/>
				<line x1="56" y1="176" x2="92" y2="156" stroke="${PALETTE.violet}" stroke-width="8" stroke-linecap="round"/>
				<line x1="200" y1="176" x2="164" y2="156" stroke="${PALETTE.sky}" stroke-width="8" stroke-linecap="round"/>`;
		case 'pride':
			return `
				<rect x="48" y="56" width="160" height="24" fill="#E40303"/>
				<rect x="48" y="80" width="160" height="24" fill="#FF8C00"/>
				<rect x="48" y="104" width="160" height="24" fill="#FFED00"/>
				<rect x="48" y="128" width="160" height="24" fill="#008026"/>
				<rect x="48" y="152" width="160" height="24" fill="#24408E"/>
				<rect x="48" y="176" width="160" height="24" fill="#732982"/>`;
		case 'full-moon':
			return `
				<circle cx="128" cy="128" r="72" fill="${PALETTE.ink}"/>
				<circle cx="148" cy="116" r="18" fill="${PALETTE.muted}" opacity="0.45"/>
				<circle cx="100" cy="140" r="12" fill="${PALETTE.muted}" opacity="0.35"/>
				<circle cx="132" cy="156" r="8" fill="${PALETTE.muted}" opacity="0.3"/>`;
		case 'sweden-election':
			return `
				<polygon points="48,88 72,44 96,88" fill="${PALETTE.gold}"/>
				<rect x="52" y="88" width="40" height="12" fill="${PALETTE.gold}"/>
				<polygon points="104,72 128,28 152,72" fill="${PALETTE.gold}"/>
				<rect x="108" y="72" width="40" height="12" fill="${PALETTE.gold}"/>
				<polygon points="160,88 184,44 208,88" fill="${PALETTE.gold}"/>
				<rect x="164" y="88" width="40" height="12" fill="${PALETTE.gold}"/>
				<rect x="72" y="128" width="112" height="76" rx="8" fill="${color}"/>
				<polyline points="96,168 116,188 160,144" fill="none" stroke="${PALETTE.bg}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`;
		case 'oresund':
			return `
				<rect x="20" y="176" width="216" height="16" fill="${color}" opacity="0.35"/>
				<rect x="28" y="152" width="200" height="12" fill="${color}"/>
				<rect x="80" y="48" width="18" height="116" fill="${color}"/>
				<rect x="158" y="48" width="18" height="116" fill="${color}"/>
				<line x1="89" y1="56" x2="32" y2="152" stroke="${PALETTE.ink}" stroke-width="5"/>
				<line x1="89" y1="72" x2="56" y2="152" stroke="${PALETTE.ink}" stroke-width="4"/>
				<line x1="167" y1="56" x2="224" y2="152" stroke="${PALETTE.ink}" stroke-width="5"/>
				<line x1="167" y1="72" x2="200" y2="152" stroke="${PALETTE.ink}" stroke-width="4"/>
				<line x1="98" y1="72" x2="158" y2="72" stroke="${PALETTE.ink}" stroke-width="4"/>
				<ellipse cx="128" cy="196" rx="40" ry="12" fill="${PALETTE.ink}" opacity="0.4"/>`;
		case 'storebaelt':
			return `
				<rect x="16" y="184" width="224" height="12" fill="${color}" opacity="0.35"/>
				<rect x="20" y="160" width="216" height="10" fill="${color}"/>
				<rect x="56" y="36" width="14" height="136" fill="${color}"/>
				<rect x="186" y="36" width="14" height="136" fill="${color}"/>
				<path d="M24 160 Q128 56 232 160" fill="none" stroke="${PALETTE.ink}" stroke-width="8" stroke-linecap="round"/>
				<line x1="80" y1="88" x2="80" y2="160" stroke="${PALETTE.ink}" stroke-width="4"/>
				<line x1="108" y1="72" x2="108" y2="160" stroke="${PALETTE.ink}" stroke-width="4"/>
				<line x1="148" y1="72" x2="148" y2="160" stroke="${PALETTE.ink}" stroke-width="4"/>
				<line x1="176" y1="88" x2="176" y2="160" stroke="${PALETTE.ink}" stroke-width="4"/>`;
		case 'halloween':
			return `
				<ellipse cx="128" cy="140" rx="72" ry="56" fill="${PALETTE.amber}"/>
				<polygon points="116,84 128,48 140,84" fill="${PALETTE.teal}"/>
				<polygon points="96,124 112,148 80,148" fill="${PALETTE.bg}"/>
				<polygon points="160,124 176,148 144,148" fill="${PALETTE.bg}"/>
				<ellipse cx="128" cy="168" rx="22" ry="10" fill="${PALETTE.bg}"/>`;
		case 'harvest':
			return `
				<ellipse cx="128" cy="176" rx="56" ry="16" fill="${color}" opacity="0.45"/>
				<polygon points="128,40 148,176 108,176" fill="${PALETTE.gold}"/>
				<line x1="88" y1="72" x2="128" y2="160" stroke="${PALETTE.amber}" stroke-width="10" stroke-linecap="round"/>
				<line x1="168" y1="72" x2="128" y2="160" stroke="${PALETTE.amber}" stroke-width="10" stroke-linecap="round"/>
				<circle cx="88" cy="64" r="10" fill="${PALETTE.gold}"/>
				<circle cx="168" cy="64" r="10" fill="${PALETTE.gold}"/>
				<circle cx="128" cy="36" r="10" fill="${PALETTE.gold}"/>`;
		case 'solstice':
			return `
				<circle cx="128" cy="128" r="40" fill="${PALETTE.gold}"/>
				<line x1="128" y1="40" x2="128" y2="64" stroke="${PALETTE.amber}" stroke-width="10" stroke-linecap="round"/>
				<line x1="128" y1="192" x2="128" y2="216" stroke="${PALETTE.amber}" stroke-width="10" stroke-linecap="round"/>
				<line x1="40" y1="128" x2="64" y2="128" stroke="${PALETTE.amber}" stroke-width="10" stroke-linecap="round"/>
				<line x1="192" y1="128" x2="216" y2="128" stroke="${PALETTE.amber}" stroke-width="10" stroke-linecap="round"/>
				<line x1="64" y1="64" x2="84" y2="84" stroke="${PALETTE.amber}" stroke-width="8" stroke-linecap="round"/>
				<line x1="192" y1="64" x2="172" y2="84" stroke="${PALETTE.amber}" stroke-width="8" stroke-linecap="round"/>
				<line x1="64" y1="192" x2="84" y2="172" stroke="${PALETTE.amber}" stroke-width="8" stroke-linecap="round"/>
				<line x1="192" y1="192" x2="172" y2="172" stroke="${PALETTE.amber}" stroke-width="8" stroke-linecap="round"/>`;
		case 'holi':
			return `
				<circle cx="96" cy="116" r="44" fill="${PALETTE.rose}" opacity="0.9"/>
				<circle cx="160" cy="116" r="44" fill="${PALETTE.gold}" opacity="0.85"/>
				<circle cx="128" cy="164" r="44" fill="${PALETTE.violet}" opacity="0.85"/>
				<circle cx="128" cy="128" r="16" fill="${PALETTE.ink}"/>`;
		case 'quake':
			return `
				<polyline points="32,168 72,168 88,96 112,188 136,120 160,176 184,88 224,168" fill="none" stroke="${PALETTE.crimson}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
				<rect x="40" y="184" width="176" height="12" fill="${color}" opacity="0.4"/>`;
		case 'underground':
			return `
				<path d="M48 176 Q48 72 128 72 Q208 72 208 176" fill="none" stroke="${color}" stroke-width="16" stroke-linecap="round"/>
				<rect x="72" y="128" width="112" height="56" rx="8" fill="${PALETTE.sky}" opacity="0.85"/>
				<rect x="88" y="144" width="24" height="24" fill="${PALETTE.bg}"/>
				<rect x="144" y="144" width="24" height="24" fill="${PALETTE.bg}"/>`;
		case 'lucia':
			return `
				<circle cx="128" cy="148" r="40" fill="${color}"/>
				<rect x="88" y="92" width="80" height="16" rx="8" fill="${PALETTE.gold}"/>
				<ellipse cx="96" cy="76" rx="7" ry="14" fill="${PALETTE.gold}"/>
				<ellipse cx="116" cy="68" rx="7" ry="16" fill="${PALETTE.gold}"/>
				<ellipse cx="140" cy="68" rx="7" ry="16" fill="${PALETTE.gold}"/>
				<ellipse cx="160" cy="76" rx="7" ry="14" fill="${PALETTE.gold}"/>
				<rect x="100" y="188" width="56" height="20" rx="8" fill="${color}"/>`;
		case 'shamrock':
			return `
				<circle cx="128" cy="88" r="28" fill="${PALETTE.teal}"/>
				<circle cx="96" cy="128" r="28" fill="${PALETTE.teal}"/>
				<circle cx="160" cy="128" r="28" fill="${PALETTE.teal}"/>
				<rect x="120" y="140" width="16" height="52" rx="8" fill="${PALETTE.teal}"/>`;
		case 'rocket':
			return `
				<polygon points="128,36 160,120 96,120" fill="${color}"/>
				<rect x="108" y="112" width="40" height="56" fill="${color}"/>
				<polygon points="96,148 108,168 96,188" fill="${PALETTE.sky}"/>
				<polygon points="160,148 148,168 160,188" fill="${PALETTE.sky}"/>
				<polygon points="112,168 128,220 144,168" fill="${PALETTE.crimson}"/>
				<circle cx="128" cy="88" r="10" fill="${PALETTE.bg}"/>`;
		case 'volcano':
			return `
				<polygon points="40,196 96,88 128,136 160,72 216,196" fill="${color}"/>
				<polygon points="112,88 128,36 144,88 136,96 120,96" fill="${PALETTE.crimson}"/>
				<circle cx="128" cy="48" r="10" fill="${PALETTE.gold}"/>
				<rect x="48" y="196" width="160" height="12" fill="${color}" opacity="0.45"/>`;
		case 'crown':
			return `
				<polygon points="48,96 80,160 176,160 208,96 168,128 128,72 88,128" fill="${PALETTE.gold}"/>
				<rect x="72" y="160" width="112" height="20" fill="${PALETTE.gold}"/>
				<circle cx="48" cy="88" r="10" fill="${PALETTE.gold}"/>
				<circle cx="128" cy="64" r="12" fill="${PALETTE.gold}"/>
				<circle cx="208" cy="88" r="10" fill="${PALETTE.gold}"/>`;
		case 'disaster':
			return `
				<polygon points="128,40 216,196 40,196" fill="${PALETTE.crimson}"/>
				<rect x="118" y="92" width="20" height="60" rx="6" fill="${PALETTE.bg}"/>
				<circle cx="128" cy="172" r="12" fill="${PALETTE.bg}"/>`;
		default:
			return `
				<circle cx="128" cy="128" r="48" fill="${color}"/>
				<rect x="116" y="72" width="24" height="112" rx="12" fill="${PALETTE.bg}"/>`;
	}
}

function accentFor(artId) {
	switch (artId) {
		case 'ramadan':
		case 'eid':
		case 'diwali':
		case 'hanukkah':
		case 'yom-kippur':
			return PALETTE.gold;
		case 'christmas':
		case 'earth-hour':
			return PALETTE.teal;
		case 'easter':
		case 'pride':
			return PALETTE.rose;
		case 'aurora':
		case 'full-moon':
			return PALETTE.violet;
		case 'halloween':
		case 'quake':
		case 'volcano':
		case 'disaster':
			return PALETTE.crimson;
		case 'harvest':
		case 'solstice':
		case 'lucia':
		case 'crown':
			return PALETTE.gold;
		case 'holi':
			return PALETTE.rose;
		case 'shamrock':
			return PALETTE.teal;
		case 'tower-bridge':
		case 'erasmusbrug':
		case 'oresund':
		case 'storebaelt':
		case 'underground':
		case 'rocket':
			return PALETTE.sky;
		case 'sweden-election':
			return PALETTE.gold;
		default:
			return PALETTE.amber;
	}
}

function renderIconSvg(artId) {
	const accent = accentFor(artId);
	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}" width="${ICON_SIZE}" height="${ICON_SIZE}">
	<rect width="${ICON_SIZE}" height="${ICON_SIZE}" rx="48" fill="${PALETTE.bg}"/>
	<rect x="10" y="10" width="236" height="236" rx="40" fill="none" stroke="${accent}" stroke-width="6"/>
	${glyph(artId, accent)}
</svg>`;
}

function renderBannerSvg(artId) {
	const accent = accentFor(artId);
	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BANNER_WIDTH} ${BANNER_HEIGHT}" width="${BANNER_WIDTH}" height="${BANNER_HEIGHT}">
	<defs>
		<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
			<stop offset="0%" stop-color="${PALETTE.bg}"/>
			<stop offset="55%" stop-color="${PALETTE.card}"/>
			<stop offset="100%" stop-color="${accent}" stop-opacity="0.35"/>
		</linearGradient>
	</defs>
	<rect width="${BANNER_WIDTH}" height="${BANNER_HEIGHT}" fill="url(#g)"/>
	<circle cx="1280" cy="220" r="260" fill="${accent}" opacity="0.08"/>
	<g transform="translate(160,180) scale(2.1)">${glyph(artId, accent)}</g>
</svg>`;
}

async function rasterizeSvg(svg, width, height, sharp) {
	if (!sharp) {
		throw new Error('sharp is required to rasterise catalogue artwork');
	}
	return sharp(Buffer.from(svg, 'utf8'))
		.resize(width, height, { fit: 'fill' })
		.png()
		.toBuffer();
}

async function renderIconPng(artId, sharp) {
	return rasterizeSvg(renderIconSvg(artId), ICON_SIZE, ICON_SIZE, sharp);
}

async function renderBannerPng(artId, sharp) {
	return rasterizeSvg(renderBannerSvg(artId), BANNER_WIDTH, BANNER_HEIGHT, sharp);
}

module.exports = {
	PALETTE,
	ICON_SIZE,
	BANNER_WIDTH,
	BANNER_HEIGHT,
	artIds,
	glyph,
	renderIconSvg,
	renderBannerSvg,
	renderIconPng,
	renderBannerPng
};
