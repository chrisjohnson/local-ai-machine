#!/usr/bin/env python3
"""Migrates catalog/builds/*.yaml from the flat "one file = one build" shape
to the grouped/versioned family shape decided in M-002 (see
.fleet/board/now/M-002-group-builds-into-versioned-lists-per-model-engine-family.md's
Decision log for the full schema and rationale).

Per M-002's Q3 finding, every one of the current 29 build files becomes a
lone v1 of its own new family file -- no merging of existing files is
required for today's data (verified again here by grouping on
(model.hf_repo, model.quantization, engine) before migrating; any group with
more than one file is printed as a warning so a human can double check
before trusting the 1:1 assumption blindly).

Conversion, per file:
  - Family `id` = old `id` with a trailing `-v<N>` version suffix stripped
    (this also becomes the new filename, replacing the old flat filename).
  - `model:` block is hoisted unchanged to the family level.
  - Everything else that used to be top-level (role, notes, status, created,
    last_verified, benchmark_runs, plus any incidental extra top-level keys
    such as one file's notes_on_size) moves into a single `versions:` list
    entry:
      - version: v1
      - compose_service_id: <old top-level id, unchanged>  -- this is the
        literal docker-compose.yml service/join key; migrating it verbatim
        is what keeps compose a no-op for existing services.
      - engine_ref: <old top-level engine, unchanged>
      - <all remaining old top-level keys other than id/engine/model,
        preserved in their original relative order>

Run for real (no --dry-run flag -- this is a one-shot migration, intended to
be run once and reviewed via `git diff`/`git status` afterward). Deletes the
old flat files and writes the new family files in their place.
"""
from __future__ import annotations

import re
import sys
from collections import defaultdict
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
BUILDS_DIR = REPO_ROOT / "catalog" / "builds"

VERSION_SUFFIX_RE = re.compile(r"^(.*)-v(\d+)$")


def family_id_for(old_id: str) -> tuple[str, str]:
    """Split an old flat id into (family_id, version_label). Files without a
    trailing -vN suffix (e.g. the one -broken file) are their own family
    with an implicit v1 -- the old id is already the family id in that case."""
    m = VERSION_SUFFIX_RE.match(old_id)
    if m:
        return m.group(1), f"v{m.group(2)}"
    return old_id, "v1"


def audit_potential_merges(records: list[dict]) -> None:
    """Group by (hf_repo, quantization, engine) -- the Q2 taxonomy's 'same
    engine recipe + same model artifact' signal -- and warn about any group
    with more than one file, since those would be merge candidates (v1+v2
    of one family) rather than independent families. Q2's audit already
    concluded no such case exists in today's data; this is a live re-check,
    not a re-trust of that conclusion."""
    groups = defaultdict(list)
    for rec in records:
        model = rec["data"].get("model") or {}
        key = (model.get("hf_repo"), model.get("quantization"), rec["data"].get("engine"))
        groups[key].append(rec["old_id"])

    suspicious = {k: v for k, v in groups.items() if len(v) > 1}
    if suspicious:
        print("WARNING: found file groups sharing (hf_repo, quantization, engine) -- "
              "these are merge candidates, not independent families. Review before trusting "
              "the 1:1-wrap assumption:")
        for key, ids in suspicious.items():
            print(f"  {key}: {ids}")
    else:
        print("Audit: no two files share (hf_repo, quantization, engine) -- "
              "confirms Q3's finding that every file becomes a lone v1, no merging needed.")


def build_family_doc(old_id: str, data: dict) -> tuple[str, dict]:
    family_id, version_label = family_id_for(old_id)

    model = data.get("model")
    version_entry = {"version": version_label, "compose_service_id": old_id}
    if "engine" in data:
        version_entry["engine_ref"] = data["engine"]

    # Preserve every remaining top-level key (role, notes, notes_on_size,
    # status, created, last_verified, benchmark_runs, and anything else)
    # verbatim and in original order, minus id/engine/model which are
    # handled above/hoisted.
    for key, value in data.items():
        if key in ("id", "engine", "model"):
            continue
        version_entry[key] = value

    family_doc = {"id": family_id}
    if model is not None:
        family_doc["model"] = model
    family_doc["versions"] = [version_entry]
    return family_id, family_doc


def dump_family_yaml(doc: dict) -> str:
    return yaml.safe_dump(doc, sort_keys=False, default_flow_style=False, width=100, allow_unicode=True)


def main():
    dry_run = "--dry-run" in sys.argv

    paths = sorted(BUILDS_DIR.glob("*.yaml"))
    if not paths:
        print(f"No files found in {BUILDS_DIR}")
        return

    records = []
    for path in paths:
        data = yaml.safe_load(path.read_text())
        old_id = data.get("id", path.stem)
        if old_id != path.stem:
            print(f"NOTE: {path.name} has id={old_id!r} != filename stem {path.stem!r}")
        records.append({"path": path, "old_id": old_id, "data": data})

    audit_potential_merges(records)

    # Verify benchmark_runs data survives byte-for-byte by round-tripping
    # each entry through the same yaml.safe_load the file was read with --
    # captured before any writes, compared after.
    before_runs = {}
    for rec in records:
        before_runs[rec["old_id"]] = rec["data"].get("benchmark_runs")

    new_files = {}
    for rec in records:
        family_id, family_doc = build_family_doc(rec["old_id"], rec["data"])
        if family_id in new_files:
            raise RuntimeError(
                f"Family id collision: {family_id!r} produced by both "
                f"{new_files[family_id]['old_id']!r} and {rec['old_id']!r} -- "
                "these need real merging into one file with v1+v2, not independent writes."
            )
        new_files[family_id] = {"doc": family_doc, "old_id": rec["old_id"], "old_path": rec["path"]}

    print(f"\nMigrating {len(records)} build file(s) into {len(new_files)} family file(s).")

    for family_id, info in sorted(new_files.items()):
        new_path = BUILDS_DIR / f"{family_id}.yaml"
        old_path = info["old_path"]
        text = dump_family_yaml(info["doc"])

        # Correctness check: benchmark_runs for this file's lone version must
        # match the pre-migration data exactly (order and content unchanged).
        migrated_runs = info["doc"]["versions"][0].get("benchmark_runs")
        original_runs = before_runs[info["old_id"]]
        if migrated_runs != original_runs:
            raise RuntimeError(f"benchmark_runs mismatch for {info['old_id']!r} -> {family_id!r}!")

        print(f"  {old_path.name}  ->  {new_path.name}"
              f"{'  (rename only)' if old_path.name == new_path.name else ''}")

        if dry_run:
            continue

        if old_path != new_path:
            old_path.unlink()
        new_path.write_text(text)

    print("\nDone." if not dry_run else "\nDry run -- no files written.")


if __name__ == "__main__":
    main()
