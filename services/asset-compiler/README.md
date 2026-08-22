# AgentScape heavy asset compiler service

Optional server-side compiler for passes that should not run in the browser. The first implemented heavy pass is CoACD convex decomposition.

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8080
```

Configure the AgentScape **Compiler Endpoint** as `https://host/compile`.

The browser always retains deterministic local fallbacks, so the engine remains usable without this service. With the service enabled, collision generation upgrades from one AABB proxy to multiple convex hulls produced by CoACD.
