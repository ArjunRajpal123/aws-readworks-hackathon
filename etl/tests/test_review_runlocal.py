"""review.html and run_local.py (fake AWS)."""

import json

import run_local
from fakes import FakePolly
from pipeline import PassageInput, run
from review import build_review
from storage import LocalStorage


def _generate(sa, pid="t-rev", text="One two. Three four?"):
    run(PassageInput(id=pid, lang="en", title="Review Test", text=text), FakePolly(), LocalStorage(str(sa)))


def test_review_page_has_player_checks_and_ssml(tmp_path):
    _generate(tmp_path)
    page = build_review(tmp_path).read_text(encoding="utf-8")
    assert 'data-id="t-rev"' in page
    assert 'src="audio/t-rev/tts-1.mp3"' in page
    assert "all pass" in page and "✗" not in page
    assert "&lt;speak&gt;" in page  # exact SSML shown, escaped
    assert '<span data-w="0">One</span>' in page
    assert 'href="../?m=t-rev"' in page
    assert 'src="audio/t-rev/tts-2.mp3"' in page and "Stephen (male)" in page


def test_review_flags_a_broken_timing_file(tmp_path):
    _generate(tmp_path)
    prod = json.loads((tmp_path / "product" / "t-rev.soundAlong.json").read_text(encoding="utf-8"))
    prod["textHash"] = "sha256:changed"
    (tmp_path / "product" / "t-rev.soundAlong.json").write_text(json.dumps(prod), encoding="utf-8")
    page = build_review(tmp_path).read_text(encoding="utf-8")
    assert "1 fail" in page and "✗" in page


class _Session:
    def __init__(self, polly, fail_sts=False):
        self.polly, self.fail_sts, self.lexicons = polly, fail_sts, []

    def client(self, name):
        if name == "sts":
            outer = self

            class Sts:
                def get_caller_identity(self):
                    if outer.fail_sts:
                        raise RuntimeError("Token has expired")
                    return {"Account": "000000000000", "Arn": "arn:aws:sts::000000000000:assumed-role/x"}
            return Sts()
        polly = self.polly
        polly.put_lexicon = lambda Name, Content: self.lexicons.append(Name)
        return polly


def test_run_local_stops_with_clear_message_when_credentials_expired(tmp_path, monkeypatch, capsys):
    polly = FakePolly()
    monkeypatch.setattr(run_local.boto3, "Session", lambda **kw: _Session(polly, fail_sts=True))
    inp = tmp_path / "a.json"
    inp.write_text(json.dumps({"id": "a", "lang": "en", "text": "Hi there."}), encoding="utf-8")
    assert run_local.main([str(inp), "--profile", "hackathon", "--sa-dir", str(tmp_path / "sa")]) == 1
    assert "aws login --profile hackathon" in capsys.readouterr().err
    assert polly.calls == []


def test_run_local_runs_many_inputs_uploads_lexicons_and_builds_review(tmp_path, monkeypatch):
    sess = _Session(FakePolly())
    monkeypatch.setattr(run_local.boto3, "Session", lambda **kw: sess)
    for pid, lang, text in [("a-en", "en", "Hello there."), ("a-es", "es", "¡Hola, amigo!")]:
        (tmp_path / f"{pid}.json").write_text(
            json.dumps({"id": pid, "lang": lang, "title": pid, "text": text}, ensure_ascii=False),
            encoding="utf-8")
    sa = tmp_path / "sa"
    assert run_local.main([str(tmp_path / "a-*.json"), "--sa-dir", str(sa)]) == 0
    assert sorted(sess.lexicons) == ["saEnUS", "saEsUS"]
    assert (sa / "product" / "a-en.soundAlong.json").exists()
    assert (sa / "product" / "a-es.soundAlong.json").exists()
    assert "a-es" in (sa / "review.html").read_text(encoding="utf-8")


def test_run_local_keeps_going_after_one_failure(tmp_path, monkeypatch):
    monkeypatch.setattr(run_local.boto3, "Session", lambda **kw: _Session(FakePolly()))
    (tmp_path / "ok.json").write_text(json.dumps({"id": "ok", "lang": "en", "text": "Fine."}), encoding="utf-8")
    (tmp_path / "long.json").write_text(json.dumps({"id": "long", "lang": "en", "text": "word " * 700}), encoding="utf-8")
    sa = tmp_path / "sa"
    assert run_local.main([str(tmp_path / "long.json"), str(tmp_path / "ok.json"), "--sa-dir", str(sa), "--no-lexicon"]) == 1
    assert (sa / "product" / "ok.soundAlong.json").exists()
