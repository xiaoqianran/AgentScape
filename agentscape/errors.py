class AgentScapeClientError(RuntimeError):
    """AgentScape client 基础异常。"""


class ProviderError(AgentScapeClientError):
    """Provider 调用失败。"""


class ContractError(ProviderError):
    """Provider 返回值不符合约定。"""


class ArtifactError(ProviderError):
    """Provider 产物无效。"""
