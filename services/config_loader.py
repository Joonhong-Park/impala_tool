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
    cluster_name: str


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
    request_timeout: int


@dataclass
class ExplorerConfig:
    chunk_hours: float
    chunk_limit: int


@dataclass
class Config:
    app: AppConfig
    cm: CmGlobalConfig
    explorer: ExplorerConfig
    clusters: list[ClusterConfig]

    def find_coordinator(self, host: str) -> Optional[CoordinatorConfig]:
        for cluster in self.clusters:
            for coord in cluster.all_coordinators():
                if coord.host == host:
                    return coord
        return None


def load_config(path: str | Path) -> Config:
    data = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    explorer_raw = data.get("explorer", {})
    return Config(
        app=AppConfig(**data["app"]),
        cm=CmGlobalConfig(**data["cm"]),
        explorer=ExplorerConfig(
            chunk_hours=explorer_raw.get("chunk_hours", 3 / 60),
            chunk_limit=explorer_raw.get("chunk_limit", 1000),
        ),
        clusters=[_parse_cluster(cl) for cl in data["clusters"] if cl.get("enabled", True)],
    )


def _parse_cluster(raw: dict) -> ClusterConfig:
    coords = raw["coordinators"]
    return ClusterConfig(
        id=raw["id"],
        color=raw["color"],
        cm=CmConfig(**raw["cm"]),
        ops_coordinators=[CoordinatorConfig(**c) for c in coords.get("ops", [])],
        user_coordinators=[CoordinatorConfig(**c) for c in coords.get("user", [])],
    )
