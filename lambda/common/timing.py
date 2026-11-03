"""Builds the `timestamp` array from Polly word speech marks."""


def build_timestamps(word_marks):
    timestamps = []
    for i, mark in enumerate(word_marks):
        start = mark["time"]
        end = word_marks[i + 1]["time"] if i + 1 < len(word_marks) else start
        timestamps.append({"id": i, "s": start, "e": end, "block": mark["value"]})
    return timestamps
