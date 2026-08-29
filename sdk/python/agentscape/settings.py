from __future__ import annotations

import ctypes
import os
import re
import sys
from dataclasses import dataclass, field

_HANDOFF_TARGET = "com.modal3d.client.agent-handoff.v1"
_HEX_64 = re.compile(r"^[0-9A-Fa-f]{64}$")


def _parse_agent_handoff(payload: bytes) -> tuple[str, str]:
    """解析 modal-3D desktop 发布的短生命周期 Agent handoff。"""
    try:
        parts = payload.decode("utf-8").split("\n")
    except UnicodeDecodeError as exc:
        raise ValueError("Agent handoff 编码无效") from exc
    if len(parts) != 5 or parts[0] != "v1":
        raise ValueError("Agent handoff 版本无效")
    try:
        port = int(parts[1])
        agent_pid = int(parts[2])
        desktop_pid = int(parts[3])
    except ValueError as exc:
        raise ValueError("Agent handoff 标识无效") from exc
    token = parts[4].strip()
    if not 1 <= port <= 65535 or agent_pid <= 0 or desktop_pid <= 0:
        raise ValueError("Agent handoff 标识无效")
    if not _HEX_64.fullmatch(token):
        raise ValueError("Agent handoff session token 无效")
    return f"http://127.0.0.1:{port}", token


def _read_windows_credential(target: str) -> bytes | None:
    """读取 Windows Credential Manager generic credential 的原始 secret bytes。"""
    if sys.platform != "win32":
        return None

    from ctypes import wintypes

    class FILETIME(ctypes.Structure):
        _fields_ = [("dwLowDateTime", wintypes.DWORD), ("dwHighDateTime", wintypes.DWORD)]

    class CREDENTIALW(ctypes.Structure):
        _fields_ = [
            ("Flags", wintypes.DWORD),
            ("Type", wintypes.DWORD),
            ("TargetName", wintypes.LPWSTR),
            ("Comment", wintypes.LPWSTR),
            ("LastWritten", FILETIME),
            ("CredentialBlobSize", wintypes.DWORD),
            ("CredentialBlob", ctypes.POINTER(ctypes.c_ubyte)),
            ("Persist", wintypes.DWORD),
            ("AttributeCount", wintypes.DWORD),
            ("Attributes", ctypes.c_void_p),
            ("TargetAlias", wintypes.LPWSTR),
            ("UserName", wintypes.LPWSTR),
        ]

    credential = ctypes.POINTER(CREDENTIALW)()
    advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)
    cred_read = advapi32.CredReadW
    cred_read.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(ctypes.POINTER(CREDENTIALW))]
    cred_read.restype = wintypes.BOOL
    cred_free = advapi32.CredFree
    cred_free.argtypes = [ctypes.c_void_p]
    cred_free.restype = None

    CRED_TYPE_GENERIC = 1
    ERROR_NOT_FOUND = 1168
    if not cred_read(target, CRED_TYPE_GENERIC, 0, ctypes.byref(credential)):
        error = ctypes.get_last_error()
        if error == ERROR_NOT_FOUND:
            return None
        raise OSError(error, "无法读取 Windows Agent handoff")
    try:
        size = int(credential.contents.CredentialBlobSize)
        if size == 0:
            return b""
        return ctypes.string_at(credential.contents.CredentialBlob, size)
    finally:
        cred_free(ctypes.cast(credential, ctypes.c_void_p))


def _load_windows_agent_handoff() -> tuple[str, str] | None:
    payload = _read_windows_credential(_HANDOFF_TARGET)
    if payload is None:
        return None
    return _parse_agent_handoff(payload)


@dataclass(frozen=True)
class Settings:
    connector_url: str = "http://127.0.0.1:39000"
    connector_origin: str = "http://localhost:3000"
    connector_pairing_token: str = field(default="", repr=False)

    @classmethod
    def from_env(cls) -> "Settings":
        explicit_connector_url = os.getenv("AGENTSCAPE_CONNECTOR_URL", "").strip()
        explicit_pairing = os.getenv("AGENTSCAPE_CONNECTOR_PAIRING_TOKEN", "").strip()

        # Temporary input aliases only: they do not remain part of the Settings API.
        legacy_connector_url = os.getenv("AGENTSCAPE_MODAL_AGENT_URL", "").strip()
        legacy_pairing = os.getenv("AGENTSCAPE_MODAL_AGENT_SESSION", "").strip()

        handoff = None
        if not explicit_connector_url and not legacy_connector_url:
            try:
                handoff = _load_windows_agent_handoff()
            except (OSError, ValueError):
                handoff = None

        discovered_url, discovered_token = handoff or ("", "")
        connector_url = explicit_connector_url or legacy_connector_url or discovered_url or "http://127.0.0.1:39000"
        pairing = explicit_pairing or legacy_pairing or discovered_token

        return cls(
            connector_url=connector_url.rstrip("/"),
            connector_origin=os.getenv("AGENTSCAPE_CONNECTOR_ORIGIN", "http://localhost:3000").rstrip("/"),
            connector_pairing_token=pairing,
        )
