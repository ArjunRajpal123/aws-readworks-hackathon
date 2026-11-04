"""audition.py: same SSML for every voice; lexicon only for matching language."""

import audition
from fakes import FakePolly


def test_audition_renders_each_voice_with_same_ssml(tmp_path):
    polly = FakePolly()
    passage = {"id": "p", "lang": "es", "title": "T", "text": "¡Hola! El Sr. Lee llegó."}
    rows = audition.audition(polly, passage, audition.parse_voices("Lupe,Pedro,Andres:es-MX"), tmp_path)
    assert [r["voice"] for r in rows] == ["Lupe", "Pedro", "Andres"]
    assert len({c["Text"] for c in polly.calls}) == 1 and polly.calls[0]["TextType"] == "ssml"
    assert [c.get("LexiconNames") for c in polly.calls] == [["saEsUS"], ["saEsUS"], None]
    assert polly.calls[2]["LanguageCode"] == "es-MX"
    assert all((tmp_path / r["file"]).stat().st_size > 0 for r in rows)
    import json
    (tmp_path / "audition.json").write_text(json.dumps(rows), encoding="utf-8")
    page = audition.write_page(tmp_path).read_text(encoding="utf-8")
    assert "Pedro" in page and "p-Andres.mp3" in page
