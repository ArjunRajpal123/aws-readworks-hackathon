// Interface text for the whole platform. English values are the original demo strings.
// Spanish values are machine-translated drafts and need review.
import { AD } from './admin_i18n.js'
import { QI } from './q_i18n.js'
import { AS } from './assist_i18n.js'
import { TR } from './tour_i18n.js'
import { V3 } from './v3_i18n.js'
import { V4 } from './v4_i18n.js'

export const I18N = {
  en: {
  langLabel: 'Passage language',
  a11yBtn: 'Accessibility', szLegend: 'Text size', rdLegend: 'Reading', dpLegend: 'Display and motion',
  szM: 'Default', szL: 'Large', szXL: 'Extra large', font: 'Easy-to-read font', spacing: 'Wider line and letter spacing',
  sentence: 'Highlight the whole sentence too', strip: 'Reading strip (one line at a time)', contrast: 'High contrast',
  motion: 'Reduce motion', follow: 'Keep the current word in view', readq: 'Read questions and answers aloud',
  kbd: 'Keyboard', kSpace: '<kbd>Space</kbd> play / pause', kArrows: '<kbd>←</kbd> <kbd>→</kbd> back / forward 5 s',
  kTab: '<kbd>Tab</kbd> then <kbd>Enter</kbd> opens a word', reset: 'Reset', back5: 'Back 5 seconds', fwd5: 'Forward 5 seconds',
  speed: 'Speed', restart: 'Start over', dark: 'Dark reading', lg1: 'Word Stop: tap for a question',
  lg2: 'Vocabulary word: tap for its card', hCard: 'Word card', hDetails: 'Details', hBands: 'By grade band',
  words: 'words', passageLbl: 'Passage', passageDemo: 'Passages with Word Stops', idleNone: 'This passage has no Word Stops yet. Press play, and tap any word to hear it again.', detailsNone: 'No Word Stops or vocabulary words in this passage yet.', srcPollySent: v => `Voice: Amazon Polly neural (${v}), sentence highlight`, panelTab: 'Word panel', panelClose: 'Close panel', thLegend: 'Color theme', thAuto: 'Match my device', thLight: 'Light', thDark: 'Dark', toDark: '☾ Dark mode', toLight: '☀ Light mode', srcPolly: v => `Voice: Amazon Polly neural (${v})`, srcBrowser: 'Voice: browser (estimated timing)', play: 'Play', pause: 'Pause', stepper: (k, n) => `Stop ${k} of ${n}`, move: 'Move', wsName: 'Word Stop', on: 'on',
  caseFile: n => `CASE FILE #${n}`, tapHint: 'Tap words in the passage. Tap again to unselect.', checkClue: 'Check my clue words',
  tapOne: 'Tap at least one word first.', tapErr: 'Those words don’t explain it. Look right after the word “or.”',
  niceFind: w => `Nice find: “${w}”.`, yourReply: 'Your reply', replyPh: 'Reply: I think it means… because…',
  replyBtn: 'Reply and compare', replyErr: 'Write a few words first, then compare.', you: 'You',
  compareHint: 'Now check your idea against the highlighted clues and the word card.', solved: 'SOLVED',
  resolvedBank: '✓ Resolved · added to your word bank', resolved: '✓ Resolved', resume: 'Resume reading ▶',
  fromStart: 'Read from the start ▶', hear: 'Hear it', synonyms: 'Synonyms', wordParts: 'Word parts',
  shades: 'Shades of meaning', english: 'English', cogPair: 'Cognado', cogEs: 'Cognate', spanish: 'Spanish', watch: 'Watch for',
  pairHint: 'Definition shown from the paired English text. ReadWorks data has no Spanish definition yet (open question).',
  trHint: 'Machine-translated definition (draft). Needs review.', openCard: 'Open word card: ',
  detailsDemo: (n, vc) => `<b>On this page:</b> ${n} Word Stop${n > 1 ? 's' : ''} · ${vc} tappable vocabulary word${vc > 1 ? 's' : ''}`,
  jarHint: 'Tap a purple word or answer Glow’s question to catch a word. Tap it here to hear it again.',
  badges: [['def', 'Definition Detective'], ['back', 'Look-Back Tracker'], ['opp', 'Opposite Spotter']],
  badgeNote: 'Each badge is a clue type. Opposite Spotter is earned in other passages.', streak: 'First-try streak:',
  moves: ['Word parts', 'Restatement', 'Definition', 'Contrast'], yourColor: 'Your color',
  colors: ['Teal', 'Purple', 'Orange', 'Green'],
  bankHint: 'Words you resolve land here, with the clue type, ready for your essay notes.', copyBank: 'Copy word bank',
  copied: 'Copied', copyFail: 'Copy failed: select the list instead',
  idle: (band, game, n) => ({
    k2: 'Press play and Glow follows along. Tap a purple word with a yellow dot and Glow asks you about it.' + (game ? ' Tap any purple word to catch it in the glow jar.' : ''),
    '35': `The audio reads straight through. Tap a word with a dot to open its case file (${n} here).`,
    '68': `The audio reads straight through. Tap a word with a dot to try a move on it (${n} here).`,
    '912': `The audio reads straight through. Tap a word with a dot to open its margin comment (${n} here).`
  })[band],
  stopsOff: 'Word Stops are off. Tapping a word opens its card only, with no question.',
  cardIdle: 'Tap any underlined word to open its card. Tap any other word to hear the passage from there.',
  stopsBtn: on => `Word Stops: ${on ? 'On' : 'Off'}`, gameBtn: on => `Game features: ${on ? 'On' : 'Off'}`,
  gameTitle: 'Optional add-on: glow jar, badges, streaks, word bank', voiceOn: 'Voice on', voiceOff: 'Voice off', sibMaking: 'Making the English version… this takes a few seconds.', sibFailed: 'Could not make the other language version. Try again later.',
  foot1: `Passage text, grade, Lexile, vocabulary, questions and sample answers come from ReadWorks' public passage data. Photos are openly licensed and credited under each picture; the drawings are original. Spanish text is a machine-translated draft that has not been reviewed.`,
  foot2: `<strong>Why guess first.</strong> A meta-analysis of 21 studies found instruction in working out word meaning from context had a 0.43 SD effect, and direct clue instruction did best (<a href="https://pedagogischestudien.nl/article/download/14910/16362" target="_blank" rel="noopener">Fukkink &amp; de Glopper, 1998</a>).`,
  foot3: `<strong>Sources:</strong>
    <a href="https://www.readworks.org/article/Lets-Meet-a-Park-Caretaker/2b781dab-4521-40d2-a9b6-ad5f2bb0ba98" target="_blank" rel="noopener">Let's Meet a Park Caretaker</a> ·
    <a href="https://www.readworks.org/article/A-Very-Messy-Tea-Party/5af24980-4d6d-41c1-87fa-4f21cb2d169d" target="_blank" rel="noopener">A Very Messy Tea Party</a> ·
    <a href="https://www.readworks.org/article/Excerpt-from-Pride-and-Prejudice/ff1d34c9-14f1-4e78-b509-6568dc912a17" target="_blank" rel="noopener">Excerpt from Pride and Prejudice</a>`,
  },
  es: {
  
  langLabel: 'Idioma del texto', a11yBtn: 'Accesibilidad', szLegend: 'Tamaño del texto', rdLegend: 'Lectura',
  dpLegend: 'Pantalla y movimiento', szM: 'Predeterminado', szL: 'Grande', szXL: 'Extra grande',
  font: 'Fuente fácil de leer', spacing: 'Mayor espaciado entre líneas y letras', sentence: 'Resaltar también toda la oración',
  strip: 'Tira de lectura (una línea a la vez)', contrast: 'Alto contraste', motion: 'Reducir movimiento',
  follow: 'Mantener la palabra actual a la vista', readq: 'Leer en voz alta preguntas y respuestas',
  kbd: 'Teclado', kSpace: '<kbd>Espacio</kbd> reproducir / pausar', kArrows: '<kbd>←</kbd> <kbd>→</kbd> atrás / adelante 5 s',
  kTab: '<kbd>Tab</kbd> y luego <kbd>Intro</kbd> abre una palabra', reset: 'Restablecer', back5: 'Atrás 5 segundos',
  fwd5: 'Adelante 5 segundos', speed: 'Velocidad', restart: 'Empezar de nuevo', dark: 'Lectura oscura',
  lg1: 'Parada de palabra: toca para una pregunta', lg2: 'Palabra de vocabulario: toca para ver su tarjeta',
  hCard: 'Tarjeta de palabra', hDetails: 'Detalles', hBands: 'Por nivel',
  words: 'palabras', passageLbl: 'Texto', passageDemo: 'Textos con Paradas de palabras', idleNone: 'Este texto aún no tiene Paradas de palabras. Presiona play y toca cualquier palabra para oírla otra vez.', detailsNone: 'Este texto aún no tiene Paradas de palabras ni palabras de vocabulario.', srcPollySent: v => `Voz: Amazon Polly neural (${v}), resaltado por oración`, panelTab: 'Panel de palabras', panelClose: 'Cerrar panel', thLegend: 'Tema de color', thAuto: 'Igual que mi dispositivo', thLight: 'Claro', thDark: 'Oscuro', toDark: '☾ Modo oscuro', toLight: '☀ Modo claro', srcPolly: v => `Voz: Amazon Polly neural (${v})`, srcBrowser: 'Voz: navegador (tiempos estimados)', play: 'Reproducir', pause: 'Pausar', stepper: (k, n) => `Parada ${k} de ${n}`, move: 'Jugada',
  wsName: 'Parada de palabra', on: 'sobre', caseFile: n => `EXPEDIENTE n.º ${n}`,
  tapHint: 'Toca palabras del texto. Vuelve a tocar para quitarlas.', checkClue: 'Revisar mis palabras pista',
  tapOne: 'Primero toca al menos una palabra.', tapErr: 'Esas palabras no lo explican. Mira justo después de la palabra “o”.',
  niceFind: w => `Buen hallazgo: “${w}”.`, yourReply: 'Tu respuesta', replyPh: 'Responde: Creo que significa… porque…',
  replyBtn: 'Responder y comparar', replyErr: 'Primero escribe unas palabras y luego compara.', you: 'Tú',
  compareHint: 'Ahora compara tu idea con las pistas resaltadas y la tarjeta de la palabra.', solved: 'RESUELTO',
  resolvedBank: '✓ Resuelto · añadido a tu banco de palabras', resolved: '✓ Resuelto', resume: 'Seguir leyendo ▶',
  fromStart: 'Leer desde el principio ▶', hear: 'Escúchala', synonyms: 'Sinónimos', wordParts: 'Partes de la palabra',
  shades: 'Matices de significado', english: 'Inglés', cogPair: 'Cognado', cogEs: 'Cognado', spanish: 'Español',
  watch: 'Ojo con',
  pairHint: 'Definición tomada del texto pareado en inglés. Los datos de ReadWorks aún no tienen definición en español (pregunta abierta).',
  trHint: 'Definición traducida automáticamente (borrador). Pendiente de revisión.', openCard: 'Abrir tarjeta de palabra: ',
  detailsDemo: (n, vc) => `<b>En esta página:</b> ${n} Parada${n > 1 ? 's' : ''} de palabra · ${vc} palabra${vc > 1 ? 's' : ''} de vocabulario tocable${vc > 1 ? 's' : ''}`,
  jarHint: 'Toca una palabra morada o responde a Glow para guardarla. Tócala aquí para oírla otra vez.',
  badges: [['def', 'Detective de definiciones'], ['back', 'Rastreador de pistas atrás'], ['opp', 'Cazador de opuestos']],
  badgeNote: 'Cada insignia es un tipo de pista. El Cazador de opuestos se gana en otros textos.',
  streak: 'Racha de primer intento:', moves: ['Partes de la palabra', 'Reformulación', 'Definición', 'Contraste'],
  yourColor: 'Tu color', colors: ['Verde azulado', 'Morado', 'Naranja', 'Verde'],
  bankHint: 'Las palabras que resuelvas aparecen aquí, con el tipo de pista, listas para tus notas del ensayo.',
  copyBank: 'Copiar banco de palabras', copied: 'Copiado', copyFail: 'No se pudo copiar: selecciona la lista',
  idle: (band, game, n) => ({
    k2: 'Presiona play y Glow te acompaña. Toca una palabra morada con punto amarillo y Glow te pregunta.' + (game ? ' Toca cualquier palabra morada para guardarla en el frasco de luz.' : ''),
    '35': `El audio se lee de corrido. Toca una palabra con un punto para abrir su expediente (${n} aquí).`,
    '68': `El audio se lee de corrido. Toca una palabra con un punto para probar una jugada con ella (${n} aquí).`,
    '912': `El audio se lee de corrido. Toca una palabra con un punto para abrir su comentario al margen (${n} aquí).`
  })[band],
  stopsOff: 'Las Paradas de palabras están desactivadas. Al tocar una palabra solo se abre su tarjeta, sin pregunta.',
  cardIdle: 'Toca cualquier palabra subrayada para abrir su tarjeta. Toca cualquier otra palabra para oír el texto desde ahí.',
  stopsBtn: on => `Paradas de palabras: ${on ? 'Sí' : 'No'}`, gameBtn: on => `Funciones de juego: ${on ? 'Sí' : 'No'}`,
  gameTitle: 'Extra opcional: frasco de luz, insignias, rachas, banco de palabras', sibMaking: 'Creando la versión en español… tarda unos segundos.', sibFailed: 'No se pudo crear la versión en el otro idioma. Inténtalo más tarde.', voiceOn: 'Voz activada', voiceOff: 'Voz desactivada',
  foot1: `El texto, el grado, el Lexile, el vocabulario, las preguntas y las respuestas de ejemplo vienen de los datos públicos de ReadWorks. Las fotos tienen licencia abierta y se acreditan debajo de cada imagen; los dibujos son originales. El texto en español es un borrador de traducción automática que no ha sido revisado.`,
  foot2: `<strong>Por qué adivinar primero.</strong> Un metaanálisis de 21 estudios halló que enseñar a deducir el significado de una palabra por el contexto tuvo un efecto de 0,43 DE, y la instrucción directa sobre pistas fue la que mejor funcionó (<a href="https://pedagogischestudien.nl/article/download/14910/16362" target="_blank" rel="noopener">Fukkink y de Glopper, 1998</a>).`,
  foot3: `<strong>Fuentes:</strong>
    <a href="https://www.readworks.org/article/Lets-Meet-a-Park-Caretaker/2b781dab-4521-40d2-a9b6-ad5f2bb0ba98" target="_blank" rel="noopener">Let's Meet a Park Caretaker</a> ·
    <a href="https://www.readworks.org/article/A-Very-Messy-Tea-Party/5af24980-4d6d-41c1-87fa-4f21cb2d169d" target="_blank" rel="noopener">A Very Messy Tea Party</a> ·
    <a href="https://www.readworks.org/article/Excerpt-from-Pride-and-Prejudice/ff1d34c9-14f1-4e78-b509-6568dc912a17" target="_blank" rel="noopener">Excerpt from Pride and Prejudice</a>`,
  },
}

Object.assign(I18N.en, AD.en, QI.en, AS.en, TR.en, V3.en, V4.en)
Object.assign(I18N.es, AD.es, QI.es, AS.es, TR.es, V3.es, V4.es)
