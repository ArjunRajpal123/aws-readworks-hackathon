#!/usr/bin/env python3
"""Fill in the Spanish side of the content export before it is seeded.

Many `es` modes in the export (rwf-*-35es, g-*-es) were placeholders: Spanish
chrome (tab, how, details) around the English passage, Word Stops, questions
and vocab cards. This script translates each of those with Bedrock (Claude),
keeping the player's passage markup intact, and writes a new export that
seed_content.py loads unchanged:

  - es mode: title, paras (same *vocab, ^stop, ~N/-N/=N markers), Word Stops,
    questions, `forms` pointing at new Spanish cards, Spanish audio ids
  - cards: one `<key>_es` card per English card those passages use
  - catalog: every entry gains `es: {title, vocab}` so lists, the family
    views and word practice can show the Spanish title and words
  - rw-*es sentence modes: Spanish titles

Each passage is translated once and cached (--cache), so re-runs only call
Bedrock for what is missing or failed validation.

    uv run --with boto3 python lambda/scripts/localize_content.py \
        --content /tmp/sa-content.json --out /tmp/sa-content-es.json
"""
from __future__ import annotations

import argparse
import copy
import json
import re
import sys
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import boto3

MODEL_ID = "global.anthropic.claude-sonnet-5-5"
REGION = "us-west-2"
MOVES_ES = {"Word parts": "Partes de la palabra", "Restatement": "Reformulación",
            "Definition": "Definición", "Contrast": "Contraste"}

SYSTEM = """You translate children's reading passages and their learning material from English \
into natural Latin American Spanish for students in US schools, at the same grade level and \
reading difficulty as the original. You return only JSON, in exactly the shape you are given."""

PASSAGE_PROMPT = """Translate this passage bundle into Spanish. Return the SAME JSON shape with every \
English string translated, plus a "forms" object (see below).

Passage markup rules (critical, a program parses these):
- A word starting with "*" is a vocabulary word. Put "*" directly before the ONE Spanish word that \
translates it (for a multi-word translation, the main word). Same number of "*" words per paragraph.
- A word ending with "^" marks a pause point. Put "^" at the end of the Spanish word that ends the \
same sentence or clause. Same number of "^" per paragraph.
- Prefixes "~N", "-N", "=N" (a symbol followed by one digit, e.g. "~1word", "-2word") mark clue, \
contrast and signal words. Put the same prefix on the corresponding Spanish word. Same count per paragraph.
- Markers can stack on one word (e.g. "*~1word^"); keep them stacked in the same order.
- Never add markup that is not in the original. Keep the same number of paragraphs.

Other fields:
- "cards": each key is a vocab card. Translate "word" to the Spanish word used in the passage \
(dictionary form, lowercase), "pos" to a Spanish part of speech (sustantivo, verbo, adjetivo, \
adverbio), and "def"/"ex" to kid-friendly Spanish ("ex" may stay empty if it was empty).
- "forms": an object mapping EVERY "*"-marked Spanish word in your paras (lowercase, without the \
"*" and punctuation, exactly as written) to the card key it belongs to.
- "stops": translate q, choices, right, rightPlain, wrong, clue, say and each note's k and html \
(keep HTML tags). Keep the correct answer the same.
- "questions": paras[0] is the question, the rest are answer options; keep each "A. "/"B. " \
prefix. Translate "sample" too when present.
- "catalog_vocab": translate w (to the same Spanish word as the matching card), def and ex.

Bundle:
"""

SMALL_PROMPT = """Translate every English string value in this JSON into natural Latin American \
Spanish for US students. Keep keys and structure identical. For vocabulary lists, "w" is the \
Spanish word, "def" and "ex" kid-friendly Spanish. Return only JSON.

"""

_rt = None


def bedrock():
    global _rt
    if _rt is None:
        _rt = boto3.client("bedrock-runtime", region_name=REGION)
    return _rt


def ask(prompt, payload, max_tokens=32000):
    resp = bedrock().converse(
        modelId=MODEL_ID,
        system=[{"text": SYSTEM}],
        messages=[{"role": "user", "content": [{"text": prompt + json.dumps(payload, ensure_ascii=False)}]}],
        inferenceConfig={"maxTokens": max_tokens},
    )
    text = "".join(c.get("text", "") for c in resp["output"]["message"]["content"])
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise ValueError("model did not return JSON")
    return json.loads(m.group(0))


# ---- markup helpers (mirror engine.js parse()/keyFor()) ----------------------
def norm(word):
    w = unicodedata.normalize("NFD", word.lower())
    w = "".join(ch for ch in w if unicodedata.category(ch) != "Mn")
    return re.sub(r"[^a-z]", "", w)


def tokens(para):
    out = []
    for raw in para.split():
        t, cls, stop = raw, [], False
        if t.endswith("^"):
            stop, t = True, t[:-1]
        while True:
            m = re.match(r"^([~\-=])(\d)", t)
            if m:
                cls.append(m.group(1) + m.group(2))
                t = t[2:]
            elif t.startswith("*") and len(t) > 1:
                cls.append("*")
                t = t[1:]
            else:
                break
        out.append((t, cls, stop))
    return out


def markup_sig(para):
    sig = {"*": 0, "^": 0}
    for _, cls, stop in tokens(para):
        sig["^"] += stop
        for c in cls:
            sig[c] = sig.get(c, 0) + 1
    return sig


def starred(paras):
    return [t for p in paras for t, cls, _ in tokens(p) if "*" in cls]


# ---- per-passage translation ------------------------------------------------
def card_keys(mode, cards):
    keys = set((mode.get("forms") or {}).values())
    keys |= {s["word"] for s in mode.get("stops") or []}
    return sorted(k for k in keys if k in cards)


def bundle_for(entry, mode, cards):
    stops = []
    for s in mode.get("stops") or []:
        b = {k: s[k] for k in ("q", "right", "rightPlain", "wrong", "clue", "say") if s.get(k)}
        b["choices"] = [c["t"] for c in s.get("choices", [])]
        b["notes"] = [{"k": n["k"], "html": n["html"]} for n in s.get("notes", [])]
        stops.append(b)
    questions = []
    for q in mode.get("questions") or []:
        b = {"paras": q["paras"]}
        if q.get("sample"):
            b["sample"] = q["sample"]
        questions.append(b)
    return {
        "title": mode["title"],
        "paras": mode["paras"],
        "cards": {k: {f: cards[k].get(f, "") for f in ("word", "pos", "def", "ex")} for k in card_keys(mode, cards)},
        "stops": stops,
        "questions": questions,
        "catalog_vocab": [{f: v.get(f, "") for f in ("w", "def", "ex")} for v in entry.get("vocab", [])],
    }


def validate(src, out):
    errs = []
    if len(out.get("paras", [])) != len(src["paras"]):
        errs.append(f"paras {len(out.get('paras', []))} != {len(src['paras'])}")
    else:
        for i, (a, b) in enumerate(zip(src["paras"], out["paras"])):
            if markup_sig(a) != markup_sig(b):
                errs.append(f"para {i} markup {markup_sig(b)} != {markup_sig(a)}")
    for k in ("stops", "questions", "catalog_vocab"):
        if len(out.get(k, [])) != len(src[k]):
            errs.append(f"{k} count")
    for a, b in zip(src["stops"], out.get("stops", [])):
        if len(b.get("choices", [])) != len(a["choices"]) or len(b.get("notes", [])) != len(a["notes"]):
            errs.append("stop choices/notes count")
    for a, b in zip(src["questions"], out.get("questions", [])):
        if len(b.get("paras", [])) != len(a["paras"]):
            errs.append("question paras count")
    if set(out.get("cards", {})) != set(src["cards"]):
        errs.append("card keys differ")
    forms = {norm(k): v for k, v in (out.get("forms") or {}).items()}
    for w in starred(out.get("paras", [])):
        if forms.get(norm(w)) not in src["cards"]:
            errs.append(f"starred word '{w}' has no card in forms")
    return errs


def translate_passage(entry, mode, cards, cache_dir):
    path = cache_dir / f"{mode['id']}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    src = bundle_for(entry, mode, cards)
    last = None
    for attempt in range(3):
        prompt = PASSAGE_PROMPT
        if last:
            prompt = f"A previous attempt had these problems, fix them: {last}\n\n" + prompt
        try:
            out = ask(prompt, src)
        except Exception as exc:  # noqa: BLE001 - retry on bad JSON / throttling
            last = [str(exc)]
            continue
        last = validate(src, out)
        if not last:
            path.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
            print(f"  ok   {mode['id']}", file=sys.stderr)
            return out
        print(f"  retry {mode['id']} ({attempt + 1}): {last[:3]}", file=sys.stderr)
    raise RuntimeError(f"{mode['id']}: could not get a valid translation: {last}")


def es_audio(aid):
    return re.sub(r"-en$", "-es", aid) if aid else aid


def apply_passage(entry, en, es, tr, cards):
    """Write a translated bundle onto the es mode, its cards and its catalog entry."""
    es_key = {k: f"{k}_es" for k in tr["cards"]}
    for k, c in tr["cards"].items():
        en_card = cards[k]
        cards[es_key[k]] = {"word": c["word"], "pos": c["pos"], "lang": "es", "pair": en_card["word"],
                            "tr": True, "def": c["def"], "ex": c.get("ex", ""), "syn": [], "es": [],
                            "cog": en_card.get("cog", False)}
        if not en_card.get("es"):
            en_card["es"] = [c["word"]]

    es["title"] = tr["title"]
    es["paras"] = tr["paras"]
    es["forms"] = {norm(w): es_key[k] for w, k in tr["forms"].items() if norm(w)}
    es["audio"] = es_audio(en.get("audio"))

    stops = []
    for s, t in zip(en.get("stops") or [], tr["stops"]):
        n = copy.deepcopy(s)
        n["word"] = es_key.get(s["word"], s["word"])
        if n.get("move"):
            n["move"] = MOVES_ES.get(s["move"], s["move"])
        for f in ("q", "right", "rightPlain", "wrong", "clue", "say"):
            if f in t:
                n[f] = t[f]
        for c, ct in zip(n.get("choices", []), t["choices"]):
            c["t"] = ct
        for note, nt in zip(n.get("notes", []), t["notes"]):
            note["k"], note["html"] = nt["k"], nt["html"]
        stops.append(n)
    es["stops"] = stops

    if en.get("questions"):
        qs = []
        for q, t in zip(en["questions"], tr["questions"]):
            n = copy.deepcopy(q)
            n["paras"] = t["paras"]
            if "sample" in t:
                n["sample"] = t["sample"]
            n["audio"] = es_audio(q.get("audio"))
            qs.append(n)
        es["questions"] = qs

    entry["es"] = {"title": tr["title"],
                   "vocab": [{"w": v["w"], "def": v["def"], "ex": v.get("ex", ""), "en": src["w"]}
                             for v, src in zip(tr["catalog_vocab"], entry.get("vocab", []))]}


def is_placeholder(en, es):
    return es is not None and es["paras"] == en["paras"]


def localize(content, cache_dir, workers):
    modes = {m["id"]: m for m in content["modes"]}
    cards = content["cards"]
    catalog = content["catalog"]

    todo = [(e, modes[e["modes"]["en"]], modes[e["modes"]["es"]]) for e in catalog
            if e.get("modes", {}).get("es") in modes and is_placeholder(modes[e["modes"]["en"]], modes[e["modes"]["es"]])]
    print(f"translating {len(todo)} passages", file=sys.stderr)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(lambda x: translate_passage(x[0], x[1], cards, cache_dir), todo))
    for (entry, en, es), tr in zip(todo, results):
        apply_passage(entry, en, es, tr, cards)

    # Entries whose es mode was already Spanish: just the catalog title + vocab.
    rest = [e for e in catalog if "es" not in e]
    small_path = cache_dir / "_catalog_rest.json"
    if small_path.exists():
        small = json.loads(small_path.read_text(encoding="utf-8"))
    else:
        small = ask(SMALL_PROMPT, {e["pid"]: [{f: v.get(f, "") for f in ("w", "def", "ex")} for v in e.get("vocab", [])] for e in rest}, 8000)
        small_path.write_text(json.dumps(small, ensure_ascii=False, indent=1), encoding="utf-8")
    for e in rest:
        es = modes.get((e.get("modes") or {}).get("es"))
        vocab = small.get(e["pid"], [])
        e["es"] = {"title": es["title"] if es else e["title"],
                   "vocab": [{"w": v["w"], "def": v["def"], "ex": v.get("ex", ""), "en": src["w"]}
                             for v, src in zip(vocab, e.get("vocab", []))]}

    # rw-* sentence modes: Spanish text, English title.
    rw_titles = sorted({m["title"] for m in content["modes"] if m["id"].startswith("rw-") and m["lang"] == "es-US"})
    if rw_titles:
        tpath = cache_dir / "_rw_titles.json"
        if tpath.exists():
            tmap = json.loads(tpath.read_text(encoding="utf-8"))
        else:
            tmap = ask(SMALL_PROMPT, {t: t for t in rw_titles}, 2000)
            tpath.write_text(json.dumps(tmap, ensure_ascii=False, indent=1), encoding="utf-8")
        for m in content["modes"]:
            if m["id"].startswith("rw-") and m["lang"] == "es-US":
                m["title"] = tmap.get(m["title"], m["title"])
    return content


def check(content):
    """Every es mode reachable from the catalog must now be Spanish, with resolvable cards."""
    modes = {m["id"]: m for m in content["modes"]}
    cards = content["cards"]
    problems = []
    for e in content["catalog"]:
        en, es = modes[e["modes"]["en"]], modes.get(e["modes"].get("es"))
        if not es:
            problems.append(f"{e['pid']}: no es mode")
            continue
        if es["title"] == en["title"]:
            problems.append(f"{e['pid']}: es title still English")
        if es["paras"] == en["paras"]:
            problems.append(f"{e['pid']}: es text still English")
        # Spanish cards carry `pair` (the English word they translate).
        for k in [s["word"] for s in es.get("stops") or []] + list((es.get("forms") or {}).values()):
            if "pair" not in cards.get(k, {}):
                problems.append(f"{e['pid']}: card {k} is not Spanish")
        if not e.get("es", {}).get("title"):
            problems.append(f"{e['pid']}: catalog has no es title")
    return problems


def main(argv=None):
    ap = argparse.ArgumentParser(description="Translate placeholder Spanish modes in a content export.")
    ap.add_argument("--content", required=True, help="JSON from frontend/scripts/export_content.mjs")
    ap.add_argument("--out", required=True, help="where to write the localized export")
    ap.add_argument("--cache", help="per-passage translation cache dir (default: <out>.cache/)")
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args(argv)

    cache_dir = Path(args.cache or args.out + ".cache")
    cache_dir.mkdir(parents=True, exist_ok=True)
    content = json.loads(Path(args.content).read_text(encoding="utf-8"))
    localize(content, cache_dir, args.workers)
    problems = check(content)
    for p in problems:
        print("PROBLEM", p, file=sys.stderr)
    Path(args.out).write_text(json.dumps(content, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {args.out}", file=sys.stderr)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
