import { I18N } from './i18n.js'
import { SPK, MUTE, GLOW, JAR, BADGE, ICON, CARDS, MODES, ACCENTS } from './data.js'

// Imperative player ported from WordStops_v8; drives the markup rendered by App.vue.
export function init() {
const $=s=>document.querySelector(s);
const B=()=>mode.band||mode.id;
const t=(k,...a)=>{const v=I18N[uiLang]&&I18N[uiLang][k]!==undefined?I18N[uiLang][k]:I18N.en[k];return typeof v==='function'?v(...a):v};
let uiLang='en';let gameOn=false;try{gameOn=localStorage.getItem('ws-game')==='1'}catch(e){}
const synth='speechSynthesis' in window?window.speechSynthesis:null;
let mode,tokens=[],els=[],cur=-1,stopIdxs=[],solved=new Set(),playing=false,run=0,timer=null,picking=null,picked=new Set(),stopsOn=true,voiceOn=true,resumeAt=0;
let R={};
function freshReward(){R={jar:[],badges:new Set(),moves:{},streak:0,firstTry:true,bank:[]}}
function keyFor(t){const w=t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z]/g,'');if(mode.forms&&mode.forms[w])return mode.forms[w];const k=Object.keys(CARDS).find(k=>!/\d/.test(k)&&w.startsWith(k));return (mode.cardOverride&&mode.cardOverride[k])||k}
function parse(m){tokens=[];m.paras.forEach((p,pi)=>p.split(/\s+/).forEach(raw=>{let t=raw,cls=[],grp=null,stop=false;
  if(t.endsWith('^')){stop=true;t=t.slice(0,-1)}
  let mm;while((mm=t.match(/^([~\-=])(\d)/))||(t[0]==='*'&&t.length>1)){if(mm){cls.push(mm[1]==='~'?'clue':mm[1]==='-'?'contrast':'signal');grp=+mm[2];t=t.slice(2)}else{cls.push('vocab');t=t.slice(1)}}
  tokens.push({text:t,cls,grp,p:pi,stop,key:null})}));
 tokens.forEach(tk=>{if(tk.cls.includes('vocab'))tk.key=keyFor(tk.text)});
 stopIdxs=tokens.map((t,i)=>t.stop?i:-1).filter(i=>i>=0)}
function stopWordIdx(k){const w=CARDS[mode.stops[k].word].word;let best=-1;tokens.forEach((t,i)=>{if(t.key&&CARDS[t.key].word===w&&i<=stopIdxs[k])best=i});return best}
// ETL product cache + loader. Passages produced by the pipeline (not in MODES) are
// rendered from the product JSON's contentTokenized HTML instead of inline-markup paras.
const PROD={};
async function loadProduct(id){if(PROD[id]!==undefined)return PROD[id];
 try{const prod=await (await fetch(`sa/product/${id}.soundAlong.json`)).json();PROD[id]=prod;return prod}
 catch(e){PROD[id]=null;return null}}
// Build a minimal mode + tokens from a product record. No Word Stops / vocab cards yet.
function parseETL(prod){const pStarts=(prod.structure&&prod.structure.paragraphStarts)||[0];
 tokens=[];const n=prod.tokenCount;let pi=0;
 for(let i=0;i<n;i++){while(pi+1<pStarts.length&&i>=pStarts[pi+1])pi++;
  tokens.push({text:'',cls:[],grp:null,p:pStarts.length?pi:0,stop:false,key:null})}
 stopIdxs=[];
 return {id:prod.id,etl:true,prod,lang:prod.lang==='es'?'es-US':'en-US',title:prod.title,
  paras:pStarts.length?pStarts:[0],stops:[],details:[],voice:1,
  sentenceStarts:(prod.structure&&prod.structure.sentenceStarts)||[0]}}
function renderETL(){const page=$('#page');page.innerHTML='';els=[];
 const wrap=document.createElement('div');wrap.style.display='grid';wrap.style.gap='10px';
 wrap.innerHTML=mode.prod.contentTokenized;
 wrap.querySelectorAll('[data-w]').forEach(s=>{const i=+s.dataset.w;s.classList.add('w');s.dataset.i=i;
  els[i]=s;if(tokens[i])tokens[i].text=s.textContent});
 page.appendChild(wrap);
 $('#ptitle').textContent=mode.title;page.classList.remove('tapping','stopping');
 $('#details').innerHTML=mode.prod.details||'';
 progress()}
function render(){const page=$('#page');page.innerHTML='<div id="glow">'+GLOW+'</div>';els=[];
 mode.paras.forEach((_,pi)=>{const wrap=document.createElement('div');wrap.style.display='grid';wrap.style.gap='10px';const p=document.createElement('p');
  tokens.forEach((tk,i)=>{if(tk.p!==pi)return;const s=document.createElement('span');s.className='w '+tk.cls.join(' ');s.textContent=tk.text;s.dataset.i=i;
   if(tk.key){s.setAttribute('role','button');s.tabIndex=0;s.setAttribute('aria-label',t('openCard')+CARDS[tk.key].word)}els[i]=s;p.appendChild(s);p.appendChild(document.createTextNode(' '))});
  const n=document.createElement('div');n.id='notes'+pi;n.style.display='grid';n.style.gap='8px';wrap.append(p,n);page.appendChild(wrap)});
 if(stopsOn)mode.stops.forEach((_,k)=>{const i=stopWordIdx(k);if(els[i])els[i].classList.add('stopw')});
 $('#ptitle').textContent=mode.title;page.classList.remove('tapping','stopping');
 const vc=new Set(tokens.filter(t=>t.key).map(t=>CARDS[t.key].word)).size;
 $('#details').innerHTML=mode.details.map(([k,v])=>`<div>${k}: ${v}</div>`).join('')+`<div style="margin-top:8px">${t('detailsDemo',mode.stops.length,vc)}</div>`;
 progress();requestAnimationFrame(()=>moveGlow(-1))}
function moveGlow(i){if(B()!=='k2')return;const g=$('#glow');if(!g)return;const page=$('#page');
 let el=i>=0?els[i]:null;if(!el){g.style.left='calc(100% - 46px)';g.style.top='-48px';return}
 const pr=page.getBoundingClientRect(),r=el.getBoundingClientRect();
 g.style.left=Math.max(0,Math.min(pr.width-46,r.left-pr.left+r.width/2-23))+'px';g.style.top=(r.top-pr.top-40)+'px'}
function glowMood(c){if(!gameOn)return;const g=$('#glow');if(!g)return;g.classList.remove('happy','oops');void g.offsetWidth;g.classList.add(c)}
function progress(){const n=tokens.length,at=cur<0?resumeAt:cur+1;$('#time').textContent=`${Math.min(at,n)} / ${n} ${t('words')}`;$('#prog').style.width=(100*Math.min(at,n)/n)+'%'}
function setActive(i){if(cur>=0&&els[cur])els[cur].classList.remove('on');cur=i;if(i>=0&&els[i])els[i].classList.add('on');progress();if(i>=0)moveGlow(i);if(typeof A!=='undefined'){markSentence(i);placeStrip(i);followWord(i)}}
const clean=t=>t.replace(/[“”]/g,'');
function stopAll(){run++;clearInterval(timer);timer=null;if(synth)synth.cancel();Object.values(SA).forEach(a=>a&&a.audio.pause());playing=false;updatePlay()}
function updatePlay(){$('#play').textContent=playing?'❚❚':'▶';$('#play').setAttribute('aria-label',playing?t('pause'):t('play'))}
const rateNow=()=>parseFloat($('#speed').value)*(mode.voice||1);
// Polly audio: files produced by the pipeline (product JSON, gzipped timing, MP3), served from sa/ in dev.
const SA={};
const lastAtOrBefore=(arr,t)=>{let lo=0,hi=arr.length-1,a=-1;while(lo<=hi){const m=(lo+hi)>>1;if(arr[m]<=t){a=m;lo=m+1}else hi=m-1}return a};
async function loadAudio(mid){if(SA[mid]!==undefined)return;SA[mid]=null;
 try{const base='sa/';
  const prod=await (await fetch(`${base}product/${mid}.soundAlong.json`)).json();
  const tr=prod.tracks[0];if(tr.qa.status!=='passed')return;
  const gz=await fetch(`${base}${tr.timingKey}`);
  // S3 sends Content-Encoding: gzip, so the browser usually inflates it already; fall back to doing it here if not.
  const raw=await gz.arrayBuffer();let tm;
  try{tm=JSON.parse(new TextDecoder().decode(raw))}catch{tm=await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).json()}
  if(tm.textHash!==prod.textHash)return;
  const audio=new Audio(`${base}${tr.audioKey}`);audio.preload='auto';
  SA[mid]={audio,start:tm.start,end:tm.end,n:tm.n,voice:tr.voiceId};
  if(mode&&mode.id===mid)showSource()}catch(e){SA[mid]=null}}
function showSource(){const lg=document.querySelector('.legend');if(!lg)return;let tag=$('#srcTag');if(!tag){tag=document.createElement('span');tag.id='srcTag';lg.appendChild(tag)}
 const a=SA[mode.id];tag.textContent=a&&a.n===tokens.length?t('srcPolly',a.voice):t('srcBrowser')}
function readAudio(from,to,onDone,id){const a=SA[mode.id],au=a.audio;let done=false;
 const finish=()=>{if(done)return;done=true;au.pause();playing=false;updatePlay();setActive(-1);onDone&&onDone()};
 const frame=()=>{if(id!==run||done)return;if(au.ended){finish();return}
  const i=Math.max(from,lastAtOrBefore(a.start,au.currentTime*1000));
  if(i>to){finish();return}if(i!==cur)setActive(i);requestAnimationFrame(frame)};
 au.currentTime=a.start[from]/1000;au.playbackRate=parseFloat($('#speed').value);au.muted=!voiceOn;setActive(from);
 au.play().then(()=>requestAnimationFrame(frame)).catch(()=>{if(id===run)finish()})}
function readRange(from,to,onDone){stopAll();const id=run;playing=true;updatePlay();
 if(SA[mode.id]&&SA[mode.id].n===tokens.length)return readAudio(from,to,onDone,id);
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
function playFrom(i){if(picking!==null)return;resumeAt=i;
 readRange(i,tokens.length-1,()=>{resumeAt=0;progress();moveGlow(-1)})}
function stopForToken(i){if(!stopsOn)return -1;for(let k=0;k<mode.stops.length;k++)if(stopWordIdx(k)===i)return k;return -1}
function pauseHere(){const at=cur>=0?cur:resumeAt;const was=playing;stopAll();if(cur>=0){els[cur].classList.remove('on');cur=-1}resumeAt=at;progress();return was}
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
 if(B()==='35'&&gameOn){const st=document.createElement('span');st.className='stamp';st.textContent=t('solved');box.appendChild(st);R.badges.add(s.badge);renderReward()}
 if(B()==='68'){if(gameOn){R.moves[s.move]=(R.moves[s.move]||0)+1;if(R.firstTry)R.streak++;else R.streak=0;}
  if(s.parts){const b=document.createElement('div');b.className='blocks snap';b.innerHTML=`<span class="blk">${s.parts[0]}</span><span class="eq">+</span><span class="blk suf">${s.parts[1]}</span><span class="eq">=</span><span class="blk res">${s.parts[2]}</span>`;box.appendChild(b)}
  renderReward()}
 if(B()==='912'){const c=CARDS[s.word];const r=document.createElement('div');r.className='resolved';if(gameOn){R.bank.push({w:c.word,ct:s.clue});r.textContent=t('resolvedBank');renderReward()}else r.textContent=t('resolved');box.appendChild(r)}
 const go=document.createElement('button');go.className='tbtn';go.type='button';
 go.textContent=resumeAt>0?t('resume'):t('fromStart');
 go.onclick=()=>playFrom(resumeAt);box.appendChild(go)}
function choiceButtons(s,list,pics,onRight){const box=document.createElement('div');box.className='choices'+(pics?' pics':'');const fb=document.createElement('p');fb.className='fb';fb.setAttribute('role','status');let done=false;
 list.forEach(c=>{const b=document.createElement('button');b.type='button';b.className='choice'+(pics?' pic':'');b.innerHTML=(pics?ICON[c.icon]:'')+'<span>'+c.t+'</span>';
  b.onclick=()=>{if(done)return;if(c.ok){done=true;b.classList.add('right');fb.className='fb ok';const rt=gameOn?s.right:(s.rightPlain||s.right);fb.textContent=rt;say(rt);onRight()}else{R.firstTry=false;b.classList.add('wrong');fb.className='fb no';fb.textContent=s.wrong;say(s.wrong);if(B()==='k2')glowMood('oops')}};box.appendChild(b)});return[box,fb]}
function openStop(k){const s=mode.stops[k],box=$('#stopBox');R.firstTry=true;box.className='stopbox';box.dataset.tab=t('caseFile',k+1)+' · '+CARDS[s.word].word.toUpperCase();box.innerHTML=stopHeader(k);
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
function showCard(key,clue){const c=CARDS[key];const adv=B()==='912'||B()==='68';
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
function renderReward(){const r=$('#reward');if(mode&&mode.etl){$('#rewardWrap').hidden=true;r.innerHTML='';return}$('#rewardWrap').hidden=!gameOn;if(!gameOn){r.innerHTML='';return}$('#rewardTitle').textContent=mode.reward;
 if(B()==='k2'){r.innerHTML=`<div class="jar">${JAR(R.jar.length)}<div class="jarwords">${R.jar.length?R.jar.map(w=>`<button class="jarword${w===R.justAdded?' new':''}" type="button" data-w="${w}">${w}</button>`).join(''):'<span class="hint">'+t('jarHint')+'</span>'}</div></div>`;
  r.querySelectorAll('.jarword').forEach(b=>b.onclick=()=>say(b.dataset.w))}
 if(B()==='35'){const all=t('badges');
  r.innerHTML=`<div class="badges">${all.map(([k,n])=>`<div class="badge ${R.badges.has(k)?'got':''}">${BADGE[k]('#8a6d1f')}<span>${n}</span></div>`).join('')}</div><p class="hint" style="margin-top:8px">${t('badgeNote')}</p>`}
 if(B()==='68'){const mv=t('moves');
  r.innerHTML=`<div class="streak">${t('streak')} <b>${R.streak}</b></div><div class="moves" style="margin-top:8px">${mv.map(m=>`<div class="mv"><span>${m}</span><b>× ${R.moves[m]||0}</b></div>`).join('')}</div>
  <div class="swatches" style="margin-top:12px">${t('yourColor')} ${ACCENTS.map((a,i)=>`<button class="sw" type="button" style="background:${a[0]}" data-i="${i}" aria-label="${t('colors')[i]}" aria-pressed="${getComputedStyle(document.documentElement).getPropertyValue('--acc').trim()===a[0]}"></button>`).join('')}</div>`;
  r.querySelectorAll('.sw').forEach(b=>b.onclick=()=>{const a=ACCENTS[+b.dataset.i];document.documentElement.style.setProperty('--acc',a[0]);document.documentElement.style.setProperty('--acc-bg',a[1]);try{localStorage.setItem('ws3-acc',b.dataset.i)}catch(e){}renderReward()})}
 if(B()==='912'){r.innerHTML=`<div class="bank">${R.bank.length?R.bank.map(b=>`<div class="bw"><b>${b.w}</b><span>${b.ct}</span></div>`).join(''):`<p class="hint">${t('bankHint')}</p>`}</div>${R.bank.length?`<button class="chipbtn" type="button" id="copyBank" style="margin-top:10px">${t('copyBank')}</button>`:''}`;
  const cb=$('#copyBank');if(cb)cb.onclick=()=>{const txt=R.bank.map(b=>`${b.w}: ${CARDS[Object.keys(CARDS).find(k=>CARDS[k].word===b.w)].def} (${b.ct})`).join('\n');
   navigator.clipboard&&navigator.clipboard.writeText(txt).then(()=>{cb.textContent=t('copied')},()=>{cb.textContent=t('copyFail')})}}}
function idle(){const b=$('#stopBox');b.className='stopbox idle';
 if(mode&&mode.etl){b.innerHTML=`<p class="hint">${t('etlIdle')}</p>`;$('#cardBody').innerHTML=`<p class="hint">${t('cardIdle')}</p>`;return}
 b.innerHTML=stopsOn?`<p class="hint">${t('idle',B(),gameOn,mode.stops.length)}</p>`:`<p class="hint">${t('stopsOff')}</p>`;
 $('#cardBody').innerHTML=`<p class="hint">${t('cardIdle')}</p>`}
function load(id){if(!MODES.some(m=>m.id===id)){loadETL(id);return}
 stopAll();mode=MODES.find(m=>m.id===id);document.body.className='b-'+B();document.documentElement.lang=mode.lang==='es-US'?'es':'en';uiLang=mode.lang==='es-US'?'es':'en';syncLang();buildTabs();applyStatic();
 document.querySelectorAll('.tab').forEach(t=>t.setAttribute('aria-selected',t.dataset.id===B()));
 $('#stopTitle').textContent=mode.stopTitle;$('#darkBtn').hidden=id!=='912';if(id!=='912'){$('#col').classList.remove('dark');$('#darkBtn').setAttribute('aria-pressed','false')}
 cur=-1;solved=new Set();picking=null;picked.clear();resumeAt=0;freshReward();parse(mode);loadAudio(mode.id);render();showSource();idle();if(typeof placeStrip==='function'){sentOn=[];placeStrip(-1)}renderReward();
 document.querySelectorAll('#bands li').forEach(li=>li.classList.toggle('cur',li.dataset.id===B()));try{localStorage.setItem('ws3-mode',id)}catch(e){}}
async function loadETL(id){stopAll();const prod=await loadProduct(id);
 if(!prod){if(!mode)load('k2');else idle();return}
 mode=parseETL(prod);document.body.className='b-'+B();document.documentElement.lang=prod.lang==='es'?'es':'en';uiLang=prod.lang==='es'?'es':'en';syncLang();buildTabs();applyStatic();
 document.querySelectorAll('.tab').forEach(t=>t.setAttribute('aria-selected',false));
 $('#stopTitle').textContent=t('wsName');$('#darkBtn').hidden=true;$('#col').classList.remove('dark');$('#darkBtn').setAttribute('aria-pressed','false');
 cur=-1;solved=new Set();picking=null;picked.clear();resumeAt=0;freshReward();
 loadAudio(mode.id);renderETL();showSource();idle();if(typeof placeStrip==='function'){sentOn=[];placeStrip(-1)}renderReward();
 document.querySelectorAll('#bands li').forEach(li=>li.classList.remove('cur'));try{localStorage.setItem('ws3-mode',id)}catch(e){}}
function buildTabs(){$('#tabs').innerHTML='';$('#bands').innerHTML='';
 MODES.filter(m=>!m.band).forEach(m=>{const v=(uiLang==='es'&&MODES.find(x=>x.id===m.id+'es'))||m;
  const b=document.createElement('button');b.type='button';b.className='tab';b.setAttribute('role','tab');b.dataset.id=m.id;b.innerHTML=`${m.tab}<small>${v.sub}</small>`;
  b.onclick=()=>load(uiLang==='es'&&MODES.some(x=>x.id===m.id+'es')?m.id+'es':m.id);$('#tabs').appendChild(b);
  const li=document.createElement('li');li.dataset.id=m.id;li.innerHTML=`<span>${m.tab}</span><span>${v.how}</span>`;$('#bands').appendChild(li)})}
function applyStatic(){document.querySelectorAll('[data-i18n]').forEach(e=>{e.textContent=t(e.dataset.i18n)});
 document.querySelectorAll('[data-i18n-html]').forEach(e=>{e.innerHTML=t(e.dataset.i18nHtml)});
 document.querySelectorAll('[data-i18n-label]').forEach(e=>{const v=t(e.dataset.i18nLabel);e.setAttribute('aria-label',v);if(e.hasAttribute('title'))e.title=v});
 $('#stopsBtn').textContent=t('stopsBtn',stopsOn);syncGame();applyTheme();
 $('#voiceBtn').setAttribute('aria-label',voiceOn?t('voiceOn'):t('voiceOff'));updatePlay()}
$('#page').addEventListener('click',e=>{const w=e.target.closest('.w');if(!w)return;const i=+w.dataset.i;
 if(picking!==null){w.classList.toggle('picked');picked.has(i)?picked.delete(i):picked.add(i);return}
 if(tokens[i].key){const k=stopForToken(i);if(k>=0&&!solved.has(k)){pauseHere();openStop(k);return}
  if(playing)pauseHere();showCard(tokens[i].key,k>=0?mode.stops[k].clue:null);say(CARDS[tokens[i].key].word);if(B()==='k2')collect(CARDS[tokens[i].key].word);return}playFrom(i)});
$('#page').addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.classList.contains('vocab')){e.preventDefault();e.target.click()}});
$('#play').onclick=()=>{if(playing){stopAll();return}playFrom(resumeAt)};
$('#restart').onclick=()=>load(mode.id);
const A={theme:'auto',size:'m',font:false,spacing:false,sentence:false,strip:false,contrast:false,motion:false,follow:true,readq:false};
try{Object.assign(A,JSON.parse(localStorage.getItem('ws-a11y')||'{}'))}catch(e){}
if(matchMedia('(prefers-reduced-motion: reduce)').matches&&!('motionSet' in A))A.motion=true;
const mqDark=matchMedia('(prefers-color-scheme: dark)');
const isDark=()=>A.theme==='dark'||(A.theme==='auto'&&mqDark.matches);
function applyTheme(){const d=isDark();document.documentElement.dataset.theme=d?'dark':'light';const b=$('#themeBtn');if(b){b.textContent=d?t('toLight'):t('toDark');b.setAttribute('aria-pressed',d)}const r=document.getElementById('a-theme-'+A.theme);if(r)r.checked=true}
mqDark.addEventListener('change',()=>{if(A.theme==='auto')applyTheme()});
function applyA(){applyTheme();document.body.dataset.size=A.size;['font','spacing','contrast','motion'].forEach(k=>document.body.classList.toggle('a-'+k,!!A[k]));
 const sz=document.getElementById('a-size-'+A.size);if(sz)sz.checked=true;['font','spacing','sentence','strip','contrast','motion','follow','readq'].forEach(k=>{const el=document.getElementById('a-'+k);if(el)el.checked=!!A[k]});
 try{localStorage.setItem('ws-a11y',JSON.stringify(A))}catch(e){}markSentence(cur);placeStrip(cur);$('#a11yBtn').classList.toggle('off',!Object.keys(A).some(k=>k!=='follow'&&k!=='motionSet'&&(k==='size'?A.size!=='m':k==='theme'?A.theme!=='auto':A[k])))}
document.querySelectorAll('input[name="a-theme"]').forEach(r=>r.onchange=()=>{A.theme=r.value;applyA()});
$('#themeBtn').onclick=()=>{A.theme=isDark()?'light':'dark';applyA()};
document.querySelectorAll('input[name="a-size"]').forEach(r=>r.onchange=()=>{A.size=r.value;applyA();moveGlow(cur)});
['font','spacing','sentence','strip','contrast','motion','follow','readq'].forEach(k=>{const el=document.getElementById('a-'+k);el.onchange=()=>{A[k]=el.checked;if(k==='motion')A.motionSet=true;applyA();moveGlow(cur)}});
$('#a-reset').onclick=()=>{Object.assign(A,{theme:'auto',size:'m',font:false,spacing:false,sentence:false,strip:false,contrast:false,motion:false,follow:true,readq:false});applyA()};
$('#a11yBtn').onclick=()=>{const p=$('#a11y');p.hidden=!p.hidden;$('#a11yBtn').setAttribute('aria-expanded',!p.hidden);if(!p.hidden)document.getElementById('a-size-'+A.size).focus()};
let sentOn=[];function markSentence(i){sentOn.forEach(j=>els[j]&&els[j].classList.remove('sent'));sentOn=[];if(!A.sentence||i<0||!tokens[i])return;
 const end=t=>/[.!?]["”’»)]*$/.test(t.text);let a=i,b=i;while(a>0&&!end(tokens[a-1])&&tokens[a-1].p===tokens[i].p)a--;while(b<tokens.length-1&&!end(tokens[b])&&tokens[b+1].p===tokens[i].p)b++;
 for(let j=a;j<=b;j++){els[j].classList.add('sent');sentOn.push(j)}}
function placeStrip(i){let st=$('#page .strip');if(!A.strip){if(st)st.remove();return}if(!st){st=document.createElement('div');st.className='strip';st.setAttribute('aria-hidden','true');$('#page').appendChild(st)}
 const el=els[i>=0?i:resumeAt]||els[0];if(!el)return;const pr=$('#page').getBoundingClientRect(),r=el.getBoundingClientRect();const lh=parseFloat(getComputedStyle(el.parentElement).lineHeight)||r.height*1.6;st.style.top=(r.top-pr.top+r.height/2-lh/2)+'px';st.style.height=lh+'px'}
function followWord(i){if(!A.follow||i<0||!els[i])return;const r=els[i].getBoundingClientRect();if(r.top<80||r.bottom>innerHeight-60)els[i].scrollIntoView({block:'center',behavior:A.motion?'auto':'smooth'})}
document.addEventListener('keydown',e=>{if(e.key===' '&&!e.target.closest('button,textarea,input,select,[role="button"]')){e.preventDefault();$('#play').click()}});
applyA();
function skip(sec){if(picking!==null)return;const ms=60000/(165*rateNow());const d=Math.round(sec*1000/ms);const from=cur>=0?cur:resumeAt;const to=Math.max(0,Math.min(tokens.length-1,from+d));
 if(playing){playFrom(to)}else{resumeAt=to;if(cur>=0){els[cur].classList.remove('on');cur=-1}progress();if(els[to])els[to].scrollIntoView({block:'nearest'})}}
$('#back5').onclick=()=>skip(-5);$('#fwd5').onclick=()=>skip(5);
document.addEventListener('keydown',e=>{if(e.target.closest('textarea,input,select'))return;if(e.key==='ArrowLeft'){skip(-5)}else if(e.key==='ArrowRight'){skip(5)}});
$('#gameBtn').onclick=()=>{gameOn=!gameOn;syncGame();try{localStorage.setItem('ws-game',gameOn?'1':'0')}catch(e){}load(mode.id)};
function syncGame(){const b=$('#gameBtn');b.textContent=t('gameBtn',gameOn);b.title=t('gameTitle');b.classList.toggle('off',!gameOn);b.setAttribute('aria-pressed',gameOn)}syncGame();
function syncLang(){const has=MODES.some(x=>x.id===B()+'es');document.querySelectorAll('.lng').forEach(b=>{const on=(b.dataset.l==='es')===(mode.lang==='es-US');b.setAttribute('aria-pressed',on);if(b.dataset.l==='es'){b.disabled=!has;b.title=has?'':'No Spanish paired text loaded for this band in the demo yet'}});$('#langNote').hidden=has}
document.querySelectorAll('.lng').forEach(b=>b.onclick=()=>{uiLang=b.dataset.l;load(uiLang==='es'?B()+'es':B())});
$('#stopsBtn').onclick=()=>{stopsOn=!stopsOn;const b=$('#stopsBtn');b.textContent=t('stopsBtn',stopsOn);b.classList.toggle('off',!stopsOn);b.setAttribute('aria-pressed',stopsOn);load(mode.id)};
$('#voiceBtn').innerHTML=SPK;
$('#voiceBtn').onclick=()=>{voiceOn=!voiceOn;const b=$('#voiceBtn');b.innerHTML=voiceOn?SPK:MUTE;b.setAttribute('aria-pressed',voiceOn);b.setAttribute('aria-label',voiceOn?t('voiceOn'):t('voiceOff'));if(!voiceOn&&synth)synth.cancel();Object.values(SA).forEach(a=>{if(a)a.audio.muted=!voiceOn})};
$('#darkBtn').onclick=()=>{const on=$('#col').classList.toggle('dark');$('#darkBtn').setAttribute('aria-pressed',on)};
window.addEventListener('resize',()=>moveGlow(cur));
try{const a=localStorage.getItem('ws3-acc');if(a!==null&&ACCENTS[+a]){document.documentElement.style.setProperty('--acc',ACCENTS[+a][0]);document.documentElement.style.setProperty('--acc-bg',ACCENTS[+a][1])}}catch(e){}
let start='k2';try{const s=localStorage.getItem('ws3-mode');if(s&&MODES.some(m=>m.id===s))start=s}catch(e){}
 const q=new URLSearchParams(location.search).get('m');if(q&&MODES.some(m=>m.id===q))start=q;else if(q)start=q
load(start);
}
