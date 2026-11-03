"""Tests for mp3duration.duration_ms.

We construct valid MPEG-1 Layer III frame headers by hand so the frame-walker
has something real to sum, plus edge cases (empty input, ID3 skip).
"""

from mp3duration import duration_ms


def _mpeg1_l3_frame():
    """One MPEG-1 Layer III frame: 128 kbps, 44100 Hz, no padding.

    Header bytes:
      0xFF         sync
      0xFB         sync(111) + version MPEG1(11) + Layer III(01) + no CRC(1)
      0x90         bitrate idx 9 (128 kbps) + sample-rate idx 0 (44100)
                   + padding 0 + private 0
      0xC0         channel mode etc. (not used by the duration math)

    frame_len = int(1152/8 * 128000 / 44100) + 0 = 417 bytes.
    frame duration = 1152 / 44100 s = 26.122 ms.
    """
    header = bytes([0xFF, 0xFB, 0x90, 0xC0])
    frame_len = 417
    return header + b"\x00" * (frame_len - len(header))


def test_empty_buffer_is_zero():
    assert duration_ms(b"") == 0


def test_id3_header_skipped_without_crashing():
    # ID3v2 tag declaring a 5-byte body, followed by non-frame bytes.
    body_size = 5
    id3 = b"ID3\x04\x00\x00" + bytes([0, 0, 0, body_size]) + b"\x00" * body_size
    # No valid frames after the tag -> 0, and importantly no exception.
    assert duration_ms(id3 + b"\x00\x00") == 0


def test_single_valid_frame_duration():
    frame = _mpeg1_l3_frame()
    # 1152/44100*1000 = 26.12 -> truncated to 26 ms.
    assert duration_ms(frame) == 26


def test_multiple_frames_sum():
    frame = _mpeg1_l3_frame()
    ten = duration_ms(frame * 10)
    # 10 * (1152/44100) s = 0.26122 s -> 261 ms.
    assert ten == 261


def test_id3_then_valid_frames():
    # A real-ish stream: ID3 tag, then audio frames.
    id3 = b"ID3\x04\x00\x00" + bytes([0, 0, 0, 0])  # empty tag body
    frame = _mpeg1_l3_frame()
    assert duration_ms(id3 + frame * 4) == duration_ms(frame * 4)
    assert duration_ms(id3 + frame * 4) == 104  # 4 * 26.12 -> 104


def test_garbage_before_sync_is_skipped():
    # Leading non-sync bytes must be skipped; the frame still counts.
    frame = _mpeg1_l3_frame()
    assert duration_ms(b"\x00\x11\x22" + frame) == 26
