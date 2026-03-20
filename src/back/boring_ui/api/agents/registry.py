"""Registry for configured and mounted agent harnesses."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from ..config import APIConfig, AgentRuntimeConfig
from .harness import AgentHarness


@dataclass(frozen=True)
class RegisteredAgent:
    """A configured agent plus its optional live harness."""

    name: str
    config: AgentRuntimeConfig
    harness: AgentHarness | None = None


class AgentRegistry:
    """Tracks configured agents and any mounted harness implementations."""

    def __init__(
        self,
        *,
        mode: str = "frontend",
        default_agent: str | None = None,
        agent_configs: dict[str, AgentRuntimeConfig] | None = None,
        harnesses: Iterable[AgentHarness] | None = None,
    ) -> None:
        self.mode = mode
        self._agent_configs: dict[str, AgentRuntimeConfig] = dict(agent_configs or {})
        self._harnesses: dict[str, AgentHarness] = {}
        if harnesses is not None:
            for harness in harnesses:
                self.register_harness(harness)
        self._default_agent = default_agent

    @classmethod
    def from_config(
        cls,
        config: APIConfig,
        *,
        harnesses: Iterable[AgentHarness] | None = None,
    ) -> "AgentRegistry":
        return cls(
            mode=config.agents_mode,
            default_agent=config.default_agent_name,
            agent_configs=config.agents,
            harnesses=harnesses,
        )

    @property
    def default_name(self) -> str | None:
        if self._default_agent and self._default_agent in self.enabled_names():
            return self._default_agent
        names = self.enabled_names()
        return names[0] if names else None

    def enabled_names(self) -> list[str]:
        return [
            name
            for name, agent in self._agent_configs.items()
            if agent.enabled
        ]

    def register_harness(self, harness: AgentHarness) -> None:
        self._harnesses[harness.name] = harness
        self._agent_configs.setdefault(harness.name, AgentRuntimeConfig(enabled=True))

    def get(self, name: str) -> RegisteredAgent | None:
        config = self._agent_configs.get(name)
        if config is None or not config.enabled:
            return None
        return RegisteredAgent(name=name, config=config, harness=self._harnesses.get(name))

    def harness(self, name: str) -> AgentHarness | None:
        registered = self.get(name)
        return None if registered is None else registered.harness

    def entries(self) -> list[RegisteredAgent]:
        return [
            RegisteredAgent(
                name=name,
                config=config,
                harness=self._harnesses.get(name),
            )
            for name, config in self._agent_configs.items()
            if config.enabled
        ]

    def routes(self) -> list:
        routes: list = []
        for entry in self.entries():
            if entry.harness is None:
                continue
            routes.extend(entry.harness.routes())
        return routes

    def runtime_config(self) -> dict:
        return {
            "mode": self.mode,
            "default": self.default_name,
            "available": self.enabled_names(),
            "definitions": [
                {
                    "name": entry.name,
                    "transport": entry.config.transport,
                    "port": entry.config.port,
                    "command": list(entry.config.command),
                    "metadata": dict(entry.config.metadata),
                }
                for entry in self.entries()
            ],
        }
