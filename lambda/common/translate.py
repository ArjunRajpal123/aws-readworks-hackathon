"""Amazon Translate wrapper for the Spanish-version feature.

Kept tiny and separate from the pipeline: the data API's /translate resource
turns an English passage into Spanish text, which the caller then sends to
POST /api/v1/text-to-speech like any other passage (so the Spanish audio,
timing and record are produced by the same pipeline, with the es-US voices).
"""

import os

import boto3

_client = None

LANG = {"en": "en", "es": "es", "en-US": "en", "es-US": "es"}
MAX_CHARS = 10000  # Amazon Translate real-time limit is well above our 3000-char passages


def _translate():
    global _client
    if _client is None:
        _client = boto3.client("translate", region_name=os.environ.get("AWS_REGION"))
    return _client


def translate_text(text, source="en", target="es"):
    """Translate `text` from source to target (2-letter or xx-XX codes).

    Returns the translated string. Raises on an unsupported language pair or
    an Amazon Translate error (the caller maps it to a 4xx/5xx).
    """
    src, tgt = LANG.get(source, source[:2]), LANG.get(target, target[:2])
    if src == tgt:
        return text
    if len(text) > MAX_CHARS:
        raise ValueError(f"text must be {MAX_CHARS} characters or fewer to translate")
    resp = _translate().translate_text(
        Text=text, SourceLanguageCode=src, TargetLanguageCode=tgt
    )
    return resp["TranslatedText"]
