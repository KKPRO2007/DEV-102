"""Webcam analysis with per-session timers: multiple faces, sustained absence, covered camera,
sustained look-away (head pose or iris), face mismatch against the registered photo, and a phone
or notes held in view."""
from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass, field

import numpy as np

import vision
from config import settings
from schemas import FaceVerifyResult, Violation


@dataclass
class FaceState:
    absent_since: float | None = None
    away_since: float | None = None
    mismatch_streak: int = 0
    phone_hits: deque[bool] = field(default_factory=deque)
    notes_hits: deque[bool] = field(default_factory=deque)
    reference: np.ndarray | None = None
    last_emit: dict[str, float] = field(default_factory=dict)


def _record(hits: deque[bool], hit: bool) -> int:
    """Adds this frame to the recent-frames window and returns how many of them had the object."""
    hits.append(hit)
    while len(hits) > max(1, settings.object_window):
        hits.popleft()
    return sum(hits)


def _emit(state: FaceState, out: list[Violation], code: str, severity: str, confidence: float, message: str) -> None:
    now = time.monotonic()
    if now - state.last_emit.get(code, -1e9) < settings.repeat_cooldown_sec:
        return
    state.last_emit[code] = now
    out.append(Violation(code=code, severity=severity, confidence=round(min(1.0, max(0.0, confidence)), 3), message=message))  # type: ignore[arg-type]


def register_reference(state: FaceState, b64: str) -> bool:
    img = vision.decode(b64)
    if img is None:
        return False
    faces = vision.detect_faces(img)
    if len(faces) != 1:
        return False
    state.reference = vision.embedding(img, faces[0])
    return state.reference is not None


def analyze_frame(state: FaceState, img: np.ndarray) -> tuple[list[Violation], dict[str, float | int | bool | None]]:
    facts = vision.analyze(img)
    now = time.monotonic()
    out: list[Violation] = []
    n = len(facts.faces)

    if facts.blocked and n == 0:
        _emit(state, out, "CAMERA_BLOCKED", "HIGH", 0.9, f"The webcam image is dark or flat (brightness {facts.brightness:.0f}); the camera may be covered.")
        state.absent_since = None
    elif n == 0:
        state.absent_since = state.absent_since or now
        gone = now - state.absent_since
        if gone >= settings.no_face_sec:
            _emit(state, out, "NO_FACE", "MEDIUM", min(1.0, 0.6 + gone / 60), f"No face detected for {gone:.0f} seconds.")
    else:
        state.absent_since = None

    if n > 1:
        conf = sorted((f.score for f in facts.faces), reverse=True)[1]
        _emit(state, out, "MULTIPLE_FACES", "HIGH", conf, f"{n} faces are visible in the webcam frame.")

    if n >= 1 and facts.looking_away:
        state.away_since = state.away_since or now
        held = now - state.away_since
        if held >= settings.gaze_away_sec:
            detail = f"yaw {facts.yaw:.0f}°" if facts.yaw is not None else "eyes off-screen"
            _emit(state, out, "GAZE_AWAY", "LOW", 0.7, f"Looked away from the screen for {held:.0f} seconds ({detail}).")
    else:
        state.away_since = None

    similarity: float | None = None
    if n == 1 and state.reference is not None:
        emb = vision.embedding(img, facts.faces[0])
        if emb is not None:
            similarity = vision.similarity(state.reference, emb)
            state.mismatch_streak = state.mismatch_streak + 1 if similarity < settings.match_threshold else 0
            # Require consecutive misses so one blurry frame cannot disqualify someone.
            if state.mismatch_streak >= settings.mismatch_frames:
                _emit(state, out, "FACE_MISMATCH", "CRITICAL", 1 - max(0.0, similarity), f"The face on camera does not match the verified photo (similarity {similarity:.2f}, threshold {settings.match_threshold:.2f}).")

    # Objects must be seen in enough recent frames, so one misread frame never counts and one missed frame never resets.
    phone = max(
        (o.score for o in facts.objects if o.label == "cell phone" and o.score >= settings.phone_min_score and o.area >= settings.phone_min_area),
        default=None,
    )
    seen = _record(state.phone_hits, phone is not None)
    if phone is not None and seen >= settings.phone_frames:
        _emit(state, out, "PHONE_DETECTED", "HIGH", phone, f"A phone was visible on camera in {seen} of the last {len(state.phone_hits)} frames (confidence {phone:.2f}).")
    notes = max(
        (o.score for o in facts.objects if o.label == "book" and o.score >= settings.notes_min_score and o.area >= settings.notes_min_area),
        default=None,
    )
    seen = _record(state.notes_hits, notes is not None)
    if notes is not None and seen >= settings.notes_frames:
        _emit(state, out, "NOTES_DETECTED", "MEDIUM", notes, f"A book or notes were visible on camera in {seen} of the last {len(state.notes_hits)} frames (confidence {notes:.2f}).")

    metrics = {
        "faces": n, "brightness": round(facts.brightness, 1), "contrast": round(facts.contrast, 1), "blocked": facts.blocked,
        "yaw": None if facts.yaw is None else round(facts.yaw, 1), "pitch": None if facts.pitch is None else round(facts.pitch, 1),
        "irisOffset": None if facts.iris_offset is None else round(facts.iris_offset, 2),
        "similarity": None if similarity is None else round(similarity, 3),
        "phones": sum(o.label == "cell phone" for o in facts.objects), "books": sum(o.label == "book" for o in facts.objects),
    }
    return out, metrics


def verify(image_b64: str, registered_b64: str | None) -> FaceVerifyResult:
    img = vision.decode(image_b64)
    if img is None:
        return FaceVerifyResult(match=False, similarity=0, faces=0, liveness=False)
    facts = vision.analyze(img)
    faces = len(facts.faces)
    # Basic liveness: a lit, textured frame with a detected face and landmarks, not a flat image.
    liveness = faces == 1 and not facts.blocked and facts.contrast > 18 and (facts.yaw is not None)
    if faces != 1:
        return FaceVerifyResult(match=False, similarity=0, faces=faces, liveness=liveness)
    if not registered_b64:
        return FaceVerifyResult(match=True, similarity=1.0, faces=1, liveness=liveness)
    ref_img = vision.decode(registered_b64)
    ref_faces = vision.detect_faces(ref_img) if ref_img is not None else []
    if not ref_faces or ref_img is None:
        return FaceVerifyResult(match=True, similarity=1.0, faces=1, liveness=liveness)
    a, b = vision.embedding(ref_img, ref_faces[0]), vision.embedding(img, facts.faces[0])
    if a is None or b is None:
        return FaceVerifyResult(match=True, similarity=0.0, faces=1, liveness=liveness)
    sim = vision.similarity(a, b)
    return FaceVerifyResult(match=sim >= settings.match_threshold, similarity=round(sim, 3), faces=1, liveness=liveness)
