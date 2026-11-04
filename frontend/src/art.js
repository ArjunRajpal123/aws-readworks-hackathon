// Original illustrations for each passage, drawn as SVG so they scale, work offline and follow no outside license.
// Each scene is a sky or wall colour, a ground shape and a few simple objects.
let uid = 0
const at = (x, y, s, body) => `<g transform="translate(${x} ${y}) scale(${s})">${body}</g>`

const M = {
  sun: () => '<g stroke="#ffb703" stroke-width="5" stroke-linecap="round">' + [0, 45, 90, 135, 180, 225, 270, 315].map(a => `<line x1="0" y1="-34" x2="0" y2="-44" transform="rotate(${a})"/>`).join('') + '</g><circle r="26" fill="#ffd23f"/>',
  moon: () => '<circle r="26" fill="#f7f0c8"/><circle cx="-8" cy="-6" r="5" fill="#e5dca8"/><circle cx="9" cy="8" r="7" fill="#e5dca8"/>',
  cloud: () => '<g fill="#fff"><ellipse cx="0" cy="0" rx="34" ry="14"/><circle cx="-14" cy="-10" r="14"/><circle cx="10" cy="-14" r="17"/></g>',
  tree: (c = '#3f9b5a') => `<rect x="-5" y="-34" width="10" height="34" fill="#8a5a35"/><circle cx="0" cy="-52" r="26" fill="${c}"/><circle cx="-18" cy="-38" r="17" fill="${c}"/><circle cx="18" cy="-38" r="17" fill="${c}"/>`,
  palm: () => '<path d="M0 0 C4 -30 2 -50 8 -70" stroke="#8a5a35" stroke-width="8" fill="none"/><g fill="#3f9b5a"><path d="M8 -70 q-34 -4 -44 20 q22 -14 44 -20z"/><path d="M8 -70 q34 -4 44 20 q-22 -14 -44 -20z"/><path d="M8 -70 q-8 -26 -34 -30 q18 14 34 30z"/><path d="M8 -70 q8 -26 34 -30 q-18 14 -34 30z"/></g>',
  house: () => '<rect x="-34" y="-44" width="68" height="44" fill="#f2c9a0"/><path d="M-42 -44 L0 -80 L42 -44z" fill="#c2543c"/><rect x="-8" y="-26" width="16" height="26" fill="#8a5a35"/><rect x="16" y="-34" width="12" height="12" fill="#bfe3f2"/><rect x="-28" y="-34" width="12" height="12" fill="#bfe3f2"/>',
  manor: () => '<rect x="-70" y="-54" width="140" height="54" fill="#e6d3b3"/><path d="M-78 -54 L0 -96 L78 -54z" fill="#8f6a4a"/><g fill="#6a89a8"><rect x="-58" y="-42" width="12" height="20"/><rect x="-34" y="-42" width="12" height="20"/><rect x="22" y="-42" width="12" height="20"/><rect x="46" y="-42" width="12" height="20"/></g><rect x="-9" y="-30" width="18" height="30" fill="#6b4a2f"/><g fill="#f5edd8"><rect x="-22" y="-54" width="5" height="54"/><rect x="17" y="-54" width="5" height="54"/></g>',
  school: () => '<rect x="-60" y="-48" width="120" height="48" fill="#d97b5a"/><rect x="-66" y="-54" width="132" height="8" fill="#9c4b33"/><g fill="#bfe3f2"><rect x="-50" y="-36" width="14" height="16"/><rect x="-26" y="-36" width="14" height="16"/><rect x="12" y="-36" width="14" height="16"/><rect x="36" y="-36" width="14" height="16"/></g><rect x="-9" y="-28" width="18" height="28" fill="#6b4a2f"/><line x1="0" y1="-54" x2="0" y2="-80" stroke="#555" stroke-width="3"/><rect x="0" y="-80" width="18" height="11" fill="#e63946"/>',
  bolt: () => '<path d="M6 -50 L-14 -8 L0 -8 L-8 30 L18 -16 L4 -16z" fill="#ffd23f" stroke="#e0a800" stroke-width="2"/>',
  ship: () => '<path d="M-50 -12 L50 -12 L36 12 L-36 12z" fill="#7a4b2a"/><rect x="-2" y="-70" width="4" height="60" fill="#5a3a22"/><path d="M4 -66 L40 -22 L4 -22z" fill="#f5f0e1"/><path d="M-4 -60 L-34 -22 L-4 -22z" fill="#fff"/>',
  flag: () => '<rect x="-2" y="-70" width="4" height="70" fill="#555"/><g><rect x="2" y="-70" width="50" height="34" fill="#fff"/><g fill="#d6342c"><rect x="2" y="-70" width="50" height="5"/><rect x="2" y="-60" width="50" height="5"/><rect x="2" y="-50" width="50" height="5"/><rect x="2" y="-40" width="50" height="4"/></g><rect x="2" y="-70" width="22" height="19" fill="#2b4a9b"/></g>',
  suitcase: () => '<rect x="-26" y="-34" width="52" height="34" rx="5" fill="#b5651d"/><path d="M-10 -34 v-8 h20 v8" fill="none" stroke="#6b3b10" stroke-width="4"/><rect x="-26" y="-20" width="52" height="4" fill="#7a431a"/>',
  beaker: (c = '#4cc38a') => `<path d="M-14 -58 H14 V-36 L30 -4 Q32 0 26 0 H-26 Q-32 0 -30 -4 L-14 -36z" fill="#e9f6fb" stroke="#6b8794" stroke-width="3"/><path d="M-20 -22 H20 L30 -4 Q32 0 26 0 H-26 Q-32 0 -30 -4z" fill="${c}"/>`,
  plate: () => '<ellipse cx="0" cy="0" rx="46" ry="14" fill="#fff" stroke="#c7d0d6" stroke-width="2"/><g fill="none" stroke="#f0b95b" stroke-width="4" stroke-linecap="round"><path d="M-24 -6 q10 -12 20 0 t20 0"/><path d="M-20 -2 q10 -12 20 0 t20 0"/></g><circle cx="-8" cy="-8" r="8" fill="#b5532f"/><circle cx="12" cy="-6" r="7" fill="#b5532f"/><circle cx="26" cy="-2" r="4" fill="#3f9b5a"/>',
  planet: (c = '#e9a35a') => `<circle r="26" fill="${c}"/><ellipse rx="44" ry="9" fill="none" stroke="#f3dca8" stroke-width="5" transform="rotate(-18)"/>`,
  telescope: () => '<g stroke="#4a4a58" stroke-width="5" stroke-linecap="round"><line x1="0" y1="-30" x2="-18" y2="0"/><line x1="0" y1="-30" x2="18" y2="0"/><line x1="0" y1="-30" x2="0" y2="0"/></g><rect x="-30" y="-52" width="62" height="16" rx="4" fill="#7b61ff" transform="rotate(-28 0 -44)"/>',
  dome: () => '<path d="M-56 0 A56 56 0 0 1 56 0z" fill="#dfe6ec" stroke="#aab6c0" stroke-width="3"/><path d="M-6 -56 L6 -56 L10 0 L-10 0z" fill="#33415c"/>',
  bin: () => '<path d="M-26 -50 H26 L20 0 H-20z" fill="#2e9e6b"/><rect x="-30" y="-58" width="60" height="9" rx="3" fill="#237a53"/><path d="M0 -42 l12 20 h-24z" fill="none" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>',
  earth: () => '<circle r="30" fill="#3a8fd1"/><path d="M-18 -10 q8 -14 20 -6 q4 10 -6 14 q-10 6 -14 -8z" fill="#4cae5c"/><path d="M8 8 q10 -4 14 6 q-6 10 -16 4z" fill="#4cae5c"/>',
  mic: () => '<rect x="-3" y="-30" width="6" height="30" fill="#555"/><circle cy="-40" r="14" fill="#aab6c0"/><path d="M-12 -44 h24 M-11 -38 h22" stroke="#7f8c96" stroke-width="2"/>',
  paper: () => '<rect x="-34" y="-48" width="68" height="48" fill="#fff" stroke="#c7d0d6" stroke-width="2"/><rect x="-28" y="-42" width="56" height="10" fill="#33415c"/><g stroke="#9aa7b1" stroke-width="3"><line x1="-28" y1="-24" x2="28" y2="-24"/><line x1="-28" y1="-16" x2="10" y2="-16"/><line x1="-28" y1="-8" x2="28" y2="-8"/></g>',
  book: (c = '#c2543c') => `<rect x="-26" y="-12" width="52" height="12" fill="${c}"/><rect x="-24" y="-24" width="48" height="12" fill="#3a6ea5"/><rect x="-22" y="-34" width="44" height="10" fill="#e0a800"/>`,
  bee: () => '<ellipse cx="-6" cy="-14" rx="12" ry="7" fill="#e8f4fa" opacity=".85" transform="rotate(-25 -6 -14)"/><ellipse cx="8" cy="-14" rx="12" ry="7" fill="#e8f4fa" opacity=".85" transform="rotate(25 8 -14)"/><ellipse rx="18" ry="12" fill="#ffd23f"/><g fill="#33415c"><rect x="-6" y="-12" width="5" height="24" rx="2"/><rect x="4" y="-12" width="5" height="24" rx="2"/><circle cx="-18" cy="0" r="6"/></g>',
  flower: (c = '#e63946') => `<rect x="-2" y="-40" width="4" height="40" fill="#3f9b5a"/><g fill="${c}"><circle cx="0" cy="-52" r="8"/><circle cx="10" cy="-46" r="8"/><circle cx="-10" cy="-46" r="8"/><circle cx="6" cy="-38" r="8"/><circle cx="-6" cy="-38" r="8"/></g><circle cy="-46" r="6" fill="#ffd23f"/>`,
  hive: () => '<g fill="#ffd23f" stroke="#c98a00" stroke-width="3"><path d="M0 -40 l14 8 v16 l-14 8 l-14 -8 v-16z"/><path d="M28 -24 l14 8 v16 l-14 8 l-14 -8 v-16z" transform="translate(0 4)"/><path d="M-28 -24 l14 8 v16 l-14 8 l-14 -8 v-16z" transform="translate(0 4)"/></g>',
  cat: (c = '#e8a55c') => `<ellipse cx="0" cy="-14" rx="22" ry="14" fill="${c}"/><circle cx="-18" cy="-28" r="12" fill="${c}"/><path d="M-28 -36 l4 -12 l8 8z M-14 -38 l8 -10 l4 12z" fill="${c}"/><path d="M20 -16 q22 -6 20 -30" fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round"/><circle cx="-22" cy="-29" r="2" fill="#222"/><circle cx="-14" cy="-29" r="2" fill="#222"/>`,
  wagon: () => '<rect x="-34" y="-30" width="68" height="22" rx="4" fill="#d6342c"/><rect x="-34" y="-34" width="68" height="6" fill="#a82019"/><circle cx="-20" cy="-4" r="10" fill="#33415c"/><circle cx="20" cy="-4" r="10" fill="#33415c"/><circle cx="-20" cy="-4" r="4" fill="#aab6c0"/><circle cx="20" cy="-4" r="4" fill="#aab6c0"/><path d="M34 -22 q26 -4 34 -34" fill="none" stroke="#555" stroke-width="5" stroke-linecap="round"/>',
  hippo: () => '<ellipse cx="0" cy="-22" rx="52" ry="26" fill="#8a7fa8"/><ellipse cx="-44" cy="-24" rx="26" ry="20" fill="#9a8fb8"/><circle cx="-62" cy="-34" r="3" fill="#222"/><circle cx="-34" cy="-40" r="3" fill="#222"/><circle cx="-50" cy="-46" r="7" fill="#8a7fa8"/><g fill="#7a6f98"><rect x="-30" y="-4" width="16" height="14" rx="4"/><rect x="18" y="-4" width="16" height="14" rx="4"/></g>',
  giraffe: () => '<rect x="12" y="-40" width="10" height="40" fill="#e0a800"/><rect x="-14" y="-40" width="10" height="40" fill="#e0a800"/><ellipse cx="0" cy="-48" rx="26" ry="14" fill="#f2c14e"/><path d="M14 -52 L26 -120 L38 -118 L28 -48z" fill="#f2c14e"/><ellipse cx="38" cy="-124" rx="14" ry="9" fill="#f2c14e"/><g fill="#b5772a"><circle cx="-8" cy="-50" r="5"/><circle cx="8" cy="-44" r="4"/><circle cx="26" cy="-80" r="4"/></g><circle cx="42" cy="-126" r="2" fill="#222"/>',
  tent: (c = '#ee8a3a') => `<path d="M-46 0 L0 -62 L46 0z" fill="${c}"/><path d="M0 -62 L12 0 H-12z" fill="#7a3f12"/>`,
  canoe: () => '<path d="M-60 -10 Q0 18 60 -10 Q0 6 -60 -10z" fill="#a05a2c"/><rect x="-60" y="-12" width="120" height="4" fill="#7a431a" transform="rotate(-2)"/>',
  shield: () => '<path d="M0 -60 Q26 -52 34 -50 V-24 Q34 -4 0 10 Q-34 -4 -34 -24 V-50 Q-26 -52 0 -60z" fill="#2c8fa8" stroke="#1b6a80" stroke-width="3"/><path d="M-14 -28 l10 10 l20 -22" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>',
  syringe: () => '<g transform="rotate(-35)"><rect x="-6" y="-70" width="12" height="8" fill="#555"/><rect x="-14" y="-62" width="28" height="8" fill="#9aa7b1"/><rect x="-10" y="-54" width="20" height="56" fill="#e9f6fb" stroke="#6b8794" stroke-width="3"/><rect x="-10" y="-30" width="20" height="32" fill="#7bd0e0"/><rect x="-2" y="2" width="4" height="22" fill="#c7d0d6"/></g>',
  cells: () => '<g><circle cx="0" cy="0" r="16" fill="#c9a7f0"/><circle cx="-5" cy="-4" r="5" fill="#7b61ff"/><circle cx="34" cy="-18" r="11" fill="#ffb4b4"/><circle cx="-34" cy="-14" r="12" fill="#ffd9a8"/><circle cx="14" cy="22" r="9" fill="#bfe3f2"/></g>',
  press: () => '<rect x="-44" y="-8" width="88" height="8" fill="#6b4a2f"/><rect x="-40" y="-70" width="8" height="64" fill="#8a5a35"/><rect x="32" y="-70" width="8" height="64" fill="#8a5a35"/><rect x="-44" y="-78" width="88" height="10" fill="#6b4a2f"/><rect x="-3" y="-72" width="6" height="40" fill="#555"/><rect x="-28" y="-34" width="56" height="8" fill="#9aa7b1"/><rect x="-26" y="-22" width="52" height="12" fill="#fff" stroke="#c7d0d6" stroke-width="2"/>',
  envelope: () => '<rect x="-36" y="-44" width="72" height="44" rx="4" fill="#fff" stroke="#c7b99a" stroke-width="3"/><path d="M-36 -44 L0 -18 L36 -44" fill="none" stroke="#c7b99a" stroke-width="3"/><circle cy="-18" r="7" fill="#c2543c"/>',
  candle: () => '<rect x="-8" y="-40" width="16" height="40" fill="#f5edd8"/><path d="M0 -62 q10 12 0 20 q-10 -8 0 -20z" fill="#ffb703"/>',
  shelf: () => '<rect x="-50" y="-96" width="100" height="96" fill="#8a5a35"/><g><rect x="-46" y="-92" width="92" height="28" fill="#6b4a2f"/><rect x="-46" y="-60" width="92" height="28" fill="#6b4a2f"/><rect x="-46" y="-28" width="92" height="24" fill="#6b4a2f"/></g><g>' + [['#c2543c', -42], ['#3a6ea5', -32], ['#e0a800', -22], ['#4cae5c', -12], ['#7b61ff', -2], ['#e63946', 8], ['#33415c', 18], ['#ee8a3a', 28]].map(([c, x]) => `<rect x="${x}" y="-90" width="9" height="24" fill="${c}"/><rect x="${x + 4}" y="-58" width="9" height="26" fill="${c}"/><rect x="${x}" y="-26" width="9" height="22" fill="${c}"/>`).join('') + '</g>',
  lamp: () => '<path d="M-18 -44 L18 -44 L10 -66 L-10 -66z" fill="#ffd23f"/><rect x="-2" y="-44" width="4" height="40" fill="#555"/><ellipse cy="-2" rx="16" ry="4" fill="#555"/>',
  phase: p => `<circle r="22" fill="#f7f0c8"/><path d="${p}" fill="#2b3a55"/>`,
  teapot: () => '<ellipse cx="0" cy="-20" rx="26" ry="20" fill="#e8f1f6" stroke="#7aa5bd" stroke-width="3"/><rect x="-12" y="-46" width="24" height="8" rx="3" fill="#7aa5bd"/><path d="M26 -26 q20 -4 24 -22" fill="none" stroke="#7aa5bd" stroke-width="6" stroke-linecap="round"/><path d="M-26 -28 q-26 0 -22 18 q4 8 20 4" fill="none" stroke="#7aa5bd" stroke-width="5"/>',
  cup: () => '<path d="M-16 -22 H16 L12 0 H-12z" fill="#fff" stroke="#7aa5bd" stroke-width="3"/><path d="M16 -18 q12 0 8 10 q-4 4 -10 2" fill="none" stroke="#7aa5bd" stroke-width="3"/>',
  leaf: (c = '#ee8a3a') => `<path d="M0 -14 q16 0 18 14 q-14 4 -18 -14z" fill="${c}"/><path d="M0 -14 q-16 0 -18 14 q14 4 18 -14z" fill="${c}" opacity=".85"/>`,
  snow: () => [[40, 30], [120, 70], [200, 20], [290, 60], [380, 34], [470, 76], [560, 28], [610, 64], [90, 120], [250, 110], [420, 118], [520, 140]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3" fill="#fff"/>`).join(''),
  stars: () => [[40, 30], [110, 62], [190, 24], [270, 50], [360, 28], [450, 66], [540, 26], [600, 58], [70, 110], [330, 96], [500, 112]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.4" fill="#fff"/>`).join(''),
  waves: (y, c) => `<path d="M0 ${y} q40 -14 80 0 t80 0 t80 0 t80 0 t80 0 t80 0 t80 0 t80 0 V260 H0z" fill="${c}"/>`,
  hills: (c1, c2) => `<path d="M0 190 Q120 120 260 180 T520 160 T640 190 V260 H0z" fill="${c1}"/><path d="M0 220 Q160 170 320 215 T640 205 V260 H0z" fill="${c2}"/>`,
  mountains: () => '<path d="M0 200 L110 80 L190 170 L290 60 L400 190 L500 100 L640 200 V260 H0z" fill="#8b99a8"/><path d="M290 60 L262 98 L290 90 L310 104z M110 80 L90 106 L112 100 L128 110z" fill="#fff"/>',
  volcano: () => '<path d="M-70 0 L-18 -80 H18 L70 0z" fill="#7a4b3a"/><path d="M-18 -80 q18 -10 36 0 l-6 10 h-24z" fill="#e8552b"/><circle cx="-6" cy="-100" r="10" fill="#9aa7b1"/><circle cx="8" cy="-118" r="13" fill="#b4bec7"/>',
  ground: c => `<rect y="200" width="640" height="60" fill="${c}"/>`,
}

// theme: [sky top, sky bottom, ground colour, scene builder]
const SCENES = {
  'b-k2': ['#bfe6ff', '#eaf7ff', '#79c47a', () => M.hills('#8fd18a', '#6ab56c') + at(90, 60, 1, M.cloud()) + at(540, 56, 1, M.sun()) + at(150, 214, 1.4, M.tree()) + at(470, 218, 1.1, M.tree('#4cae5c')) + at(330, 232, 1, M.flower()) + at(380, 236, 1, M.flower('#ffd23f'))],
  'b-35': ['#fde9d0', '#fff6ea', '#caa27a', () => M.ground('#d9b48a') + at(330, 214, 1.4, M.teapot()) + at(220, 216, 1.3, M.cup()) + at(450, 216, 1.3, M.cup()) + '<circle cx="470" cy="226" r="8" fill="#7b4a2a" opacity=".6"/>'],
  'b-912': ['#2b3a55', '#f4b680', '#4a5a40', () => M.stars() + at(540, 60, 1, M.moon()) + M.hills('#55684a', '#3f5238') + at(320, 212, 1.5, M.manor()) + at(110, 220, 1.2, M.tree('#2f5a3a')) + at(540, 222, 1.2, M.tree('#2f5a3a'))],
  'rwf-E1': ['#cfeeff', '#f5fcff', '#79c47a', () => at(80, 56, 1, M.cloud()) + at(560, 54, 1, M.sun()) + M.hills('#9ad48f', '#6ab56c') + '<ellipse cx="330" cy="226" rx="150" ry="22" fill="#6bb7d9"/>' + at(300, 226, 1, M.hippo()) + at(520, 214, 1, M.giraffe()) + at(110, 220, 1.1, M.palm())],
  'rwf-E2': ['#1f2a44', '#566a8f', '#e8eef5', () => M.snow() + at(540, 60, 0.9, M.moon()) + M.ground('#e8eef5') + at(300, 214, 1.5, M.school()) + at(470, 120, 1, M.bolt()) + at(110, 218, 1, M.tree('#2f5a3a'))],
  'rwf-E3': ['#cfe8f7', '#eef8ff', '#3a8fd1', () => at(100, 56, 1, M.cloud()) + at(540, 56, 1, M.sun()) + M.waves(200, '#3a8fd1') + M.waves(226, '#2b78b8') + at(300, 210, 1.4, M.ship()) + at(520, 218, 1, M.flag()) + at(130, 232, 0.9, M.suitcase())],
  'rwf-E4': ['#ffe8c9', '#fff7ec', '#c99b6b', () => M.ground('#d9ad7c') + at(210, 226, 1.3, M.plate()) + at(390, 228, 1.4, M.beaker('#8bd17c')) + at(500, 228, 1, M.beaker('#f28ab2')) + at(330, 226, 1, M.plate())],
  'rwf-E5': ['#bfe0ff', '#f1f9ff', '#2b78b8', () => at(540, 56, 1, M.sun()) + M.mountains() + M.waves(214, '#3a8fd1') + at(110, 214, 1.2, M.volcano())],
  'rwf-E6': ['#e4ecff', '#f6f8ff', '#9aa7b1', () => M.ground('#c9d3dc') + at(220, 220, 1.7, M.paper()) + at(380, 220, 1.5, M.mic()) + at(520, 220, 1.3, M.book())],
  'rwf-E7': ['#d6f2dc', '#f2fbf4', '#79c47a', () => at(90, 56, 1, M.cloud()) + M.hills('#8fd18a', '#6ab56c') + at(190, 224, 1.5, M.bin()) + at(330, 214, 1.2, M.earth()) + at(480, 224, 1.5, M.bin()) + at(560, 220, 1.2, M.leaf('#4cae5c'))],
  'rwf-E8': ['#0f1b3a', '#33427a', '#1b2540', () => M.stars() + at(520, 70, 1, M.planet()) + at(120, 92, 0.7, M.planet('#6fb3d9')) + M.ground('#1b2540') + at(300, 214, 1.2, M.dome()) + at(460, 228, 1.4, M.telescope())],
  'rwf-E9': ['#bfe6ff', '#eaf7ff', '#3a8fd1', () => at(540, 56, 1, M.sun()) + M.hills('#6fae6b', '#4f9356') + M.waves(214, '#3a8fd1') + at(110, 202, 1.3, M.tent()) + at(230, 206, 1, M.tree('#2f7a46')) + at(430, 232, 1.1, M.canoe())],
  'g-K1': ['#bfe6ff', '#eaf7ff', '#79c47a', () => at(540, 56, 1, M.sun()) + at(110, 56, 1, M.cloud()) + M.hills('#8fd18a', '#6ab56c') + at(330, 236, 1.8, M.wagon())],
  'g-K2': ['#ffe6c4', '#fff6e8', '#c9a15a', () => at(500, 54, 1, M.sun()) + M.hills('#d9b25f', '#c28f3d') + at(150, 220, 1.6, M.tree('#ee8a3a')) + at(300, 222, 1.3, M.tree('#d6342c')) + at(470, 222, 1.5, M.tree('#e0a800')) + at(220, 120, 1, M.leaf('#d6342c')) + at(380, 150, 1, M.leaf('#ee8a3a'))],
  'g-K3': ['#d8efff', '#f4fbff', '#79c47a', () => M.hills('#8fd18a', '#6ab56c') + at(500, 214, 1.5, M.house()) + at(250, 232, 2, M.cat()) + at(100, 54, 1, M.cloud())],
  'g-M1': ['#d6f0ff', '#f6fcff', '#79c47a', () => at(110, 58, 1, M.sun()) + M.hills('#9ad48f', '#6ab56c') + at(210, 232, 1.3, M.flower()) + at(300, 234, 1.2, M.flower('#7b61ff')) + at(400, 232, 1.4, M.flower('#ff7a59')) + at(320, 110, 1.6, M.bee()) + at(530, 190, 1.4, M.hive())],
  'g-M2': ['#3b2a22', '#6b4a3a', '#4a3226', () => M.ground('#4a3226') + at(150, 230, 1.5, M.shelf()) + at(330, 230, 1.5, M.shelf()) + at(470, 232, 1.2, M.lamp()) + at(540, 230, 1.5, M.book())],
  'g-M3': ['#0f1b3a', '#2b3a6b', '#1b2540', () => M.stars() + [0, 1, 2, 3, 4].map(i => at(110 + i * 105, 120, 1.3, M.phase(['M0 -22 A22 22 0 0 1 0 22 A22 22 0 1 1 0 -22z', 'M0 -22 A22 22 0 0 0 0 22 A11 22 0 0 1 0 -22z', 'M0 -22 A22 22 0 0 0 0 22 A22 22 0 0 0 0 -22z M0 -22 A22 22 0 0 1 0 22 A11 22 0 0 0 0 -22z', 'M0 -22 A22 22 0 0 1 0 22 A11 22 0 0 0 0 -22z', 'M-1 -22 A22 22 0 0 1 -1 22 A22 22 0 0 1 -1 -22z'][i]))).join('') + at(320, 236, 0.9, M.earth())],
  'g-H1': ['#efe3c8', '#f8f1e0', '#b99a6b', () => M.ground('#c9ac7e') + at(250, 228, 1.8, M.press()) + at(430, 228, 1.4, M.paper()) + at(520, 230, 1.2, M.book('#7a4b2a'))],
  'g-H2': ['#dff3f7', '#f4fcfe', '#9fd0dc', () => M.ground('#bfe0ea') + at(150, 118, 1.5, M.cells()) + at(500, 110, 1.3, M.cells()) + at(320, 226, 1.8, M.shield()) + at(480, 226, 1.4, M.syringe())],
  'g-H3': ['#3a3550', '#6b5a7a', '#2f2a40', () => M.stars() + M.ground('#2f2a40') + at(230, 226, 1.6, M.envelope()) + at(410, 228, 1.3, M.candle()) + '<g stroke="#9ec1e0" stroke-width="2" opacity=".6">' + [60, 140, 300, 380, 520, 590].map(x => `<line x1="${x}" y1="20" x2="${x - 8}" y2="52"/>`).join('') + '</g>'],
}

// Topic tags used to suggest related readings.
export const TAGS = {
  'b-k2': ['nature', 'community'], 'b-35': ['family', 'humor'], 'b-912': ['society', 'classic'],
  'rwf-E1': ['animals', 'nature'], 'rwf-E2': ['school', 'weather'], 'rwf-E3': ['history', 'society'], 'rwf-E4': ['science', 'humor'],
  'rwf-E5': ['science', 'earth'], 'rwf-E6': ['school', 'writing'], 'rwf-E7': ['earth', 'science'], 'rwf-E8': ['space', 'science'], 'rwf-E9': ['outdoors', 'family'],
  'g-K1': ['family', 'play'], 'g-K2': ['nature', 'science'], 'g-K3': ['animals', 'community'],
  'g-M1': ['animals', 'science', 'nature'], 'g-M2': ['books', 'community'], 'g-M3': ['space', 'science', 'earth'],
  'g-H1': ['history', 'society', 'books'], 'g-H2': ['science', 'health'], 'g-H3': ['writing', 'family'],
}

export function art(pid) {
  const s = SCENES[pid] || SCENES['b-k2']
  const id = 'sk' + (++uid)
  return `<svg viewBox="0 0 640 260" preserveAspectRatio="xMidYMid slice" role="img" focusable="false" aria-hidden="true">`
    + `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s[0]}"/><stop offset="1" stop-color="${s[1]}"/></linearGradient></defs>`
    + `<rect width="640" height="260" fill="url(#${id})"/>${s[3]()}</svg>`
}
