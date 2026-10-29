"""Agent settings and detection thresholds, read once from the environment (and the repo .env)."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT.parent / ".env")


def _f(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    agent_key: str = os.getenv("AGENT_API_KEY", "dev-agent-key")
    llm_api_key: str = os.getenv("LLM_API_KEY", "")
    llm_model: str = os.getenv("LLM_MODEL", "") or "claude-sonnet-5-5"
    llm_base_url: str = os.getenv("LLM_BASE_URL", "https://api.anthropic.com")
    models_dir: Path = ROOT / "models"

    # Rules. Webcam frames arrive every second, so timers accumulate across frames per session.
    gaze_away_sec: float = _f("GAZE_AWAY_SEC", 2.0)
    no_face_sec: float = _f("NO_FACE_SEC", 2.0)
    yaw_limit_deg: float = _f("YAW_LIMIT_DEG", 28.0)
    pitch_limit_deg: float = _f("PITCH_LIMIT_DEG", 22.0)
    iris_offset_limit: float = _f("IRIS_OFFSET_LIMIT", 0.32)
    match_threshold: float = _f("FACE_MATCH_THRESHOLD", 0.363)
    mismatch_frames: int = int(_f("FACE_MISMATCH_FRAMES", 2))
    dark_mean: float = _f("CAMERA_DARK_MEAN", 28.0)
    flat_std: float = _f("CAMERA_FLAT_STD", 9.0)
    min_face_px: int = int(_f("MIN_FACE_PX", 60))
    query_similarity: float = _f("QUERY_SIMILARITY", 0.55)
    risk_half_life_sec: float = _f("RISK_HALF_LIFE_SEC", 300.0)
    max_frames_per_sec: float = _f("MAX_FRAMES_PER_SEC", 2.0)
    repeat_cooldown_sec: float = _f("REPEAT_COOLDOWN_SEC", 20.0)

    # Objects in the webcam frame (MediaPipe EfficientDet-Lite0, COCO labels). OBJECT_DETECTION=0 turns it off.
    object_detection: bool = os.getenv("OBJECT_DETECTION", "1").lower() not in ("0", "false", "off")
    # A phone held up to the webcam often scores 0.35-0.45 with this model; the size floor drops
    # watch- and button-sized misreads that score as high.
    phone_min_score: float = _f("PHONE_MIN_SCORE", 0.35)
    phone_min_area: float = _f("PHONE_MIN_AREA", 0.02)
    phone_frames: int = int(_f("PHONE_FRAMES", 1))
    notes_min_score: float = _f("NOTES_MIN_SCORE", 0.4)
    notes_frames: int = int(_f("NOTES_FRAMES", 2))
    # Objects count when seen in enough of this many recent frames, so one missed frame does not reset them.
    object_window: int = int(_f("OBJECT_WINDOW", 3))
    # A book must cover this share of the frame, so a bookshelf behind the candidate is ignored.
    notes_min_area: float = _f("NOTES_MIN_AREA", 0.04)

    @property
    def llm_enabled(self) -> bool:
        return bool(self.llm_api_key)


settings = Settings()
