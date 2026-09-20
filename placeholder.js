'use strict';
// Draws simple leather-goods illustrations so the shop looks complete before you add real photos.
// URL format: /img/ph/<kind>.svg?c=<hex colour>&bg=<lav|sage>

function clamp(n) { return Math.max(0, Math.min(255, Math.round(n))); }
function shade(hex, amt) {
  const h = String(hex).replace('#', '').padEnd(6, '0').slice(0, 6);
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const f = amt >= 0 ? (v => v + (255 - v) * amt) : (v => v * (1 + amt));
  return '#' + [f(r), f(g), f(b)].map(v => clamp(v).toString(16).padStart(2, '0')).join('');
}

const KINDS = {
  oxford: (c, d, l) => `
    <path d="M56 208 C54 170 56 130 62 110 Q68 96 88 96 L146 104 C170 108 190 126 216 138 C258 156 318 160 346 184 Q358 194 358 208 Z" fill="${c}"/>
    <path d="M88 96 L146 104 C130 120 104 124 80 112 Z" fill="rgba(20,16,30,.35)"/>
    <path d="M60 130 C110 150 150 140 176 118" fill="none" stroke="${l}" stroke-width="3" opacity=".5"/>
    <g stroke="${l}" stroke-width="4" stroke-linecap="round" opacity=".85">
      <path d="M160 112 l16 -12"/><path d="M178 122 l16 -12"/><path d="M196 132 l16 -12"/>
    </g>
    <path d="M262 152 Q292 176 304 208" fill="none" stroke="${d}" stroke-width="3" stroke-dasharray="6 5"/>
    <ellipse cx="296" cy="178" rx="36" ry="12" fill="#fff" opacity=".16" transform="rotate(22 296 178)"/>
    <path d="M50 206 H362 Q364 226 340 230 H130 L124 242 H62 Q48 240 50 222 Z" fill="${d}"/>`,
  sneaker: (c, d, l) => `
    <path d="M58 206 C54 160 56 122 66 106 Q74 92 96 94 L140 98 C152 94 162 82 178 84 Q192 86 198 102 C216 132 260 144 312 162 Q358 178 360 206 Z" fill="${c}"/>
    <path d="M100 194 C150 152 226 152 306 190 L300 206 L100 206 Z" fill="${l}" opacity=".65"/>
    <path d="M96 94 L140 98 C128 116 108 120 88 112 Z" fill="rgba(20,16,30,.3)"/>
    <g fill="#fff" opacity=".9"><rect x="176" y="100" width="22" height="7" rx="3.5" transform="rotate(28 176 100)"/><rect x="196" y="112" width="22" height="7" rx="3.5" transform="rotate(28 196 112)"/><rect x="216" y="124" width="22" height="7" rx="3.5" transform="rotate(28 216 124)"/></g>
    <rect x="44" y="200" width="326" height="36" rx="18" fill="#FBFAFD"/>
    <rect x="44" y="222" width="326" height="8" fill="${d}" opacity=".18"/>`,
  boot: (c, d, l) => `
    <path d="M62 212 L66 40 Q66 32 76 32 L150 32 Q160 32 160 42 L162 112 C200 130 270 142 322 166 Q356 182 358 212 Z" fill="${c}"/>
    <path d="M68 92 H160 V130 Q116 148 68 132 Z" fill="${d}" opacity=".6"/>
    <rect x="100" y="20" width="22" height="26" rx="7" fill="${d}"/>
    <path d="M74 60 H150" stroke="${l}" stroke-width="3" opacity=".45"/>
    <ellipse cx="300" cy="182" rx="34" ry="10" fill="#fff" opacity=".14" transform="rotate(20 300 182)"/>
    <path d="M54 210 H364 Q366 226 344 230 H150 L146 246 H62 Q50 244 52 224 Z" fill="${d}"/>`,
  sandal: (c, d, l) => `
    <path d="M62 206 C50 176 84 146 150 144 L300 154 C354 160 356 214 300 226 L124 240 C84 242 70 226 62 206 Z" fill="${d}"/>
    <path d="M70 204 C64 180 92 154 150 152 L298 162 C340 168 342 206 298 216 L124 230 C92 232 78 220 70 204 Z" fill="${l}" opacity=".55"/>
    <path d="M132 158 C160 96 246 96 274 164" fill="none" stroke="${c}" stroke-width="30" stroke-linecap="round"/>
    <path d="M112 196 C130 140 250 130 262 178" fill="none" stroke="${c}" stroke-width="22" stroke-linecap="round" opacity=".92"/>
    <path d="M150 132 C190 104 230 104 258 138" fill="none" stroke="${l}" stroke-width="3" opacity=".5"/>`,
  wallet: (c, d, l) => `
    <rect x="128" y="76" width="150" height="34" rx="10" fill="#fff" opacity=".85" transform="rotate(-8 128 76)"/>
    <rect x="86" y="96" width="236" height="150" rx="26" fill="${c}"/>
    <path d="M86 138 H322" stroke="${d}" stroke-width="3" opacity=".5"/>
    <rect x="86" y="96" width="236" height="150" rx="26" fill="none" stroke="${l}" stroke-width="3" stroke-dasharray="7 6" opacity=".5" transform="translate(0 0)"/>
    <rect x="262" y="140" width="60" height="44" rx="14" fill="${d}"/>
    <circle cx="286" cy="162" r="7" fill="${l}"/>`,
  belt: (c, d, l) => `
    <circle cx="200" cy="138" r="86" fill="none" stroke="${c}" stroke-width="30"/>
    <circle cx="200" cy="138" r="86" fill="none" stroke="${l}" stroke-width="2" stroke-dasharray="7 6" opacity=".5"/>
    <g fill="${d}" opacity=".55"><circle cx="118" cy="168" r="4"/><circle cx="126" cy="188" r="4"/><circle cx="138" cy="206" r="4"/><circle cx="152" cy="220" r="4"/></g>
    <rect x="248" y="42" width="66" height="54" rx="12" fill="none" stroke="#C9C4D6" stroke-width="10" transform="rotate(24 281 69)"/>
    <rect x="262" y="60" width="8" height="30" rx="4" fill="#C9C4D6" transform="rotate(24 281 69)"/>`,
  bag: (c, d, l) => `
    <path d="M138 128 C134 42 268 42 262 128" fill="none" stroke="${d}" stroke-width="15" stroke-linecap="round"/>
    <path d="M84 118 H316 L332 236 Q333 252 318 252 H82 Q67 252 68 236 Z" fill="${c}"/>
    <path d="M84 118 H316 L322 164 Q200 190 78 164 Z" fill="${d}" opacity=".45"/>
    <path d="M100 134 H300" stroke="${l}" stroke-width="3" stroke-dasharray="7 6" opacity=".5"/>
    <rect x="184" y="158" width="32" height="34" rx="9" fill="#C9C4D6"/>
    <circle cx="200" cy="175" r="5" fill="${d}"/>`,
  care: (c, d, l) => `
    <rect x="96" y="130" width="130" height="90" rx="14" fill="${d}"/>
    <ellipse cx="161" cy="130" rx="65" ry="18" fill="${l}"/>
    <ellipse cx="161" cy="130" rx="52" ry="12" fill="${c}"/>
    <rect x="96" y="160" width="130" height="34" fill="#FBFAFD" opacity=".9"/>
    <rect x="112" y="172" width="98" height="6" rx="3" fill="${d}" opacity=".6"/>
    <rect x="112" y="182" width="60" height="5" rx="2.5" fill="${d}" opacity=".35"/>
    <g transform="rotate(-24 296 170)"><rect x="262" y="150" width="120" height="30" rx="14" fill="${c}"/><rect x="262" y="150" width="46" height="30" rx="14" fill="${l}"/><rect x="336" y="158" width="52" height="14" rx="4" fill="#E7DFC9"/></g>`
};

const BG = {
  lav: ['#F1ECFB', '#D9CDF1', '#C3B2E8'],
  sage: ['#EDF3EA', '#CFDDC9', '#B3C8AD']
};
const KIND_FOR_CATEGORY = {
  formal: 'oxford', sneakers: 'sneaker', boots: 'boot', sandals: 'sandal',
  wallets: 'wallet', belts: 'belt', bags: 'bag', 'shoe-care': 'care'
};
function kindForCategory(slug) { return KIND_FOR_CATEGORY[slug] || 'oxford'; }

function svg(kind, color, bg) {
  const draw = KINDS[kind] || KINDS.oxford;
  const c = '#' + (String(color || '8A6A50').replace(/[^0-9a-fA-F]/g, '').padEnd(6, '0').slice(0, 6));
  const d = shade(c, -0.38), l = shade(c, 0.32);
  const [b0, b1, b2] = BG[bg] || BG.lav;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 440" role="img" aria-label="Product illustration">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${b0}"/><stop offset="1" stop-color="${b1}"/></linearGradient>
    <radialGradient id="r" cx=".72" cy=".2" r=".7"><stop offset="0" stop-color="${b2}" stop-opacity=".75"/><stop offset="1" stop-color="${b2}" stop-opacity="0"/></radialGradient>
  </defs>
  ${bg === 'none' ? '' : '<rect width="400" height="440" fill="url(#g)"/><rect width="400" height="440" fill="url(#r)"/>'}
  <g transform="translate(12 84) scale(.94)">
  <ellipse cx="200" cy="252" rx="150" ry="11" fill="#2A2438" opacity=".12"/>
  ${draw(c, d, l)}
  </g>
</svg>`;
}

module.exports = { svg, kindForCategory, KINDS };
