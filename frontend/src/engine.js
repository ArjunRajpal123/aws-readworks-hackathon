import { I18N } from './i18n.js'
import { initAdmin } from './admin.js'
import { createQuestions } from './questions.js'
import { createDialogs } from './rate.js'
import { createTour } from './tour.js'
import { addPipelineMode, ensureSibling } from './pipeline_mode.js'
import { createInfo } from './info.js'
import { createFamily } from './family.js'
import { addWords } from './store.js'
import { byBand, byPid, byMode, modeFor, MODES, CARDS, hydrateContent, hydrateBandModes, loadMode, hasMode, titleOf } from './content.js'
import { art } from './art.js'
import { getProfile, setProfile, addSession, setSessionQuiz, upNext, bandOf, hydratePeople } from './people.js'
import { createNext } from './next.js'
import { createProfile } from './profile.js'
import { initNav } from './nav.js'
import { fetchProduct } from './api.js'
import { SPK, MUTE, GLOW, JAR, BADGE, ICON, ACCENTS } from './icons.js'

// Imperative player ported from WordStops_v8; drives the markup rendered by App.vue.
export function init() {
const $=s=>document.querySelector(s);
const B=()=>mode.band||mode.id;
const aid=()=>mode.audio||mode.id;
const pid=()=>mode&&mode.rwf?'rwf-'+mode.rwf:mode&&mode.rw?'rw-'+mode.rw:'';
let qs=null,dlg=null,fam=null,info=null,nxt=null,pfd=null,view='p',lastHeard=-1;const heard=new Set();
const enoughHeard=()=>heard.size>=0.6*tokens.length;
const explored=new Set(),tapped=new Set();
const STOPW=new Set('the and was were are for with that this they them then than from have has had not but you your his her she him its our out who what when where which will would could there their about into over just like some very been also more most only other such'.split(' '));
function trackTap(i){const tk=tokens[i];if(!tk||tk.key)return;const w=tk.text.replace(/[^\p{L}'’-]/gu,'').toLowerCase();if(w.length>=4&&!STOPW.has(w))tapped.add(w)}
function collectedWords(){const out=[],seen=new Set();[...explored].forEach(w=>{const k=w.toLowerCase();if(!seen.has(k)){seen.add(k);out.push(w)}});tapped.forEach(w=>{if(!seen.has(w)){seen.add(w);out.push(w)}});return out}
function finishData(){const words=collectedWords(),n=words.length,stopsTot=mode.stops?mode.stops.length:0,stopsDone=solved.size;
 const vocab=[...new Set(tokens.filter(t=>t.key&&card(t.key)).map(t=>card(t.key).word))];
 return{title:mode.title,words,stars:[true,n>=3,n>=6||(stopsTot>0&&stopsDone>=stopsTot)],need2:Math.max(1,3-n),stops:[stopsDone,stopsTot],next:vocab.filter(w=>!explored.has(w))}}
const curEntry=()=>mode?byMode(mode.id):null;
let spentMs=0,lastTouch=Date.now();
setInterval(()=>{if(!document.hidden&&(playing||Date.now()-lastTouch<45000))spentMs+=1000},1000);
['pointerdown','keydown','scroll'].forEach(ev=>addEventListener(ev,()=>{lastTouch=Date.now()},{passive:true,capture:true}));
addEventListener('sa-quiz',e=>{const{done,mc,ok}=e.detail;if(mc&&done>=mc){const p=getProfile(),en=curEntry();if(en)setSessionQuiz(p.role==='student'?p.id:'guest',en.pid,Math.round(100*ok/mc))}});
let finAt=0;
function maybeDone(){if(!dlg||!mode)return;if(Date.now()-finAt<4000)return;finAt=Date.now();const d=finishData();clearPos();
 const prof=getProfile(),en=curEntry(),minutes=Math.max(0.1,Math.round(spentMs/6000)/10);
 const asg=prof.role==='student'&&en&&upNext(prof.id).some(x=>x.pid===en.pid);
 addSession({student:prof.role==='student'?prof.id:'guest',pid:en?en.pid:mode.id,at:new Date().toISOString(),minutes,words:[...explored],extra:[...tapped],q:null,stars:d.stars.filter(Boolean).length,source:asg?'assigned':'independent'});
 addWords(d.words,mode.title);dlg.openDone(d)}
// Resume: remember where the student stopped in each passage.
const posKey=()=>'ws-pos-'+mode.id;let posT=0;
function savePos(i,force){if(!mode||i==null||i<0||!tokens.length)return;const n=Date.now();if(!force&&n-posT<1500)return;posT=n;try{localStorage.setItem(posKey(),JSON.stringify({i,n:tokens.length}))}catch(e){}}
function hideResume(){const b=document.getElementById('resumeBar');if(b)b.hidden=true}
function clearPos(){try{localStorage.removeItem(posKey())}catch(e){}hideResume()}
function savedPos(){try{const p=JSON.parse(localStorage.getItem(posKey())||'null');return p&&p.n===tokens.length&&p.i>=4&&p.i<tokens.length-4?p:null}catch(e){return null}}
function showResume(){const p=savedPos(),b=document.getElementById('resumeBar');if(!b)return;if(!p){b.hidden=true;return}
 document.getElementById('resumeMsg').textContent=t('resumeMsg',Math.round(100*p.i/tokens.length));document.getElementById('resumeGo').textContent=t('resumeBtn');document.getElementById('resumeNo').textContent=t('resumeNo');b.dataset.i=p.i;b.hidden=false}
// Voices students can choose (Amazon Polly neural). A passage's soundAlong record lists one track per voice; if the chosen voice has no track yet, the default track plays and the page says so.
const VOICES={'en-US':[['Danielle','F'],['Stephen','M']],'es-US':[['Lupe','F'],['Pedro','M']]};
// The audio id's -en/-es suffix names its language; otherwise the mode's own language.
const voiceLang=()=>{if(!mode)return 'en-US';const m=/-(en|es)$/.exec(aid());return (m?m[1]==='es':mode.lang==='es-US')?'es-US':'en-US'};
function curVoice(){const L=voiceLang();let v=null;try{v=localStorage.getItem('ws-voice-'+L)}catch(e){}return VOICES[L].some(x=>x[0]===v)?v:VOICES[L][0][0]}
function fillVoice(){const sel=$('#voice');if(!sel)return;const L=voiceLang();sel.innerHTML=VOICES[L].map(([n,g])=>`<option value="${n}">${n} (${t(g==='F'?'voiceF':'voiceM')})</option>`).join('');sel.value=curVoice()}
function updateViewTabs(){const has=!!(mode&&mode.questions);$('#viewTabs').hidden=!has;if(has)$('#vtQn').textContent='('+mode.questions.length+')'}
function setView(v){if(v==='q'&&!(mode&&mode.questions))v='p';view=v;document.body.classList.toggle('view-q',v==='q');$('#vtP').setAttribute('aria-selected',v==='p');$('#vtQ').setAttribute('aria-selected',v==='q');if(v==='q'){stopAll();setSide(false);window.scrollTo(0,0)}}
const isNarrow=()=>matchMedia('(max-width: 880px)').matches;
const t=(k,...a)=>{const v=I18N[uiLang]&&I18N[uiLang][k]!==undefined?I18N[uiLang][k]:I18N.en[k];return typeof v==='function'?v(...a):v};
let uiLang='en';let gameOn=false;try{gameOn=localStorage.getItem('ws-game')==='1'}catch(e){}
const synth='speechSynthesis' in window?window.speechSynthesis:null;
let mode,tokens=[],els=[],cur=-1,stopIdxs=[],solved=new Set(),playing=false,run=0,timer=null,picking=null,picked=new Set(),stopsOn=true,voiceOn=true,resumeAt=0;
let R={};
function freshReward(){R={jar:[],badges:new Set(),moves:{},streak:0,firstTry:true,bank:[]}}
// Resolve a card by key from the passage's own cards (pipeline/user passages
// carry mode.cards) first, then the shared built-in CARDS.
const card=k=>(mode&&mode.cards&&mode.cards[k])||CARDS[k];
function keyFor(t){const w=t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');if(mode.forms&&mode.forms[w])return mode.forms[w];
 if(mode&&mode.cards&&mode.cards[w])return w;  // pipeline passages: normalized word IS the key
 const k=Object.keys(CARDS).find(k=>!/\d/.test(k)&&w.startsWith(k));return (mode.cardOverride&&mode.cardOverride[k])||k}
function parse(m){tokens=[];m.paras.forEach((p,pi)=>p.split(/\s+/).forEach(raw=>{let t=raw,cls=[],grp=null,stop=false;
  if(t.endsWith('^')){stop=true;t=t.slice(0,-1)}
  let mm;while((mm=t.match(/^([~\-=])(\d)/))||(t[0]==='*'&&t.length>1)){if(mm){cls.push(mm[1]==='~'?'clue':mm[1]==='-'?'contrast':'signal');grp=+mm[2];t=t.slice(2)}else{cls.push('vocab');t=t.slice(1)}}
  tokens.push({text:t,cls,grp,p:pi,stop,key:null})}));
 tokens.forEach(tk=>{if(tk.cls.includes('vocab'))tk.key=keyFor(tk.text)});
 stopIdxs=tokens.map((t,i)=>t.stop?i:-1).filter(i=>i>=0)}
function stopWordIdx(k){const w=CARDS[mode.stops[k].word].word;let best=-1;tokens.forEach((t,i)=>{if(t.key&&CARDS[t.key].word===w&&i<=stopIdxs[k])best=i});return best}
function render(){const page=$('#page');page.innerHTML='<div id="glow">'+GLOW+'</div>';els=[];
 mode.paras.forEach((_,pi)=>{const wrap=document.createElement('div');wrap.style.display='grid';wrap.style.gap='10px';const p=document.createElement('p');
  tokens.forEach((tk,i)=>{if(tk.p!==pi)return;const s=document.createElement('span');s.className='w '+tk.cls.join(' ');s.textContent=tk.text;s.dataset.i=i;
   if(tk.key&&card(tk.key)){s.setAttribute('role','button');s.tabIndex=0;s.setAttribute('aria-label',t('openCard')+card(tk.key).word)}else if(tk.key){tk.key=null;s.className='w '+tk.cls.filter(c=>c!=='vocab').join(' ')}els[i]=s;p.appendChild(s);p.appendChild(document.createTextNode(' '))});
  const n=document.createElement('div');n.id='notes'+pi;n.style.display='grid';n.style.gap='8px';wrap.append(p,n);page.appendChild(wrap)});
 if(stopsOn)mode.stops.forEach((_,k)=>{const i=stopWordIdx(k);if(els[i])els[i].classList.add('stopw')});
 $('#ptitle').textContent=mode.title;page.classList.remove('tapping','stopping');
 const vc=new Set(tokens.filter(t=>t.key&&card(t.key)).map(t=>card(t.key).word)).size;
 $('#details').innerHTML=mode.details.map(([k,v])=>`<div>${k}: ${v}</div>`).join('')+`<div style="margin-top:8px">${mode.stops.length||vc?t('detailsDemo',mode.stops.length,vc):t('detailsNone')}</div>`;
 progress();requestAnimationFrame(()=>moveGlow(-1))}
function moveGlow(i){if(B()!=='k2')return;const g=$('#glow');if(!g)return;const page=$('#page');
 let el=i>=0?els[i]:null;if(!el){g.style.left='calc(100% - 46px)';g.style.top='-48px';return}
 const pr=page.getBoundingClientRect(),r=el.getBoundingClientRect();
 g.style.left=Math.max(0,Math.min(pr.width-46,r.left-pr.left+r.width/2-23))+'px';g.style.top=(r.top-pr.top-40)+'px'}
function glowMood(c){if(!gameOn)return;const g=$('#glow');if(!g)return;g.classList.remove('happy','oops');void g.offsetWidth;g.classList.add(c)}
function progress(){const n=tokens.length,at=cur<0?resumeAt:cur+1;{const a=audioReady&&audioReady();if(a&&!playing)scrubTo(a.start[Math.min(Math.max(cur<0?resumeAt:cur,0),n-1)])}$('#time').textContent=`${Math.min(at,n)} / ${n} ${t('words')}`;$('#prog').style.width=(100*Math.min(at,n)/n)+'%'}
function setActive(i){if(cur>=0&&els[cur])els[cur].classList.remove('on');cur=i;if(i>=0&&els[i])els[i].classList.add('on');if(playing&&i>=0)savePos(i);if(i>=0){if(lastHeard>=0&&i>lastHeard&&i-lastHeard<40){for(let j=lastHeard;j<=i;j++)heard.add(j)}else heard.add(i);lastHeard=i}progress();if(sentS.length){if(i>=0){const k=sentOf(i);if(k!==ribK){ribK=k;seenS[k]=true;paintRibbon()}}else if(ribK!==-1){ribK=-1;paintRibbon()}}if(i>=0)moveGlow(i);if(typeof A!=='undefined'){markSentence(i);placeStrip(i);followWord(i)}}
const clean=t=>t.replace(/[“”]/g,'');
function stopAll(){run++;qs&&qs.stop();clearInterval(timer);timer=null;if(synth)synth.cancel();Object.values(SA).forEach(a=>a&&a.audio.pause());playing=false;updatePlay()}
function setOpts(open){document.body.classList.toggle('opts-closed',!open);const b=document.getElementById('optBtn');if(b)b.setAttribute('aria-expanded',open)}
function updatePlay(){if(playing){hideResume()}$('#play').textContent=playing?'❚❚':'▶';$('#play').setAttribute('aria-label',playing?t('pause'):t('play'));if('mediaSession' in navigator)navigator.mediaSession.playbackState=playing?'playing':'paused'}
const rateNow=()=>parseFloat($('#speed').value)*(mode.voice||1);
// Polly audio: files produced by the pipeline (product JSON, gzipped timing, MP3), fetched via GET /api/v1/text-to-speech (see src/api.js).
const SA={};
if(import.meta.env.DEV){window.__SA=SA;window.__done=()=>{finAt=0;maybeDone()}} // dev only: lets tests read the audio state
const lastAtOrBefore=(arr,t)=>{let lo=0,hi=arr.length-1,a=-1;while(lo<=hi){const m=(lo+hi)>>1;if(arr[m]<=t){a=m;lo=m+1}else hi=m-1}return a};
async function loadAudio(mid){if(SA[mid]!==undefined)return;SA[mid]=null;
 try{
  const want=curVoice(),okT=x=>x.qa&&x.qa.status!=='failed';
  const prod=await fetchProduct(mid,want,voiceLang());if(!prod)return;
  // The API picks the track for the chosen voice (selectedTrack); local sa/ records are picked here the same way.
  const tr=prod.selectedTrack?prod.tracks.find(x=>x.id===prod.selectedTrack):prod.tracks.find(x=>x.voiceId===want&&okT(x))||prod.tracks.find(x=>x.default&&okT(x))||prod.tracks.find(okT);if(!tr)return;
  const gz=await fetch(prod.urls[tr.id].timing);
  // S3 sends Content-Encoding: gzip, so the browser usually inflates it already; fall back to doing it here if not.
  const raw=await gz.arrayBuffer();let tm;
  try{tm=JSON.parse(new TextDecoder().decode(raw))}catch{tm=await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).json()}
  if(tm.textHash!==prod.textHash)return;
  const audio=new Audio(prod.urls[tr.id].audio);audio.preload='auto';
  SA[mid]={audio,start:tm.start,end:tm.end,n:tm.n,dur:tm.durationMs,voice:tr.voiceId,want,sentOnly:tr.granularity!=='word',sent:prod.structure.sentenceStarts};
  if(mode&&aid()===mid){showSource();computeChunks()}}catch(e){SA[mid]=null}}
function showSource(){}
// ---------- Support steps (the scaffold dial) and the reading ribbon ----------
// listen: whole passage, word by word. follow: whole passage, phrase by phrase. echo: one sentence, then the student reads it.
// yours: no automatic audio; tap a word to hear just that word. The ribbon has one segment per sentence.
let support='listen';try{const v=localStorage.getItem('ws-support');if(['listen','follow','echo','yours'].includes(v))support=v}catch(e){}
let sentS=[],phraseS=[],seenS=[],repS=[],ribK=-1,echoK=-1;
const ABBR=/^(mr|mrs|ms|dr|st|jr|sr|sra|srta|prof|vs|etc|ee|uu|p\.m|a\.m)\.$/i;
const endsSent=w=>/[.!?]["”’)\]»]*$/.test(w)&&!ABBR.test(w.replace(/["“”‘’(¿¡«]/g,''))&&!/^[A-Z]\.$/.test(w);
const endsPhrase=w=>/[,;:—–]["”’)]*$/.test(w)||endsSent(w);
function computeChunks(){
 const a=SA[aid()];
 const useProd=!!(a&&a.n===tokens.length&&a.sent&&a.sent.length); // Polly's own sentence marks handle "Mr." and "EE. UU."
 sentS=useProd?a.sent.slice():[];phraseS=[];
 let pLen=0;
 tokens.forEach((tk,i)=>{
  const para=i===0||tokens[i-1].p!==tk.p,prev=i?tokens[i-1].text:'';
  if(para||endsPhrase(prev)||pLen>=9){phraseS.push(i);pLen=0}
  if(!useProd&&(para||endsSent(prev)))sentS.push(i);
  pLen++});
 seenS=sentS.map(()=>false);repS=sentS.map(()=>0);ribK=-1;
 buildRibbon()}
const sentOf=i=>Math.max(0,lastAtOrBefore(sentS,i));
const sentEnd=k=>(sentS[k+1]??tokens.length)-1;
const fmt=ms=>{ms=Math.max(0,Math.round(ms/1000));return Math.floor(ms/60)+':'+String(ms%60).padStart(2,'0')};
let loopSent=false,loopK=-1;
function audioReady(){const a=SA[aid()];return a&&a.n===tokens.length&&a.dur?a:null}
// sentence marks on the scrubber, like chapter marks in a podcast player
function buildRibbon(){const a=audioReady(),tk=$('#ticks'),sk=$('#seek');if(!tk)return;
 tk.innerHTML=a?sentS.slice(1).map(s=>`<i style="left:${(100*a.start[s]/a.dur).toFixed(2)}%"></i>`).join(''):'';
 sk.disabled=!a;sk.value=0;sk.style.setProperty('--p','0%');$('#tCur').textContent='0:00';$('#tLeft').textContent=a?'-'+fmt(a.dur):'-0:00'}
function paintRibbon(){}
function noteReplay(){}
function scrubTo(ms){const a=audioReady();if(!a)return;const p=Math.min(1000,Math.round(1000*ms/a.dur));
 const sk=$('#seek');sk.value=p;sk.style.setProperty('--p',(p/10)+'%');$('#tCur').textContent=fmt(ms);$('#tLeft').textContent='-'+fmt(Math.max(0,a.dur-ms))}
function seekToMs(ms){const a=audioReady();if(!a)return;const i=Math.max(0,lastAtOrBefore(a.start,ms));
 if(playing)playFrom(i);else{resumeAt=i;clearEcho();if(cur>=0&&els[cur]){els[cur].classList.remove('on');cur=-1}scrubTo(a.start[i])}}
function prevSent(){const at=cur>=0?cur:resumeAt,k=sentOf(at);playFrom(sentS[(at-sentS[k]>2||k===0)?k:k-1])}
function nextSent(){const at=cur>=0?cur:resumeAt,k=sentOf(at);if(k<sentS.length-1)playFrom(sentS[k+1])}
function mediaInfo(){if(!('mediaSession' in navigator)||typeof MediaMetadata==='undefined')return;
 navigator.mediaSession.metadata=new MediaMetadata({title:mode.title,artist:'ReadWorks',album:'Sound Along'})}
function setupMedia(){if(!('mediaSession' in navigator))return;const set=(n,f)=>{try{navigator.mediaSession.setActionHandler(n,f)}catch(err){}};
 set('play',()=>playFrom(cur>=0?cur:resumeAt));set('pause',()=>stopAll());set('seekbackward',()=>skip(-5));set('seekforward',()=>skip(5));
 set('previoustrack',prevSent);set('nexttrack',nextSent);set('seekto',d=>seekToMs(d.seekTime*1000))}
function clearEcho(){echoK=-1;const b=$('#echoBar');if(b)b.hidden=true;els.forEach(e=>e&&e.classList.remove('echo'))}
function showEcho(k,kind){echoK=k;els.forEach(e=>e&&e.classList.remove('echo'));
 for(let j=sentS[k];j<=sentEnd(k)&&j<tokens.length;j++)els[j]&&els[j].classList.add('echo');
 const last=k>=sentS.length-1,echo=kind==='echo';
 $('#echoBar').hidden=false;$('#echoMsg').textContent=t(echo?(last?'echoEnd':'echoPrompt'):'yoursPrompt');
 $('#echoAgain').hidden=!echo;$('#echoNext').hidden=!echo||last;$('#echoSent').hidden=echo;
 if(echo){resumeAt=last?0:sentS[k+1];($('#echoNext').hidden?$('#echoAgain'):$('#echoNext')).focus({preventScroll:true})}}
function hearSentence(k){clearEcho();noteReplay(sentS[k]);readRange(sentS[k],sentEnd(k),()=>{})}
function hearWord(i){if(picking!==null)return;clearEcho();noteReplay(i);readRange(i,i,()=>{progress();showEcho(sentOf(i),'yours')})}
function tapPlay(i){if(support==='yours')hearWord(i);else playFrom(i)}
function fillSupport(){const sel=$('#support');if(!sel)return;
 [['listen','supL'],['follow','supF'],['echo','supE'],['yours','supY']].forEach(([v,k])=>{const o=sel.querySelector(`option[value="${v}"]`);if(o)o.textContent=t(k)});
 sel.value=support;$('#supNote').textContent=t({listen:'supNoteL',follow:'supNoteF',echo:'supNoteE',yours:'supNoteY'}[support])}
function readAudio(from,to,onDone,id){const a=SA[aid()],au=a.audio;let done=false,sk=-1;
 const finish=(ok=true)=>{if(done)return;done=true;au.pause();playing=false;updatePlay();els.forEach(e=>e&&e.classList.remove('on'));setActive(-1);onDone&&onDone(ok)};
 const frame=()=>{if(id!==run||done)return;if(au.ended){finish();return}
  const ms=au.currentTime*1000;let i=Math.max(from,lastAtOrBefore(a.start,ms));scrubTo(ms);
  if(loopSent&&loopK>=0&&(support==='listen'||support==='follow')&&i>sentEnd(loopK)){au.currentTime=a.start[sentS[loopK]]/1000;requestAnimationFrame(frame);return}
  if(to<tokens.length-1&&(i>to||ms>=a.start[to]+Math.min(a.end[to]-a.start[to],900))){finish();return}
  const cs=a.sentOnly?a.sent:(support==='follow'?phraseS:null);
  if(cs){const k=Math.max(0,lastAtOrBefore(cs,i));if(k!==sk){sk=k;els.forEach(e=>e&&e.classList.remove('on'));setActive(cs[k]);const end=cs[k+1]??tokens.length;for(let j=cs[k];j<end;j++)els[j]&&els[j].classList.add('on')}requestAnimationFrame(frame);return}
  if(i>to){finish();return}if(i!==cur)setActive(i);requestAnimationFrame(frame)};
 const target=a.start[from]/1000,seek=()=>{au.currentTime=target};
 // iOS ignores a seek before metadata has loaded, so wait for it when needed; play() must still start inside the tap.
 if(au.readyState>=1)seek();else au.addEventListener('loadedmetadata',seek,{once:true});
 au.playbackRate=parseFloat($('#speed').value);au.muted=!voiceOn;setActive(from);mediaInfo();
 // 'ended' is the safety net: it still fires if the page is in the background and animation frames are paused
 au.addEventListener('ended',()=>{if(id===run&&!done)finish()},{once:true});
 au.play().then(()=>requestAnimationFrame(frame)).catch(()=>{if(id===run)finish(false)})}
function readRange(from,to,onDone){stopAll();const id=run;playing=true;updatePlay();
 if(SA[aid()]&&SA[aid()].n===tokens.length)return readAudio(from,to,onDone,id);
 const rate=rateNow(),ms=60000/(165*rate);let i=from;setActive(i);
 let useVoice=voiceOn&&synth,done=false,got=false,curB=to,watch=null,chunkStart=0,chunkExp=0;
 const finish=()=>{if(id!==run||done)return;done=true;clearInterval(timer);clearInterval(watch);timer=null;playing=false;updatePlay();setActive(-1);onDone&&onDone()};
 const tick=()=>{if(id!==run||done){clearInterval(timer);return}
  if(useVoice){if(i<curB){i++;setActive(i)}return}
  i++;if(i>to){finish();return}setActive(i)};
 const startTimer=()=>{clearInterval(timer);timer=setInterval(tick,ms)};
 if(!useVoice){startTimer();return}
 const chunks=[];let st=from;for(let k=from;k<=to;k++){if(/[.!?;:]["”’)]*$/.test(tokens[k].text)||k===to){chunks.push([st,k]);st=k+1}}
 const fallback=()=>{if(id!==run||done||!useVoice)return;useVoice=false;clearInterval(watch);synth.cancel();startTimer()};
 const speakChunk=c=>{if(id!==run||done||!useVoice)return;if(c>=chunks.length){finish();return}
  const [a,b]=chunks[c];curB=b;let text='',offs=[];for(let k=a;k<=b;k++){offs.push(text.length);text+=clean(tokens[k].text)+' '}
  chunkStart=Date.now();chunkExp=(b-a+1)*ms*1.8+4000;
  if(!got){i=a;setActive(a)}
  const u=new SpeechSynthesisUtterance(text);u.rate=rate;u.lang=mode.lang||'en-US';
  u.onboundary=e=>{if(id!==run||!useVoice)return;if(e.name&&e.name!=='word')return;if(!got){got=true;clearInterval(timer);timer=null}let k=0;while(k+1<offs.length&&offs[k+1]<=e.charIndex)k++;i=a+k;setActive(i)};
  u.onend=()=>{if(id!==run||!useVoice)return;speakChunk(c+1)};
  u.onerror=e=>{if(id!==run||!useVoice)return;if(e&&(e.error==='interrupted'||e.error==='canceled'))return;fallback()};
  synth.speak(u)};
 watch=setInterval(()=>{if(id!==run||done){clearInterval(watch);return}if(useVoice&&Date.now()-chunkStart>chunkExp)fallback()},500);
 speakChunk(0);
 setTimeout(()=>{if(id===run&&!done&&!got&&useVoice)startTimer()},900)}
function say(t){if(!voiceOn||!synth)return;synth.cancel();const u=new SpeechSynthesisUtterance(t);u.rate=rateNow();u.lang=mode.lang||'en-US';synth.speak(u)}
function nextStopFrom(i){if(!stopsOn)return -1;for(let k=0;k<stopIdxs.length;k++)if(!solved.has(k)&&stopIdxs[k]>=i)return k;return -1}
function playFrom(i){if(picking!==null)return;resumeAt=i;clearEcho();if(loopSent)loopK=sentOf(i);
 if(support==='echo'){const k=sentOf(i);readRange(i,sentEnd(k),ok=>{if(ok!==false&&k>=sentS.length-1)maybeDone();else showEcho(k,'echo')});return}
 readRange(i,tokens.length-1,ok=>{resumeAt=0;progress();moveGlow(-1);if(ok!==false)maybeDone()})}
function stopForToken(i){if(!stopsOn)return -1;for(let k=0;k<mode.stops.length;k++)if(stopWordIdx(k)===i)return k;return -1}
function pauseHere(){const at=cur>=0?cur:resumeAt;const was=playing;if(was)savePos(at,true);stopAll();if(cur>=0){els[cur].classList.remove('on');cur=-1}resumeAt=at;progress();return was}
function stepper(k){return `<div class="stepper">${t('stepper',k+1,mode.stops.length)} ${mode.stops.map((_,j)=>`<i class="${solved.has(j)?'ok':j===k?'cur':''}"></i>`).join('')}</div>`}
function stopHeader(k){const s=mode.stops[k],w=CARDS[s.word].word;
 if(B()==='k2')return `<div class="shead">${stepper(k)}</div>`;
 if(B()==='35')return `<div class="shead" style="font-family:'Special Elite',monospace">${stepper(k)}</div>`;
 if(B()==='68')return `<div class="shead"><span class="tag68">${t('move')}: ${s.move}</span>${stepper(k)}</div>`;
 const wi=stopWordIdx(k),sent=sentenceAround(wi);
 return `<div class="cmt"><span class="av">WS</span><span><span class="who">${t('wsName')}</span> <span class="when">${t('on')} “${w}”</span></span></div><p class="quote">${sent}</p>${stepper(k)}`}
function sentenceAround(i){let a=i,b=i;while(a>0&&!/[.!?;]["”’]?$/.test(tokens[a-1].text))a--;while(b<tokens.length-1&&!/[.!?;]["”’]?$/.test(tokens[b].text))b++;
 return tokens.slice(a,b+1).map(t=>t.text).join(' ').replace(/^(.{0,140}).*$/,(m,x)=>m.length>140?x+'…':m)}
function reveal(k){solved.add(k);const s=mode.stops[k];
 tokens.forEach((t,i)=>{if(t.grp===k+1)els[i].classList.add('lit')});const wi=stopWordIdx(k);if(els[wi]){els[wi].classList.add('solved');els[wi].classList.remove('active-anchor')}
 s.notes.forEach(n=>{const d=document.createElement('div');d.className='callout'+(n.cx?' cx':'');d.innerHTML=`<span class="k">${n.k}</span><p>${n.html}</p>`;$('#notes'+n.p).appendChild(d)});
 showCard(s.word,s.clue);const st=$('#stopBox .stepper');if(st)st.outerHTML=stepper(k);
 const box=$('#stopBox');
 if(B()==='k2')collect(CARDS[s.word].word);
 if(B()==='35'&&gameOn){const st=document.createElement('span');st.className='stamp';st.textContent=t('solved');box.appendChild(st);R.badges.add(s.badge);renderReward();const bn=(t('badges').find(x=>x[0]===s.badge)||[])[1];if(bn)toast(t('badgeEarned',bn))}
 if(B()==='68'){if(gameOn){const mk=mvKey(s.move);R.moves[mk]=(R.moves[mk]||0)+1;if(R.firstTry)R.streak++;else R.streak=0;}
  if(s.parts){const b=document.createElement('div');b.className='blocks snap';b.innerHTML=`<span class="blk">${s.parts[0]}</span><span class="eq">+</span><span class="blk suf">${s.parts[1]}</span><span class="eq">=</span><span class="blk res">${s.parts[2]}</span>`;box.appendChild(b)}
  renderReward()}
 if(B()==='912'){const c=CARDS[s.word];const r=document.createElement('div');r.className='resolved';if(gameOn){R.bank.push({w:c.word,ct:s.clue});r.textContent=t('resolvedBank');renderReward()}else r.textContent=t('resolved');box.appendChild(r)}
 const go=document.createElement('button');go.className='tbtn';go.type='button';
 go.textContent=resumeAt>0?t('resume'):t('fromStart');
 go.onclick=()=>playFrom(resumeAt);box.appendChild(go)}
function choiceButtons(s,list,pics,onRight){const box=document.createElement('div');box.className='choices'+(pics?' pics':'');const fb=document.createElement('p');fb.className='fb';fb.setAttribute('role','status');let done=false;
 list.forEach(c=>{const b=document.createElement('button');b.type='button';b.className='choice'+(pics?' pic':'');b.innerHTML=(pics?ICON[c.icon]:'')+'<span>'+c.t+'</span>';
  b.onclick=()=>{if(done)return;if(c.ok){done=true;b.classList.add('right');fb.className='fb ok';const rt=gameOn?s.right:(s.rightPlain||s.right);fb.textContent=rt;say(rt);onRight()}else{R.firstTry=false;b.classList.add('wrong');fb.className='fb no';fb.textContent=s.wrong;say(s.wrong);if(B()==='k2')glowMood('oops')}};box.appendChild(b)});return[box,fb]}
function openStop(k){if(isNarrow())setSide(true);const s=mode.stops[k],box=$('#stopBox');R.firstTry=true;box.className='stopbox';box.dataset.tab=t('caseFile',k+1)+' · '+CARDS[s.word].word.toUpperCase();box.innerHTML=stopHeader(k);
 $('#page').classList.add('stopping');const wi=stopWordIdx(k);if(B()==='912'&&els[wi])els[wi].classList.add('active-anchor');if(B()==='k2')moveGlow(wi);
 const q=document.createElement(B()==='k2'?'div':'p');
 if(B()==='k2'){q.className='bubble';q.innerHTML='<b>Glow:</b> '+s.q}else{q.className='q';q.textContent=s.q}box.appendChild(q);
 if(A.readq&&s.type!=='pictures')say(s.q+(s.choices?'. '+s.choices.map(c=>c.t).join('. '):''));
 if(s.type==='pictures'){const[c,f]=choiceButtons(s,s.choices,true,()=>reveal(k));box.append(c,f);say(s.say)}
 else if(s.type==='choice'){const[c,f]=choiceButtons(s,s.choices,false,()=>reveal(k));box.append(c,f)}
 else if(s.type==='tapclue'){picking=k;picked.clear();$('#page').classList.add('tapping');
  const hint=document.createElement('p');hint.className='hint';hint.textContent=t('tapHint');
  const err=document.createElement('p');err.className='err';err.setAttribute('role','status');
  const done=document.createElement('button');done.className='tbtn';done.type='button';done.textContent=t('checkClue');
  done.onclick=()=>{const hits=[...picked].filter(i=>tokens[i].grp===k+1&&tokens[i].cls.includes('clue'));
   if(!picked.size){err.textContent=t('tapOne');return}
   if(!hits.length){R.firstTry=false;err.textContent=t('tapErr');return}
   picking=null;$('#page').classList.remove('tapping');picked.forEach(i=>els[i].classList.remove('picked'));err.textContent='';hint.remove();done.remove();
   const ok=document.createElement('p');ok.className='fb ok';ok.textContent=t('niceFind',hits.sort((a,b)=>a-b).map(i=>clean(tokens[i].text).replace(/[.,]/g,'')).join(' '));
   const q2=document.createElement('p');q2.className='q';q2.textContent=s.q2;const[c,f]=choiceButtons(s,s.choices,false,()=>reveal(k));box.append(ok,q2,c,f)};
  box.append(hint,done,err)}
 else if(s.type==='write'){const ta=document.createElement('textarea');ta.id='guess'+k;ta.setAttribute('aria-label',t('yourReply'));ta.placeholder=t('replyPh');
  const err=document.createElement('p');err.className='err';err.setAttribute('role','status');
  const b=document.createElement('button');b.className='tbtn';b.type='button';b.textContent=t('replyBtn');ta.oninput=()=>{err.textContent=''};
  b.onclick=()=>{if(ta.value.trim().split(/\s+/).length<3){err.textContent=t('replyErr');return}ta.readOnly=true;b.remove();
   const you=document.createElement('div');you.className='cmt';you.innerHTML=`<span class="av you">${t('you')}</span><span class="who">${t('yourReply')}</span>`;box.insertBefore(you,ta);
   const m=document.createElement('p');m.className='hint';m.textContent=t('compareHint');box.append(m);reveal(k)};
  box.append(ta,err,b)}}
function showCard(key,clue){if(isNarrow())setSide(true);const c=card(key);if(!c)return;explored.add(c.word);const adv=B()==='912'||B()==='68';
 $('#cardBody').innerHTML=`<div class="card">
 <div class="word">${c.word}<span class="pos">${c.pos}</span></div>
 <div><button class="chipbtn" type="button" id="hear">${t('hear')}</button></div>
 <p>${c.def}</p>${c.ex?`<p class="ex">“${c.ex}”</p>`:''}${clue?`<p class="ct">${clue}</p>`:''}
 ${c.syn.length?`<div class="row"><span class="lab">${t('synonyms')}</span>${c.syn.map(s=>`<span class="chip">${s}</span>`).join('')}</div>`:''}
 ${B()==='912'&&c.shades?`<div class="shades"><span class="lab" style="font-weight:700">${t('shades')}</span><div class="scale">${c.shades.words.map((w,i)=>`<span class="${i===c.shades.me?'me':''}">${w}</span>`).join('')}</div><div class="ends"><span>${c.shades.ends[0]}</span><span>${c.shades.ends[1]}</span></div></div>`:''}
 ${adv&&c.parts?`<div class="row"><span class="lab">${t('wordParts')}</span><span>${c.parts}</span></div>`:''}
 ${c.pair?`<div class="row"><span class="lab">${t('english')}</span><span class="chip">${c.pair}</span>${c.cog?`<span class="chip cog">${t('cogPair')}</span>`:''}</div><p class="hint" style="font-size:13px">${c.tr?t('trHint'):t('pairHint')}</p>`:''}
 ${c.es.length?`<div class="row"><span class="lab">${t('spanish')}</span>${c.es.map(s=>`<span class="chip">${s}</span>`).join('')}${c.cog?`<span class="chip cog">${t('cogEs')}</span>`:''}</div>`:''}
 ${c.look?`<div class="row"><span class="lab">${t('watch')}</span><span>${c.look}</span></div>`:''}</div>`;$('#hear').onclick=()=>say(c.word)}
function collect(w){if(!gameOn)return;if(!R.jar.includes(w)){R.jar.push(w);R.justAdded=w}glowMood('happy');renderReward()}
function toast(msg){let el=document.getElementById('toast');if(!el){el=document.createElement('div');el.id='toast';el.setAttribute('role','status');document.body.appendChild(el)}
 el.textContent=msg;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),3200)}
const MOVES_EN=['Word parts','Restatement','Definition','Contrast'];
function mvKey(m){const i=MOVES_EN.indexOf(m);return i>=0?(t('moves')[i]||m):m}
function renderReward(){const r=$('#reward');$('#rewardWrap').hidden=!gameOn;if(!gameOn){r.innerHTML='';return}$('#rewardTitle').textContent=mode.reward;
 if(B()==='k2'){r.innerHTML=`<div class="jar">${JAR(R.jar.length)}<div class="jarwords">${R.jar.length?R.jar.map(w=>`<button class="jarword${w===R.justAdded?' new':''}" type="button" data-w="${w}">${w}</button>`).join(''):'<span class="hint">'+t('jarHint')+'</span>'}</div></div>`;
  r.querySelectorAll('.jarword').forEach(b=>b.onclick=()=>say(b.dataset.w))}
 if(B()==='35'){const avail=new Set((mode.stops||[]).map(s=>s.badge)),all=t('badges').filter(([k])=>avail.has(k)||R.badges.has(k));
  r.innerHTML=all.length?`<div class="badges">${all.map(([k,n])=>`<div class="badge ${R.badges.has(k)?'got':''}">${BADGE[k]('#8a6d1f')}<span>${n}</span></div>`).join('')}</div><p class="hint" style="margin-top:8px">${t('badgeNote2')}</p>`
   :`<p class="hint">${t('badgeNone')}</p><button type="button" class="chipbtn" id="badgeTry">${t('badgeTry')}</button>`;
  const bt=$('#badgeTry');if(bt)bt.onclick=()=>load('35')}
 if(B()==='68'){const mv=t('moves');$('#rewardTitle').textContent=t('mvTitle');
  r.innerHTML=`<p class="hint">${t('mvIntro')}</p><div class="streak">${t('mvStreak')} <b>${R.streak}</b></div><h3 class="mvh">${t('mvUsed')}</h3><div class="moves">${mv.map(m=>`<div class="mv"><span>${m}</span><b>× ${R.moves[m]||0}</b></div>`).join('')}</div>
  <div class="swatches" style="margin-top:12px">${t('mvColor')} ${ACCENTS.map((a,i)=>`<button class="sw" type="button" style="background:${a[0]}" data-i="${i}" aria-label="${t('colors')[i]}" aria-pressed="${getComputedStyle(document.documentElement).getPropertyValue('--acc').trim()===a[0]}"></button>`).join('')}</div>`;
  r.querySelectorAll('.sw').forEach(b=>b.onclick=()=>{const a=ACCENTS[+b.dataset.i];document.documentElement.style.setProperty('--acc',a[0]);document.documentElement.style.setProperty('--acc-bg',a[1]);try{localStorage.setItem('ws3-acc',b.dataset.i)}catch(e){}renderReward()})}
 if(B()==='912'){r.innerHTML=`<div class="bank">${R.bank.length?R.bank.map(b=>`<div class="bw"><b>${b.w}</b><span>${b.ct}</span></div>`).join(''):`<p class="hint">${t('bankHint')}</p>`}</div>${R.bank.length?`<button class="chipbtn" type="button" id="copyBank" style="margin-top:10px">${t('copyBank')}</button>`:''}`;
  const cb=$('#copyBank');if(cb)cb.onclick=()=>{const txt=R.bank.map(b=>`${b.w}: ${CARDS[Object.keys(CARDS).find(k=>CARDS[k].word===b.w)].def} (${b.ct})`).join('\n');
   navigator.clipboard&&navigator.clipboard.writeText(txt).then(()=>{cb.textContent=t('copied')},()=>{cb.textContent=t('copyFail')})}}}
function idle(){const b=$('#stopBox');b.className='stopbox idle';
 b.innerHTML=stopsOn?`<p class="hint">${mode.stops.length?t('idle',B(),gameOn,mode.stops.length):t('idleNone')}</p>`:`<p class="hint">${t('stopsOff')}</p>`;
 $('#cardBody').innerHTML=`<p class="hint">${t('cardIdle')}</p>`}
async function load(id){stopAll();
 // Modes are fetched from the cloud (content.js) on demand; built-in and
 // pipeline modes already in MODES are used directly.
 mode=MODES.find(m=>m.id===id)||await loadMode(id);
 if(!mode){const f=byMode(id);if(f)mode=await loadMode(modeFor(f,uiLang==='es'))}
 if(!mode)return; // nothing to show (no such passage)
 document.body.className=document.body.className.replace(/\bb-\w+/g,'').trim()+' b-'+B();setSide(false);document.documentElement.lang=mode.lang==='es-US'?'es':'en';uiLang=mode.lang==='es-US'?'es':'en';syncLang();buildTabs();applyStatic();
 document.querySelectorAll('.tab').forEach(t=>t.setAttribute('aria-selected',t.dataset.id===B()));
 $('#stopTitle').textContent=mode.stopTitle;$('#darkBtn').hidden=id!=='912';if(id!=='912'){$('#col').classList.remove('dark');$('#darkBtn').setAttribute('aria-pressed','false')}
 cur=-1;solved=new Set();picking=null;picked.clear();resumeAt=0;freshReward();parse(mode);loadAudio(aid());render();showSource();qs&&qs.render(mode);clearEcho();computeChunks();heard.clear();explored.clear();tapped.clear();lastHeard=-1;updateViewTabs();setView('p');fillVoice();idle();if(typeof placeStrip==='function'){sentOn=[];placeStrip(-1)}renderReward();showResume();renderHero();updateNext();spentMs=0;setOpts(true);
 document.querySelectorAll('#bands li').forEach(li=>li.classList.toggle('cur',li.dataset.id===B()));try{localStorage.setItem('ws3-mode',id);const ce=curEntry();if(ce)localStorage.setItem('ws-bp-'+ce.band,ce.pid)}catch(e){}}
const TAB_ORDER=['k2','35','68','912'];
function buildTabs(){$('#tabs').innerHTML='';$('#bands').innerHTML='';
 // Base band modes, always in grade order (cloud fetches resolve out of order).
 const base=MODES.filter(m=>!m.band).sort((a,b)=>TAB_ORDER.indexOf(a.id)-TAB_ORDER.indexOf(b.id));
 base.forEach(m=>{const v=(uiLang==='es'&&MODES.find(x=>x.id===m.id+'es'))||m;
  const b=document.createElement('button');b.type='button';b.className='tab';b.setAttribute('role','tab');b.dataset.id=m.id;b.innerHTML=`${m.tab}<small>${v.sub}</small>`;
  b.onclick=()=>openBand(m.id);$('#tabs').appendChild(b);
  const li=document.createElement('li');li.dataset.id=m.id;li.innerHTML=`<span>${m.tab}</span><span>${v.how}</span>`;$('#bands').appendChild(li)})}
function bandEntry(b){let id=null;try{id=localStorage.getItem('ws-bp-'+b)}catch(e){}const l=byBand(b);return l.find(e=>e.pid===id)||l[0]}
function openBand(b){const e=bandEntry(b);if(e)load(modeFor(e,uiLang==='es'))}
function openPid(pid){const e=byPid(pid);if(e)load(modeFor(e,uiLang==='es'))}
function normStart(id){if(byMode(id))return id;const m=MODES.find(x=>x.id===id);const b=m?(m.band||m.id):'k2';const f=bandEntry(b);return f?modeFor(f,!!(m&&m.lang==='es-US')):'k2'}
let CREDITS={};const CRED=fetch('img/credits.json').then(r=>r.ok?r.json():{}).then(j=>{CREDITS=j||{}}).catch(()=>{});
const plain=h=>{const d=document.createElement('div');d.innerHTML=h||'';return (d.textContent||'').replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]))};
function renderHero(){const f=$('#heroArt');if(!f)return;const e=curEntry();if(!e){f.hidden=true;f.innerHTML='';return}
 const cap=img=>{const c=CREDITS[e.pid];let s=img&&c?`${t('heroPhoto',plain(c.author),plain(c.license))} · <a href="${c.url}" target="_blank" rel="noopener">${t('heroCommons')}</a>`:t(img?'heroCapImg':'heroCap');
  return s+(e.url?` · <a href="${e.url}" target="_blank" rel="noopener">${t('heroLink')}</a>`:'')};
 f.hidden=false;f.innerHTML=`<div class="hero-art" role="img">${art(e.pid)}</div><figcaption>${cap(false)}</figcaption>`;f.firstChild.setAttribute('aria-label',t('heroAlt',mode.title));
 // A real photo (public/img/<passage id>.jpg, with its credit in credits.json) replaces the drawing when it exists.
 const im=new Image();im.onload=()=>{if(curEntry()!==e)return;const box=f.querySelector('.hero-art');if(!box)return;box.innerHTML='';box.appendChild(im);CRED.then(()=>{if(curEntry()!==e)return;const c=f.querySelector('figcaption');if(c)c.innerHTML=cap(true)})};
 im.alt='';im.src='img/'+e.pid+'.jpg'}
function updateNext(){const b=$('#nextBtn');if(!b)return;const p=getProfile();const n=p.role==='student'?upNext(p.id).length:0;b.textContent=n?t('nextBtnN',n):t('nextBtn')}
function updateProfBtn(){const b=$('#profBtn');if(!b)return;const p=getProfile();const nm=p.role==='guest'?t('pfGuest'):p.name;b.innerHTML='<span class="pn"></span><span class="pi" aria-hidden="true"></span>';b.firstChild.textContent=nm;b.lastChild.textContent=nm.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();b.setAttribute('aria-label',t('pfBtn',nm))}
function applyProfile(p){updateProfBtn();updateNext();
 if(p.role==='student'){setFam(false);setAdmin(false);const up=upNext(p.id)[0];const e=up?byPid(up.pid):bandEntry(bandOf(p.st));if(e)load(modeFor(e,uiLang==='es'))}
 else if(p.role==='parent'){setFam(true);fam.show({tab:'parent',fam:p.id,stu:p.pa.kids[0],sub:'log'})}
 else if(p.role==='teacher'){setFam(true);fam.show({tab:'teacher',cls:p.te.cls,stu:null})}
 else if(document.body.classList.contains('fam'))fam.show({})}
function fillPassages(){const sel=$('#passageSel');if(!sel)return;const es=uiLang==='es';
 sel.innerHTML=byBand(B()).map(p=>`<option value="${p.modes.en}">${titleOf(p,es)} · ${es?(/^\d+$/.test(p.grade)?'Grado ':'Grados '):(/^\d+$/.test(p.grade)?'Grade ':'Grades ')}${p.grade}${p.lexile?' · '+p.lexile:''}</option>`).join('');
 const ce=curEntry();if(ce)sel.value=ce.modes.en}
let admin=null;
function navActive(){const a=document.body.classList.contains('admin'),f=document.body.classList.contains('fam');[['#navContent',!a&&!f],['#famBtn',f],['#adminBtn',a]].forEach(([q,on])=>{const b=$(q);if(!b)return;b.classList.toggle('on',on);on?b.setAttribute('aria-current','page'):b.removeAttribute('aria-current')})}
function famLabel(){const on=document.body.classList.contains('fam');const b=$('#famBtn');if(!b)return;b.setAttribute('aria-pressed',on);navActive()}
function setFam(on){if(on&&document.body.classList.contains('admin'))setAdmin(false);document.body.classList.toggle('fam',on);$('#family').hidden=!on;
 if(on){setSide(false);stopAll();fam&&fam.show()}famLabel();try{history.replaceState(null,'',on?'#family':location.pathname+location.search)}catch(e){}
 if(on)window.scrollTo(0,0)}
function adminLabel(){const on=document.body.classList.contains('admin');const b=$('#adminBtn');if(!b)return;b.setAttribute('aria-pressed',on);navActive()}
function setAdmin(on){if(on&&document.body.classList.contains('fam')){document.body.classList.remove('fam');$('#family').hidden=true;famLabel()}document.body.classList.toggle('admin',on);$('#admin').hidden=!on;$('#adminTag').hidden=!on;if(on){setSide(false);stopAll()}adminLabel();
 try{history.replaceState(null,'',on?'#admin':location.pathname+location.search)}catch(e){}
 if(on)window.scrollTo(0,0)}
function applyStatic(){document.querySelectorAll('[data-i18n]').forEach(e=>{e.textContent=t(e.dataset.i18n)});
 document.querySelectorAll('[data-i18n-html]').forEach(e=>{e.innerHTML=t(e.dataset.i18nHtml)});
 document.querySelectorAll('[data-i18n-label]').forEach(e=>{const v=t(e.dataset.i18nLabel);e.setAttribute('aria-label',v);if(e.hasAttribute('title'))e.title=v});
 adminLabel();famLabel();updateProfBtn();updateNext();admin&&admin.render();fam&&fam.render();info&&info.label();fillPassages();fillSupport();fillVoice();$('#stopsBtn').textContent=t('stopsBtn',stopsOn);syncGame();applyTheme();
 $('#voiceBtn').setAttribute('aria-label',voiceOn?t('voiceOn'):t('voiceOff'));updatePlay()}
$('#page').addEventListener('click',e=>{const w=e.target.closest('.w');if(!w)return;const i=+w.dataset.i;if(picking===null)trackTap(i);
 if(picking!==null){w.classList.toggle('picked');picked.has(i)?picked.delete(i):picked.add(i);return}
 if(tokens[i].key){const k=stopForToken(i);if(k>=0&&!solved.has(k)){pauseHere();openStop(k);return}
  if(playing)pauseHere();showCard(tokens[i].key,k>=0?mode.stops[k].clue:null);say(card(tokens[i].key).word);if(B()==='k2')collect(card(tokens[i].key).word);return}tapPlay(i)});
$('#page').addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.classList.contains('vocab')){e.preventDefault();e.target.click()}});
$('#play').onclick=()=>{if(playing){savePos(cur,true);stopAll();return}playFrom(resumeAt)};
$('#restart').onclick=()=>{clearPos();load(mode.id)};
$('#resumeGo').onclick=()=>{const i=+$('#resumeBar').dataset.i;hideResume();setView('p');playFrom(i)};$('#resumeNo').onclick=()=>clearPos();
document.addEventListener('visibilitychange',()=>{if(document.hidden&&playing)savePos(cur,true)});addEventListener('pagehide',()=>{if(playing)savePos(cur,true)});
const A={theme:'auto',size:'m',font:false,spacing:false,sentence:false,strip:false,contrast:false,motion:false,follow:true,readq:false};
try{Object.assign(A,JSON.parse(localStorage.getItem('ws-a11y')||'{}'))}catch(e){}
if(matchMedia('(prefers-reduced-motion: reduce)').matches&&!('motionSet' in A))A.motion=true;
const SIZES=['m','l','xl'];
function bumpSize(d){A.size=SIZES[Math.min(2,Math.max(0,SIZES.indexOf(A.size)+d))];applyA();moveGlow(cur)}
const mqDark=matchMedia('(prefers-color-scheme: dark)');
const isDark=()=>A.theme==='dark'||(A.theme==='auto'&&mqDark.matches);
function applyTheme(){const d=isDark();document.documentElement.dataset.theme=d?'dark':'light';const b=$('#themeBtn');if(b){b.textContent=d?t('toLight'):t('toDark');b.setAttribute('aria-pressed',d)}const r=document.getElementById('a-theme-'+A.theme);if(r)r.checked=true}
mqDark.addEventListener('change',()=>{if(A.theme==='auto')applyTheme()});
function applyA(){{const si=SIZES.indexOf(A.size);$('#szDn').disabled=si<=0;$('#szUp').disabled=si>=2}applyTheme();document.body.dataset.size=A.size;['font','spacing','contrast','motion'].forEach(k=>document.body.classList.toggle('a-'+k,!!A[k]));
 const sz=document.getElementById('a-size-'+A.size);if(sz)sz.checked=true;['font','spacing','sentence','strip','contrast','motion','follow','readq'].forEach(k=>{const el=document.getElementById('a-'+k);if(el)el.checked=!!A[k]});
 try{localStorage.setItem('ws-a11y',JSON.stringify(A))}catch(e){}markSentence(cur);placeStrip(cur);$('#a11yBtn').classList.toggle('off',!Object.keys(A).some(k=>k!=='follow'&&k!=='motionSet'&&(k==='size'?A.size!=='m':k==='theme'?A.theme!=='auto':A[k])))}
document.querySelectorAll('input[name="a-theme"]').forEach(r=>r.onchange=()=>{A.theme=r.value;applyA()});
$('#themeBtn').onclick=()=>{A.theme=isDark()?'light':'dark';applyA()};
document.querySelectorAll('input[name="a-size"]').forEach(r=>r.onchange=()=>{A.size=r.value;applyA();moveGlow(cur)});
['font','spacing','sentence','strip','contrast','motion','follow','readq'].forEach(k=>{const el=document.getElementById('a-'+k);el.onchange=()=>{A[k]=el.checked;if(k==='motion')A.motionSet=true;applyA();moveGlow(cur)}});
$('#a-reset').onclick=()=>{Object.assign(A,{theme:'auto',size:'m',font:false,spacing:false,sentence:false,strip:false,contrast:false,motion:false,follow:true,readq:false});applyA()};
$('#szUp').onclick=()=>bumpSize(1);$('#szDn').onclick=()=>bumpSize(-1);
$('#a11yBtn').onclick=()=>{const p=$('#a11y');p.hidden=!p.hidden;$('#a11yBtn').setAttribute('aria-expanded',!p.hidden);if(!p.hidden)document.getElementById('a-size-'+A.size).focus()};
let sentOn=[];function markSentence(i){sentOn.forEach(j=>els[j]&&els[j].classList.remove('sent'));sentOn=[];if(!A.sentence||i<0||!tokens[i])return;
 const end=t=>/[.!?]["”’»)]*$/.test(t.text);let a=i,b=i;while(a>0&&!end(tokens[a-1])&&tokens[a-1].p===tokens[i].p)a--;while(b<tokens.length-1&&!end(tokens[b])&&tokens[b+1].p===tokens[i].p)b++;
 for(let j=a;j<=b;j++){els[j].classList.add('sent');sentOn.push(j)}}
function placeStrip(i){let st=$('#page .strip');if(!A.strip){if(st)st.remove();return}if(!st){st=document.createElement('div');st.className='strip';st.setAttribute('aria-hidden','true');$('#page').appendChild(st)}
 const el=els[i>=0?i:resumeAt]||els[0];if(!el)return;const pr=$('#page').getBoundingClientRect(),r=el.getBoundingClientRect();const lh=parseFloat(getComputedStyle(el.parentElement).lineHeight)||r.height*1.6;st.style.top=(r.top-pr.top+r.height/2-lh/2)+'px';st.style.height=lh+'px'}
function followWord(i){if(!A.follow||i<0||!els[i])return;
 const band=()=>{const r=els[i].getBoundingClientRect(),bar=$('#audioPill').getBoundingClientRect(),top=Math.min(Math.max(bar.bottom,0),bar.height)+16;return {r,top,out:r.top<top||r.bottom>innerHeight*0.6}};
 let b=band();if(!b.out)return;
 const target=b.top+(innerHeight-b.top)*0.22;window.scrollBy({top:b.r.top-target,behavior:A.motion?'auto':'smooth'});
 setTimeout(()=>{if(cur!==i)return;const c=band();if(c.out)window.scrollBy({top:c.r.top-(c.top+(innerHeight-c.top)*0.22),behavior:'auto'})},450)}
document.addEventListener('keydown',e=>{if(e.key===' '&&!e.target.closest('button,textarea,input,select,[role="button"]')){e.preventDefault();$('#play').click()}});
applyA();
function skip(sec){if(picking!==null)return;const ms=60000/(165*rateNow());const d=Math.round(sec*1000/ms);const from=cur>=0?cur:resumeAt;const to=Math.max(0,Math.min(tokens.length-1,from+d));
 if(playing){playFrom(to)}else{resumeAt=to;if(cur>=0){els[cur].classList.remove('on');cur=-1}progress();if(els[to])els[to].scrollIntoView({block:'nearest'})}}
$('#back5').onclick=()=>skip(-5);$('#fwd5').onclick=()=>skip(5);
document.addEventListener('keydown',e=>{if(e.target.closest('textarea,input,select'))return;if(e.key==='ArrowLeft'){e.shiftKey?prevSent():skip(-5)}else if(e.key==='ArrowRight'){e.shiftKey?nextSent():skip(5)}});
$('#gameBtn').onclick=()=>{gameOn=!gameOn;syncGame();try{localStorage.setItem('ws-game',gameOn?'1':'0')}catch(e){}load(mode.id)};
function syncGame(){const b=$('#gameBtn');b.textContent=t('gameBtn',gameOn);b.title=t('gameTitle');b.classList.toggle('off',!gameOn);b.setAttribute('aria-pressed',gameOn)}syncGame();
function syncLang(){const has=(mode&&mode.pipeline)?!!(mode.sib||mode.sibId):(curEntry()?true:MODES.some(x=>x.id===B()+'es'));document.querySelectorAll('.lng').forEach(b=>{const on=(b.dataset.l==='es')===(mode.lang==='es-US');b.setAttribute('aria-pressed',on);if(b.dataset.l==='es'){b.disabled=!has;b.title=has?'':'No Spanish text for this passage yet'}})}
$('#passageSel').onchange=()=>{const e=byMode($('#passageSel').value);if(e)load(modeFor(e,uiLang==='es'))};
document.querySelectorAll('.lng').forEach(b=>b.onclick=async()=>{uiLang=b.dataset.l;const e=curEntry();
 // Pipeline passage: swap to the other language's text when the chosen language differs.
 if(mode&&mode.pipeline){const wantEs=uiLang==='es',isEs=mode.lang==='es-US';
  if(wantEs!==isEs){const sib=await ensureSibling(MODES,mode);if(sib){load(sib);return}}
  syncLang();applyStatic();return}
 load(e?modeFor(e,uiLang==='es'):(uiLang==='es'?B()+'es':B()))});
$('#stopsBtn').onclick=()=>{stopsOn=!stopsOn;const b=$('#stopsBtn');b.textContent=t('stopsBtn',stopsOn);b.classList.toggle('off',!stopsOn);b.setAttribute('aria-pressed',stopsOn);load(mode.id)};
$('#voiceBtn').innerHTML=SPK;
$('#voiceBtn').onclick=()=>{voiceOn=!voiceOn;const b=$('#voiceBtn');b.innerHTML=voiceOn?SPK:MUTE;b.setAttribute('aria-pressed',voiceOn);b.setAttribute('aria-label',voiceOn?t('voiceOn'):t('voiceOff'));if(!voiceOn&&synth)synth.cancel();Object.values(SA).forEach(a=>{if(a)a.audio.muted=!voiceOn})};
$('#darkBtn').onclick=()=>{const on=$('#col').classList.toggle('dark');$('#darkBtn').setAttribute('aria-pressed',on)};
window.addEventListener('resize',()=>moveGlow(cur));
try{const a=localStorage.getItem('ws3-acc');if(a!==null&&ACCENTS[+a]){document.documentElement.style.setProperty('--acc',ACCENTS[+a][0]);document.documentElement.style.setProperty('--acc-bg',ACCENTS[+a][1])}}catch(e){}
// `start` is resolved after cloud hydration (see the boot block below), since
// MODES/CATALOG are empty until then. Keep the last-opened id and the ?m= id.
let lastMode=null;try{lastMode=localStorage.getItem('ws3-mode')}catch(e){}
 const q=new URLSearchParams(location.search).get('m');
 let start='k2';
// Side panel on narrow screens: the word panel slides in from the right and is easy to open and close.
let panelFocus=null;
function setSide(open){const was=document.body.classList.contains('side-open');if(open===was)return;
 document.body.classList.toggle('side-open',open);$('#sideTab').setAttribute('aria-expanded',open);
 if(open){panelFocus=document.activeElement;setTimeout(()=>$('#sideClose').focus({preventScroll:true}),30)}
 else if(panelFocus&&document.contains(panelFocus)){panelFocus.focus({preventScroll:true});panelFocus=null}}
window.__saSide=true;$('#sideTab').onclick=()=>setSide(true);$('#sideClose').onclick=()=>setSide(false);$('#sideBackdrop').onclick=()=>setSide(false);
document.addEventListener('keydown',e=>{if(e.key==='Escape')setSide(false)});
matchMedia('(min-width: 881px)').addEventListener('change',e=>{if(e.matches)setSide(false)});
$('#support').onchange=()=>{support=$('#support').value;try{localStorage.setItem('ws-support',support)}catch(e){}stopAll();clearEcho();els.forEach(e=>e&&e.classList.remove('on'));setActive(-1);fillSupport()};
$('#seek').addEventListener('input',()=>{const a=audioReady();if(!a)return;const ms=$('#seek').value/1000*a.dur;$('#seek').style.setProperty('--p',($('#seek').value/10)+'%');$('#tCur').textContent=fmt(ms);$('#tLeft').textContent='-'+fmt(a.dur-ms)});
$('#seek').addEventListener('change',()=>{const a=audioReady();if(a)seekToMs($('#seek').value/1000*a.dur)});
$('#prevS').onclick=prevSent;$('#nextS').onclick=nextSent;
$('#loopBtn').onclick=()=>{loopSent=!loopSent;$('#loopBtn').setAttribute('aria-pressed',loopSent);loopK=loopSent?sentOf(cur>=0?cur:resumeAt):-1};
setupMedia();
$('#echoNext').onclick=()=>{if(echoK>=0&&echoK<sentS.length-1)playFrom(sentS[echoK+1])};
$('#echoAgain').onclick=()=>{if(echoK>=0)playFrom(sentS[echoK])};
$('#echoSent').onclick=()=>{if(echoK>=0)hearSentence(echoK)};
admin=initAdmin(t);
qs=createQuestions({t,stopPassage:stopAll,voiceOn:()=>voiceOn,voice:curVoice});
dlg=createDialogs({t,getMode:()=>mode,getAudioId:aid,getVoice:()=>{const a=SA[aid()];return a&&a.voice?a.voice:'browser'},onReread:()=>{setView('p');window.scrollTo(0,0);playFrom(0)},onKeep:()=>{setView('p');window.scrollTo(0,0)},onQuestions:()=>setView('q'),onNext:()=>nxt&&nxt.open(),onWords:()=>{setFam(true);fam.show('parent');setTimeout(()=>{const e=document.getElementById('fmWords');if(e)e.scrollIntoView({block:'start'})},60)}});
fam=createFamily({t,getLang:()=>uiLang,getProfile,onRead:(pid,asfor)=>{if(asfor){setProfile(asfor);updateProfBtn();updateNext()}setFam(false);openPid(pid)}});info=createInfo({t});
nxt=createNext({t,getCurrent:curEntry,getAssigned:()=>{const p=getProfile();return p.role==='student'?upNext(p.id):[]},getLang:()=>uiLang,onOpen:openPid});
pfd=createProfile({t,onPick:applyProfile});
$('#nextBtn').onclick=()=>nxt.open();$('#profBtn').onclick=()=>pfd.open();
addEventListener('sa-people',()=>{updateNext();updateProfBtn()});
$('#vtP').onclick=()=>setView('p');$('#vtQ').onclick=()=>setView('q');$('#rateBtn').onclick=()=>dlg.openRate();
$('#voice').onchange=async()=>{const L=voiceLang();try{localStorage.setItem('ws-voice-'+L,$('#voice').value)}catch(e){}
 // Remember where we were and whether we were playing, then reload the chosen
 // voice's track and resume from the same word so the new voice takes over.
 const at=cur>=0?cur:resumeAt;const was=playing;stopAll();qs&&qs.stop();
 SA[aid()]=undefined;await loadAudio(aid());showSource();
 if(was)playFrom(at||0)};
const tour=createTour({t,view:()=>document.body.classList.contains('admin')?'admin':document.body.classList.contains('fam')?'fam':'student',before:()=>{if(!document.body.classList.contains('admin')&&!document.body.classList.contains('fam')){setOpts(true);setView('p');setSide(false);stopAll()}}});
$('#howBtn').onclick=()=>tour.start();
$('#optBtn').onclick=()=>setOpts(document.body.classList.contains('opts-closed'));
$('#famBtn').onclick=()=>setFam(true);$('#navContent').onclick=()=>{setAdmin(false);setFam(false);window.scrollTo(0,0)};
$('#adminBtn').onclick=()=>setAdmin(true);initNav();
// Hydrate the roster/sessions/assignments/practice from the cloud (fires 'sa-people' when ready, which re-renders).
hydratePeople();
// Hydrate the passage catalog + shared cards, then the band-tab modes, from
// the cloud BEFORE the first load so tabs and lists have their metadata.
(async()=>{
 await hydrateContent();await hydrateBandModes();buildTabs();
 // Resolve the starting passage now that the catalog is loaded.
 if(lastMode&&(hasMode(lastMode)||byMode(lastMode)))start=normStart(lastMode);
 if(q){
  if(hasMode(q)||byMode(q)){await load(normStart(q))}
  else{const m=await addPipelineMode(MODES,q);await load(m?m.id:start)}
 }else await load(start);
 if(location.hash==='#admin')setAdmin(true);else if(location.hash==='#family')setFam(true);
 else if(!q&&getProfile().role!=='guest')applyProfile(getProfile());
})();
}
