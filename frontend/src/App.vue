<script setup>
import { onMounted } from 'vue'
import { init } from './engine.js'

onMounted(init)
</script>

<template>
  <div v-pre>
<div class="top"><div class="in">
  <span class="name">Sound Along</span><span class="sub" data-i18n="topSub">Word Stops concept</span>
  <span class="pill" data-i18n="pill">Concept mockup · not a live ReadWorks feature</span>
  <button class="themebtn" id="themeBtn" type="button" aria-pressed="false"></button>
</div></div>

<div class="bandrow"><div class="in">
  <div class="titlerow">
    <h1 id="ptitle"></h1>
    <div class="lngwrap" role="group" aria-label="Passage language" data-i18n-label="langLabel"><button class="lng" type="button" data-l="en" aria-pressed="true">English</button><button class="lng" type="button" data-l="es" aria-pressed="false">Español</button></div><span class="lngnote" id="langNote" hidden>Spanish demo: K–2 tab</span>
    <button class="tbtn" id="stopsBtn" type="button" aria-pressed="true">Word Stops: On</button>
    <button class="tbtn off" id="a11yBtn" type="button" aria-expanded="false" aria-controls="a11y" data-i18n="a11yBtn">Accessibility</button>
    <button class="tbtn off" id="gameBtn" type="button" aria-pressed="false" title="Optional add-on: glow jar, badges, streaks, word bank">Game features: Off</button>
  </div>
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
  <div class="keys"><b data-i18n="kbd">Keyboard</b><span data-i18n-html="kSpace"><kbd>Space</kbd> play / pause</span><span data-i18n-html="kArrows"><kbd>←</kbd> <kbd>→</kbd> back / forward 5 s</span><span data-i18n-html="kTab"><kbd>Tab</kbd> then <kbd>Enter</kbd> opens a word</span><button class="chipbtn" type="button" id="a-reset" data-i18n="reset">Reset</button></div>
</div></div>

<div class="main"><div class="in">
  <section class="col" id="col" aria-label="Passage">
    <div class="player">
      <div class="audio">
        <button class="pbtn skip" id="back5" type="button" aria-label="Back 5 seconds" title="Back 5 seconds" data-i18n-label="back5"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4h4"/><text x="12" y="15.5" text-anchor="middle" font-size="8" font-family="Arial" fill="currentColor" stroke="none">5</text></svg></button>
        <button class="pbtn" id="play" type="button" aria-label="Play">▶</button>
        <button class="pbtn skip" id="fwd5" type="button" aria-label="Forward 5 seconds" title="Forward 5 seconds" data-i18n-label="fwd5"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4h-4"/><text x="12" y="15.5" text-anchor="middle" font-size="8" font-family="Arial" fill="currentColor" stroke="none">5</text></svg></button>
        <span class="time" id="time">0 / 0</span>
        <span class="track"><i id="prog"></i></span>
        <button class="pbtn" id="voiceBtn" type="button" aria-label="Voice on" aria-pressed="true"></button>
      </div>
      <label class="chipbtn" for="speed"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="8" r="6.5"/><path d="M8 4.5V8l2.5 1.5"/></svg><span data-i18n="speed">Speed</span>
        <select id="speed" style="border:0;font:inherit;font-size:15px;background:transparent;color:inherit"><option value="0.8">0.8x</option><option value="1" selected>1x</option><option value="1.2">1.2x</option></select>
      </label>
      <button class="chipbtn" id="restart" type="button" data-i18n="restart">Start over</button>
      <button class="chipbtn" id="darkBtn" type="button" aria-pressed="false" hidden data-i18n="dark">Dark reading</button>
    </div>
    <div class="legend"><span><i class="d"></i><span data-i18n="lg1">Word Stop: tap for a question</span></span><span><i class="u"></i><span data-i18n="lg2">Vocabulary word: tap for its card</span></span></div>
    <div class="passage" id="page"></div>
  </section>

  <aside class="side">
    <div><h2 id="stopTitle">Word Stop</h2><div class="stopbox idle" id="stopBox" aria-live="polite"></div></div>
    <div id="rewardWrap"><h2 id="rewardTitle"></h2><div class="reward" id="reward"></div></div>
    <div><h2 data-i18n="hCard">Word card</h2><div id="cardBody" aria-live="polite"></div></div>
    <div><h2 data-i18n="hDetails">Details</h2><div class="dl" id="details"></div></div>
    <div><h2 data-i18n="hBands">By grade band</h2><ul class="bands" id="bands"></ul></div>
  </aside>
</div></div>

<footer><div class="in">
  <p data-i18n-html="foot1"><strong>About this mockup.</strong> The ReadWorks page frame stays the same in every band; only the Word Stop layer changes look. It is a hackathon concept, not a ReadWorks product. Glow, the badges and all illustrations are original drawings for this demo. Passage text, grade, Lexile, vocabulary, definitions, examples, synonyms and Spanish come from ReadWorks' public passage data. The voice is the browser's built-in speech with estimated word timing; the build would use Polly audio and word timestamps. Teachers would set the band per assignment; students never see a grade label.</p>
  <p data-i18n-html="foot2"><strong>Why guess first.</strong> A meta-analysis of 21 studies found instruction in working out word meaning from context had a 0.43 SD effect, and direct clue instruction did best (<a href="https://pedagogischestudien.nl/article/download/14910/16362" target="_blank" rel="noopener">Fukkink &amp; de Glopper, 1998</a>).</p>
  <p data-i18n-html="foot3"><strong>Sources:</strong>
    <a href="https://www.readworks.org/article/Lets-Meet-a-Park-Caretaker/2b781dab-4521-40d2-a9b6-ad5f2bb0ba98" target="_blank" rel="noopener">Let's Meet a Park Caretaker</a> ·
    <a href="https://www.readworks.org/article/A-Very-Messy-Tea-Party/5af24980-4d6d-41c1-87fa-4f21cb2d169d" target="_blank" rel="noopener">A Very Messy Tea Party</a> ·
    <a href="https://www.readworks.org/article/Excerpt-from-Pride-and-Prejudice/ff1d34c9-14f1-4e78-b509-6568dc912a17" target="_blank" rel="noopener">Excerpt from Pride and Prejudice</a></p>
</div></footer>
  </div>
</template>
