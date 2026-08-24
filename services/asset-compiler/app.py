"""AgentScape 可选重型资产编译服务。"""
from __future__ import annotations

import io

import ipaddress
import os
import socket
from typing import Any

from urdf_proposal import urdf_part_proposal
from part_geometry import mesh_report, part_meshes
from urllib.parse import urljoin, urlparse

import numpy as np
import requests
import trimesh
from fastapi import FastAPI, HTTPException, Request, UploadFile
from pydantic import BaseModel

API_VERSION = "1"
app = FastAPI(title="AgentScape Asset Compiler", version=API_VERSION)
MAX_ASSET_BYTES = int(os.getenv("MAX_ASSET_BYTES", 100 * 1024 * 1024))
MAX_REDIRECTS = 3
MAX_URDF_BYTES = int(os.getenv('MAX_URDF_BYTES', 5 * 1024 * 1024))
MAX_PARTS_PER_REQUEST = int(os.getenv('MAX_PARTS_PER_REQUEST', '32'))
MAX_PART_METADATA_BYTES = int(os.getenv('MAX_PART_METADATA_BYTES', str(256 * 1024)))


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


async def _read_upload(upload: UploadFile, max_bytes: int = MAX_ASSET_BYTES) -> bytes:
    chunks, total = [], 0
    while True:
        chunk = await upload.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise ValueError("资产超过 MAX_ASSET_BYTES")
        chunks.append(chunk)
    return b"".join(chunks)


def _compile_part_geometry(glb: bytes, metadata: dict[str, Any]) -> dict[str, Any]:
    parts = metadata.get("parts") or []
    if not isinstance(parts, list) or not parts:
        raise ValueError("part-geometry requires metadata.parts[]")
    if len(parts) > MAX_PARTS_PER_REQUEST:
        raise ValueError("Part 数量超过 MAX_PARTS_PER_REQUEST")
    meshes, extraction_errors = part_meshes(glb, parts)
    density = float(os.getenv("DEFAULT_DENSITY_KG_M3", "500"))
    results: dict[str, Any] = {}
    for part in parts:
        part_id = str(part.get("id") or "")
        if part_id in extraction_errors:
            results[part_id] = {"warning": f"Part 几何提取失败: {extraction_errors[part_id]}"}
            continue
        mesh = meshes.get(part_id)
        if mesh is None:
            results[part_id] = {"warning": "Part 不包含可提取 Mesh"}
            continue
        report = mesh_report(mesh, density)
        try:
            colliders = _coacd_colliders(mesh)
        except Exception as exc:
            results[part_id] = {"warning": f"CoACD 失败: {exc}", "geometry": report}
            continue
        if not colliders:
            results[part_id] = {"warning": "CoACD 未生成有效凸包", "geometry": report}
            continue
        physics = {"friction": 0.5}
        if "mass" in report:
            physics["mass"] = report["mass"]
        results[part_id] = {
            "collision": {"strategy": "coacd-part", "quality": "convex-decomposition", "colliders": colliders},
            "physics": physics,
            "geometry": report,
        }
    return {"parts": results}


@app.get("/health")
def health():
    return {"ok": True, "service": "agentscape-asset-compiler", "apiVersion": API_VERSION}


@app.post("/proposal/urdf")
def proposal_from_urdf(req: UrdfProposalRequest):
    try:
        return {"partProposal": urdf_part_proposal(_download(req.url, MAX_URDF_BYTES))}
    except Exception as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/compile")
async def compile_asset(request: Request):
    content_type = request.headers.get("content-type", "")
    if content_type.startswith("multipart/form-data"):
        try:
            import json
            form = await request.form()
            stage = str(form.get("stage") or "")
            upload = form.get("asset")
            if upload is None or not hasattr(upload, 'read'):
                raise ValueError(f"{stage or 'multipart'} requires asset upload")
            try:
                if stage == "urdf-proposal":
                    upload_content_type = str(getattr(upload, 'content_type', '') or '').lower()
                    if upload_content_type not in {"application/xml", "text/xml", "application/octet-stream"}:
                        raise ValueError(f"urdf-proposal unsupported media type: {upload_content_type or '<missing>'}")
                    return {"partProposal": urdf_part_proposal(await _read_upload(upload, MAX_URDF_BYTES))}
                if stage != "part-geometry":
                    raise HTTPException(400, f"不支持的 multipart stage: {stage}")
                metadata_text = str(form.get("metadata") or "{}")
                if len(metadata_text.encode("utf-8")) > MAX_PART_METADATA_BYTES:
                    raise ValueError("Part metadata 超过 MAX_PART_METADATA_BYTES")
                metadata = json.loads(metadata_text)
                return _compile_part_geometry(await _read_upload(upload), metadata)
            finally:
                close = getattr(upload, 'close', None)
                if close is not None:
                    await close()
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(422, str(exc)) from exc

    try:
        req = CompileRequest.model_validate(await request.json())
    except Exception as exc:
        raise HTTPException(422, str(exc)) from exc
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
