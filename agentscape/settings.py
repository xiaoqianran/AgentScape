from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    kaggle_url: str = "http://127.0.0.1:30100"
    kaggle_token: str = ""
    modal_agent_url: str = "http://127.0.0.1:39000"
    modal_agent_session: str = ""

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            kaggle_url=os.getenv("AGENTSCAPE_KAGGLE_URL", "http://127.0.0.1:30100").rstrip("/"),
            kaggle_token=os.getenv("AGENTSCAPE_KAGGLE_TOKEN", ""),
            modal_agent_url=os.getenv("AGENTSCAPE_MODAL_AGENT_URL", "http://127.0.0.1:39000").rstrip("/"),
            modal_agent_session=os.getenv("AGENTSCAPE_MODAL_AGENT_SESSION", ""),
        )
