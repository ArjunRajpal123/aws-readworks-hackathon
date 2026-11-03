"""Compute MP3 duration from frame headers (no third-party deps).

Polly does not return audio duration, and the timing file needs the final
word's end time. We sum MPEG audio frame durations. Polly MP3 output is
constant-ish bitrate MPEG-1/2 Layer III, so frame-walking is accurate enough
for word timing (the last end time only needs to be a sane upper bound).
"""

from __future__ import annotations

# bitrate tables (kbps) indexed by [version_bit][layer][bitrate_index]
_BITRATE = {
    # MPEG1 Layer3
    (3, 1): [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
    # MPEG2/2.5 Layer3
    (2, 1): [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
}
_SAMPLE_RATE = {
    3: [44100, 48000, 32000, 0],  # MPEG1
    2: [22050, 24000, 16000, 0],  # MPEG2
    0: [11025, 12000, 8000, 0],  # MPEG2.5
}


def duration_ms(data: bytes) -> int:
    i = 0
    n = len(data)
    # Skip an ID3v2 tag if present.
    if data[:3] == b"ID3" and n >= 10:
        size = (
            (data[6] & 0x7F) << 21
            | (data[7] & 0x7F) << 14
            | (data[8] & 0x7F) << 7
            | (data[9] & 0x7F)
        )
        i = 10 + size

    total_seconds = 0.0
    while i + 4 <= n:
        if data[i] != 0xFF or (data[i + 1] & 0xE0) != 0xE0:
            i += 1
            continue
        b1, b2 = data[i + 1], data[i + 2]
        version_bits = (b1 >> 3) & 0x03  # 3=MPEG1, 2=MPEG2, 0=MPEG2.5
        layer_bits = (b1 >> 1) & 0x03  # 1=Layer3
        if layer_bits != 1 or version_bits == 1:
            i += 1
            continue
        br_index = (b2 >> 4) & 0x0F
        sr_index = (b2 >> 2) & 0x03
        padding = (b2 >> 1) & 0x01

        vkey = 3 if version_bits == 3 else 2
        bitrate = _BITRATE[(vkey, 1)][br_index] * 1000
        sample_rate = _SAMPLE_RATE.get(version_bits, _SAMPLE_RATE[2])[sr_index]
        if bitrate == 0 or sample_rate == 0:
            i += 1
            continue

        if version_bits == 3:  # MPEG1 Layer3
            samples_per_frame = 1152
        else:  # MPEG2 / 2.5 Layer3
            samples_per_frame = 576
        frame_len = int((samples_per_frame // 8 * bitrate) / sample_rate) + padding
        if frame_len <= 0:
            i += 1
            continue
        total_seconds += samples_per_frame / sample_rate
        i += frame_len

    return int(total_seconds * 1000)
