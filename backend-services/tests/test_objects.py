"""Phone and notes rules in the face agent, plus a smoke test of the real object detector."""
from __future__ import annotations

import dataclasses

import numpy as np
import pytest

import vision
from agents import face_agent
from agents.face_agent import FaceState
from vision import DetectedObject, Face, FrameFacts

FRAME = np.zeros((480, 640, 3), dtype=np.uint8)
FACE = Face(box=(220, 120, 200, 200), score=0.95)
PHONE = DetectedObject(label="cell phone", score=0.8, area=0.02)
WEAK_PHONE = DetectedObject(label="cell phone", score=0.3, area=0.05)
# Scores seen on real test frames: a phone held to the camera at 0.41, a wristwatch misread at 0.37.
HELD_PHONE = DetectedObject(label="cell phone", score=0.41, area=0.11)
WATCH = DetectedObject(label="cell phone", score=0.37, area=0.01)
BIG_BOOK = DetectedObject(label="book", score=0.7, area=0.12)
SHELF_BOOK = DetectedObject(label="book", score=0.9, area=0.01)


@pytest.fixture
def frames(monkeypatch):
    """Runs the face agent over a sequence of frames, each with the given objects, and returns the codes raised."""
    def run(*objects_per_frame: list[DetectedObject], state: FaceState | None = None) -> list[list[str]]:
        st = state or FaceState()
        out = []
        for objects in objects_per_frame:
            facts = FrameFacts(faces=[FACE], brightness=120, contrast=40, objects=list(objects))
            monkeypatch.setattr(vision, "analyze", lambda _img, f=facts: f)
            violations, _ = face_agent.analyze_frame(st, FRAME)
            out.append([v.code for v in violations])
        return out
    return run


def test_one_frame_with_a_phone_is_enough(frames):
    # Frames arrive every second, so a phone is reported on the first frame it appears in.
    assert frames([PHONE]) == [["PHONE_DETECTED"]]


def test_phone_detected_is_high_with_the_detector_confidence(monkeypatch):
    facts = FrameFacts(faces=[FACE], brightness=120, contrast=40, objects=[PHONE])
    monkeypatch.setattr(vision, "analyze", lambda _img: facts)
    violations, metrics = face_agent.analyze_frame(FaceState(), FRAME)
    assert [(v.code, v.severity, v.confidence) for v in violations] == [("PHONE_DETECTED", "HIGH", 0.8)]
    assert metrics["phones"] == 1


def test_with_a_two_frame_setting_two_of_the_last_three_frames_count(frames, monkeypatch):
    monkeypatch.setattr(face_agent, "settings", dataclasses.replace(face_agent.settings, phone_frames=2))
    assert frames([PHONE], [], [PHONE]) == [[], [], ["PHONE_DETECTED"]]
    assert frames([PHONE], [], [], [PHONE], [], [], [PHONE]) == [[], [], [], [], [], [], []]


def test_a_phone_held_to_the_camera_at_a_modest_score_is_caught(frames):
    assert frames([HELD_PHONE]) == [["PHONE_DETECTED"]]


def test_a_tiny_phone_shaped_misread_is_ignored(frames):
    assert frames([WATCH], [WATCH], [WATCH]) == [[], [], []]


def test_low_confidence_phones_are_ignored(frames):
    assert frames([WEAK_PHONE], [WEAK_PHONE], [WEAK_PHONE]) == [[], [], []]


def test_large_book_in_two_frames_raises_notes_detected(frames):
    assert frames([BIG_BOOK], [BIG_BOOK]) == [[], ["NOTES_DETECTED"]]


def test_a_book_missed_in_one_frame_is_still_caught(frames):
    assert frames([BIG_BOOK], [], [BIG_BOOK]) == [[], [], ["NOTES_DETECTED"]]


def test_small_books_such_as_a_shelf_behind_the_candidate_are_ignored(frames):
    assert frames([SHELF_BOOK], [SHELF_BOOK], [SHELF_BOOK], [SHELF_BOOK]) == [[], [], [], []]


def test_a_held_phone_is_reported_again_only_after_the_cooldown(frames):
    result = frames([PHONE], [PHONE], [PHONE], [PHONE])
    assert result == [["PHONE_DETECTED"], [], [], []]


def test_off_switch_skips_the_detector(monkeypatch):
    monkeypatch.setattr(vision, "settings", dataclasses.replace(vision.settings, object_detection=False))
    monkeypatch.setattr(vision, "_objects", object())  # would fail if it were called
    assert vision.detect_objects(FRAME) == []


def test_real_detector_loads_and_finds_nothing_in_a_blank_frame():
    status = vision.ensure_models()
    if not status.get("objects"):
        pytest.skip("object model could not be downloaded (offline?)")
    assert vision.detect_objects(FRAME) == []
    assert vision.detect_objects(np.full((480, 640, 3), 200, dtype=np.uint8)) == []
