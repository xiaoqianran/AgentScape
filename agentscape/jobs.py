from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field
from decimal import Decimal
from hashlib import sha256
from typing import Any

from .errors import ContractError


SECRET_KEY = re.compile(
    r"authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|secret|credential|signed[-_]?url",
    re.IGNORECASE,
)

JsonValue = None | bool | int | float | str | list["JsonValue"] | dict[str, "JsonValue"]
JS_MAX_SAFE_INTEGER = 2**53 - 1


def _safe_json(value: Any, path: str) -> JsonValue:
    if value is None or isinstance(value, (bool, str)):
        return value
    if isinstance(value, int):
        if abs(value) > JS_MAX_SAFE_INTEGER:
            raise ContractError(f"Job 整数超出 JS 安全范围: {path}")
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ContractError(f"Job 数据包含非有限数字: {path}")
        return value
    if isinstance(value, list):
        return [_safe_json(item, f"{path}[{index}]") for index, item in enumerate(value)]
    if isinstance(value, dict):
        result: dict[str, JsonValue] = {}
        for key, item in value.items():
            if not isinstance(key, str):
                raise ContractError(f"Job 数据 key 必须是字符串: {path}")
            if SECRET_KEY.search(key):
                raise ContractError(f"Job 数据包含敏感字段: {path}.{key}")
            result[key] = _safe_json(item, f"{path}.{key}")
        return result
    raise ContractError(f"Job 数据不是 JSON 兼容类型: {path}")


def sanitize_job_data(value: Any, path: str = "value") -> JsonValue:
    """校验并复制可安全进入 Job contract 的 JSON 数据。"""

    return _safe_json(value, path)


def _utf16_key(value: str) -> bytes:
    return value.encode("utf-16-be", "surrogatepass")


def _array_index(value: str) -> int | None:
    if not value or not value.isascii() or not value.isdigit():
        return None
    if value != "0" and value.startswith("0"):
        return None
    index = int(value)
    return index if index < 2**32 - 1 else None


def _js_object_keys(value: dict[str, JsonValue]) -> list[str]:
    # stableValue 先按 UTF-16 排序插入；JSON.stringify 随后会把 array-index key 提到最前面。
    ordered = sorted(value, key=_utf16_key)
    indices = sorted((key for key in ordered if _array_index(key) is not None), key=lambda key: int(key))
    return indices + [key for key in ordered if _array_index(key) is None]


def _js_number(value: int | float) -> str:
    if isinstance(value, int):
        return str(value)
    if value == 0:
        return "0"
    if value.is_integer() and abs(value) < 1e21:
        return str(int(value))

    text = repr(value).lower()
    absolute = abs(value)
    if 1e-6 <= absolute < 1e21:
        return format(Decimal(text), "f") if "e" in text else text

    if "e" not in text:
        text = format(value, ".17e")
    mantissa, exponent = text.split("e", 1)
    if mantissa.endswith(".0"):
        mantissa = mantissa[:-2]
    exponent_value = int(exponent)
    sign = "+" if exponent_value >= 0 else "-"
    return f"{mantissa}e{sign}{abs(exponent_value)}"


def _js_string(value: str) -> str:
    dumped = json.dumps(value, ensure_ascii=False)
    return "".join(
        f"\\u{ord(char):04x}" if 0xD800 <= ord(char) <= 0xDFFF else char
        for char in dumped
    )


def _js_json(value: JsonValue) -> str:
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, (int, float)):
        return _js_number(value)
    if isinstance(value, str):
        return _js_string(value)
    if isinstance(value, list):
        return "[" + ",".join(_js_json(item) for item in value) + "]"
    return "{" + ",".join(
        f"{_js_string(key)}:{_js_json(value[key])}" for key in _js_object_keys(value)
    ) + "}"


def _stable_json(value: JsonValue) -> bytes:
    return _js_json(value).encode("utf-8")


@dataclass(frozen=True, slots=True)
class JobRequest:
    provider: str
    operation: str
    inputs: dict[str, JsonValue] = field(default_factory=dict)
    profile: str | None = None
    options: dict[str, JsonValue] = field(default_factory=dict)
    output_roles: tuple[str, ...] = ()
    parent: dict[str, JsonValue] | None = None
    retention: dict[str, JsonValue] | None = None
    metadata: dict[str, JsonValue] | None = None

    def canonical(self) -> dict[str, JsonValue]:
        provider = str(self.provider or "").strip()
        operation = str(self.operation or "").strip()
        if not provider or not operation:
            raise ContractError("Job request 必须包含 provider 和 operation")

        roles = sorted({str(role) for role in self.output_roles if str(role)}, key=_utf16_key)
        return {
            "provider": provider,
            "operation": operation,
            "inputs": _safe_json(self.inputs, "inputs"),
            "profile": None if self.profile is None else str(self.profile),
            "options": _safe_json(self.options, "options"),
            "outputRoles": roles,
            "parent": None if self.parent is None else _safe_json(self.parent, "parent"),
            "retention": None if self.retention is None else _safe_json(self.retention, "retention"),
            "metadata": None if self.metadata is None else _safe_json(self.metadata, "metadata"),
        }

    @property
    def request_hash(self) -> str:
        digest = sha256(_stable_json(self.canonical())).hexdigest()
        return f"sha256:{digest}"

    @property
    def idempotency_key(self) -> str:
        return f"idem_{self.request_hash[7:47]}"

    def to_dict(self) -> dict[str, JsonValue]:
        canonical = self.canonical()
        request_hash = f"sha256:{sha256(_stable_json(canonical)).hexdigest()}"
        return {
            **canonical,
            "requestHash": request_hash,
            "idempotencyKey": f"idem_{request_hash[7:47]}",
        }
