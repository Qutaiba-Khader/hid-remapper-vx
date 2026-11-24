# Flow map — hid-remapper-vx

The stored, complete, deterministic set of this project's code paths and the checks each needs. **Update it with every code
change, run one full pass, fix, re-run until a pass is clean, stop.** Skill: `hid-remapper-vx-flowmap`.

```bash
python3 tools/flow/flowmap.py check     # the full pass. CLEAN = stop
python3 tools/flow/flowmap.py quick     # after a change: affected tests + map consistency
python3 tools/flow/flowmap.py update    # mechanical update: line numbers, skeleton rows, entries
```

<!-- TOTALS:START -->
**Last clean pass 2026-11-24 18:20:25 +0300:** 8 paths, 0 gate tests · lines 663/3379 (19.6%) · branches 246/315 (78.1%) · 2 justified, 0 unjustified.
<!-- TOTALS:END -->

## Areas

| Area | Prefix | Map | Tests | Owns |
|---|---|---|---|---|
| upstream-merge | P-MRG | [upstream-merge.md](flow-map/upstream-merge.md) | `config-tool-web-v2/tests/upstream-merge.test.js`, `firmware-links.test.js` | the 2026-11 merge's tool-side paths |

## Entry points

[flow-map/entries.md](flow-map/entries.md) lists every way work enters the code. A path not reachable from one of them is dead
code: remove it or justify it.

## Main flows

One chain per main flow, from an entry to its visible result. Name files and symbols, not line numbers, and mark each boundary:
`[NET]` network, `[DB]` database, `[BIN]` external program, `[DEV]` device. Each boundary has a fake in the tests.

```
Open device → device.js connect [DEV] → getInfo().bluetooth → tabs.js isBluetooth → Pair / Clear-bonds cards
Actions → tabs.js FW list / v1 index.html → releases/latest/download/<file> [NET] → the .uf2 CI built
Quick start → examples.js → translate.js configToApp → rows → appMappingToConfig → device.js save [DEV]
```

## Critical gates

Branch coverage can pass while a sub-condition never decides anything. Each compound condition that decides what the user gets,
loses data or restarts work has a decision table: per atomic condition, a pair of inputs where only that condition changes and the
outcome changes. Tests are named `G-<GATE>-<condition>`; `flow-map/mutants.json` proves each one can fail.

| Gate | Where | Conditions | Outcome decided |
|---|---|---|---|
| G-BT | `config-tool-web-v2/js/device.js getInfo` | `device.productName` present · contains "Bluetooth" | whether Pair / Clear-bonds are offered |
| G-NORM | `config-tool-web-v2/js/translate.js configToApp` | `version` < 18 · field present | gamepad normalization on/off after loading |
| G-FW | `config-tool-web-v2/js/tabs.js` FW list + v1 `index.html` | file offered · file built by CI | a working download, not a 404 |

## The update rule

Every code change, with no exceptions:

1. Add or edit the rows in `flow-map/<area>.md` and their tests for each new or changed branch, mode or edge case. Removed code
   loses its rows. A changed compound condition updates its gate table.
2. `flowmap.py check`. New gaps get a test or a justified row.
3. Clean: commit map, tests and code together. A defect found: fix it, add its path, run the full pass again. Stop at the first
   clean pass. No random rounds in place of the pass.
