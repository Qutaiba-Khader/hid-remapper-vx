# Flow map — area `upstream-merge`

Paths added or changed by the 2026-11-24 merge of jfedor2/hid-remapper (upstream `c5457f7`).
Files: `config-tool-web-v2/js/device.js` (`getInfo`), `config-tool-web-v2/js/tabs.js` (firmware list,
`isBluetooth`), `config-tool-web-v2/js/examples.js`, `config-tool-web/index.html` (download buttons).
Tests: `config-tool-web-v2/tests/upstream-merge.test.js`, `config-tool-web-v2/tests/firmware-links.test.js`.
Run: `python3 tools/flow/flowmap.py check`.

The firmware side of the merge is checked outside this gate, because it is C: every CI variant is built
locally exactly as the workflows do, and the real `.uf2` files run in rp2040js against the real v2 page
(`Shared1Tb/projects/hid-remapper-vx-sim-poc/e2e`, results in the merge report).

## Paths

| ID | Entry | Conditions | Expected | Checks | If it fails |
|---|---|---|---|---|---|
| P-MRG-01 | Open device (`device.js connect`) | product name "HID Remapper Bluetooth XXXX" (upstream `remapper_bt`, fork `remapper_picow_ble`) | `getInfo().bluetooth` true → Pair / Clear-bonds cards shown | upstream-merge.test.js | `tinyusb_stuff.cc` product string; `device.js getInfo` |
| P-MRG-02 | Open device | wired build, "HID Remapper XXXX" | `bluetooth` false → cards hidden | upstream-merge.test.js | same |
| P-MRG-03 | Open device | no product name | `bluetooth` false, generic name | upstream-merge.test.js | `getInfo` null guard |
| P-MRG-04 | Actions tab render | — | `isBluetooth()` reads only `getInfo().bluetooth` | upstream-merge.test.js | `tabs.js isBluetooth` |
| P-MRG-05 | Quick start → Examples → gamepad-to-mouse | upstream's v18 example with ports | loads, writes back identical mappings and expressions | upstream-merge.test.js | `translate.js configToApp / appMappingToConfig` |
| P-MRG-06 | v1 Actions → Download firmware | every v1 `.uf2` link | each file is produced by CI | firmware-links.test.js | `.github/workflows/*`, `firmware-bluetooth/build.sh` |
| P-MRG-08 | Load JSON / example / device config (`translate.js configToApp`) | config `version` < 18 | gamepad normalization OFF (v1 rule); v18 without the field = ON; explicit value kept | upstream-merge.test.js | `translate.js` normalizeGamepad |
| P-MRG-07 | v1 + v2 firmware lists | upstream's new builds | `remapper_bt`, `remapper_bt_pico2_w`, `remapper_nice_nano` offered by both and built by CI | firmware-links.test.js | `tabs.js` FW list, v1 `index.html`, `build-rp2040.yml` |

## Mode combinations

Bluetooth detection is the only switch: Bluetooth name / wired name / no name (P-MRG-01..03).

## Not exercised — justified

| Location | Anchor | Class | Reason |
|---|---|---|---|
| `config-tool-web-v2/js/tabs.js:100` | `9107bcaff0` | presentation | Settings-tab hint text for the IR pin card (only wording changed: GP2/GP3 are now a USB port). The behaviour it describes is enforced by the firmware and checked in the rp2040js e2e test 49c |
| `config-tool-web-v2/js/tabs.js:101` | `5ebcaf4bb7` | presentation | Same template expression as line 100 (the IR pin number field's markup); rendering only, the value path is covered by translate.js tests |
