"""FastAPI web server for the benchmark orchestrator (LAN, no auth — keep
this off the WAN boundary, same convention as every other LAN-only service
in this stack). Startup also spawns the queue worker thread, so the queue
resumes across container restarts."""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .config import Config
from .orchestrator import Orchestrator

STATIC_DIR = Path(__file__).resolve().parent / "static"

config = Config()
orchestrator = Orchestrator(config)

app = FastAPI(title="llm-inference-bench orchestrator", version="1.0.0")


class RunRequest(BaseModel):
    runs: list[list[str]]


class RunCreate(BaseModel):
    # Single-run convenience: POST /run {"builds": [...]}
    builds: list[str]


@app.on_event("startup")
def _startup():
    # Worker must be alive before the first request can enqueue something
    # the worker should pick up immediately.
    orchestrator.start()


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.post("/runs")
def enqueue_runs(req: RunRequest):
    if not req.runs:
        raise HTTPException(status_code=400, detail="runs must be a non-empty list")
    created = []
    for builds in req.runs:
        try:
            created.append(orchestrator.enqueue(builds))
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
    return {"created": created}


@app.post("/run")
def enqueue_run(req: RunCreate):
    if not req.builds:
        raise HTTPException(status_code=400, detail="builds must be a non-empty list")
    try:
        return {"created": orchestrator.enqueue(req.builds)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.get("/queue")
def queue():
    return {"runs": orchestrator.list_runs()}


@app.get("/runs/{run_id}")
def get_run(run_id: str):
    run = orchestrator.get_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail=f"no run {run_id}")
    return run


@app.get("/builds")
def builds():
    services = orchestrator.services()
    valid = [
        {
            "name": name,
            "always_up": info["always_up"],
            "port": info["port"],
            "has_build_yaml": (config.checkout_dir / "builds" / name / "build.yaml").exists(),
            "benchmarkable": (not info["always_up"]) or orchestrator._always_up_benchmarkable(name),
        }
        for name, info in sorted(services.items())
        if (not info["always_up"]) or orchestrator._always_up_benchmarkable(name)
    ]
    return {"builds": valid}


@app.get("/state")
def state_file():
    path = config.state_path
    if not path.exists():
        return {"state": None}
    return FileResponse(path)
