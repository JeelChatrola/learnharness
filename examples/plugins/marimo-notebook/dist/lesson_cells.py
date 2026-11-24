"""Cell operations for the paired LearnHarness tutor."""
import base64
import hashlib
import json

import marimo._code_mode as cm


def revision(cell):
    return hashlib.sha256(cell.code.encode("utf-8")).hexdigest()


def describe(cell, detailed):
    info = {"id": cell.id, "revision": revision(cell), "status": cell.status,
            "code": cell.code if detailed else cell.code[:180]}
    if detailed:
        info["errors"] = [e.msg[:1500] for e in cell.errors[:5]]
        info["console"] = [str(o.data)[:1000] for o in cell.console_outputs[-5:]]
        output = cell.output
        if output:
            info["output_type"] = output.mimetype
            if output.mimetype.startswith("text/") or output.mimetype == "application/json":
                info["output"] = str(output.data)[:4000]
    return info


async def perform(encoded):
    args = json.loads(base64.b64decode(encoded))
    action = args["action"]
    cell_id = args.get("cell_id")
    async with cm.get_context() as ctx:
        if cell_id is not None and cell_id not in ctx.cells:
            raise ValueError("Cell no longer exists. Read the notebook again.")
        if action == "read":
            if cell_id:
                result = describe(ctx.cells[cell_id], True)
            else:
                offset = args.get("offset", 0)
                cells = list(ctx.cells.values())
                result = {"cells": [describe(c, False) for c in cells[offset:offset + 30]],
                          "total": len(cells), "offset": offset}
        else:
            if action == "write":
                if cell_id is None:
                    cell_id = ctx.create_cell(args["code"])
                else:
                    if revision(ctx.cells[cell_id]) != args.get("revision"):
                        raise ValueError("Cell changed since it was read. Read it again before editing.")
                    ctx.edit_cell(cell_id, args["code"])
            if action == "run" or args.get("run"):
                ctx.run_cell(cell_id)
            result = {"cell_id": cell_id, "ran": action == "run" or args.get("run", False)}
    print("LH_CELL_RESULT " + json.dumps(result))
