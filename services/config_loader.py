from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import yaml


@dataclass
class CoordinatorConfig:
    host: str
    port: int


@dataclass
class CmConfig:
    host: str
    port: int
    api_version: str


@dataclass
class ClusterConfig:
    id: str
    color: str
    cm: CmConfig
    ops_coordinators: list[CoordinatorConfig]
    user_coordinators: list[CoordinatorConfig]

    def all_coordinators(self) -> list[CoordinatorConfig]:
        return self.ops_coordinators + self.user_coordinators


@dataclass
class AppConfig:
    port: int
    ca_bundle: str


@dataclass
class CmGlobalConfig:
    username: str
    password: str
    cluster_name: str
    request_timeout: int


@dataclass
class Config:
    app: AppConfig
    cm: CmGlobalConfig
    clusters: list[ClusterConfig]

    def find_coordinator(self, host: str) -> Optional[CoordinatorConfig]:
        for cluster in self.clusters:
            for coord in cluster.all_coordinators():
                if coord.host == host:
                    return coord
        return None

    def coordinator_hosts(self) -> set[str]:
        return {c.host for cl in self.clusters for c in cl.all_coordinators()}


def load_config(path: str | Path) -> Config:
    data = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    return Config(
        app=AppConfig(**data["app"]),
        cm=CmGlobalConfig(**data["cm"]),
        clusters=[_parse_cluster(cl) for cl in data["clusters"]],
    )


def _parse_cluster(raw: dict) -> ClusterConfig:
    coords = raw["coordinators"]
    return ClusterConfig(
        id=raw["id"],
        color=raw["color"],
        cm=CmConfig(**raw["cm"]),
        ops_coordinators=[CoordinatorConfig(**c) for c in coords["ops"]],
        user_coordinators=[CoordinatorConfig(**c) for c in coords["user"]],
    )
