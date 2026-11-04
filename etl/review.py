"""Stage 2 review page: listen to and check every generated passage.

Builds one self-contained HTML file, <sa-dir>/review.html, from the pipeline
output already on disk (product JSON, gzipped timing, marks, Polly input).
For each passage: an audio player that highlights each word from the timing
file (click a word to jump to it), the QA numbers, basic tie-out checks, the
exact SSML sent to Polly, and a link to the same passage in the Vue player.

Open it from disk, or with the Vite dev server running at /sa/review.html.

Usage:
    python review.py                      # default sa dir: frontend/public/sa
    python review.py --sa-dir <dir> --ids rws-e1-en,rws-e1-es
"""

from __future__ import annotations

import argparse
import gzip
import html
import json
import sys
from pathlib import Path

DEFAULT_SA_DIR = Path(__file__).resolve().parent.parent / "frontend" / "public" / "sa"


def _load(sa: Path, pid: str) -> dict | None:
    prod_path = sa / "product" / f"{pid}.soundAlong.json"
    if not prod_path.exists():
        return None
    prod = json.loads(prod_path.read_text(encoding="utf-8"))
    tr = prod["tracks"][0]
    timing_raw = (sa / tr["timingKey"]).read_bytes()
    try:
        timing = json.loads(gzip.decompress(timing_raw))
    except OSError:
        timing = json.loads(timing_raw)
    base = sa / Path(tr["audioKey"]).parent
    ssml = next((p.read_text(encoding="utf-8") for p in sorted(base.glob("tts-1.input.*"))), "")
    return {"prod": prod, "track": tr, "timing": timing, "input": ssml}


def checks(item: dict) -> list[tuple[str, bool, str]]:
    """Basic hard checks: the output belongs to its input and the player can use it."""
    prod, tr, tm = item["prod"], item["track"], item["timing"]
    qa, start, end = tr["qa"], tm["start"], tm["end"]
    dur = tm.get("durationMs", qa.get("durationMs", 0))
    polly_s, ssml_s = qa.get("pollySentences"), qa.get("ssmlSentences")
    return [
        ("player will use timing (qa.status == passed)", qa["status"] == "passed", qa["status"]),
        ("textHash matches product", tm["textHash"] == prod["textHash"], ""),
        ("one time per word (n == tokenCount)", tm["n"] == prod["tokenCount"] == len(start),
         f"{tm['n']} / {prod['tokenCount']}"),
        ("times only move forward", all(a <= b for a, b in zip(start, start[1:])), ""),
        ("every word starts before the audio ends", bool(start) and start[-1] < dur, f"{dur} ms"),
        ("last word ends with the audio", bool(end) and end[-1] == dur, ""),
        ("every word has its own Polly mark", not qa.get("lowConfidence"),
         f"{len(qa.get('lowConfidence', []))} estimated"),
        ("Polly heard the intended sentences", ssml_s is None or polly_s == ssml_s,
         f"Polly {polly_s} / SSML {ssml_s} / tokenizer {qa.get('sentences')}"),
    ]


_CSS = """
:root{--bg:#f6f8f9;--card:#fff;--ink:#17252b;--mut:#5a6b72;--line:#d9e1e4;--acc:#007693;--hi:#ffe066;--ok:#1d7442;--bad:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#0f1618;--card:#162125;--ink:#e2ebee;--mut:#98a9af;--line:#2a3a3f;--acc:#4fb8d3;--hi:#806600;--ok:#7fd6a2;--bad:#f2a49d}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,Segoe UI,sans-serif}
main{max-width:1100px;margin:0 auto;padding:16px}h1{font-size:24px;margin:8px 0}p.mut,.mut{color:var(--mut)}
table{border-collapse:collapse;width:100%;font-size:13px;background:var(--card)}th,td{border:1px solid var(--line);padding:4px 6px;text-align:left}
.ok{color:var(--ok);font-weight:600}.bad{color:var(--bad);font-weight:600}
section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:14px 0}
section h2{font-size:17px;margin:0 0 4px}audio{width:100%;margin:8px 0}
.text p{margin:6px 0}.text [data-w]{cursor:pointer;border-radius:3px;padding:0 1px}
.text [data-w].on{background:var(--hi)}.text [data-w].est{text-decoration:underline dotted var(--bad)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:4px 16px;font-size:13px}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;background:var(--bg);padding:8px;border-radius:6px}
a{color:var(--acc)}
"""

_JS = """
const lastAtOrBefore=(a,t)=>{let lo=0,hi=a.length-1,r=-1;while(lo<=hi){const m=(lo+hi)>>1;if(a[m]<=t){r=m;lo=m+1}else hi=m-1}return r};
document.querySelectorAll('section[data-id]').forEach(sec=>{
  const tm=JSON.parse(sec.querySelector('script.timing').textContent);
  const au=sec.querySelector('audio');const words=[...sec.querySelectorAll('.text [data-w]')];
  const byI=[];words.forEach(w=>byI[+w.dataset.w]=w);(tm.est||[]).forEach(i=>byI[i]&&byI[i].classList.add('est'));
  let cur=-1;const set=i=>{if(i===cur)return;if(byI[cur])byI[cur].classList.remove('on');cur=i;if(byI[i])byI[i].classList.add('on')};
  const tick=()=>{set(lastAtOrBefore(tm.start,au.currentTime*1000));if(!au.paused)requestAnimationFrame(tick)};
  au.addEventListener('play',()=>requestAnimationFrame(tick));au.addEventListener('seeked',tick);
  words.forEach(w=>w.addEventListener('click',()=>{au.currentTime=tm.start[+w.dataset.w]/1000;au.play()}));
});
"""


def build_review(sa_dir: Path | str = DEFAULT_SA_DIR, ids: list[str] | None = None) -> Path:
    sa = Path(sa_dir)
    if ids is None:
        ids = sorted(p.name[: -len(".soundAlong.json")] for p in (sa / "product").glob("*.soundAlong.json"))
    items = [(pid, _load(sa, pid)) for pid in ids]
    items = [(pid, it) for pid, it in items if it]

    rows, sections, total_cost = [], [], 0.0
    for pid, it in items:
        prod, tr, tm = it["prod"], it["track"], it["timing"]
        qa, gen = tr["qa"], prod.get("generation", {})
        cs = checks(it)
        fails = [c for c in cs if not c[1]]
        cost = gen.get("estCostUsd") or 0.0
        total_cost += cost
        e = html.escape
        rows.append(
            f"<tr><td><a href='#{e(pid)}'>{e(pid)}</a></td><td>{e(prod.get('lang',''))}</td>"
            f"<td>{e(tr.get('voiceId',''))}</td><td>{prod['tokenCount']}</td>"
            f"<td>{len(qa.get('lowConfidence', []))}</td>"
            f"<td>{qa.get('pollySentences')} / {qa.get('ssmlSentences')}</td>"
            f"<td>{tm.get('durationMs', qa.get('durationMs', 0)) / 1000:.1f}s</td>"
            f"<td>${cost:.4f}</td>"
            f"<td class='{'ok' if not fails else 'bad'}'>{'all pass' if not fails else f'{len(fails)} fail'}</td></tr>"
        )
        check_html = "".join(
            f"<div><span class='{'ok' if ok else 'bad'}'>{'✓' if ok else '✗'}</span> {e(name)}"
            f"{' <span class=mut>(' + e(detail) + ')</span>' if detail else ''}</div>"
            for name, ok, detail in cs
        )
        timing_js = json.dumps({"start": tm["start"], "est": qa.get("lowConfidence", [])}).replace("</", "<\\/")
        settings = tr.get("settings", {})
        sections.append(f"""
<section id="{e(pid)}" data-id="{e(pid)}">
  <h2>{e(prod.get('title', pid))}</h2>
  <div class="mut">{e(pid)} · {e(tr.get('voiceId',''))} ({e(tr.get('engine',''))}) · {e(tr.get('configVersion',''))}
   · <a href="../?m={e(pid)}">open in Vue player</a> (needs <code>npm run dev</code>)</div>
  <audio controls preload="auto" src="{e(tr['audioKey'])}"></audio>
  <div class="text">{prod['contentTokenized']}</div>
  <p class="mut">Click any word to play from it. Highlight follows the timing file; dotted-underlined words had no Polly mark (time estimated).</p>
  <div class="grid">{check_html}</div>
  <div class="grid mut" style="margin-top:6px">
   <div>rate {e(str(settings.get('rate')))} · DRC {e(str(settings.get('drc')))} · break {e(str(settings.get('paragraphBreakMs')))} ms</div>
   <div>lexicon {e(str(tr.get('lexicon')))} ({e(str(settings.get('lexiconMode')))}) · overrides {e(str(settings.get('pronunciationOverrides', 0)))}</div>
   <div>billed {gen.get('billedChars', '?')} chars · ${cost:.4f}</div>
   <div>merged sentence breaks: {e(str(qa.get('mergedSentenceBreaks', [])))}</div>
  </div>
  <details><summary>Exact input sent to Polly</summary><pre>{e(it['input'])}</pre></details>
  <script type="application/json" class="timing">{timing_js}</script>
</section>""")

    page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Stage 2 Review</title>
<style>{_CSS}</style></head><body><main>
<h1>Stage 2 audio review</h1>
<p class="mut">{len(items)} passage(s) · estimated Polly cost ${total_cost:.4f}. Listen to each one, watch the highlight, and note anything mispronounced or paused oddly.</p>
<table><thead><tr><th>id</th><th>lang</th><th>voice</th><th>words</th><th>estimated</th><th>sentences Polly/SSML</th><th>length</th><th>cost</th><th>checks</th></tr></thead>
<tbody>{''.join(rows)}</tbody></table>
{''.join(sections)}
</main><script>{_JS}</script></body></html>"""
    out = sa / "review.html"
    out.write_text(page, encoding="utf-8")
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Build the Stage 2 review page.")
    ap.add_argument("--sa-dir", default=str(DEFAULT_SA_DIR))
    ap.add_argument("--ids", help="comma-separated passage ids (default: all)")
    args = ap.parse_args(argv)
    ids = [i.strip() for i in args.ids.split(",")] if args.ids else None
    print(f"Wrote {build_review(args.sa_dir, ids)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
