from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    kaggle_url: str = "http://127.0.0.1:30100"
    kaggle_token: str = ""
    modal_2d_agent_url: str = "http://127.0.0.1:3212"
    modal_2d_agent_session: str = ""
    modal_agent_url: str = "http://127.0.0.1:39000"
    modal_agent_session: str = ""
    connector_url: str = "http://127.0.0.1:39000"
    connector_origin: str = "http://localhost:3000"
    connector_pairing_token: str = ""

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            kaggle_url=os.getenv("AGENTSCAPE_KAGGLE_URL", "http://127.0.0.1:30100").rstrip("/"),
            kaggle_token=os.getenv("AGENTSCAPE_KAGGLE_TOKEN", ""),
            modal_2d_agent_url=os.getenv("AGENTSCAPE_MODAL_2D_AGENT_URL", "http://127.0.0.1:3212").rstrip("/"),
            modal_2d_agent_session=os.getenv("AGENTSCAPE_MODAL_2D_AGENT_SESSION", ""),
            modal_agent_url=os.getenv("AGENTSCAPE_MODAL_AGENT_URL", "http://127.0.0.1:39000").rstrip("/"),
            modal_agent_session=os.getenv("AGENTSCAPE_MODAL_AGENT_SESSION", ""),
            connector_url=os.getenv(
                "AGENTSCAPE_CONNECTOR_URL",
                os.getenv("AGENTSCAPE_MODAL_AGENT_URL", "http://127.0.0.1:39000"),
            ).rstrip("/"),
            connector_origin=os.getenv("AGENTSCAPE_CONNECTOR_ORIGIN", "http://localhost:3000").rstrip("/"),
            connector_pairing_token=os.getenv(
                "AGENTSCAPE_CONNECTOR_PAIRING_TOKEN",
                os.getenv("AGENTSCAPE_MODAL_AGENT_SESSION", ""),
            ),
        )
