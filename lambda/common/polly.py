"""Thin wrapper around the Polly operations the text-to-speech endpoints need.

Uses the synchronous SynthesizeSpeech API so a single Lambda invocation can
return both audio and word-level timing. Word-level SpeechMarkTypes require
the `neural` or `standard` engine, not `generative`, which is why the
default engine here differs from the `generative` voice used by the main
Sound Along pipeline.
"""
import json
import os

import boto3

_polly = boto3.client("polly")

DEFAULT_VOICE_ID = os.environ.get("TTS_DEFAULT_VOICE_ID", "Joanna")
DEFAULT_ENGINE = os.environ.get("TTS_DEFAULT_ENGINE", "neural")
DEFAULT_LANGUAGE_CODE = os.environ.get("TTS_DEFAULT_LANGUAGE_CODE", "en-US")

MAX_TEXT_CHARS = 3000  # SynthesizeSpeech (synchronous) limit


def synthesize_audio(text, voice_id=None, language_code=None, engine=None):
    response = _polly.synthesize_speech(
        Text=text,
        OutputFormat="mp3",
        VoiceId=voice_id or DEFAULT_VOICE_ID,
        Engine=engine or DEFAULT_ENGINE,
        LanguageCode=language_code or DEFAULT_LANGUAGE_CODE,
    )
    return response["AudioStream"].read()


def synthesize_word_marks(text, voice_id=None, language_code=None, engine=None):
    response = _polly.synthesize_speech(
        Text=text,
        OutputFormat="json",
        SpeechMarkTypes=["word"],
        VoiceId=voice_id or DEFAULT_VOICE_ID,
        Engine=engine or DEFAULT_ENGINE,
        LanguageCode=language_code or DEFAULT_LANGUAGE_CODE,
    )
    raw = response["AudioStream"].read().decode("utf-8")
    marks = [json.loads(line) for line in raw.splitlines() if line.strip()]
    return [mark for mark in marks if mark.get("type") == "word"]
