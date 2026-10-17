# Fixtures for the ComfyUI workflow template converter

- `object_info.json` holds the node definitions of **ComfyUI v0.41.0** (the version Bhippi pins) for every
  node class the bundled templates use (59 classes). It was produced by importing ComfyUI v0.41.0's own node
  modules (`nodes.py`, `comfy_extras/*`) in a plain Python process and calling the same function the
  server's `GET /object_info` route uses for each node (`INPUT_TYPES()` / `GET_NODE_INFO_V1()`), so inputs,
  their order, ranges, dynamic combos and output slots are exactly what the server reports. Tooltips and
  hidden inputs were removed to keep it small. Model-file combos are empty lists because no model folders
  existed on the machine that made it; the converter does not check them.
- The templates the tests convert are the bundled ones in `public/comfy-templates/` (MIT, from
  github.com/Comfy-Org/workflow_templates; see the `CREDITS.md` there), so the tests always check what
  ships.
