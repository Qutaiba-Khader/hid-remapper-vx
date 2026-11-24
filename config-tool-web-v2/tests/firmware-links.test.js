/* FIRMWARE DOWNLOAD tests.

   CLAUDE.md golden rule #4: firmware filenames must be identical everywhere — the CI `mv` step,
   the web tool's download buttons, and the release assets. One typo = a 404 for the user.

   This checks the tool's list against the names CI actually produces (parsed from the workflow),
   so a rename on either side fails here instead of in someone's browser.

   Run: cd config-tool-web-v2 && node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const TABS = fs.readFileSync(path.join(__dirname, "..", "js", "tabs.js"), "utf8");

// what the web tool offers
const offered = [...new Set([...TABS.matchAll(/"(remapper[a-z0-9_]*\.uf2)"/g)].map((m) => m[1]))];

// What CI actually ships. Three sources, because CI names artifacts three different ways:
//   1. explicit renames:      mv build-pico2/remapper.uf2 artifacts/remapper_pico2.uf2
//   2. a wildcard sweep:      mv build/*.uf2 artifacts     -> whatever CMake targets produced
//   3. the nRF builds:        `build <name> ...` lines in firmware-bluetooth/build.sh
function ciArtifacts() {
  const names = new Set();

  const rp = fs.readFileSync(path.join(ROOT, ".github", "workflows", "build-rp2040.yml"), "utf8");
  // (1) explicit renames
  for (const m of rp.matchAll(/artifacts\/(remapper[a-z0-9_]*\.uf2)/g)) names.add(m[1]);
  // (2) the wildcard sweep picks up every CMake executable target from the default build dir
  if (/mv\s+build\/\*\.uf2\s+artifacts/.test(rp)) {
    const cmake = fs.readFileSync(path.join(ROOT, "firmware", "CMakeLists.txt"), "utf8");
    for (const m of cmake.matchAll(/add_executable\((remapper[a-z0-9_]*)/g)) names.add(m[1] + ".uf2");
    // the combined dual image is produced by a custom command, not add_executable
    if (rp.includes("remapper_dual_combined")) names.add("remapper_dual_combined.uf2");
  }
  // (3) the nRF Bluetooth builds. Upstream (2026-11) replaced the build-nrf52.yml matrix with
  //     build-nrf.yml, which runs firmware-bluetooth/build.sh; each `build <name> <ncs> <board>` line
  //     there ships remapper_<name>.uf2 -- or remapper_<name>.hex when Zephyr makes no UF2 for that
  //     board (the nRF54 dev kits, flashed over their debugger), so those are not .uf2 downloads.
  const nrfWf = fs.readFileSync(path.join(ROOT, ".github", "workflows", "build-nrf.yml"), "utf8");
  assert.ok(nrfWf.includes("./build.sh"), "build-nrf.yml no longer runs firmware-bluetooth/build.sh");
  const buildSh = fs.readFileSync(path.join(ROOT, "firmware-bluetooth", "build.sh"), "utf8");
  for (const m of buildSh.matchAll(/^build\s+([a-z0-9_]+)\s+v[0-9.]+\s+(\S+)/gm)) {
    if (/dk$/.test(m[1])) continue;  // dev kit: .hex, not .uf2
    names.add("remapper_" + m[1] + ".uf2");
  }
  // (4) the Pico W builds — build-picow.yml is now part of the release pipeline (release.yml).
  const pw = fs.readFileSync(path.join(ROOT, ".github", "workflows", "build-picow.yml"), "utf8");
  for (const m of pw.matchAll(/artifacts\/(remapper[a-z0-9_]*\.uf2)/g)) names.add(m[1]);
  // (5) the IR-output builds (build-ir.yml) — the `remapper`/`remapper_picow_ble` targets rebuilt
  //     with -DIR_OUTPUT_ENABLED=ON, renamed to *_ir.uf2. Not in release.yml yet; see feature/ir-output.
  const ir = fs.readFileSync(path.join(ROOT, ".github", "workflows", "build-ir.yml"), "utf8");
  for (const m of ir.matchAll(/artifacts\/(remapper[a-z0-9_]*\.uf2)/g)) names.add(m[1]);
  return names;
}

test("the tool offers a non-trivial number of firmware builds", () => {
  assert.ok(offered.length >= 20, `only ${offered.length} builds offered — the list has gone stale`);
});

test("every firmware file the tool offers is one CI actually produces", () => {
  const built = ciArtifacts();
  assert.ok(built.size > 0, "could not parse any artifact names out of the CI workflows");

  // No whitelist any more: build-picow is in release.yml, so both Pico W .uf2 are parsed above like
  // every other file. (Was: a manual-upload whitelist for remapper_picow_ble.uf2.)
  const phantom = offered.filter((f) => !built.has(f));
  assert.deepStrictEqual(phantom, [],
    "the tool links to .uf2 files CI never builds — these are 404s: " + phantom.join(", "));
});

test("the dual builds are labelled with the correct side (A = device/PC, B = host)", () => {
  // Verified against firmware/CMakeLists.txt: dual_a uses tusb_config_device (it IS the USB
  // device the PC sees); dual_b uses tusb_config_host (your keyboard plugs into it).
  const cmake = fs.readFileSync(path.join(ROOT, "firmware", "CMakeLists.txt"), "utf8");
  const aBlock = cmake.slice(cmake.indexOf("target_include_directories(remapper_dual_a"));
  const bBlock = cmake.slice(cmake.indexOf("target_include_directories(remapper_dual_b"));
  assert.ok(aBlock.slice(0, 300).includes("tusb_config_device"), "dual_a must build as a USB device");
  assert.ok(bBlock.slice(0, 300).includes("tusb_config_host"), "dual_b must build as a USB host");

  // and the UI must say so
  const aLine = TABS.match(/"remapper_dual_a\.uf2",\s*sub:\s*"([^"]+)"/);
  const bLine = TABS.match(/"remapper_dual_b\.uf2",\s*sub:\s*"([^"]+)"/);
  assert.ok(aLine && /side A/i.test(aLine[1]) && /PC/i.test(aLine[1]),
    "side A must be described as the one that plugs into the PC");
  assert.ok(bLine && /side B/i.test(bLine[1]),
    "side B must be described as the one your device plugs into");
});

// The ORIGINAL tool (config-tool-web/index.html, v1) has its own hard-coded download buttons. Same
// rule: every .uf2 it links must be one CI ships, or the button is a 404.
test("P-MRG-06 every firmware file the v1 tool links is one CI actually produces", () => {
  const v1 = fs.readFileSync(path.join(ROOT, "config-tool-web", "index.html"), "utf8");
  const linked = [...new Set([...v1.matchAll(/releases\/latest\/download\/(remapper[a-z0-9_]*\.uf2)/g)].map((m) => m[1]))];
  assert.ok(linked.length >= 10, `v1 links only ${linked.length} builds`);
  const built = ciArtifacts();
  const phantom = linked.filter((f) => !built.has(f));
  assert.deepStrictEqual(phantom, [], "v1 links to .uf2 files CI never builds: " + phantom.join(", "));
});

// The builds upstream added in the 2026-11 merge are offered by BOTH tools.
test("P-MRG-07 both tools offer upstream's official Bluetooth builds", () => {
  const v1 = fs.readFileSync(path.join(ROOT, "config-tool-web", "index.html"), "utf8");
  for (const f of ["remapper_bt.uf2", "remapper_bt_pico2_w.uf2", "remapper_nice_nano.uf2"]) {
    assert.ok(offered.includes(f), "v2 does not offer " + f);
    assert.ok(v1.includes("releases/latest/download/" + f), "v1 does not offer " + f);
    assert.ok(ciArtifacts().has(f), "CI does not build " + f);
  }
});
