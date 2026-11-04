"""Stage 2 review page: listen to and check every generated passage and voice.

Builds one self-contained HTML file, <sa-dir>/review.html, from the pipeline
output already on disk (product JSON, gzipped timing, Polly input). For each
passage it shows the text once and one player per voice track (e.g. tts-1
female, tts-2 male). The highlight follows whichever voice is playing, and
clicking a word plays from it in the last-used voice. Also shows QA numbers,
basic tie-out checks per track, the exact SSML sent to Polly, and a link to
the same passage in the Vue player.

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


def _read_timing(path: Path) -> dict:
    raw = path.read_bytes()
    try:
        return json.loads(gzip.decompress(raw))
    except OSError:
        return json.loads(raw)


def _load(sa: Path, pid: str) -> dict | None:
    prod_path = sa / "product" / f"{pid}.soundAlong.json"
    if not prod_path.exists():
        return None
    prod = json.loads(prod_path.read_text(encoding="utf-8"))
    tracks = []
    for tr in prod["tracks"]:
        base = sa / Path(tr["audioKey"]).parent
        inp = next((p.read_text(encoding="utf-8")
                    for p in sorted(base.glob(f"{tr['id']}.input.*"))), "")
        tracks.append({"track": tr, "timing": _read_timing(sa / tr["timingKey"]), "input": inp})
    return {"prod": prod, "tracks": tracks}


def checks(prod: dict, item: dict) -> list[tuple[str, bool, str]]:
    """Basic hard checks: the output belongs to its input and the player can use it."""
    tr, tm = item["track"], item["timing"]
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
main{max-width:1100px;margin:0 auto;padding:16px}h1{font-size:24px;margin:8px 0}.mut{color:var(--mut)}
.tablewrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13px;background:var(--card)}th,td{border:1px solid var(--line);padding:4px 6px;text-align:left}
.ok{color:var(--ok);font-weight:600}.bad{color:var(--bad);font-weight:600}
section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:14px 0}
section h2{font-size:17px;margin:0 0 4px}.voice{border-top:1px solid var(--line);margin-top:10px;padding-top:8px}
.voice h3{font-size:14px;margin:0}audio{width:100%;margin:6px 0}
.text p{margin:6px 0}.text [data-w]{cursor:pointer;border-radius:3px;padding:0 1px}
.text [data-w].on{background:var(--hi)}.text [data-w].est{text-decoration:underline dotted var(--bad)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:4px 16px;font-size:13px}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;background:var(--bg);padding:8px;border-radius:6px}
a{color:var(--acc)}
"""

_JS = """
const lastAtOrBefore=(a,t)=>{let lo=0,hi=a.length-1,r=-1;while(lo<=hi){const m=(lo+hi)>>1;if(a[m]<=t){r=m;lo=m+1}else hi=m-1}return r};
document.querySelectorAll('section[data-id]').forEach(sec=>{
  const words=[...sec.querySelectorAll('.text [data-w]')];const byI=[];words.forEach(w=>byI[+w.dataset.w]=w);
  const voices=[...sec.querySelectorAll('.voice')].map(v=>({au:v.querySelector('audio'),tm:JSON.parse(v.querySelector('script.timing').textContent)}));
  let active=voices[0],cur=-1;
  const mark=v=>{words.forEach(w=>w.classList.remove('est'));(v.tm.est||[]).forEach(i=>byI[i]&&byI[i].classList.add('est'))};
  const set=i=>{if(i===cur)return;if(byI[cur])byI[cur].classList.remove('on');cur=i;if(byI[i])byI[i].classList.add('on')};
  voices.forEach(v=>{
    const tick=()=>{if(active!==v)return;set(lastAtOrBefore(v.tm.start,v.au.currentTime*1000));if(!v.au.paused)requestAnimationFrame(tick)};
    v.au.addEventListener('play',()=>{voices.forEach(o=>{if(o!==v)o.au.pause()});active=v;mark(v);requestAnimationFrame(tick)});
    v.au.addEventListener('seeked',tick);
  });
  if(active)mark(active);
  words.forEach(w=>w.addEventListener('click',()=>{const v=active;v.au.currentTime=v.tm.start[+w.dataset.w]/1000;v.au.play()}));
});
"""


def build_review(sa_dir: Path | str = DEFAULT_SA_DIR, ids: list[str] | None = None) -> Path:
    sa = Path(sa_dir)
    if ids is None:
        ids = sorted(p.name[: -len(".soundAlong.json")] for p in (sa / "product").glob("*.soundAlong.json"))
    items = [(pid, _load(sa, pid)) for pid in ids]
    items = [(pid, it) for pid, it in items if it]
    e = html.escape

    rows, sections, total_cost = [], [], 0.0
    for pid, it in items:
        prod = it["prod"]
        total_cost += prod.get("generation", {}).get("estCostUsd") or 0.0
        voice_blocks = []
        for t in it["tracks"]:
            tr, tm = t["track"], t["timing"]
            qa, settings = tr["qa"], tr.get("settings", {})
            cs = checks(prod, t)
            fails = [c for c in cs if not c[1]]
            cost = qa.get("estCostUsd") or 0.0
            label = f"{tr['id']} · {tr.get('voiceId', '')}" + (f" ({tr['voiceGender']})" if tr.get("voiceGender") else "")
            rows.append(
                f"<tr><td><a href='#{e(pid)}'>{e(pid)}</a></td><td>{e(tr['id'])}</td>"
                f"<td>{e(tr.get('voiceId', ''))}</td><td>{prod['tokenCount']}</td>"
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
            voice_blocks.append(f"""
  <div class="voice" data-track="{e(tr['id'])}">
   <h3>{e(label)}{' · default' if tr.get('default', True) else ''}</h3>
   <audio controls preload="metadata" src="{e(tr['audioKey'])}"></audio>
   <div class="grid">{check_html}</div>
   <div class="grid mut" style="margin-top:4px">
    <div>{e(tr.get('configVersion', ''))}</div>
    <div>lexicon {e(str(tr.get('lexicon')))} ({e(str(settings.get('lexiconMode')))}) · overrides {e(str(settings.get('pronunciationOverrides', 0)))}</div>
    <div>billed {qa.get('billedChars', '?')} chars · ${cost:.4f}</div>
   </div>
   <details><summary>Exact input sent to Polly</summary><pre>{e(t['input'])}</pre></details>
   <script type="application/json" class="timing">{timing_js}</script>
  </div>""")
        merged = it["tracks"][0]["track"]["qa"].get("mergedSentenceBreaks", [])
        sections.append(f"""
<section id="{e(pid)}" data-id="{e(pid)}">
  <h2>{e(prod.get('title', pid))}</h2>
  <div class="mut">{e(pid)} · <a href="../?m={e(pid)}">open in Vue player</a> (default voice; needs <code>npm run dev</code>)
   · merged sentence breaks: {e(str(merged))}</div>
  <div class="text">{prod['contentTokenized']}</div>
  <p class="mut">Play a voice below; the highlight follows it. Click any word to play from it in the last-used voice.
   Dotted-underlined words had no Polly mark for that voice (time estimated).</p>
  {''.join(voice_blocks)}
</section>""")

    page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Stage 2 Review</title>
<style>{_CSS}</style></head><body><main>
<h1>Stage 2 audio review</h1>
<p class="mut">{len(items)} passage(s) · estimated Polly cost ${total_cost:.4f}. Listen to each voice, watch the highlight, and note anything mispronounced or paused oddly.</p>
<div class="tablewrap"><table><thead><tr><th>id</th><th>track</th><th>voice</th><th>words</th><th>estimated</th><th>sentences Polly/SSML</th><th>length</th><th>cost</th><th>checks</th></tr></thead>
<tbody>{''.join(rows)}</tbody></table></div>
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
