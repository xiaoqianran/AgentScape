"""AgentScape 可选重型资产编译服务。"""
from __future__ import annotations

import io
import ipaddress
import os
import socket
from typing import Any
from urllib.parse import urljoin, urlparse

import numpy as np
import requests
import trimesh
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

API_VERSION = "1"
app = FastAPI(title="AgentScape Asset Compiler", version=API_VERSION)
MAX_ASSET_BYTES = int(os.getenv("MAX_ASSET_BYTES", 100 * 1024 * 1024))
MAX_REDIRECTS = 3
MAX_URDF_BYTES = int(os.getenv('MAX_URDF_BYTES', 5 * 1024 * 1024))


class UrdfProposalRequest(BaseModel):
    url: str


class CompileRequest(BaseModel):
    stage: str
    source: dict[str, Any] | None = None
    inspection: dict[str, Any] | None = None
    geometry: dict[str, Any] | None = None
    semantics: dict[str, Any] | None = None
    articulationCandidates: list[dict[str, Any]] | None = None


def _assert_public_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("只允许公开的 http/https URL")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    for info in socket.getaddrinfo(parsed.hostname, port, type=socket.SOCK_STREAM):
        address = ipaddress.ip_address(info[4][0])
        if not address.is_global:
            raise ValueError("拒绝访问私有、回环、链路本地或其他非公网地址")


def _download(url: str, max_bytes: int = MAX_ASSET_BYTES) -> bytes:
    current = url
    for _ in range(MAX_REDIRECTS + 1):
        _assert_public_url(current)
        with requests.get(current, timeout=(5, 60), stream=True, allow_redirects=False) as response:
            if 300 <= response.status_code < 400:
                location = response.headers.get("location")
                if not location:
                    raise ValueError("重定向响应缺少 Location")
                current = urljoin(current, location)
                continue
            response.raise_for_status()
            declared = int(response.headers.get("content-length", "0") or 0)
            if declared > max_bytes:
                raise ValueError("资产超过 MAX_ASSET_BYTES")
            chunks, total = [], 0
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if not chunk:
                    continue
                total += len(chunk)
                if total > max_bytes:
                    raise ValueError("资产超过 MAX_ASSET_BYTES")
                chunks.append(chunk)
            return b"".join(chunks)
    raise ValueError("重定向次数过多")


def _urdf_part_proposal(urdf_bytes: bytes) -> dict[str, Any]:
    from yourdfpy import URDF

    model = URDF.load(
        io.BytesIO(urdf_bytes),
        build_scene_graph=False,
        build_collision_scene_graph=False,
        load_meshes=False,
        load_collision_meshes=False,
    )
    joints = list(model.robot.joints)
    by_child = {joint.child: joint for joint in joints}
    movable = {"revolute", "prismatic", "continuous"}

    def movable_parent(link_name: str) -> str:
        current = link_name
        while current in by_child:
            joint = by_child[current]
            if joint.type in movable:
                return joint.child
            current = joint.parent
        return "$root"

    parts = []
    for joint in joints:
        if joint.type == "fixed":
            continue
        axis = np.asarray(joint.axis if joint.axis is not None else [1, 0, 0], dtype=float)
        norm = float(np.linalg.norm(axis))
        if norm > 1e-12:
            axis = axis / norm
        limits = None
        if joint.limit and joint.limit.lower is not None and joint.limit.upper is not None:
            lower, upper = float(joint.limit.lower), float(joint.limit.upper)
            if np.isfinite(lower) and np.isfinite(upper) and lower < upper:
                limits = [lower, upper]
        origin = np.asarray(joint.origin if joint.origin is not None else np.eye(4), dtype=float)
        proposal_joint = {
            "type": joint.type,
            "axis": axis.round(9).tolist(),
            "urdf": {
                "name": joint.name,
                "parentLink": joint.parent,
                "childLink": joint.child,
                "originMatrix": origin.round(9).tolist(),
            },
        }
        if limits is not None:
            proposal_joint["limits"] = limits
        parts.append({
            "id": joint.child,
            "node": joint.child,
            "parent": movable_parent(joint.parent),
            "joint": proposal_joint,
            "confidence": 1.0,
        })

    return {
        "version": 1,
        "source": "urdf/yourdfpy",
        "confidence": 1.0,
        "parts": parts,
    }


def _scene_mesh(glb: bytes) -> trimesh.Trimesh:
    scene = trimesh.load(io.BytesIO(glb), file_type="glb", force="scene")
    if not isinstance(scene, trimesh.Scene):
        return scene
    meshes = []
    for node_name in scene.graph.nodes_geometry:
        transform, geom_name = scene.graph[node_name]
        geom = scene.geometry[geom_name].copy()
        geom.apply_transform(transform)
        meshes.append(geom)
    if not meshes:
        raise ValueError("GLB 不包含 Mesh 几何")
    return trimesh.util.concatenate(meshes)


def _coacd_colliders(mesh: trimesh.Trimesh) -> list[dict[str, Any]]:
    try:
        import coacd
    except ImportError as exc:
        raise RuntimeError("未安装 coacd") from exc
    coacd_mesh = coacd.Mesh(np.asarray(mesh.vertices, dtype=np.float64), np.asarray(mesh.faces, dtype=np.int32))
    hulls = coacd.run_coacd(
        coacd_mesh,
        threshold=float(os.getenv("COACD_THRESHOLD", "0.05")),
        max_convex_hull=int(os.getenv("COACD_MAX_HULLS", "16")),
        preprocess_mode="auto",
        merge=True,
        seed=0,
    )
    return [
        {"shape": "convexHull", "vertices": np.asarray(vertices, dtype=float).reshape(-1).round(6).tolist()}
        for vertices, _faces in hulls
        if len(vertices) >= 4
    ]


@app.get("/health")
def health():
    return {"ok": True, "service": "agentscape-asset-compiler", "apiVersion": API_VERSION}


@app.post("/proposal/urdf")
def proposal_from_urdf(req: UrdfProposalRequest):
    try:
        return {"partProposal": _urdf_part_proposal(_download(req.url, MAX_URDF_BYTES))}
    except Exception as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/compile")
def compile_asset(req: CompileRequest):
    if req.stage != "enrich":
        raise HTTPException(400, f"不支持的 stage: {req.stage}")
    url = (req.source or {}).get("url")
    if not url:
        return {"collision": None, "warnings": ["缺少 source.url，跳过重型几何 Pass"]}
    try:
        mesh = _scene_mesh(_download(url))
        colliders = _coacd_colliders(mesh)
        if not colliders:
            raise ValueError("CoACD 未生成有效凸包")
    except Exception as exc:
        raise HTTPException(422, str(exc)) from exc

    extents = np.asarray(mesh.extents, dtype=float)
    volume = float(abs(mesh.volume)) if mesh.is_volume else None
    density = float(os.getenv("DEFAULT_DENSITY_KG_M3", "500"))
    mass = max(0.05, min(200.0, volume * density)) if volume else max(0.1, float(np.prod(extents)) * 100.0)
    components = len(mesh.split(only_watertight=False))
    return {
        "collision": {"strategy": "coacd", "quality": "convex-decomposition", "colliders": colliders},
        "physics": {"mass": round(mass, 4), "friction": 0.5},
        "geometry": {
            "watertight": bool(mesh.is_watertight),
            "windingConsistent": bool(mesh.is_winding_consistent),
            "components": int(components),
            "volume": volume,
        },
    }
