"""Optional heavy AgentScape asset compiler backend.

Uses trimesh + CoACD for convex decomposition. It deliberately lives outside
GitHub Pages/browser runtime and follows the provider-neutral compiler contract.
"""
from __future__ import annotations
import io
import os
from typing import Any

import numpy as np
import requests
import trimesh
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="AgentScape Asset Compiler", version="1.1.0")

class CompileRequest(BaseModel):
    stage: str
    source: dict[str, Any] | None = None
    inspection: dict[str, Any] | None = None
    geometry: dict[str, Any] | None = None
    semantics: dict[str, Any] | None = None
    articulationCandidates: list[dict[str, Any]] | None = None


def _download(url: str) -> bytes:
    response = requests.get(url, timeout=60)
    response.raise_for_status()
    if len(response.content) > int(os.getenv("MAX_ASSET_BYTES", 100 * 1024 * 1024)):
        raise ValueError("asset exceeds MAX_ASSET_BYTES")
    return response.content


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
        raise ValueError("GLB contains no mesh geometry")
    return trimesh.util.concatenate(meshes)


def _coacd_colliders(mesh: trimesh.Trimesh) -> list[dict[str, Any]]:
    try:
        import coacd
    except ImportError as exc:
        raise RuntimeError("coacd package is not installed") from exc
    coacd_mesh = coacd.Mesh(np.asarray(mesh.vertices, dtype=np.float64), np.asarray(mesh.faces, dtype=np.int32))
    hulls = coacd.run_coacd(
        coacd_mesh,
        threshold=float(os.getenv("COACD_THRESHOLD", "0.05")),
        max_convex_hull=int(os.getenv("COACD_MAX_HULLS", "16")),
        preprocess_mode="auto",
        merge=True,
        seed=0,
    )
    result = []
    for vertices, _faces in hulls:
        result.append({
            "shape": "convexHull",
            "vertices": np.asarray(vertices, dtype=float).reshape(-1).round(6).tolist(),
        })
    return result


@app.get("/health")
def health():
    return {"ok": True, "service": "agentscape-asset-compiler", "version": "1.1.0"}


@app.post("/compile")
def compile_asset(req: CompileRequest):
    if req.stage != "enrich":
        raise HTTPException(400, f"unsupported stage: {req.stage}")
    url = (req.source or {}).get("url")
    if not url:
        return {"collision": None, "warnings": ["source.url missing; heavy geometry pass skipped"]}
    try:
        mesh = _scene_mesh(_download(url))
        colliders = _coacd_colliders(mesh)
    except Exception as exc:
        raise HTTPException(422, str(exc)) from exc

    extents = np.asarray(mesh.extents, dtype=float)
    volume = float(abs(mesh.volume)) if mesh.is_volume else None
    density = float(os.getenv("DEFAULT_DENSITY_KG_M3", "500"))
    mass = max(0.05, min(200.0, volume * density)) if volume else max(0.1, float(np.prod(extents)) * 100.0)
    return {
        "collision": {"strategy": "coacd", "quality": "convex-decomposition", "colliders": colliders},
        "physics": {"mass": round(mass, 4), "friction": 0.5},
        "geometry": {"watertight": bool(mesh.is_watertight), "volume": volume},
    }
