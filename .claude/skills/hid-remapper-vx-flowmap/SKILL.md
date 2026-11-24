---
name: hid-remapper-vx-flowmap
description: "The flow map of hid-remapper-vx: its stored, complete set of code paths with the checks for each, as deterministic tests plus a coverage gate. Use after ANY code change to hid-remapper-vx (update the map and tests with it), before a deploy or release, and when asked for a flow test or full trace of hid-remapper-vx. One clean pass, then stop."
---

# hid-remapper-vx flow map

Method: the base skill `flowmap`. This project's map: `docs/FLOW-MAP.md`, `docs/flow-map/*.md`; settings: `flowmap.json`.

```bash
python3 tools/flow/flowmap.py update   # mechanical: line numbers, skeleton rows, entries
python3 tools/flow/flowmap.py quick    # after a change: affected tests + map consistency
python3 tools/flow/flowmap.py check    # the full pass, before a deploy or release. CLEAN = stop
python3 tools/flow/flowmap.py mutate   # the gate tests can fail
```

Every code change updates the map in the same commit. Fill each `TODO` row the update adds. Fix what a pass finds, re-run the full
pass, stop at the first clean one. No random review rounds in place of it.

## Project notes

- Level `quick` (set 2026-11-24): gates, entries and every NEW or changed line must be closed; the 2758 older gaps of the v2
  tool are in the ledger, which may only shrink. Levels `standard` / `full` were estimated at ~1.7M agent tokens: owner's call.
- One lane, `node` (node-v8): `node --test config-tool-web-v2/tests/*.test.js`. The tests have no dependencies and use a fake
  WebHID device (`device-suspend.test.js`, `upstream-merge.test.js`); no test touches a real device or the network.
- Coverage looks low (≈20 % lines) because many v2 tests read the source as text (contract/guard tests); that is known.
- The firmware is C and is NOT in this gate. Its flow is checked by building every CI variant locally
  (`Shared1Tb/projects/hid-remapper-vx-build-tools/build_like_ci.py`) and running the real `.uf2` files in rp2040js against
  the real pages (`Shared1Tb/projects/hid-remapper-vx-sim-poc/e2e`: `run.ts` = v2 tool, `v1.ts` = original tool).
