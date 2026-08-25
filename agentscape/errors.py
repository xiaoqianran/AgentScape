class AgentScapeClientError(RuntimeError):
    """AgentScape client 基础异常。"""


class ProviderError(AgentScapeClientError):
    """Provider 执行失败。"""


class ContractError(AgentScapeClientError):
    """远端返回值或本地数据不符合契约。"""


class ArtifactError(ProviderError):
    """Provider 产物无效。"""


class ConnectionRequiredError(AgentScapeClientError):
    """远端连接不可用，但已有 Job 可能仍可恢复。"""


class IdempotencyConflictError(ContractError):
    """同一幂等键绑定了不同 request 或 Job。"""


class ConnectorHttpError(ProviderError):
    """Connector 返回非成功 HTTP 状态。"""

    def __init__(self, *, code: str, status: int) -> None:
        self.code = code
        self.status = status
        super().__init__(f"Connector HTTP {status}: {code}")
