// Spanish versions of the 3-5, 6-8 and 9-12 demo passages, vocabulary cards and Word Stops.
// MACHINE-TRANSLATED DRAFT: not reviewed by ReadWorks or a Spanish-language editor.
// Markers match data.js: * vocab word, ~n clue words, -n opposite words, =n signal word, ^ closes the Word Stop sentence.
const NOTE = ['Traducción', 'Borrador de traducción automática. Pendiente de revisión.']

export function addSpanish(CARDS, MODES) {
  Object.assign(CARDS, {
    impuesto: { word: 'impuesto', pos: 'sustantivo', pair: 'tax', tr: true, def: 'Cantidad de dinero que se paga al gobierno y que el gobierno usa para pagar sus servicios a la gente y para mantenerse.', ex: 'Los impuestos se cobran sobre lo que ganamos y sobre muchas cosas que compramos.', syn: ['tributo'], es: [], cog: false },
    impuesto68: { word: 'impuesto', pos: 'sustantivo', pair: 'tax', tr: true, def: 'Cantidad de dinero que se paga al gobierno y que el gobierno usa para pagar sus servicios a la gente y para mantenerse.', ex: 'Los impuestos se cobran sobre lo que ganamos y sobre muchas cosas que compramos.', syn: ['gravamen', 'arancel', 'tributo'], es: [], cog: false },
    colono: { word: 'colono', pos: 'sustantivo', pair: 'colonist', tr: true, def: 'Persona que vive en una colonia o es miembro de ella.', ex: 'Antes de la Guerra de Independencia, los colonos de los Estados Unidos formaban parte del gobierno británico.', syn: [], es: [], cog: true },
    principio: { word: 'principio', pos: 'sustantivo', pair: 'principle', tr: true, def: 'Un principio es una creencia básica sobre lo que está bien y lo que está mal. La creencia de que todas las personas deben ser tratadas de manera igual y justa es un principio en el que se basan las leyes de muchos países.', syn: ['norma', 'ideal', 'regla'], es: [], cog: true, look: 'también significa “comienzo”: es otro sentido de la palabra' },
    perceptible: { word: 'perceptible', pos: 'adjetivo', pair: 'discernible', tr: true, def: 'Que se puede percibir o distinguir.', ex: 'El cambio en el producto era sutil y no resultaba perceptible para la mayoría de los usuarios.', syn: ['apreciable', 'visible'], es: [], cog: false },
    regocijarse: { word: 'regocijarse', pos: 'verbo', pair: 'rejoice', tr: true, def: 'Llenarse de alegría o mostrar gran placer.', ex: 'Nos regocijamos con el buen tiempo.', syn: ['alegrarse', 'celebrar', 'deleitarse'], es: [], cog: false,
      shades: { ends: ['un sentimiento interior', 'un acontecimiento que otros ven'], words: ['deleitarse', 'regocijarse', 'celebrar'], me: 1 } },
    alterar: { word: 'alterar', pos: 'verbo transitivo', pair: 'alter', tr: true, def: 'Hacer diferente; cambiar.', ex: 'El vestido le quedaba grande, así que lo mandó alterar.', syn: ['ajustar', 'modificar', 'revisar'], es: [], cog: true,
      shades: { ends: ['cambio pequeño', 'cambio grande'], words: ['ajustar', 'alterar', 'modificar'], me: 1 } },
    formalidad: { word: 'formalidad', pos: 'sustantivo', pair: 'formality', tr: true, def: 'Apego a las costumbres o normas ceremoniosas.', syn: ['dignidad', 'ceremonia'], es: [], cog: true, parts: 'formal + -idad (cualidad de)' },
  })

  // K-2 Spanish cards: the demo data had English definitions and examples (taken from the paired English text).
  Object.assign(CARDS, {
    planeta: { word: 'planeta', pos: 'sustantivo', lang: 'es', pair: 'planet', tr: true, def: 'Un planeta es un cuerpo grande en el espacio que se mueve alrededor de una estrella. Los planetas son mucho más pequeños que las estrellas y no dan luz como ellas. La Tierra es un planeta que se mueve alrededor de la estrella que llamamos Sol.', ex: 'Júpiter es el planeta más grande de nuestro sistema solar.', syn: [], es: [], cog: true },
    oceano: { word: 'océano', pos: 'sustantivo', lang: 'es', pair: 'ocean', tr: true, def: 'Cuando hablamos de un océano, nos referimos a una parte de la enorme extensión de agua salada que cubre la Tierra.', ex: 'El estado de Hawái, en Estados Unidos, está formado por varias islas en el océano Pacífico.', syn: [], es: [], cog: true },
    foto: { word: 'fotos', pos: 'sustantivo', lang: 'es', pair: 'photo', tr: true, def: 'Foto es una palabra corta para fotografía. Una fotografía es una imagen que se hace con una cámara.', ex: 'Dan y sus amigos miraron las fotos de su viaje de campamento.', syn: [], es: [], cog: true },
  })

  MODES.push(
    {
      id: '35es', band: '35', lang: 'es-US', tab: '3–5', sub: 'Detective de palabras', title: 'Una fiesta del té muy desordenada', voice: 1,
      reward: 'Insignias de detective', stopTitle: 'Expediente del caso',
      details: [['Grado', '5'], ['Versión', 'StepRead 2 · 690L · 811 palabras (texto original)'], ['Tipo', 'No ficción'], ['Autor', 'W.M. Akers'], ['Vocabulario', 'colono, impuesto'], NOTE],
      paras: [
        'A muchos ingleses les encanta el té. Les encanta desde que se trajo a Inglaterra por primera vez desde China. En el siglo XVIII, llevaron su amor por el té a sus colonias de América del Norte.',
        'En esa época, existía una empresa inglesa llamada Compañía de las Indias Orientales. Esta empresa traía té de la India a Inglaterra. Llevarlo hasta allí costaba mucho dinero. Los *impuestos hacían que ese costo fuera aún más alto.^ ~1Un ~1impuesto ~1es ~1dinero ~1que ~1la ~1gente ~1tiene ~1que ~1pagar ~1al ~1gobierno. El gobierno inglés hizo un trato con la Compañía de las Indias Orientales a principios del siglo XVIII.',
        'Sin embargo, a la ~2gente ~2de ~2las ~2colonias de América del Norte no le gustaba pagar tanto por el té. Decidieron comprar otro té. Lo compraban a unos holandeses que lo metían a escondidas en las colonias. Este té era tan bueno como el té inglés. Además, era más barato. ¿Y qué si comprarlo iba contra la ley? A los *colonos no les importaba.^ Aun así tomaban su taza de té y les quedaba dinero.',
      ],
      stops: [
        { word: 'impuesto', type: 'choice', badge: 'def', q: '“Los impuestos hacían que ese costo fuera aún más alto.” ¿Qué crees que es un impuesto?',
          choices: [{ t: 'Dinero que la gente tiene que pagar al gobierno', ok: true }, { t: 'Un tipo de hoja de té' }, { t: 'Un barco que lleva té' }],
          right: '¡Caso resuelto! La siguiente oración lo demuestra.', rightPlain: 'Buena idea. La siguiente oración lo demuestra.', wrong: 'Mmm. Un impuesto hizo que el costo subiera. Mira otra vez.', clue: 'Pista de definición',
          notes: [{ p: 1, k: 'Pista de definición', html: 'La oración siguiente te lo dice: <b>un impuesto es dinero que la gente tiene que pagar al gobierno</b>.' }] },
        { word: 'colono', type: 'choice', badge: 'back', q: '“A los colonos no les importaba.” ¿Quiénes son los colonos?',
          choices: [{ t: 'Personas que viven en las colonias', ok: true }, { t: 'Holandeses que venden té' }, { t: 'Trabajadores de la Compañía de las Indias Orientales' }],
          right: '¡Caso resuelto! Mira atrás: “la gente de las colonias” compraba el té más barato.', rightPlain: 'Sí. Mira atrás: “la gente de las colonias” compraba el té más barato.', wrong: 'No exactamente. ¿Quién compraba el té holandés?', clue: 'Pista de mirar atrás',
          notes: [{ p: 2, k: 'Pista de mirar atrás', html: 'Antes: <b>la gente de las colonias</b>. Un <b>colono</b> es una persona que vive en una colonia.' }] },
      ],
      how: 'Expedientes de casos y cursor de lupa. Extra de juego: un sello RESUELTO e insignias con el nombre de cada tipo de pista.',
    },
    {
      id: '68es', band: '68', lang: 'es-US', tab: '6–8', sub: 'Constructor de palabras', title: 'Una fiesta del té muy desordenada', voice: 1,
      reward: 'Tus jugadas', stopTitle: 'Parada de palabra',
      details: [['Grado', '5 (se usa aquí para la interacción de 6–8)'], ['Versión', 'StepRead 1 · 910L · 850 palabras (texto original)'], ['Tipo', 'No ficción'], ['Autor', 'W.M. Akers'], ['Vocabulario', 'colono, principio, impuesto'], NOTE],
      paras: [
        'Con la Ley del Té de 1773, el Parlamento permitió que la Compañía de las Indias Orientales vendiera té a los *colonos por menos dinero que antes.^ Como resultado, la Compañía del Té de las Indias Orientales pudo dejar fuera por completo a los comerciantes estadounidenses del proceso de venta del té. De repente, el té inglés era más barato que el té holandés ilegal. Esto debería haber hecho felices a los colonos, pero no fue así.',
        'Eso se debe en parte a que la ley perjudicó a la economía estadounidense. Y también a que el *impuesto seguía vigente, y los colonos no querían que nada de su dinero fuera a algo que consideraban ~2injusto. Era una cuestión de *principios, =2o del ~2código ~2moral de los colonos.^ Y algunos colonos de Boston eran, en efecto, muy íntegros.',
      ],
      stops: [
        { word: 'colono', type: 'choice', move: 'Partes de la palabra', parts: ['colonia', '-ista', 'colonista'],
          q: 'Descompón la palabra: colon(ia) + -ista (colonista, o colono). Un -ista es una persona que hace o es algo, como un artista o un dentista. Entonces un colono es…',
          choices: [{ t: 'una persona que vive en una colonia', ok: true }, { t: 'una empresa que envía té' }, { t: 'una ley aprobada por el Parlamento' }],
          right: 'Lo armaste. Las partes de la palabra sirven aunque la oración no dé ninguna pista.', rightPlain: 'Correcto. Las partes de la palabra sirven aunque la oración no dé ninguna pista.', wrong: 'Usa las partes: colonia + persona.', clue: 'Pista de partes de la palabra (colonia + -ista)',
          notes: [{ p: 0, k: 'Pista de partes de la palabra', html: 'Esta oración no da ninguna pista, así que usa las partes: <b>colonia + -ista</b>.' }] },
        { word: 'principio', type: 'tapclue', move: 'Reformulación',
          q: 'Antes de adivinar, toca las palabras del texto que ayudan a explicar “principio”.', q2: 'Ahora, ¿qué significa principio aquí?',
          choices: [{ t: 'Una creencia sobre lo que está bien y lo que está mal', ok: true }, { t: 'El comienzo de algo' }, { t: 'Un impuesto sobre el té' }],
          right: 'Correcto. Ojo: “principio” también puede significar “comienzo”. Es la misma palabra, pero aquí tiene otro sentido.', wrong: 'Esa no. Mira las palabras que tocaste.', clue: 'Pista de reformulación (palabra señal: o)',
          notes: [{ p: 1, k: 'Pista de reformulación', html: 'La palabra <b>o</b> señala la misma idea con otras palabras: <b>código moral</b>. Antes, <b>injusto</b> lo refuerza.' }] },
      ],
      cardOverride: { impuesto: 'impuesto68' },
      how: 'Limpio y cuadrado. Las partes de la palabra encajan y los tipos de pista son “jugadas”. Extra de juego: rachas de primer intento y elige tu color.',
    },
    {
      id: '912es', band: '912', lang: 'es-US', tab: '9–12', sub: 'Anotación', title: 'Fragmento de Orgullo y prejuicio', voice: 1,
      reward: 'Banco de palabras', stopTitle: 'Comentario',
      details: [['Grado', '11–12'], ['Palabras', '1,157 (texto original)'], ['Lexile', 'sin Lexile'], ['Tipo', 'Ficción'], ['Autora', 'Jane Austen'], ['Vocabulario', 'alterar, perceptible, formalidad, regocijarse'], NOTE],
      paras: [
        'Por fin se hizo *perceptible la Rectoría. El ~1jardín en pendiente hasta el camino, la ~1casa que se alzaba en él, las empalizadas verdes y el seto de laurel, ~1todo ~1anunciaba ~1que ~1habían ~1llegado.^ El señor Collins y Charlotte aparecieron en la puerta, y el carruaje se detuvo ante la pequeña verja que conducía, por un corto sendero de grava, hasta la casa, entre los ~2gestos ~2de ~2cabeza ~2y ~2las ~2sonrisas de toda la comitiva. En un momento todos estaban fuera del coche, *regocijándose al verse unos a otros.^ La señora Collins recibió a su amiga con la más ~2viva ~2alegría, y Elizabeth se sentía cada vez más satisfecha de haber venido al encontrarse recibida con tanto afecto. Vio al instante que los modales de su primo no se habían *alterado con el matrimonio; su cortesía formal era ~3la ~3misma ~3de ~3siempre, y la retuvo unos minutos en la verja para oír y satisfacer sus preguntas por toda su familia.^ Luego, sin más demora que la de señalar lo cuidada que estaba la entrada, los hicieron pasar a la casa; y en cuanto estuvieron en el salón, les dio la bienvenida por segunda vez, con ostentosa *formalidad, a su humilde morada, y repitió puntualmente todos los ofrecimientos de refrigerio de su esposa.',
      ],
      forms: { regocijandose: 'regocijarse', alterado: 'alterar' },
      stops: [
        { word: 'perceptible', type: 'choice', q: 'Luego el narrador enumera el jardín, la casa, el seto. ¿Qué significa perceptible?',
          choices: [{ t: 'Que se puede ver o notar', ok: true }, { t: 'Lejano y escondido' }, { t: 'Viejo y en ruinas' }],
          right: 'Sí. La lista de cosas que ahora pueden ver es la pista.', wrong: 'Fíjate en lo que viene justo después: ¿qué pueden ver ahora?', clue: 'Pista de ejemplo (lo que aparece a la vista)',
          notes: [{ p: 0, k: 'Pista de ejemplo', html: 'Después de la palabra, Austen enumera lo que aparece a la vista: <b>jardín, casa, seto</b>. “Todo anunciaba que habían llegado.”' }] },
        { word: 'regocijarse', type: 'write', q: 'Con tus propias palabras, ¿qué están haciendo? ¿Qué del texto te hace pensarlo?', clue: 'Pista de inferencia (entre oraciones)',
          notes: [{ p: 0, k: 'Pista de inferencia', html: 'Ninguna oración lo define. Antes: <b>gestos de cabeza y sonrisas</b>. Después: <b>la más viva alegría</b>. Júntalos.' }] },
        { word: 'alterar', type: 'choice', q: 'Su cortesía era “la misma de siempre”. ¿Qué significa alterado?',
          choices: [{ t: 'Cambiado', ok: true }, { t: 'Mejorado mucho' }, { t: 'Notado por otros' }],
          right: 'Correcto. El punto y coma prepara una reformulación: no alterado = la misma de siempre.', wrong: 'Vuelve a leer las palabras después del punto y coma.', clue: 'Pista de reformulación (después del punto y coma)',
          notes: [{ p: 0, k: 'Pista de reformulación', html: '<b>No alterado</b> = <b>la misma de siempre</b>. La misma idea, dicha dos veces.' }] },
      ],
      how: 'Tranquilo y adulto. Las paradas llegan como comentarios al margen, con matices de significado, partes de palabras y lectura oscura. Extra: un banco de palabras exportable.',
    },
  )

  // The existing K-2 Spanish mode still has English labels.
  const k2 = MODES.find(m => m.id === 'k2es')
  k2.sub = 'Glow la luciérnaga'
  k2.details = [['Grado', 'Kínder'], ['Palabras', '109'], ['Lexile', '320L'], ['Tipo', 'Texto pareado español-inglés (“Colors All Around”)'], ['Autor', 'Rebecca Clark'], ['Pareado con', '“Blue on Earth” (inglés, 370L)'], ['Vocabulario', 'planeta, océano, fotos (en negrita en el texto, emparejadas con el vocabulario en inglés planet, ocean, photo)']]
  k2.how = 'Glow sigue las palabras. Toca una palabra punteada y Glow pregunta con dibujos. Extra de juego: un frasco de luz guarda las palabras.'
}
