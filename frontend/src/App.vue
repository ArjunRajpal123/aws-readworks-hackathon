<script setup>
import { onMounted } from 'vue'
import { init } from './engine.js'

onMounted(init)
</script>

<template>
  <div v-pre>
<div class="adminbar"><button class="adminbtn" id="adminBtn" type="button" aria-pressed="false" aria-controls="admin"><span>Admin</span></button><span class="admintag" id="adminTag" data-i18n="adminTag" hidden></span></div>

<div class="top"><div class="in">
  <span class="name">Sound Along</span>
  <button class="howbtn" id="howBtn" type="button"><span class="howq" aria-hidden="true">?</span><span data-i18n="howBtn">How to use</span></button>
  <button class="themebtn" id="themeBtn" type="button" aria-pressed="false"></button>
</div></div>

<div class="bandrow"><div class="in">
  <div class="titlerow">
    <h1 id="ptitle"></h1>
    <div class="lngwrap" role="group" aria-label="Passage language" data-i18n-label="langLabel"><button class="lng" type="button" data-l="en" aria-pressed="true">English</button><button class="lng" type="button" data-l="es" aria-pressed="false">Español</button></div>
    <button class="tbtn" id="stopsBtn" type="button" aria-pressed="true">Word Stops: On</button>
    <button class="tbtn off" id="a11yBtn" type="button" aria-expanded="false" aria-controls="a11y" data-i18n="a11yBtn">Accessibility</button>
    <button class="tbtn off" id="gameBtn" type="button" aria-pressed="false" title="Optional add-on: glow jar, badges, streaks, word bank">Game features: Off</button>
  </div>
  <div class="srcrow"><label for="passageSel" data-i18n="passageLbl">Passage</label><select id="passageSel"></select></div>
  <div class="tabs" role="tablist" aria-label="Grade band mode" id="tabs"></div>
</div></div>
<div class="a11y" id="a11y" hidden><div class="in">
  <fieldset><legend data-i18n="szLegend">Text size</legend>
    <label><input type="radio" name="a-size" id="a-size-m" value="m" checked> <span data-i18n="szM">Default</span></label>
    <label><input type="radio" name="a-size" id="a-size-l" value="l"> <span data-i18n="szL">Large</span></label>
    <label><input type="radio" name="a-size" id="a-size-xl" value="xl"> <span data-i18n="szXL">Extra large</span></label></fieldset>
  <fieldset><legend data-i18n="rdLegend">Reading</legend>
    <label><input type="checkbox" id="a-font"> <span data-i18n="font">Easy-to-read font</span></label>
    <label><input type="checkbox" id="a-spacing"> <span data-i18n="spacing">Wider line and letter spacing</span></label>
    <label><input type="checkbox" id="a-sentence"> <span data-i18n="sentence">Highlight the whole sentence too</span></label>
    <label><input type="checkbox" id="a-strip"> <span data-i18n="strip">Reading strip (one line at a time)</span></label></fieldset>
  <fieldset><legend data-i18n="thLegend">Color theme</legend>
    <label><input type="radio" name="a-theme" id="a-theme-auto" value="auto" checked> <span data-i18n="thAuto">Match my device</span></label>
    <label><input type="radio" name="a-theme" id="a-theme-light" value="light"> <span data-i18n="thLight">Light</span></label>
    <label><input type="radio" name="a-theme" id="a-theme-dark" value="dark"> <span data-i18n="thDark">Dark</span></label></fieldset>
  <fieldset><legend data-i18n="dpLegend">Display and motion</legend>
    <label><input type="checkbox" id="a-contrast"> <span data-i18n="contrast">High contrast</span></label>
    <label><input type="checkbox" id="a-motion"> <span data-i18n="motion">Reduce motion</span></label>
    <label><input type="checkbox" id="a-follow" checked> <span data-i18n="follow">Keep the current word in view</span></label>
    <label><input type="checkbox" id="a-readq"> <span data-i18n="readq">Read questions and answers aloud</span></label></fieldset>
  <div class="keys"><b data-i18n="kbd">Keyboard</b><span data-i18n-html="kSpace"><kbd>Space</kbd> play / pause</span><span data-i18n-html="kSent"><kbd>Shift</kbd> <kbd>←</kbd> <kbd>→</kbd> previous / next sentence</span><span data-i18n-html="kArrows"><kbd>←</kbd> <kbd>→</kbd> back / forward 5 s</span><span data-i18n-html="kTab"><kbd>Tab</kbd> then <kbd>Enter</kbd> opens a word</span><button class="chipbtn" type="button" id="a-reset" data-i18n="reset">Reset</button></div>
</div></div>

<section id="admin" class="admin" aria-label="Admin" hidden></section>

<div class="main"><div class="in">
  <section class="col" id="col" aria-label="Passage">
    <div class="viewtabs" id="viewTabs" role="tablist" hidden><button type="button" role="tab" id="vtP" aria-selected="true"><span data-i18n="vtPassage">Passage</span></button><button type="button" role="tab" id="vtQ" aria-selected="false"><span data-i18n="vtQuestions">Questions</span> <span id="vtQn"></span></button></div>
    <div class="player">
      <div class="audio" id="audioPill">
        <div class="ctl">
          <button class="pbtn skip" id="prevS" type="button" aria-label="Previous sentence" title="Previous sentence" data-i18n-label="prevS"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg></button>
          <button class="pbtn skip" id="back5" type="button" aria-label="Back 5 seconds" title="Back 5 seconds" data-i18n-label="back5"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4h4"/><text x="12" y="15.5" text-anchor="middle" font-size="8" font-family="Arial" fill="currentColor" stroke="none">5</text></svg></button>
          <button class="pbtn" id="play" type="button" aria-label="Play">▶</button>
          <button class="pbtn skip" id="fwd5" type="button" aria-label="Forward 5 seconds" title="Forward 5 seconds" data-i18n-label="fwd5"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4h-4"/><text x="12" y="15.5" text-anchor="middle" font-size="8" font-family="Arial" fill="currentColor" stroke="none">5</text></svg></button>
          <button class="pbtn skip" id="nextS" type="button" aria-label="Next sentence" title="Next sentence" data-i18n-label="nextS"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg></button>
          <button class="pbtn" id="loopBtn" type="button" aria-pressed="false" aria-label="Repeat this sentence" title="Repeat this sentence" data-i18n-label="loopLbl"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg></button>
          <button class="pbtn" id="voiceBtn" type="button" aria-label="Voice on" aria-pressed="true"></button>
        </div>
        <div class="scrub"><span class="time" id="tCur">0:00</span><div class="scrubwrap"><div class="ticks" id="ticks"></div><input id="seek" class="seek" type="range" min="0" max="1000" value="0" step="1" aria-label="Seek" data-i18n-label="seekLbl" disabled></div><span class="time" id="tLeft">-0:00</span></div>
        <span class="time" id="time" hidden></span><span class="track" hidden><i id="prog"></i></span>
      </div>
      <label class="chipbtn" for="speed"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="8" r="6.5"/><path d="M8 4.5V8l2.5 1.5"/></svg><span data-i18n="speed">Speed</span>
        <select id="speed" style="border:0;font:inherit;font-size:16px;background:transparent;color:inherit"><option value="0.75">0.75x</option><option value="1" selected>1x</option><option value="1.25">1.25x</option><option value="1.5">1.5x</option></select>
      </label>
      <label class="chipbtn" for="voice"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="5" r="2.6"/><path d="M3 14c.6-2.8 2.5-4 5-4s4.4 1.2 5 4"/></svg><span data-i18n="voiceLbl">Voice</span>
        <select id="voice" style="border:0;font:inherit;font-size:16px;background:transparent;color:inherit"></select></label>
      <label class="chipbtn" for="support"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 13V9m4 4V4m4 9V7m3 6V2"/></svg><span data-i18n="supportLbl">Support</span>
        <select id="support" style="border:0;font:inherit;font-size:16px;background:transparent;color:inherit"><option value="listen"></option><option value="follow"></option><option value="echo"></option><option value="yours"></option></select></label>
      <button class="chipbtn" id="restart" type="button" data-i18n="restart">Start over</button>
      <button class="chipbtn" id="rateBtn" type="button" data-i18n="rateBtn">Rate</button>
      <button class="chipbtn" id="darkBtn" type="button" aria-pressed="false" hidden data-i18n="dark">Dark reading</button>
    </div>
    <div class="echobar" id="echoBar" hidden role="status"><span id="echoMsg"></span><button class="chipbtn" id="echoAgain" type="button" data-i18n="echoAgain"></button><button class="tbtn" id="echoNext" type="button" data-i18n="echoNext"></button><button class="chipbtn" id="echoSent" type="button" data-i18n="echoSent"></button></div>
    <div class="legend"><span><i class="d"></i><span data-i18n="lg1">Word Stop: tap for a question</span></span><span><i class="u"></i><span data-i18n="lg2">Vocabulary word: tap for its card</span></span></div>
    <p class="supnote" id="supNote"></p>
    <div class="passage" id="page"></div>
    <section id="qsec" class="qsec" hidden aria-label="Questions"></section>
  </section>

  <aside class="side" id="side" aria-label="Words and details"><button class="sideclose" id="sideClose" type="button" aria-label="Close panel" data-i18n-label="panelClose">✕</button>
    <div><h2 id="stopTitle">Word Stop</h2><div class="stopbox idle" id="stopBox" aria-live="polite"></div></div>
    <div id="rewardWrap"><h2 id="rewardTitle"></h2><div class="reward" id="reward"></div></div>
    <div><h2 data-i18n="hCard">Word card</h2><div id="cardBody" aria-live="polite"></div></div>
    <div><h2 data-i18n="hDetails">Details</h2><div class="dl" id="details"></div></div>
    <div><h2 data-i18n="hBands">By grade band</h2><ul class="bands" id="bands"></ul></div>
  </aside>
</div></div>

<button class="sidetab" id="sideTab" type="button" aria-controls="side" aria-expanded="false"><span data-i18n="panelTab">Word panel</span></button>
<div id="sideBackdrop"></div>

<footer><div class="in">
  <p data-i18n-html="foot1">Passage text, grade, Lexile, vocabulary, questions and sample answers come from ReadWorks' public passage data. Illustrations are original drawings. Spanish text is a machine-translated draft that has not been reviewed.</p>
  <p data-i18n-html="foot2"><strong>Why guess first.</strong> A meta-analysis of 21 studies found instruction in working out word meaning from context had a 0.43 SD effect, and direct clue instruction did best (<a href="https://pedagogischestudien.nl/article/download/14910/16362" target="_blank" rel="noopener">Fukkink &amp; de Glopper, 1998</a>).</p>
  <p data-i18n-html="foot3"><strong>Sources:</strong>
    <a href="https://www.readworks.org/article/Lets-Meet-a-Park-Caretaker/2b781dab-4521-40d2-a9b6-ad5f2bb0ba98" target="_blank" rel="noopener">Let's Meet a Park Caretaker</a> ·
    <a href="https://www.readworks.org/article/A-Very-Messy-Tea-Party/5af24980-4d6d-41c1-87fa-4f21cb2d169d" target="_blank" rel="noopener">A Very Messy Tea Party</a> ·
    <a href="https://www.readworks.org/article/Excerpt-from-Pride-and-Prejudice/ff1d34c9-14f1-4e78-b509-6568dc912a17" target="_blank" rel="noopener">Excerpt from Pride and Prejudice</a></p>
</div></footer>
  </div>
</template>
