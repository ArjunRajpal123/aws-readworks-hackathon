import { addSpanish } from './data_es.js'
// Placeholder demo content carried over from WordStops_v8 (passages, vocab cards, Word Stops, icons).
// To be replaced by the soundAlong JSON + timing files.
export const SPK='<svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M2 6h3l4-3v10L5 10H2z"/><path d="M11 5.5a3.5 3.5 0 0 1 0 5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
export const MUTE='<svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M2 6h3l4-3v10L5 10H2z"/><path d="M11 6l4 4M15 6l-4 4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
export const GLOW='<svg viewBox="0 0 48 48" aria-hidden="true"><ellipse cx="17" cy="15" rx="9" ry="6" fill="#d9ccf5" stroke="#6b4bb0" stroke-width="1.5" transform="rotate(-25 17 15)"/><ellipse cx="29" cy="13" rx="9" ry="6" fill="#d9ccf5" stroke="#6b4bb0" stroke-width="1.5" transform="rotate(20 29 13)"/><circle class="tail" cx="34" cy="33" r="9" fill="#ffd23f" opacity=".45"/><ellipse cx="31" cy="31" rx="8" ry="6.5" fill="#ffd23f"/><circle cx="19" cy="27" r="10" fill="#6b4bb0"/><circle cx="16" cy="25" r="3" fill="#fff"/><circle cx="23" cy="25" r="3" fill="#fff"/><circle cx="16.6" cy="25.4" r="1.5" fill="#222"/><circle cx="23.6" cy="25.4" r="1.5" fill="#222"/><path d="M16 31q3.5 3 7 0" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/><path d="M14 18l-3-6M22 17l1-7" stroke="#6b4bb0" stroke-width="1.6" stroke-linecap="round"/><circle cx="11" cy="12" r="1.6" fill="#ffd23f"/><circle cx="23" cy="10" r="1.6" fill="#ffd23f"/></svg>';
export const JAR=n=>`<svg viewBox="0 0 72 86" aria-hidden="true"><rect x="20" y="4" width="32" height="10" rx="3" fill="#6b4bb0"/><path d="M16 16h40q6 0 6 8v50q0 8-8 8H18q-8 0-8-8V24q0-8 6-8z" fill="#fff" stroke="#6b4bb0" stroke-width="2.5"/>${Array.from({length:n},(_,i)=>`<circle cx="${24+(i*17)%28}" cy="${70-i*12}" r="6" fill="#ffd23f" stroke="#e0a800"/>`).join('')}</svg>`;
export const BADGE={
 def:(c)=>`<svg viewBox="0 0 54 54" aria-hidden="true"><circle cx="27" cy="27" r="24" fill="#f7ebc8" stroke="${c}" stroke-width="3"/><rect x="16" y="15" width="18" height="24" rx="2" fill="#fff" stroke="${c}" stroke-width="2"/><path d="M20 21h10M20 26h10M20 31h6" stroke="${c}" stroke-width="2"/><circle cx="35" cy="34" r="6" fill="none" stroke="${c}" stroke-width="2.5"/><path d="M39 38l5 5" stroke="${c}" stroke-width="3"/></svg>`,
 back:(c)=>`<svg viewBox="0 0 54 54" aria-hidden="true"><circle cx="27" cy="27" r="24" fill="#f7ebc8" stroke="${c}" stroke-width="3"/><path d="M36 27H18m6-7-7 7 7 7" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="38" cy="18" r="3" fill="${c}"/></svg>`,
 opp:(c)=>`<svg viewBox="0 0 54 54" aria-hidden="true"><circle cx="27" cy="27" r="24" fill="#f7ebc8" stroke="${c}" stroke-width="3"/><path d="M14 22h22l-5-5M40 32H18l5 5" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`
};
export const ICON={
 waves:'<svg viewBox="0 0 56 56" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22c6-6 10-6 16 0s10 6 16 0 10-6 16 0"/><path d="M4 34c6-6 10-6 16 0s10 6 16 0 10-6 16 0"/><path d="M4 46c6-6 10-6 16 0s10 6 16 0 10-6 16 0"/></svg>',
 tree:'<svg viewBox="0 0 56 56" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="28" cy="22" r="14"/><path d="M28 36v14M20 50h16"/></svg>',
 car:'<svg viewBox="0 0 56 56" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 36v-8l6-10h24l8 10h6v8z"/><circle cx="16" cy="38" r="5"/><circle cx="40" cy="38" r="5"/></svg>',
 bldg:'<svg viewBox="0 0 56 56" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><rect x="14" y="6" width="28" height="44"/><path d="M21 14h4M31 14h4M21 22h4M31 22h4M21 30h4M31 30h4M25 50v-9h6v9"/></svg>'
};
export const CARDS={
 planeta:{word:'planeta',pos:'sustantivo',lang:'es',pair:'planet',def:'A planet is a large thing in space that moves around a star. Planets are much smaller than stars, and they don\'t give off light as stars do. Earth is a planet that moves around the star that we call the sun.',ex:'Jupiter is the largest planet in our solar system.',syn:[],es:[],cog:true},
 oceano:{word:'océano',pos:'sustantivo',lang:'es',pair:'ocean',def:'If we talk about one ocean, we mean one part of all the vast area of salt water that covers the earth.',ex:'The U.S. state of Hawaii is made up of several islands in the Pacific Ocean.',syn:[],es:[],cog:true},
 foto:{word:'fotos',pos:'sustantivo',lang:'es',pair:'photo',def:'Photo is a short word for photograph. A photograph is a picture that is made by using a camera.',ex:'Dan and his friends looked at the photos of them from their camping trip.',syn:[],es:[],cog:true},
 nature:{word:'nature',pos:'noun',def:'Nature is everything in the world that is not made by people. Animals, plants, water, and air are parts of nature.',ex:'Harry loves nature, so he likes to go on hikes in the woods.',syn:['surroundings','outdoors','environment'],es:['naturaleza'],cog:true},
 visit:{word:'visit',pos:'verb',def:'When you visit someone, you go to see them and spend a little time with them. When you visit a place, you go there and see the things that are there.',syn:['see','drop by','call on'],es:['visitar','ir de visita','ir'],cog:true},
 tax:{word:'tax',pos:'noun',def:'a sum of money paid to a government, which the government uses to pay for its services to the people and to maintain itself.',ex:'Taxes are charged on what we earn and many things that we buy.',syn:[],es:['impuesto','tributo'],cog:false},
 tax68:{word:'tax',pos:'noun',def:'a sum of money paid to a government, which the government uses to pay for its services to the people and to maintain itself.',ex:'Taxes are charged on what we earn and many things that we buy.',syn:['levy','tariff','duty'],es:['impuesto','tributo'],cog:false},
 colonist:{word:'colonist',pos:'noun',def:'a person who lives in or is a member of a colony.',ex:'Before the Revolutionary War, colonists in the United States were part of the British government.',syn:[],es:['colono','colonizador'],cog:true},
 principle:{word:'principle',pos:'noun',def:'A principle is a basic belief about what is right and what is wrong. The belief that all people should be treated in an equal and fair manner is a principle that the laws of many countries are based on.',syn:['regulation','ideal','rule'],es:['principio'],cog:true,look:'principal: sounds the same, different word'},
 discernible:{word:'discernible',pos:'adjective',def:'able to be perceived or distinguished.',ex:'The change in the product was subtle and not discernible to most users.',syn:['perceptible','appreciable'],es:[],parts:'discern + -ible (able to be)'},
 rejoice:{word:'rejoice',pos:'verb',def:'to be full of joy or show great pleasure (sometimes followed by “in”).',ex:'We rejoiced in the good weather.',syn:['delight','glory','celebrate'],es:['regocijar','dar gusto'],cog:false,look:'a word you know inside it: joy',
   shades:{ends:['a feeling inside','an event others see'],words:['delight','rejoice','celebrate'],me:1}},
 alter:{word:'alter',pos:'transitive verb',def:'to make different; change.',ex:'The dress was too large for her now, so she had it altered.',syn:['adjust','amend','revise'],es:['alterar','cambiar','modificar'],cog:true,
   shades:{ends:['small change','big change'],words:['adjust','alter','revise'],me:1}},
 formality:{word:'formality',pos:'noun',def:'adherence to ceremonious custom or standards.',syn:['dignity','ceremony'],es:[],parts:'formal + -ity (the quality of being)'}
};
export const MODES=[
 {id:'k2es',band:'k2',lang:'es-US',tab:'K–2',sub:'Glow the firefly',title:'Encuentra los colores del arcoíris',voice:0.85,reward:'Frasco de luz',stopTitle:'Glow pregunta',
  details:[['Grade','Kindergarten'],['Words','109'],['Lexile','320L'],['Type','Spanish-English paired text ("Colors All Around")'],['Author','Rebecca Clark'],['Paired with','"Blue on Earth" (English, 370L)'],['Vocabulary','planeta, océano, fotos (bold in the passage, matched to the English vocab planet, ocean, photo)']],
  paras:["¿Puedes imaginar los colores del arcoíris? Nuestro *planeta está lleno de estos colores.",
   "Las fresas son rojas. Las catarinas también son rojas.",
   "Las calabazas son naranjas. ¿Qué más es naranja? Unas hojas en otoño son naranjas.",
   "Los girasoles y los limones son amarillos. A veces, los patitos también son amarillos.",
   "Un animal verde es el cocodrilo. Y el pasto es verde.",
   "El cielo sin nubes es azul. Otra cosa azul es el *océano y sus ~1grandes ~1olas.^",
   "Hay uvas moradas. ¿Sabías que las medusas también pueden ser moradas?",
   "Busca los colores del arcoíris en el mundo. ¡Quizá puedas sacarles *fotos!"],
  stops:[{word:'oceano',type:'pictures',q:'¿Qué dibujo muestra el océano?',say:'¿Qué dibujo muestra el océano? Agua con olas. Un árbol. O un carro.',
   choices:[{t:'Agua con olas',icon:'waves',ok:true},{t:'Un árbol',icon:'tree'},{t:'Un carro',icon:'car'}],
   right:'¡Sí! El océano tiene grandes olas. ¡Al frasco de luz!',rightPlain:'¡Sí! El océano tiene grandes olas.',wrong:'Casi. Busca la pista: grandes olas.',clue:'Pista de ejemplo',
   notes:[{p:5,k:'Pista',html:'El océano tiene <b>grandes olas</b>. Es mucha agua azul.'}]}],
  how:''},
 {id:'k2',tab:'K–2',sub:'Glow the firefly',title:"Let's Meet a Park Caretaker",voice:0.85,reward:'Glow jar',stopTitle:'Glow asks',
  details:[['Grade','1'],['Words','379'],['Lexile','590L'],['Type','Nonfiction'],['Author','Jill Lauren'],['Vocabulary','different, nature, visit']],
  paras:["Lots of people live in big cities. Cities are full of people, -1cars, -1and -1noise. That can feel a little stressful sometimes. So where can people in cities go when they want to find some peace and quiet? They can go to a park!",
   "A city park is a fun place to relax, play, and enjoy *nature. In Atlanta, Georgia, there's a big park called Piedmont Park. Over six million people *visit it every year! Many people go to look at the beautiful ~1trees ~1and ~1flowers.^ Others go to run or do yoga. Lots of people go to play sports."],
  stops:[{word:'nature',type:'pictures',q:'Which picture shows nature?',say:'Which picture shows nature? Trees and flowers. Cars. Or a tall building.',
   choices:[{t:'Trees and flowers',icon:'tree',ok:true},{t:'Cars',icon:'car'},{t:'Tall building',icon:'bldg'}],
   right:'Yes! Trees and flowers are part of nature. Into the glow jar it goes!',rightPlain:'Yes! Trees and flowers are part of nature.',wrong:'Not quite. People make that. Look for something that grows.',clue:'Example clue + opposite clue',
   notes:[{p:1,k:'Example clue',html:'People look at <b>trees and flowers</b>. Those are nature.'},{p:0,cx:true,k:'Opposite clue',html:'<b>Cars and noise</b> are the city. They are not nature.'}]}],
  how:'Glow follows the words. Tap a dotted word and Glow asks with pictures. Game add-on: a glow jar collects words.'},
 {id:'35',tab:'3–5',sub:'Word detective',title:'A Very Messy Tea Party',voice:1,reward:'Detective badges',stopTitle:'Case file',
  details:[['Grade','5'],['Version','StepRead 2 · 690L · 811 words'],['Type','Nonfiction'],['Author','W.M. Akers'],['Vocabulary','colonist, tax']],
  paras:["Lots of English people love tea. They have loved it ever since it was first brought to England from China. In the 1700s, they took their love of tea with them to their colonies in North America.",
   "At that time, there was an English company called the East India Company. This company brought tea from India to England. Getting it there cost a lot of money. *Taxes made this cost even higher.^ ~1A ~1tax ~1is ~1money ~1that ~1people ~1have ~1to ~1pay ~1the ~1government. The English government made a deal with the East India Company in the early 1700s.",
   "The ~2people ~2in ~2the ~2colonies of North America didn’t like paying so much for tea, though. They decided to buy other tea instead. They bought it from Dutch people who sneaked it into the colonies. This tea was just as good as English tea. It was also cheaper. So what if buying it was against the law? The *colonists didn't care.^ They still got a cup of tea and had money left over."],
  stops:[
   {word:'tax',type:'choice',badge:'def',q:'“Taxes made this cost even higher.” What do you think a tax is?',
    choices:[{t:'Money people have to pay the government',ok:true},{t:'A kind of tea leaf'},{t:'A ship that carries tea'}],
    right:'Case solved! The next sentence proves it.',rightPlain:'Good guess. The next sentence proves it.',wrong:'Hmm. A tax made the cost go up. Look again.',clue:'Definition clue',
    notes:[{p:1,k:'Definition clue',html:'The very next sentence tells you: <b>a tax is money that people have to pay the government</b>.'}]},
   {word:'colonist',type:'choice',badge:'back',q:'“The colonists didn’t care.” Who are the colonists?',
    choices:[{t:'People who live in the colonies',ok:true},{t:'Dutch people who sell tea'},{t:'Workers at the East India Company'}],
    right:'Case solved! Look back: “the people in the colonies” bought the cheaper tea.',rightPlain:'Yes. Look back: “the people in the colonies” bought the cheaper tea.',wrong:'Not quite. Who was buying the Dutch tea?',clue:'Look-back clue + word part',
    notes:[{p:2,k:'Look-back clue',html:'Earlier: <b>the people in the colonies</b>. colony + <b>-ist</b> = a person from a colony.'}]}],
  how:'Case files and a magnifying-glass cursor. Game add-on: a SOLVED stamp and badges named for each clue type.'},
 {id:'68',tab:'6–8',sub:'Word builder',title:'A Very Messy Tea Party',voice:1,reward:'Your moves',stopTitle:'Word Stop',
  details:[['Grade','5 (used here for the 6–8 interaction)'],['Version','StepRead 1 · 910L · 850 words'],['Type','Nonfiction'],['Author','W.M. Akers'],['Vocabulary','colonist, principle, tax']],
  paras:["With the Tea Act of 1773, Parliament let the East India Company sell tea to the *colonists for less money than before.^ As a result, the East India Tea Company was able to cut American traders out of the tea selling process completely. Suddenly, English tea was cheaper than illegal Dutch tea. This should have made the colonists happy, but it didn’t.",
   "That’s partly because the act hurt the American economy. And it’s also because the *tax was still in place, and colonists didn't want any of their money going toward something they thought was ~2unfair. It was a question of *principle, =2or of the colonists’ ~2moral ~2code.^ And a few colonists in Boston were very principled indeed."],
  stops:[
   {word:'colonist',type:'choice',move:'Word parts',parts:['colony','-ist','colonist'],q:'Break it apart: colon(y) + -ist. An -ist is a person who does or is something, like an artist or a scientist. So a colonist is…',
    choices:[{t:'a person who lives in a colony',ok:true},{t:'a company that ships tea'},{t:'a law passed by Parliament'}],
    right:'Built it. Word parts work even when the sentence gives no clue.',rightPlain:'Right. Word parts work even when the sentence gives no clue.',wrong:'Use the parts: colony + person.',clue:'Word-part clue (colony + -ist)',
    notes:[{p:0,k:'Word-part clue',html:'This sentence gives no clue, so use the parts: <b>colony + -ist</b>.'}]},
   {word:'principle',type:'tapclue',move:'Restatement',q:'Before you guess, tap the words in the passage that help explain “principle.”',q2:'Now, what does principle mean here?',
    choices:[{t:'A belief about what is right and wrong',ok:true},{t:'The leader of a school'},{t:'A tax on tea'}],
    right:'Right. Watch out for “principal” (a school leader). It sounds the same but is a different word.',wrong:'Not this one. Look at the words you tapped.',clue:'Restatement clue (signal word: or)',
    notes:[{p:1,k:'Restatement clue',html:'The word <b>or</b> signals the same idea in other words: <b>moral code</b>. Earlier, <b>unfair</b> backs it up.'}]}],
  cardOverride:{tax:'tax68'},
  how:'Clean and square. Word parts snap together, clue types are “moves.” Game add-on: first-try streaks, pick your color.'},
 {id:'912',tab:'9–12',sub:'Annotation',title:'Excerpt from Pride and Prejudice',voice:1,reward:'Word bank',stopTitle:'Comment',
  details:[['Grade','11–12'],['Words','1,157'],['Lexile','no Lexile'],['Type','Fiction'],['Author','Jane Austen'],['Vocabulary','alter, discernible, formality, regard, rejoice']],
  paras:["At length the Parsonage was *discernible. The ~1garden sloping to the road, the ~1house standing in it, the green pales, and the laurel ~1hedge, ~1everything ~1declared ~1they ~1were ~1arriving.^ Mr. Collins and Charlotte appeared at the door, and the carriage stopped at the small gate which led by a short gravel walk to the house, amidst the ~2nods ~2and ~2smiles of the whole party. In a moment they were all out of the chaise, *rejoicing at the sight of each other.^ Mrs. Collins welcomed her friend with the ~2liveliest ~2pleasure, and Elizabeth was more and more satisfied with coming when she found herself so affectionately received. She saw instantly that her cousin’s manners were not *altered by his marriage; his formal civility was ~3just ~3what ~3it ~3had ~3been, and he detained her some minutes at the gate to hear and satisfy his enquiries after all her family.^ They were then, with no other delay than his pointing out the neatness of the entrance, taken into the house; and as soon as they were in the parlour, he welcomed them a second time, with ostentatious *formality to his humble abode, and punctually repeated all his wife’s offers of refreshment."],
  forms:{rejoicing:'rejoice',altered:'alter'},
  stops:[
   {word:'discernible',type:'choice',q:'Then the narrator lists the garden, the house, the hedge. What does discernible mean?',
    choices:[{t:'Able to be seen or noticed',ok:true},{t:'Far away and hidden'},{t:'Old and falling apart'}],
    right:'Yes. The list of things they can now see is the clue.',wrong:'Look at what comes right after: what can they see now?',clue:'Example clue (what comes into view)',
    notes:[{p:0,k:'Example clue',html:'After the word, Austen lists what comes into view: <b>garden, house, hedge</b>. “Everything declared they were arriving.”'}]},
   {word:'rejoice',type:'write',q:'In your own words, what are they doing? What in the text makes you think so?',clue:'Inference clue (across sentences)',
    notes:[{p:0,k:'Inference clue',html:'No sentence defines it. Before: <b>nods and smiles</b>. After: <b>liveliest pleasure</b>. Put them together.'}]},
   {word:'alter',type:'choice',q:'His civility was “just what it had been.” What does altered mean?',
    choices:[{t:'Changed',ok:true},{t:'Improved a lot'},{t:'Noticed by others'}],
    right:'Right. The semicolon sets up a restatement: not changed = just what it had been.',wrong:'Read the words after the semicolon again.',clue:'Restatement clue (after the semicolon)',
    notes:[{p:0,k:'Restatement clue',html:'<b>Not altered</b> = <b>just what it had been</b>. Same idea, said twice.'}]}],
  how:'Quiet and adult. Stops arrive as margin comments; shades of meaning, word parts, dark reading. Add-on: an exportable word bank.'}
];
export const ACCENTS=[['#007693','#e3f2f6','Teal'],['#6b4bb0','#efe9fa','Purple'],['#c2410c','#fdeee4','Orange'],['#1d7442','#e6f3eb','Green']];

addSpanish(CARDS, MODES)
