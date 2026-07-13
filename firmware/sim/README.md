# firmware/sim — running the mapping engine without a Pico

```bash
node --test firmware/sim/*.test.js     # 36 tests, no dependencies
```

## Why this exists

The firmware cannot be built or run on the maintainer's machine (Windows, no Pico SDK). CI
compiles it, but **nothing executes it until it is flashed to a board**. For most of the
firmware that is fine — a compile error is the only realistic failure. The combo engine
(usage page `0xFFFB`) is different: it is timing-dependent, edge-dependent and stateful, so
"it compiles" says almost nothing about whether it works.

So `engine.js` is a hand-port of the parts of `../src/remapper.cc` that decide **what the host
actually receives**:

- `set_mapping_from_config()` — state slots, the combo build, `mapped_on_layers`, and the
  unmapped-passthrough sources
- `process_mapping()` — `evaluate_combos()` → consumption → the output accumulation loop

It mirrors the C++ line-for-line — same variable names, same order, same comparisons — so a
divergence shows up in a diff.

## The bug this suite was written to catch

Combo members were being marked in `mapped_on_layers`. That is what an ordinary mapping does,
and it looks right. But `mapped_on_layers` is what suppresses a usage's *unmapped-passthrough*
source — so a key used **only** in a combo went completely dead when pressed on its own. The
combo itself worked perfectly, which is exactly what made it hard to see.

`EACH MEMBER KEY STILL FIRES ON ITS OWN` in `combo.test.js` is that regression, and the drift
guard `combo members are NOT marked in mapped_on_layers` fails if the line ever comes back.

## Keeping it honest

A simulation that has drifted from the code it claims to model is worse than none — it reports
green about a program that no longer exists. Part 3 of `combo.test.js` therefore reads
`remapper.cc`, `remapper.h`, `types.h` and both `CMakeLists.txt` and asserts the invariants the
port depends on: the page constant, the force-port-0 rule for combo sources, the call order of
`evaluate_combos`, the inclusive `<=` window comparison, `scaling`-as-milliseconds, consume on
flag bit 3, `NCOMBOS`, the `#ifdef COMBO_ENABLED` guards, and that the nRF52840 build defines
the macro too.

**If you change the combo code in `remapper.cc`, these tests are supposed to fail.** Update the
port, don't delete the guard.

## The one place JS and C++ genuinely disagree

In C++, `mapping.target_usage & 0xFFFF0000` is a `uint32_t`. In JS, `&` yields a **signed**
int32, so `0xfffb0000 & 0xffff0000` is `-327680`, which never equals the literal `0xfffb0000`.
Every page comparison in `engine.js` coerces back with `>>> 0`. Getting this wrong does not
throw — the sim just quietly classifies combo members as ordinary mappings and tests the wrong
program. It cost a debugging session; hence this paragraph.
