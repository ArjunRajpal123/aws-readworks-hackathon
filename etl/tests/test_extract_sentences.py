"""extract_sentences: workbook rows -> ETL inputs (made-up sentences only)."""

import json

import pytest

openpyxl = pytest.importorskip("openpyxl")

import extract_sentences as ex  # noqa: E402

EN_HEAD = ["ID", "Language", "Grade", "Title", "Genre", "Source URL",
           "Short simple sentence", "Complex longer sentence", "Sentence with a number",
           "Number type", "Sentence with Mr./Mrs. (English only)", "Sentence with a date/year", "Notes"]
ES_HEAD = ["ID", "Title (English source)", "Source URL", "Short simple sentence",
           "Complex longer sentence", "Sentence with a number",
           "Sentence with Sr./Sra. (from Mr./Mrs.)", "Sentence with a date/year", "Translation notes"]


def _workbook(path):
    wb = openpyxl.Workbook()
    en = wb.active
    en.title = "Sentences"
    en.append(EN_HEAD)
    en.append(["E1", "English", 4, "Test Story", "Fiction", "https://x/a",
               "It was  calm.", "The cat sat, and the dog ran.", "She had two pens.",
               "Number words", "NOT FOUND in passage", "In 1999, it rained.", "a note"])
    es = wb.create_sheet("Spanish_MT")
    es.append(ES_HEAD)
    es.append(["E1", "Test Story", "https://x/a", "¡Era tranquilo!", "El gato se sentó.",
               "Tenía dos plumas.", "N/A (no Mr./Mrs. in English)", "En 1999, llovió.", None])
    wb.save(path)


def test_rows_become_inputs_with_one_paragraph_per_cell(tmp_path):
    _workbook(tmp_path / "w.xlsx")
    wb = openpyxl.load_workbook(tmp_path / "w.xlsx", data_only=True)
    en, es = ex.rows_to_inputs(wb)
    assert en["id"] == "rws-e1-en" and en["lang"] == "en"
    assert en["text"] == "It was calm.\n\nThe cat sat, and the dog ran.\n\nShe had two pens.\n\nIn 1999, it rained."
    assert [s["case"] for s in en["source"]["segments"]] == ["short", "complex", "number", "date"]
    assert es["id"] == "rws-e1-es" and es["lang"] == "es" and es["source"]["machineTranslated"]
    assert es["text"].startswith("¡Era tranquilo!")
    assert "a note" not in en["text"]


def test_main_writes_files_and_filters(tmp_path):
    _workbook(tmp_path / "w.xlsx")
    assert ex.main([str(tmp_path / "w.xlsx"), "--out-dir", str(tmp_path / "in"), "--lang", "es"]) == 0
    files = list((tmp_path / "in").glob("*.json"))
    assert [f.name for f in files] == ["rws-e1-es.json"]
    assert json.loads(files[0].read_text(encoding="utf-8"))["title"] == "Test Story (E1, es)"


def test_tokenizer_gives_one_paragraph_per_sentence_cell(tmp_path):
    from tokenizer import tokenize
    _workbook(tmp_path / "w.xlsx")
    wb = openpyxl.load_workbook(tmp_path / "w.xlsx", data_only=True)
    en = ex.rows_to_inputs(wb, lang="en")[0]
    assert len(tokenize(en["text"], "en").paragraph_starts) == 4
