# Development log

Newest first. One entry per slice: what landed, what it cost, what moved a
golden hash and why.

---

## 2026-08-29 — Playtest: the cockpit in the way, and where the waves went

Three findings from the controls, and the third was a question rather than a
bug.

**WEAPON view was completely blocked while flying.** In the gunsight the eye
sits on the mount, and for a flown craft that mount is eight metres ahead of
the hull's centre - well inside a Manta, which is longer than that. The screen
filled with the inside of the player's own wing and there was no aiming at
all. The carrier had the same problem years earlier in this codebase and
solved it by pushing its eye out past the bow spike, which works for a ship
you stand ON. For a craft you ARE, the honest answer is different: a pilot
does not see their own aircraft. It is hidden while it is the gunsight
subject and back the moment the view changes.

**"No weapon buttons in HELM view" was my own regression, one round old.** The
chips were there - but the column wrap I added at the last playtest had put
FIRE at the foot of one column and the weapons it fires at the head of the
other, which reads exactly like "the weapons are missing". Two fixes: the
buttons are tighter, so an ordinary window does not wrap at all, and FIRE and
its chips now live in one container that no wrap can split. Measured at four
viewports; at 1600x900 and above it is a single column, and the pair is bound
at every size.

**PILOT now lights up** while a craft is selected and unflown. Asleep-at-a-
third says what the ship CAN do; it does not say what you can do next, and a
Manta that has just gone away is flyable with nothing on screen saying so.

**And the waves.** The owner asked whether there is a setting beyond choosing
modern. There is, and it is theirs: the 2026-08-26 ruling was "High + modern
only", and the weather, mirror sea and swell are all gated on
`physicalEffects`, which only the High preset sets. Confirmed by measurement -
modern+High builds the swell, modern+Medium does not.

So the gate is right and the TELLING was missing. The tier lived in the DBG
strip, which is hidden by default. There is now a chip in the top right
reading `Modern · High`, which turns amber when the look is asking for more
than the tier pays for, and clicking it cycles the tier. That also retires the
controls audit's exemption for `G`: "a setting, not a war action" was
defensible while the tier only changed how things looked, and stopped being so
the moment it decided whether there was weather.

One process note. My first attempt to reproduce the cockpit bug ran the probe
at `graphics=high` and the Manta never left the deck - in solo the ENGINE RUNS
IN THE CLIENT, so a page rendering at three frames a second is a war advancing
at three ticks a second. The rule I wrote two days ago ("run a probe at the
cheapest tier that still tests what it is for") applied to my own new probe
and I did not apply it.

---

## 2026-08-29 — Rain, spray, a wet deck, sunbeams, and light through the wave

Owner reversed Q2b's "not now" while playtesting. Five effects, all High +
modern, all driven by the same pure weather function.

**Rain** is 11,000 instanced streaks in a box that rides the eye, entirely
positioned in the vertex shader by one `mod()` of the clock. The first box was
220 m on a side and looked emptier than a light shower - **volume grows as the
cube of the span** while the eye only ever sees the near few metres, so
doubling the box to get coverage divides the apparent density by eight. At
64 m the same drops read as a downpour, and the fog owns everything past it,
which is what distance does to real rain.

**The wet deck** needed a material change, not a colour change. Lambert has no
specular term, so wet under it can only mean darker - the less convincing
half. At High + modern there is already a PMREM environment map in the scene,
so the deck becomes a standard material and its roughness falls from 0.96 to
0.14 as it soaks. Wet up in four seconds, dry off over the better part of a
minute: a deck that dries as fast as the cloud clears reads as a lighting
change rather than as weather.

**Spray** needs the sea AND the ship. A stopped hull in a gale smokes a
little, a hull at speed on glass barely wets its paint, and the two together
throw water off the bow.

**Sunbeams** are screen-space on one triangle, and that is a deliberate trade
written down in docs/07: real god rays want a render target and a radial blur,
which means an EffectComposer and a rewritten render loop - a lot of machinery
and risk for an effect that is believed rather than examined. The limitation
is recorded rather than hidden: these shafts are not occluded by islands or by
the ship, and fixing that needs the depth buffer this avoids.

**And the sea got the thing it was still missing.** Twelve Gerstner components
gave it shape; what it lacked was light coming THROUGH a wave. That is the
term that separates water from a shiny surface - the far side of a crest from
the sun glows from inside, greener and brighter than any reflection - and it
needs a raised piece of water, the sun behind it and the eye facing it, all at
once, which is exactly when a real swell lights up.

**Three things cost time, all of them mine:**

A comment inside a shader template literal read "that `mod` is the whole
animation" - and backticks END a template literal. The browser reported
`Unexpected identifier 'mod'`, a JavaScript error in a file whose JavaScript
was fine, and the whole client failed to load.

`fog: true` on a raw ShaderMaterial makes three.js call `refreshFogUniforms`,
which reaches for `fogColor` on a material that never declared it - a page
error per draw, per frame.

And the beams looked like a lens flare on the first pass: high frequencies and
a hard power give a sharp star pinned to the sun. Crepuscular rays are wide
soft wedges with gaps between them, because they are the shape of the holes in
the cloud, not the shape of the sun.

**Verified by breaking it:** raising the rain threshold out of reach made four
assertions name themselves - the squall is not raining, the deck is 0.00 wet,
a soaked deck is still rough, and the ship has no wettable surface at all.
That last one matters most: an empty wettables list would pass a naive
"is it wet" check by doing nothing.

**Reviewed the batch afterwards and found four omissions**, of which one was
the same mistake twice.

Phase 3b learned that the cloud shell must be hidden while the mirror water
renders its reflection, because the shell rides the eye and is therefore in
the wrong place seen from a mirrored camera. Phase 3c then added three MORE
eye-riding effects and put none of them on that list. The beams were the worst
of the three: a screen-space triangle with depth testing off and the last
render order, painting over the entire reflection texture. The lesson is not
"remember the list" - it is that a hand-kept list is only correct until the
next feature, so the probe now asserts the rule instead: nothing that rides
the eye may be drawn during the reflection pass, and everything must be
visible again after. Verified by restoring the cloud-only list and watching
it name rain, spray and beams by name.

Also: the spray puffs were hard-edged rectangles, because the fragment shader
reached for `gl_PointCoord` - meaningless in a triangle shader - and then
never used the value it read, so there was no falloff at all. Four Color
allocations per frame hoisted out of the update paths. And `ownX`/`ownZ` were
being used before they were declared on view3d, harmless by order of
execution and now initialised where every other field is.

---

## 2026-08-28 — The documentation catches up, and one last gap closes

A sweep of docs, specs, skills, memories and tests before the owner sits down
again. Mostly bookkeeping; two things were not.

**The last open gap from the architect's review, closed.** R-010's four doc
drifts are fixed - `trajectoryHash` was cited as living in
`shared/statehash.js` and is in `engine/snapshot.js`, docs/05 said "four
files" over a table of six, docs/00 had no row for docs/10, and the slice
skill had a sentence from item 7 spliced onto the end of item 8.

**And the one thing the review flagged as unread turned out to be real.** It
said `lobby.js` "was not read deeply enough to confirm a guard exists" for a
war restarted with fewer teams than seated players. There was no guard. The
table's size is a room option and the seats fill independently, so three
commanders in a two-carrier room was a legal state, and the third seat would
have received `snapshot.views[2]` - undefined, a war with no view of it. The
room refuses now and says which way to fix it: turn the table up, or somebody
stands down. Observers are not owed a hull and do not block a start. Written
as a failing test first, which is how I know the guard was missing rather
than merely unproven.

The slice skill also gained a ninth rule, from the playtest: **a new action
needs a button, not only a key**, and there is a probe that checks.

---

## 2026-08-28 — The first playtest at the controls

Six findings from the owner actually flying it, and they turn out to be
mostly one finding wearing six hats: **the interface knew things it never
said.**

**The best of them was measurable, and the measurement was the fix.** "I did
not find fire button." The right-hand column held **622px of buttons in 448px
of screen** and simply cut the last three off the bottom: FIRE, POD, VIRUS.
Not hidden by a rule, not disabled - off the end of a fixed-height column.
The most important button in the game, invisible.

Hiding the sleeping ones would have solved it and was refused: the 2026-08-24
ruling keeps a button whose moment has not come visible at a third opacity,
and that ruling is right - it is how a player learns what the ship can do. So
the columns wrap, and the right-hand one grows inward from the edge.

**"Cannot steer walrus" was not an engine bug.** Headless, both paths work: an
ordered move makes speed 119, and `take_control` sets throttle 100 and it
makes 118. What was missing was the telling - a selected craft sits at HOLD
until you order it somewhere or press T, and the PILOT button that would have
said so was one of the three below the fold. Same defect, different hat.

**Four keys had no button at all**, found by auditing rather than by eye: Y
the decoy screen, O rear view, ] the scope, and , / . the clock. Y is the one
that stings - a whole ruled feature whose button label had been sitting unused
in both language files since the day it was specced. The audit now reads every
`key === '...'` out of client/main.js and checks it against the captions on
screen, with declared exceptions. Verified by deleting the Y button and
watching it named.

**PROG said nothing about whose course it was laying.** It routes to the
selected craft and to the ship otherwise, which is right; with nothing
selected the owner laid four waypoints, watched the carrier take them, and
reasonably concluded unit routing was broken. It reads PROG W4 or PROG SHIP
now, live off the selection.

**Both bars went to the top**, and then CHART was on both of them. The owner
ruled it off the console bar, and the right one survived: the camera bar's
CHART opens the same map AND lights the camera bar to match, where the
console's left it reading HELM with a map on screen. The chart is still a
member of the console - another tab closes it, closing the console puts it
away - it just has no tab. Two controls for one job, keep the one that leaves
the interface honest.

**And two flakes in the GATE, which matter more than they look.** Running the
suite five times to check the playtest work found `server_watch` failing about
one run in three and `client_smoke` about one in five. Neither was the
playtest's doing; both had been there.

The watchdog one was a real race in the test: it read `/watch`, then
`/healthz`, and asserted the two counts were EQUAL - two snapshots of a war
that is still running, so on a loaded box the watchdog could notice one more
slow tick in between. Findings only accumulate, so reading health first and
`/watch` second turns it into an inequality that holds by construction. The
architect's R-007 was the same class, in a different file.

The smoke one was the host: headless Chromium on a machine with no sound card
reports that the WebAudio renderer cannot reach an audio device, and the gate
fails on any console error. Now ignored, matched on the device wording rather
than on "audio" so a real fault in client/sound.js still fails.

Five consecutive clean runs after. A flaky gate is worse than a flaky probe,
because a gate you have to re-run is a gate you stop reading - and this week
has been mostly about earning the right to believe the instruments.

**One layout lesson, cheaply learned:** the first version of the top row
pinned the camera bar at a fixed left margin and it overlapped the console's
tabs by 75px - and would have overlapped worse in Norwegian, where every label
is longer. One flex row instead of two offsets. Measuring the boxes found it
immediately; looking at the screenshot had not.

---

## 2026-08-27 — The architect's twelve, nine of them built

An outside review landed twelve findings. I checked every one against the
code before touching anything, on the principle that another reviewer can be
wrong - **none were**. That is worth recording on its own: twelve for twelve,
no false positives, and two were sharper than written.

**R-003 was the one I would not have found.** The fog listed unit states by
number and left out `UNIT_LANDED`. Meanwhile `unitEngageable` in
engine/units.js explicitly INCLUDES it, with a comment saying a Manta on a
runway "is a target like any other, a runway is a place to refuel, not a
sanctuary". The AI reads state directly; the player reads the view. So the
machine could shoot parked aircraft the player was never shown - the fog was
handing the AI a sanctuary the rules deny, and only to the AI. The fix is not
to add state 4 to a list but to ask `unitEngageable` itself, so the two can
never disagree again.

**R-001 was worse than "sloppy ordering".** `reject()` returns the state it
was handed; it rolls nothing back. So `liftOff` before a check meant a refused
order still took a parked Manta off the runway - and the interface said the
order was refused. Ordering is the fix, and the lesson is about `reject`, not
about those three functions.

**R-005 needed two things the finding did not mention**, and both only showed
up when it was measured. `stopClock` does not stop the ticks already DUE in
the pump that faulted, so the first version halted four times in a row, each
re-running the failing tick; the callback has to refuse on its own account.
And when the STATE is what broke, `saveGame` cannot write at all, because it
hashes the state - so the thing R-005 exists to protect, the command log, was
lost anyway. It now writes `<save>.halted` with the log and no hash:
recoverable by hand, deliberately not auto-resumable, because an empty hash
cannot be verified and resume refusing a mismatch is a guard I did not want to
weaken.

**R-006 came with a ruling** (owner: they should get their ship back). The
sweep released the hold at the end of the grace window, so `reclaim` could
never find the token and a late commander got the lowest free seat with their
name discarded. Keeping the hold fixes that, but it opens a second hole
immediately: a kept hold would reserve the seat forever for someone who may
never return. So `isHeld` now answers "spoken for?" differently for a
newcomer than for the absent commander - the AI is a caretaker, not a
claimant. One test asserted the old rule outright and was rewritten to the new
one.

**R-008 was a hit on code I wrote hours earlier**: the weather probe read the
scope by re-deriving "pad 10, helm width 250" from the panel source - our own
failure class, "a probe that selects the UI by position". The panel publishes
`__scopeBox` now. Verified the way the reviewer suggested: change `pad` to 22,
run the probe, watch it follow the scope.

**R-009 was under-counted.** The allow-list also carried `Bash(git fetch *)`,
which the working agreement prohibits outright, and `Bash(cd *)`. Gone, along
with `git push *` (which permitted pushing to `main`), `sed *` and `node *`.

565 tests, smoke clean, battery unchanged - these are refusal paths and the AI
does not walk them. R-010, R-011 and R-012 were outside the batch and are
still open.

---

## 2026-08-27 — A sea that is a spectrum, and cloud that has shape

Owner, after watching it run: the ocean should look alive like the reference
scene, the cloud should look realistic, and the modern tier "had the same
uniform ocean waves". All three fair.

**The waves were uniform because there were four of them, all pointing the
same way.** Four Gerstner components within a few degrees of the wind is
corduroy - parallel ridges of one size, marching. Twelve now, but the count is
not the fix: the DIRECTIONAL SPREAD is. Long swell runs with the wind because
some other wind raised it days ago somewhere else; short chop fans out. So
spread grows with frequency - the 210 m swell within 7 degrees of the wind,
the 4.5 m chop up to 80 degrees off it. Crossing wave trains are the whole
difference between water and a combed carpet.

The reference scene got there from the other end: 26 waves in mixed directions
baked into a normal map. Same idea, ours in geometry.

Two more the sea needed: ripple detail in the FRAGMENT, because at six metres
between vertices every wave shorter than that - which is all the glitter - has
to live in the normal or the surface reads as plastic; and whitecaps keyed to
the WAVE normal rather than the ripple-perturbed one, because the first
version made every centimetre of chop a breaking crest and turned a gale
whiter than noon.

**Cloud was a smear.** A four-octave value fBm at one low frequency looks
exactly like what it is. Domain warping is the big one - sampling noise at a
position displaced by other noise turns blobs into curling, torn, sheared
forms - plus more octaves at a frequency where they show, and light from a
direction: one extra density sample toward the sun gives the silver lining
where the deck thins into the light.

**Three defects surfaced on the way, all ours.** The swell patch and the
mirror sea had drifted apart - the mirror was being tinted by the weather
while the patch kept a hardcoded blue, so the seam showed as a tone step in
the middle of the frame; one `seaColourFor()` feeds both now. The cloud shell
was being reflected by the water from the wrong place, because it rides the
eye and the reflection renders from a mirrored camera - pale mottled patches
that moved with the ship. And excluding it then made the storm sea brighter
than noon, because the water was left reflecting the bright Preetham dome:
at grazing angles, which fill most of the frame, the reflection is ALL of the
colour and `waterColor` has no say at all. Darkening the dome with rayleigh
fixed it, and is right anyway - the sky behind cloud should be dark, not
bright with dark cloud pasted over it.

**And the lesson, which cost the most and is worth the most: three.js
interpolates colour in LINEAR space.** Colour management converts every
`new THREE.Color(hex)` to the linear working space, where a bright warm
colour is much brighter than its hex suggests - so a linear blend keeps its
warmth long after the weight looks nearly complete. A dawn peach lerped 94% of
the way to cold slate came out `#5a4e51`: brown. I raised that weight by eye
three times and it barely moved, because the number was never the problem.
**Printing the uniform found it in one run.** The fix is a curve rather than a
bigger number - storm to the 0.45 power, so 0.9 pulls at 0.95 and the last few
per cent, which are the ones that change the hue, actually arrive.

That is the second time in two days that guessing at a rendering number wasted
more effort than measuring it would have. Both are now in docs/07 (lesson 12)
and the review skill.

**Also fixed, and it was a test lying to me:** the lightning-on-the-scope check
was sampling a band of the 3D scene at the panel's height rather than the
panel's own 2D canvas, and "passed" because a flash brightens the whole scene.
It was measuring the sea and reporting on the radar. It only came apart when
cloud reflections left the water and the two readings collapsed to the same
number. It now reads the instrument canvas, demands a real margin rather than
any difference at all, and was verified by switching the clutter off and
watching it fail.

Measured after: water variance in `graphics_shots` went 429 -> 2164, storm sea
97,104,112 against noon 117,116,115 (darker AND blue-dominant, where it had
been brighter than noon), storm sky uniforms `#3e404b` / `#2e343e` where they
had been the brown `#5a4e51`.

---

## 2026-08-27 — The sweep retries once, and says so

*(Then the first full run with the retry in place found one more thing, which
is recorded at the end of this entry.)*

Owner's ruling, after the flakiness above: `npm run probes` retries a failed
probe once and reports `ok (2nd try - FLAKY)`.

The point is not a green sweep. Every probe that needs a second attempt is
listed by name under a FLAKY heading at the end of every run, and the exit
code counts only probes that failed twice. What the retry buys is that a real
failure is no longer buried among two false ones — which is exactly what
happened in the sweep before it, where `second_war` (a renderer artefact),
`playtest_round2` and `playtest_round3` (both contention) made a clean run
look like three broken features.

Verified with two throwaway probes: one that fails then passes, one that
always fails. The first is reported flaky and named; the second fails twice
and sets the exit code.

**And then the first full run with it caught a probe the retry could not
save: my own.** `weather` failed TWICE - a page load timing out at 30
seconds. It passes perfectly alone, and it is the heaviest probe in the suite
by a wide margin: seven loads of the High tier, the one path headless
Chromium rasterises in software. It also sorts last, so it runs when the
machine is most loaded, and the retry ran immediately afterwards with the box
still busy.

That is the honest limit of a retry: it fixes contention that has passed, not
a probe that is simply too heavy. The fix is the probe. It now navigates ONE
page seven times instead of opening seven, and waits 90 seconds rather than
20 for the first tick - which is precisely what `graphics_shots.mjs` already
did, with a comment saying why ("Patience, not a lighter scene"). I wrote a
High-tier probe without the patience this repo had already learned High-tier
probes need.

One number worth recording while it is fresh: **a full sweep is now 5,128
seconds**, not the ~13 minutes docs/05 claimed. Use `npm run probes -- <name>`
while working; keep the full sweep for a hand-over.

---

## 2026-08-27 — The LAN room was never slow

Asked to fix "the LAN room takes 4 to 16 seconds to come back". There was
nothing to fix: I had measured the wrong thing, twice, and reported it both
times.

The reopen round trip with **no browser at all** - raw socket, `lobby_reopen`
in, the `lobby` message back - is **2 ms**, three runs out of three. No defect
in `reopenRoom`, the transport, or the client's handling of it. `saveNow()`
was never a suspect either: it returns immediately when there is no save path,
which is the probe's case.

The seconds were the renderer. `second_war` ran at `graphics=medium`, and
headless Chromium rasterises Medium and High in software. The page was janky
enough that Playwright's `click()` took 2.4 to 5.8 seconds just to consider
the button actionable - the server had already flipped to lobby *during* the
click - and the redraw took seconds more. Split across the two halves:

    click returned 2426ms | server flipped 1942ms | panel open 4080ms
    click returned 5806ms | server flipped 4739ms | panel open 12202ms

At `graphics=low`: 1.0 to 1.7 s end to end, and five passes out of five where
it had been two in three. Low is also simply correct for this probe, which is
about the war's lifecycle - end a war, take the room back, sail again - and
about pixels not at all.

**How the wrong answer survived two rounds.** The first report ("broken") came
from one failing run plus a snapshot 2.5 seconds after the click. The second
("4 to 16 seconds") came from timing the probe three times - real numbers,
wrong subject, and the numbers made it feel measured. What broke it open was
asking the same question a different way: run the path with the UI taken out.
Two milliseconds is not a slower version of four seconds, it is a different
system, and that gap is the tell that the instrument is in the measurement.

The rule that comes out of it, now in the review skill: **a headless browser
doing software rendering is not a clock.** When a UI probe says a feature is
slow, measure the path without the UI before believing it - and run every
probe at the cheapest tier that still tests what it is for, or it is timing
the renderer on every run whatever it thinks it is timing.

---

## 2026-08-27 — Reviewing the day's own work

A review pass over the five slices, looking for what they left behind. Six
things, in the order they matter.

**The console floated over the ending screen.** Six panels folded into one
shell means the group now has ONE z-index, and at 12 it beat the war-over
screen at 9 - so an open console sat on top of the result. Only `#log-panel`
had that bug before; grouping generalised it to all six. The shell is now at
8, with the rest of the HUD chrome, and the console shuts itself on the tick
the phase flips, because there is nothing left to manage.

**Fuel bites, and nothing said so.** The only fuel event in the engine fires
at ZERO, which is after the decision rather than before it. A cost the player
discovers by running dry is an ambush, not a choice. The ship now calls for
the lighter at 25% and again at 10%, once per mark, re-arming if a delivery
lifts the bunker back through it. Client-side, so no rule and no pin.

**`behaviorHash` had no callers.** It has existed for weeks with a comment
saying "when a golden hash moves, compare this", and a passing test, and
nothing used it - including `tools/repin_m0a.mjs`, whose entire job is that
question. I hand-rolled the comparison in a scratch script this session
without noticing, which is the tell. Every pinned step now carries a
behaviour hash and the tool reports it separately:

    hash drift:      first at tick 1: 822ace53… -> d339fcde…
    behaviour drift: none - the ruleset stamp moved, the war did not

Proven both ways before landing: adding an inert knob moves the hash alone;
changing `radarStormPermil` moves both. A function with tests and no callers
is not finished.

**The key list never mentioned J or Q.** The list behind `?` named `Z` and
stopped. The squadron console and the quartermaster - two of the largest
screens in the game - were reachable only by a player who had read docs/04.
One line now covers all four, and the retired `help.damage` string is gone
from both catalogues.

**docs/01 never mentioned the weather.** The simulation contract described
state, commands, hashing and randomness, and said nothing about the third
category the weather introduced: derived, stored nowhere, and read by the
engine. It now has a section, including the rule that keeps it honest - the
engine may ask the weather about its own seed and its own tick and nothing
else - and `test/engine_weather_seam.test.js` enforces exactly that by
reading every call site. Verified by breaking it on purpose: the tripwire
trips.

**Two things I checked and did NOT find**, worth recording so the next review
does not re-check them. The Viewing Drone and the decoys never reach
`stepWalrus` - both have their own branches that `continue` first - so the
sea-state slowing lands only on the Walrus and the lighter, which is the
classification the ruling wanted. And landing is gated on horizontal distance
rather than altitude, so the storm flight floor cannot strand an aircraft
that is trying to come home.

**Left alone deliberately:** `flightFloorUnits` converts units to metres and
back to call a rule written in metres, which is ugly and correct; and the AI
does not model slower boats in a heavy sea, which is benign because it
re-plans every few ticks rather than committing to an estimate.

---

## 2026-08-27 — The eight answers, built

The owner answered all eight open questions in one line each. Five needed
building; three were decisions not to.

**Sea state reaches the small craft (Q1b).** A heavy sea slows anything on the
surface and lifts an aircraft off the wavetops. Two things the tests hold
down. It applies AFLOAT only - a Walrus is amphibious and a heavy sea has no
opinion about a vehicle climbing a hillside, which would be classifying by the
wrong axis. And the flight floor binds the AIRCRAFT rather than the stick: the
AI cruises at 400 m and is untouched today, but a limit that binds only the
human is one the human reads as the game cheating.

Measured, and the measurement was the interesting part. The flight floor moves
the battery not at all, exactly as predicted. The speed rule is the whole
change - and seed 777001 turns out to be **chaotic rather than sensitive**:
26k ticks with the rule off, 82k at 650, 205k at 750, 48k at 850, not
monotonic anywhere. Three of the five seeds do not move at any setting. So the
battery genuinely cannot choose this number, which is worth knowing before
spending an evening tuning against it. 650 was chosen on feel.

**Fuel bites (Q6b).** At the old burn of 90 the bunker never fell below a
fifth in any war we ran, so ruling #3's whole fuel supply chain was
decorative. Burn is now 130: about an hour of hard steaming in a full bunker,
against wars of 25 to 70 minutes. 150 was tried and rejected - it leaves a
long war finishing on 1-3%, survivable for the machine and a knife edge for a
human quartermaster, who is who the rule is for.

The false trail here is worth recording. The first sweep reported ZERO
refuellings at every burn rate, which read as a dead supply chain. It was a
dead INSTRUMENT: deliveries arrive as ~400-fuel lumps against a 100,000
bunker - four per-mil - and my detector only counted jumps above five per-mil.
Instrumenting the flow showed 59,210 fuel delivered over a long war. Measure
the flow, not the feature; and when the flow reads zero, suspect the meter.

**A strike blooms the scope (Q3b).** Drawn under everything real, so a strike
can never hide a blip the player was entitled to see, and derived from (seed,
tick) so two players in one storm see the same noise. While in there, the
scope's range ring now draws `radarNow` rather than the fair-weather figure -
drawing the fair figure in a storm draws a promise the set cannot keep.

The probe's first version compared the strike against the storm mood, which is
a different scene entirely: it would have passed whether or not the clutter
ever drew. It now photographs tick 41719 as well as 41720 - same storm, cloud,
wind and sun, the stroke the only difference. A test that cannot fail is worse
than no test, because it reports confidence.

**One tabbed console (Q5b).** Six overlays with six keys became one overlay
with a tab strip. The panels were not rewritten: each still owns its element,
its `.open` class and its own toggle, and the console only decides which is
open, routing through each panel's own toggle so its internal flag cannot
drift from its class. Two judgements inside it: the chart keeps the whole
screen on its tab, because folding a map into a 620px column obeys the letter
of the ruling and loses what the ruling was for; and the island tab remembers
its subject across a close, because the console shuts every tab before opening
one and a forgetful close wiped the island on the way to showing it.

The smoke gate had the old model baked in - it pressed each panel key twice
expecting to return to where it started, which is right for six toggles and
wrong for a radio. Updated to ask the console what is showing rather than
assume which way a key will flip it.

**The probe sweep paid for itself three times over on this slice.** None of
these were visible to the tests or to the smoke gate:

- **Clicking open water closed the whole console.** That is the click that
  lays a course on the chart, so the map shut under every course the player
  laid. A sea-click now dismisses the ISLAND tab and nothing else.
- **The chart tab's floating strip sat on the camera-tab bar**, swallowing
  every click on HELM / WEAPON / BIRDSEYE. It keeps the console's own corner
  instead, and the chart's button row drops below it.
- **Moving the chart canvas inside `#console` made it a stacking context.**
  At z-index 12 the full-screen map painted over the whole HUD. On the chart
  tab the shell is now static and sizeless, with `display: contents` on its
  body, so the map stacks exactly as it did as a top-level overlay.

And a fourth from the WEATHER work, which only a full sweep would have
connected: `graphics_shots` asserts a blue zenith, which was a fact about the
pipeline while the sun was nailed at 49 degrees and became a fact about the
weather the moment the sun started crossing. It now freezes the sky at a
clear noon, found by condition rather than hardcoded.

**On the sweep's own reliability.** 29/31 in the clean run, but all 31 pass
when run individually: `playtest_round2` and `playtest_round3` fail only
under thirty-one back-to-back browser launches (the second by outright
SIGKILL). `second_war` was flaky too - see the entry above for what that
turned out to be. Three flaky probes cost the sweep most of its authority,
because a sweep you have to re-run to believe is one you stop reading.

**The dead keys go (Q6a).** `startFuel`, `startOrdnance` and `startMaterials`
were read by nothing. Deleting them moved the golden pins, which surprised me
until I looked: `state.rulesHash` hashes the whole ruleset so two LAN peers can
prove they hold the same game. That is the field working. Proven by hashing
3,000 ticks with `rulesHash` blanked - identical, tick for tick - so a pin move
is not by itself evidence that the war changed.

The dead-key test grew the check that would have caught `rules.startMaterials`,
which hid because `units.json` has a live key of the same name and the check
matches bare names.

**Not built, by ruling:** no rain or spray yet (Q2b); the squadron numbers
stand as they are (Q4a); the six oversized engine modules stay (Q7a), because
splitting churns the files the pins depend on for no behaviour change.

---

## 2026-08-26 — Weather, and the one thing it is allowed to touch

Owner's ask: a more lifelike ocean, wind-aligned waves, weather that tells a
story from near-white cloud to a grey-dark-blue storm with lightning, a sun
that crosses and casts shadows with no complete darkness -- render-only at
first, High tier only.

**The design decision is that the sky is a pure function of the war.**
`weatherAt(seed, tick)` returns sun, day, wind, cloud, storm and this tick's
lightning as integers, out of nothing but the seed and the tick, and is
stored nowhere. Every client in a LAN game and every replay sees the same sky
at the same moment with nothing crossing the wire; the state hash cannot
carry it; and because it is pure and cheap the *engine* may read it too. That
last one is what turns weather from a screensaver into a rule, so it went
into the Luau-portable subset from the first line.

**One effect is wired, per the ruling: heavy weather shortens radar**,
floored at 700 per-mil. Everything else -- swell, cloud, lightning, colour,
exposure -- is cosmetic and gated on High + modern.

That one effect earned its place. The battery moved on two of five seeds, and
seed 777001 moved a long way: a 192,713-tick war won on island count became a
26,203-tick war decided by sinking, and its worst quiet spell fell from
30,689 ticks to 8,769. I checked it was really the radar rule by setting the
floor to 1000 and re-running -- the old numbers came straight back, to the
tick. The mechanism makes sense: shorter radar in weather pulls both fleets
closer before either can shoot, so a squall turns a standoff into a knife
fight. Seed 31337 lengthened slightly (50,536 -> 54,186); the other three did
not move at all.

**Three days of graphics lessons in one slice**, all recorded in docs/07 as
lessons 8-11:

- A **flat cloud plane cannot work** for a chase camera -- it is past the far
  plane at every angle that matters. It became a sky shell that projects each
  fragment's view ray onto a virtual deck. And the shader has to handle an eye
  *above* the deck too, or the strategic view gets a brown dome overhead.
- **The horizon must agree with itself.** Sky, cloud, fog and sea all meet at
  the sea line, and any one of them fading to nothing there opens a bright
  strip exactly where the eye rests.
- **A storm has no lit side.** This one took three passes. Applying the sun's
  warmth first and the storm's grey second leaves a squall at dawn reading
  brown, at any weight I tried; the storm has to take the haze, the cloud's
  lit face, the water colour *and* the sun glitter together. Measured, the
  storm sky went 134,128,127 -> 113,108,108 across those passes, and the sea
  61,60,61 -> 41,39,40.

**And one that was entirely my own fault**, worth writing down because it
cost the most: I spent a long session convinced the cloud material was broken
-- `side: 0`, `transparent: false`, nothing drawn -- when a leftover debug
script of mine was replacing the material before every measurement. I was
inspecting my own scaffolding. Remove the scaffolding *before* trusting the
instrument.

**The new probe measures rather than photographs.** `debugging/probes/weather.mjs`
finds five moods by condition (not by hardcoded tick -- that is what made
three older probes stale), freezes each with `?weather=`, and reads the
average colour of a sky band and a sea band out of the frame buffer in the
same JS turn as the render, per lesson 7. A shader that silently does nothing
still produces a beautiful screenshot; only the numbers catch it. The
assertion I care most about is the dullest: all five moods must render
*different* skies, which is what would catch the whole path being switched
off.

Two assertions carry the owner's ask directly: night must be far darker than
day but never below a steerable floor, and the storm sky must not be warm.

**What moved:** the golden pins moved together for the radar rule (a ruled
gameplay change), 540 tests pass, smoke is clean, and the battery is
re-measured above. `radarStormPermil` joins `data/rules.json`.

**Deliberately not done:** wind does not push hulls, storms do not affect
flight or gunnery, and there is no rain, spray or wet-deck effect. The ask
was render-first with one effect wired; the rest are rulings the owner has
not made yet.

---

## 2026-08-26 — Review, part two: the checks that would have caught it

Where the first review slice fixed behaviour, this one mostly builds the
things that would have found it without me.

**The fog, as a shape rather than a field list.** The contact views were
checked by naming fields one at a time, which is precisely how a leak gets
in. Two property tests instead: an enemy record must carry exactly the same
KEYS as one of your own, and every number on an enemy's records is branded
with a sentinel that must not appear in the other side's view. They found
drift immediately - `chassis` was on the own carrier view and not on the
contact one; nine unit fields (maxHp, ceiling, commPod, telemetry,
deckPermil and the four payload figures) were missing from the unit contact
view; and four CARRIER fields had landed on the unit contact view through a
careless replace of mine. Islands and the referee view were already
consistent, and are now pinned that way - the referee view has been wrong
once before.

**Save and resume with the newest vocabulary.** The command log IS the save
format, and the six commands the squadron batch added had never been through
it. One of them, `set_route`, is the first command in the game that carries
an array. A war that uses all six now saves, reloads and replays to the same
hash.

**Three constraints that existed only in prose.** "Style is data; nothing
cosmetic may touch the simulation" has been a standing constraint since
2026-08-19 with nothing enforcing it. The Luau-portable subset has been a
rule since day one and had eleven violations. The numbers the docs quote had
never been checked against the ruleset - those all agreed, but the reverse
sweep found five keys nothing reads. All three now have tests, and the dead-
key test works both ways: a key declared inert that something starts reading
fails too, so the list cannot rot into a lie.

**Watchdog tripwires** for the three new invariants: a hull over its payload
budget, a craft stuck in the deck cycle (a stall the stall detector cannot
see, because the war around it is busy), and a course leg off the chart.

**The gate opens every squadron page now**, not just the panel - four
screens behind one key, and a page that throws while drawing is invisible to
a gate that only presses J.

**Two findings queued rather than taken**, both in dev-questions:
`startFuel` and `startOrdnance` are unused while the ship sails brim-full,
contradicting her own documented "finite issue" - and wiring them is a real
balance change (measured: three seeds, three starting values, 20k to 299k
ticks). And six portable modules are past the 300-line soft cap, reducer.js
at 857; the subset test guards 900 so it cannot get worse meanwhile.

**Looked at and deliberately left:** a sunk carrier's STOWED hulls stay
stowed rather than being lost with her. Kills score through shots.js, so
nothing reads them and changing it would move hashes for no gain.

**And two small things worth the trouble.** Ten imported names that nothing
used any more, most of them left behind when the AI stopped calling
`launchUnit` and started riding the deck cycle - none of them a bug, all of
them a lie about what the file does. There is a `hygiene.test.js` for that
now, and for merge markers and stray prints from the portable half.

The other: a craft in the deck cycle sat at the WATERLINE on the spot the
hangar left her, which is inside the hull and behind it the moment the ship
makes way. Five seconds of an invisible aircraft. She rides the deck now, at
deck height, and you can watch her ranged there before she goes - which is
the visible half of a feature that was otherwise only a status line.

**Cost:** 531 tests (+8 files across the three review slices), smoke green,
battery 5/5, 29/30 probes - and the one failure was `squadron.mjs` asserting
a page COUNT, stale one day after I wrote it. It asserts the page NAMES now.

---

## 2026-08-26 — Review: the deck cycle's second order, and the subset enforced

A review pass in the owner's absence, by the method in the engine-review
skill. Five findings, four fixed, one queued because it is a balance
decision.

**The fitting screen took money after the whistle.** `set_station` and
`set_device` are withdrawals from the stores exactly as `build_on_island`
is, and they arrived after the 2026-08-23 ruling without being told about
it. Guarded - and the test is now a SWEEP over every command that moves
goods, so the next spending command that forgets fails here rather than
being found by eye.

**The machine did not pay the deck cost the player pays.** The AI and the
supply run called `launchUnit` directly, so a human waited five seconds on
the lift and the machine did not. Everyone rides the lift now, which needed
three careful edits rather than one:

- the AI's "have I already sent a Walrus?" counted only ACTIVE, so it would
  have ordered a second and a third during the five seconds the first was on
  the ramp. There is a `unitCommitted()` for that now, and the strike's
  top-up counts committed airframes rather than airborne ones.
- the strike used to push the launched event itself; the deck pushes it when
  she actually leaves, so the manual push was a duplicate.
- the supply boat used to be given its order at the moment of launch. Launch
  RESETS a hull's orders, so the order was thrown away - and worse, a run
  that stood down while she was still on the ramp left her adrift at sea for
  the rest of the war, because the recall only looked for a boat that was
  loading. She is ordered when she is afloat, and anything not actively
  delivering is called home.

**The hold's ceiling is a delivery rule, not a container.** Landing stores
off a hull put the ordnance store over capacity, because the ship starts
with both the hold and every magazine full. Capping it made the fitting
screen dead at tick one; destroying the excess would have broken ruling #3.
The rule now reads: `ordnanceCapacity` is what the ship can take in from
OUTSIDE - it is the limit engine/supply.js unloads against - and a round
moving from a rack to the hold never left the ship. The instrument bars
clamp at the brim so nothing draws past its bezel.

**The Luau-portable subset was a rule nobody checked.** Eleven violations,
including a comparator `sort` in the AI, `.includes` in the reducer itself,
and `.shift()` in the snapshot ring. All rewritten as loops - the AI's sort
is an insertion sort with the same total order, so the result is unchanged -
and there is now a TEST that reads the sources and fails on the next one.
Three files throw on purpose (the hash canonicaliser, the fixed-point
overflow guard, the PRNG's empty range); those are named exemptions.

**Queued, not fixed:** `startFuel` and `startOrdnance` sit unused in
`data/rules.json` while the ship sails with a brim-full bunker and hold -
which contradicts the comment beside `startMaterials` saying she sails with
a finite issue. Wiring them is a balance change and it is a real one:
measured over three seeds, seed 31337 runs 50k ticks at the current 6000,
299k at the ruleset's 2000, and 42k at 3000. Owner's call (dev-questions).
Also queued: six portable modules are past the 300-line soft cap by half
again or more, reducer.js at 857. The subset test guards 900 so it cannot
get worse.

**Cost:** 514 tests (+3 files), smoke green, battery 5/5 - and pacing moved,
because the machine now pays for its own deck: seed 20260818 resolves at
59,728 rather than 160,891.

---

## 2026-08-26 — The last three consoles: gunnery, the screen, resources

The tail of docs/10 gap 5, and with it the 1988 interface review is closed
apart from two things noted as deliberate (the 2x2 quad camera view, and
craft selectors as icons rather than numbered chips).

**GUNNERY.** In WEAPON view the right-hand instrument box stops being the
ship's condition and becomes the gun's: an orientation dial with the hull in
plan bow-up and the gun line swinging round it, a TEMP gauge against the
weapon's own heat ceiling, and `LASER OPERATIVE` / `MOUNT OPERATIVE` in
words. Heat has been in the engine since the 1988 weapon sets and had never
once been on the glass - a player learned about overheating by the gun going
quiet.

The dial needed an honest answer to "where is the gun pointing". Ours does
not traverse mechanically - it fires at what it is pointed at - so it reads
the DESIGNATED target when there is one and the boresight otherwise, and
there is no slew D-pad because there is no slew. A target abeam swings the
line out to the beam, which is the picture the original's diagram gave.

**THE SCREEN.** The defence drones get the fourth page of the squadron
console, and it is the ship's page rather than a craft's, so it hides the
craft rows. Four patterns - RING, AHEAD, ASTERN, FLANKS - and three spreads,
with the counts out / aboard / lost and a plan drawn TO the chosen spread, so
the picture is the setting rather than an illustration of it. Both are
changeable while the screen is out: moving bait mid-engagement is the
manoeuvre, not a setup step. The price is untouched and still ruled.

**RESOURCES.** A second reading on the chart beside NETWORK: the archipelago
by role, yours against theirs, the neutral count, the depot by name, and the
sum of what your islands hold. Two goes at placing it - first under the left
action column, then under the right - before it landed clear of both and
below the top bar. A reading under a row of buttons is a reading nobody
reads. MILESTONE has no counterpart: the original's campaign had one and our
war does not.

**Cost:** 508 tests (+6), smoke green, battery 5/5 unmoved. Both pins moved
with --force for the two new carrier fields - state shape, and at the
defaults no change in behaviour at all. New probe `consoles.mjs` drives all
three. One small find on the way: `.sq-act.on` had no style, so a selected
pattern chip looked exactly like an unselected one.

---

## 2026-08-25 — The squadron console: outfitting, the deck, and typed pods

Owner watched 83 screenshots of a PC/DOS playthrough back against our client
and named the gap exactly: managing, outfitting, launching, plotting course
for, recovering and piloting Mantas and Walruses. The analysis is
docs/10-squadron.md, and it comes to one line - **we have almost every
mechanic and almost none of the console.**

Four rulings (docs/06), three built in this pass, waypoints still to come.

**The fitting screen is a weight problem.** Every store now weighs something
and every hull has a budget, in grams on the record because a laser round
weighs less than a kilogram and the engine has no floats. The numbers are the
original's where the original stated them - a 60 kg air-to-air missile, a
400 kg ACCB pod. A brim-full Manta is exactly 750 kg, so the preset the ship
has always launched with is the brim rather than an overload. A Walrus is
1,400 kg of guns and mines in a 2,000 kg hull, which means it goes ashore
with the pod OR the bomb: it used to be handed both for free, and choosing is
the whole point of the screen.

Weight is a CAPACITY rule and not a flight model - a light Manta is not
faster, exactly as in 1988. If that changes it belongs in flight.js.

**Launching is an operation.** IN HANGER → ON FLIGHT DECK → LAUNCHING → away,
about five seconds, with a progress bar and a standing ABORT; recovery is the
mirror, DOCKING → IN DOCK, and drifting out of the envelope means going round
again. The lift is the MIDSHIP section, which we already had - wreck it and
the air group is stranded below decks, which is what the original's repair
screen was telling you all along. Shuffling craft fore and aft on the deck is
deliberately not carried over: a 1988 interface for a 1988 problem.

Scenario tests run with the cycle at zero (`instantDeck`, alongside the other
four things `bareRules` strips) and a zero-length cycle completes inside the
command, so "launch" still means launched. integration_capture plays it for
real.

**Pods are typed.** POD - RESOURCE / FACTORY / DEFENCE, chosen at the ship,
riding to the beach; the island board may still re-role it afterwards, which
is the one liberty we keep.

**The console** is `J` - two craft types, a numbered 1-4 selector, and three
pages: BOARD (what every hull is doing, with the deck clock), OUTFIT (the
fitting screen, with a plan of the craft and its hardpoints) and DECK
(launch, abort, recall).

### What the battery found

Three things, and only one of them was the deck.

1. **The supply boat loaded by a fixed order, not by shortfall.** Seed
   20260818 stopped resolving at all: a carrier at 87 of 1,000 hull with ZERO
   materials while its own depot held 61,571, because the hold filled with
   fuel every run for a ship already 58,327 fuel to the good. It could not
   mend, so it retreated, and kept retreating for 340,000 ticks. The boat now
   loads EMPTIEST FIRST. The note above `chassisWanted` records the identical
   lesson being learned once already for parts - nobody generalised it, and
   materials had it too.
2. **The AI's shopping list still had no word for materials.** Third time
   that list has been found short: fuel and ordnance from the start, chassis
   after seed 900913, materials never. A damaged ship now calls the boat.
3. **Typed pods froze the machine's estate.** `planFor` was only ever asked
   about an island with NO role, and after typed pods no island has none - so
   no AI team ever built a factory again. The machine now loads the pod its
   estate wants, and re-roles an island whose plan changed while nothing is
   built on it.

And the deck's own defect: `beginDocking` was called every tick while a craft
sat in the envelope, restarting its clock, so nothing ever came aboard -
aircraft flew an endless final, ran dry, and were rebuilt at chassis cost.

Then a fourth, and it was mine. Letting the estate re-role an island whose
plan had changed - the fix for typed pods - exposed an oscillation that had
always been latent in `planFor`: it asked "what should this island be" while
counting that island's own role in the answer. A RESOURCE island makes the
plan want a FACTORY; a FACTORY island makes it want a RESOURCE. One island
flipped every three ticks for a whole war. Nothing was built on it, no team
ever raised a plant, and by tick 300,000 both fleets sat on full holds of ore
with empty bunkers - which is what the from-zero AI race test had been trying
to tell me for an hour. The question is now what an island should be GIVEN
THE REST of the estate, which is stable by construction. The old code was
safe only by accident: it planned an island once, when it had no role, so the
loop could not close.

The from-zero race resolves at tick 82,931 again.

**Cost:** 502 tests (+22 across four new files), smoke green with a gate that
now waits for the ramp instead of pressing T on a timer, battery 5/5
(19k-161k ticks), the from-zero AI race back at 82,931. Both pins moved three times with --force: a state-shape
change and a ruled gameplay change in the same batch, with one explained
event drift (the fixture's tick-4 recovery now lands later). New probe
`squadron.mjs` drives the console through the glass - fits a store and
watches the budget move, types a pod, and runs a hull from the hangar to away.

Six probes and the gate needed the same fix - press the button, then WAIT for
the ramp, rather than pausing a fixed half-second. None of them was wrong;
all of them were written when launching was instant. The waits are generous
because in SOLO the engine is driven by the animation frame: a hundred ticks
is five seconds at the table and the better part of a minute in a headless
browser sharing a machine with the rest of the suite.

**Still open from the batch:** the smaller 1988 things in docs/10 gap 5 - the turret console's TEMP gauge and
orientation diagram, drone placement, the RESOURCES counts.

---

## 2026-08-25 — Chasing the lobby probe, and what was behind it

The lobby probe had been failing. Owner asked me to chase it. The room was
fine; the probe was clicking the wrong thing — and the sweep that followed
found one real bug that had been live for days.

**The lobby probe.** It clicked "the first settable row" and asserted the
island count had changed. True until the war room gained rows above it — the
start ladder went in at the top — after which the click cycled somebody
else's option and the probe reported a broken lobby. Verified by hand first:
a host's change reaches the guest in under half a second, and both sides
start in the same war. Now selects by NAME and reads the chosen value back
rather than hardcoding 16, because the menu's default island count is a
ruling that has already moved once.

**Two more of the same.** `start_menu.mjs` had drifted so far that its
second click was commented "enemy carrier" while it cycled the table size.
`second_war.mjs` timed out waiting for 32 islands it was never going to get.
`gunsight.mjs` read `hud-weapons`, a HUD line the round-four rulings moved to
the weapon group above the panel — it died on a null and read as a broken
gunsight. `playtest_round2.mjs` asserted that four fifths of the throttle bar
is 80, which stopped being true when the astern gear made the scale -25..100
(four fifths is 75; 80 is at 0.84). All fixed, all now compute or read back
rather than hardcode. The gunsight probe gained real assertions while I was
in there — it was collecting the weapon readout and never checking it — and
round two now covers the astern end of the scale it had not known existed.

### The one that was not the probe's fault

`client/panels/island.js` called `islandName()` **without importing it**. The
island board threw a ReferenceError for every player who clicked one of their
own islands: no title, no choices, a dead panel. It is on the critical path
for the playtest — A2 asks you to open a board and build a runway.

One line to fix. The interesting part is why it survived: the smoke gate
fails on ANY console error and would have caught it in a second, but nothing
in the gate ever opened that panel. The gate now opens every panel with a
key and clicks an island you own, and asserts the board came up with a title.
Verified by deliberately removing the import again: four failures, both
transports, exactly as it should.

One more turned up in the first full sweep: `turret_shot.mjs` asserted the
renderer held EXACTLY the four guns it injects, which was true while a war
began on a bare ocean. The home island (two guns a side) and the neutral
silos put real batteries on the chart from tick zero, so ten were already
drawn and fourteen read as a broken turret layer. It measures the delta now.

**`npm run probes`** now runs the lot (`-- name` to narrow), so this cannot
rot silently again. 28/28 green in about 13 minutes. Two skill rules follow it: select DOM by name, never by
index; and a new panel needs one line in the smoke gate that opens it.

**Cost:** no engine change — one missing import in the client, five stale
probes, one new runner. 480 tests, fixture unchanged, smoke green with the
new panel sweep, 28/28 probes.

---

## 2026-08-25 — Nose to nose, and the ladder settled

Owner's answers to the four questions the start ladder left open: **90% is
the right bar** for a late war, **10-20 km apart is fine** for it, **the
menu should open on 8 islands**, and — the new work — a fifth rung,
*"Nose-to-nose which is late game by close start"*.

**The menu default.** The islands ladder reads 4 → 8 → 16 → … so the cycle
runs small-to-large, and the first rung was silently the default: a fresh
menu opened on a 14 km sea. Options may now state a default instead of
inheriting one from position; islands states 8, the ruleset's own figure.
The war room already read its default from the ruleset, so only the menu was
ever wrong.

**Nose to nose (shape 4)** reuses the late war entire and replaces only the
placement. Marching further in could not have delivered it: a late sea is
wall-to-wall gun envelopes, which is exactly what holds the ordinary late
war at 10-20 km. So this shape does not march — it picks ONE meeting ground
and puts the fleet on a circle round it: seat 0 due east, the rest evenly
spaced, 4 km between neighbours. A candidate is taken only if EVERY hull on
it has open water, no battery in reach and its sea room; never a fleet
half-placed.

The search order mattered more than the search. Radius has to be the OUTER
loop — the tightest circle that works anywhere on the chart beats a loose
one at the middle. Written the other way round (ground first, then grow the
ring) a two-carrier war took a 28 km ring at the map centre and called it
nose to nose.

Measured, 16 islands: two carriers exactly 4 km apart on every map and seed;
four make a ring 5.7-8 km across; sixteen put neighbours at 4 km. A round is
in the air inside the first minute on all three battery seeds, against 0-15
minutes for the ordinary late war. Two of three then ended within a minute —
which is the empty player seat again (see yesterday's entry): 4 km is lethal
to a ship that does not manoeuvre. Whether it is lethal to a HUMAN is the
one number left open, and PLAYTEST A5 asks it.

**Cost:** 480 tests (+1), fixture unchanged, smoke green, battery 5/5 and
unmoved (shape 0 is untouched by any of this). `late_war.mjs` now takes a
rung argument and photographs either.

**Unrelated, found while running the probe sweep:** `debugging/probes/
lobby.mjs` fails — a host's option change does not reach the guest, and both
sides start on the default island count. It fails identically with this
slice stashed, so it is older than today; not diagnosed yet.

---

## 2026-08-25 — The start ladder, and the spawn defect it uncovered

Owner's ask: choose how far along the war is when you sit down. Four rungs —
a home island each (default), nothing but the ship, developed (a third each,
a third neutral), and late (everything held, built and upgraded) "for late
game testing for humans especially."

**One rule, not two switches.** `actionStart` and `homeIslandStart` were
independent booleans whose four combinations included two nobody designed.
They collapse into `startShape` (0..3): one rules key, one war-room row, one
start-menu row, one i18n string set, one fold in `shared/options.js` — which
also maps the old pair, so saves and replays from before today land on the
rung they meant.

**The late war needed a different victory.** Handing out the whole
archipelago IS two thirds of it, which ends the war before tick one. First
answer was to cap the share, which turned out to be a lie: on a four-island
sea the menu promised "the whole archipelago held" and dealt one rock each.
Second answer, kept: a late war raises the island bar to 90%. Everybody
starts holding their third, so holding a third cannot be the win — you have
to take what the other side built. Derived from `startShape` at build time,
so a replay recomputes it.

**Closing the distance became a fleet manoeuvre.** The per-carrier nudge the
developed start had used since August 23 walked both ships to the same
point when the late war asked it to go further: 611 m apart on seed 900913,
one sunk in ten seconds. It now runs over the whole fleet in lockstep, ten
rounds, each step vetoed by land, by a rival battery's envelope, or by 4 km
of sea room owed to another hull — and a vetoed step no longer ends that
ship's march, because a placement is not a voyage. One island in the
straight line used to read as a wall: a 32-island late war stopped every
carrier a third of the way in while the water past the rock was open to the
middle. Nearest enemy island at tick zero fell from 26 km to 16 km on that
configuration.

### What the measurement actually found

Chasing "the late war fires no shots in five minutes" led somewhere else.
On a four-island sea, **three seeds in four spawn a carrier inside the enemy
HOME island's 3,500 m battery** — destroyed inside a minute, without
scratching the enemy ship. Same failure the third review found in the
developed start on 2026-08-23; the default opening simply never got the
clearance walk. It has one now, shared by all shapes:

- fanned retreat (seven bearings, not one) — straight back from a gun is
  often straight into a beach, and stopping there leaves you at the muzzle;
- a second pass that accepts water merely deeper than the ship draws when
  the strict test (a clear 500 m ring) finds nothing — a spawn can sit in
  four fathoms with a shoal inside every ring, and keeping a clearance rule
  by staying under the guns is the wrong trade.

Pinned: no carrier starts within any hostile battery's reach, across five
seeds x three island counts x three armed shapes.

**A wrong turn worth recording.** Before finding the battery, I "fixed" the
symptom in worldgen — a spawn-separation pass pushing corners apart. It
moved two seeds of five and made one war END FASTER, which is the signal
that it was treating the wrong thing. Reverted. The tell I nearly missed:
the loser always died with the winner at 100% hull, and in the headless
battery **team 0 is the empty player seat** (`aiTeams: [1]`). A stationary
unmanned ship, not an AI defect. Check who is driving before diagnosing a
one-sided war.

**Cost:** 479 tests (+6), fixture unchanged, smoke green, battery 5/5 — all
five resolve by sinking, 19k–96k ticks. New probe `late_war.mjs` walks the
four rungs through the real menu and photographs the late war's first
moment; it asserts the front (the nearest enemy-held island) is inside the
20 km leash, which is the honest form of "already in the war" — the enemy
FLAGSHIP is 10-20 km out and often not on the scope at tick zero.

**Open for the owner (PLAYTEST A5):** is 90% the right bar for a late war,
or should it run on points and time? And should a late war start nose to
nose rather than 10-20 km apart?

---

## 2026-08-24 — The third capture path: shoot the command centre out

Second source review, item 1 - the one genuine MECHANIC the CRASH review
showed we lacked. An owned island's command centre now stands at the
node with 400 shield points (data: commandCentreHp); enemy fire that
reaches the node - direct rounds in the flight sweep, splash from the
detonate path - chews it down, and at zero the island goes to NOBODY:
clearWorks takes the factories, warehouses, turrets and runway with it
(CRASH: "the missile launchers blow up"), the owner is -1, and the bare
rock takes an ACCB like any other. A neutral island has only a marker
mast - nothing to hit. Ownership paths (pod, virus, action start) raise
the shields; destruction is chart-level news (event 43, common
knowledge like a capture).

Delivery needs no new targeting: the boresight IS the delivery system -
a piloted gun run down the nose, or splash weapons. The test flies one,
and found the terrain teaching gunnery: this node's ground RISES to the
west, so a 300 m approach flies its bolts into the hillside - the
passing shot's endpoint ground check is downstream of the node check,
which is why a CLOSE run works and a long one digs trenches. The node's
terrain height is computed once at worldgen (island.nodeZ) so the sweep
never samples noise per shot.

Both pins re-pinned (nodeHp/nodeZ + the rules key), zero event drift;
battery endpoints byte-identical - AI wars do not strafe centres (yet).
444 tests, smoke green. Bat Caves and neutral silos stay with the
docs/09 discussion, as flagged.

## 2026-08-24 — The chart and the chips: the second source review's UI slice

The CRASH 63 + Spectrum screenshot review (dev-questions §30) showed four
UI constants every 1988 screen kept and we lacked. All landed as one
slice, view-layer only, no pins.

- **The CHART**, on the tab row after BIRDSEYE: a real map screen at last
  - named islands (the names shared/names.js already derives), owner
  colours, role letters, runway/depot marks, own hulls solid, contacts
  hollow, ghosts crossed, the course diamond. Drag pans, wheel zooms, FIT
  reframes, NETWORK overlays the shipping star to the depot. Clicks route
  through the SAME handleWorldPoint as the 3D viewport - extracted for
  the purpose - so water is PROG, an island is its board, a runway is an
  approach, and the two input paths cannot drift.
- **SCORE always on screen** - it was in every original screenshot and
  the point cap is an end condition; ours had been hiding in the DBG
  strip. describeScore, bottom right, every frame.
- **PAUSE as a lit button**, and the **A chip** for the autopilot -
  lit while a course stands, click to clear it.
- **Unit chips** bottom left (the cockpit shot's Manta icons 1-3): a chip
  per hull that is out, kind letter + id, a down-arrow when parked on a
  runway, lit when named, click to name - the same selection NEXT and
  5-8 drive.

probe chart_and_chips.mjs walks it all: score text, pause lighting, chart
open -> click water -> course + A lit -> CLEAR -> out, network toggle,
HELM tab closing the chart, a launched Manta's chip selecting with the
marker up. Smoke green; 441 tests unchanged (view layer).

## 2026-08-24 — The manual's three feel-changers: repair, the leash, runways

Items 7, 1 and 2 of the coverage review, in rising order of reach.

**7 - the hangar mends, damage slows, a cripple leaks.** Stowed hulls
repair on the beat, paying yard materials point for point; unit damage
scales speed AND agility in direct proportion (floored at a quarter so a
cripple crawls home; the anti-stall floor keeps a broken Manta flying);
below 12% the tank leaks - the whole capacity in two minutes on top of
the burn. The original kept these three together and so do we.

**1 - the telemetry leash.** Mantas and Walruses are DRONES: past 20 km
the picture fades (the cockpit warns), past 26 km the link dies and the
craft self-destructs. The lighter is autonomous and exempt; a sunk
carrier is a dead signal source. The link state rides the view FROM THE
SAME FUNCTION the engine's verdict uses. The AI obeys the leash - a
fade-line sweep every cadence, and no errands beyond nine tenths of it
(one loss in 30k ticks on the 64-island 16-team table). The 8-island sea
is smaller than the leash, so the battery did not move a tick.

**2 - island runways.** Resource and Defence islands build a strip; a
Manta approaches (slowing to minimum inside 2 km - at cruise its turning
circle exceeds the capture ring and it ORBITS the airfield to a dry tank,
measured at a 425 m orbit), lands inside 500 m of the node, refuels from
the island's own stock, and relaunches on any new order. Parked, the
island's Command Centre holds it - no telemetry to lose, which makes
island-hopping the answer to the leash, exactly the original's range
game. A parked Manta is a target; a captured airfield captures what sits
on it. One trap for the record: FLIGHT_LANDING first got value 4, which
is DRIVE_BLOCKED - fleet.js compares flight and drive outcomes in one
chain, and every landing read as "blocked". Outcome enums that meet in
one switch must not share values.

Three repins across the run (economy fields, telemetry rules, runway
works), all with zero event drift. 441 tests, battery five for five,
smoke green.

## 2026-08-24 — The manual's small trio: astern, signals, and the flavour pack

Items 4, 9 and 10 of the Amiga-manual coverage review, one slice.

**Astern.** set_throttle accepts -25..100 for the SHIP (units keep 0..100
- a Manta has no reverse). A quarter of the scale, as the original's speed
indicator had it, and a quarter of our flank speed lands near the
original's 22 knots astern. Making sternway the grounding feeler swings
AFT - the stern feels the bottom coming up - which is also what lets a
ship aground by the bow back herself off the reef instead of being pinned
by her own bow test; there is a test that runs a ship onto a reef and
backs her off. Fuel burns by throttle MAGNITUDE (the first draft burned
less than idle in reverse). The panel scale shows the astern fifth with a
zero notch; astern fills left, in red. Old logs never carry a negative
throttle, so both pins held without a repin.

**Signals.** The original's Messaging Computer: the last sixteen reports
with ages behind I/MSG. Text is put on ~24 event codes client-side, in
both languages, using the view's own fog-filtered event stream - the log
can never know more than the seat does.

**Flavour pack.** Island NAMES, derived in shared/names.js from each
island's seed and id - never stored, so every client and the server agree
without a byte of state (VARDO POINT, KELP HAVEN...). They title the
island board, the quartermaster rows, the signals and the new location
status line (position km / bearing / island in range, bottom centre, as
the original had). Rear view on O flips chase and gunsight. 5-8 select
the Nth hull that is out. And SURRENDER is a real command: double-ESC
inside three seconds scuttles the ship - hull to zero through the
ordinary path, so victory, events and the ending screen all follow by
their ordinary rules.

Probe flavour_pack.mjs walks all of it, ending on the struck colours.
430 tests + smoke green.

## 2026-08-24 — Playtest round four: the interface says where you are

Five rulings from an Action Game session, landed together. The thread
through all of them is the 1988 original's virtue: the interface always
SAID which console you were at, and ours now does.

- **Camera tabs**, top centre: HELM / WEAPON / BIRDSEYE, clickable, lit
  where you are; C still cycles. The names are the owner's.
- **WEAPON view makes the selector the console**: the weapon chips move
  to the bottom centre at full size - and that is where the "missing"
  carrier gun turned out to be hiding: LASER 600 now stands under the
  crosshair with F to fire it. Nothing about the gun changed; what
  changed is that the interface finally pointed at it.
- **The legend centred**: max-height + scroll, bordered, screen middle.
- **Context-enabled buttons**: an availability map computed per frame -
  PILOT sleeps until NEXT names a hull, POD/VIRUS until it is a Walrus,
  CLIMB/DIVE until a Manta is flown, LAUNCH until one is stowed, and the
  ship row (STOP/FLARES/SUPPLY/...) sleeps with the ship. A sleeping
  button keeps its place and drops to a third opacity: the column
  teaches the game's shape even while most of it waits.
- **NEXT shows what it named**: a spinning ring-and-pointer marker over
  the selected hull, hidden while piloting (the camera is the answer
  then), rebuilt per war like every scene object.
- **The piloting panel is the craft's** (supersedes round two's
  ship-always helm): FLIGHT or DRIVE on the left with the craft's
  compass/throttle/speed/fuel, the scope CENTRED ON THE FLOWN HULL (team
  fog, arranged around you), MANTA/WALRUS on the right - hull, altitude
  for the flyer or magazine bar for the gunner (magazine capacities come
  from the ruleset the client already fetched; the view carries rounds,
  not capacities), weapon tally, bearing home. The helm's clicks route
  through sendThrottle/sendRudder now, so panel and keys drive the same
  thing: whatever the panel shows.

probe playtest_round4.mjs asserts the lot: tab flow, the centred weapon
bar with LASER600 on the carrier, the centred legend, PILOT waking on
NEXT with the marker up, __panelMode flight->ship round trip, CLIMB
waking only in the air. 426 tests + smoke green; view-layer only, no
pins.

## 2026-08-23 — The third review's nine, closed the same day

The owner ruled "fix all", so all nine landed as one slice. 426 tests,
battery five for five, smoke green; no pins moved (the action start is
not pinned, and nothing touched the base two-team war).

1. **The Action start no longer spawn-kills.** Allocation for every team
   runs FIRST, round-robin - one island per team per round, so a crowded
   table shorts late rounds rather than late seats - and only then do
   carriers move. The nudge refuses water a rival battery already reaches
   (longest turret weapon + 1,200 m), and a spawn that ended up inside an
   envelope anyway backs straight off the nearest gun. Seed 31337's
   16-team table, which lost teams 14 and 15 by tick 10,307, now keeps
   all sixteen afloat; the suite asserts spawn clearance on five seeds.
2. **Once each means once ORDERED**: every other yard refuses a refit
   already building anywhere on the team - the fitted-only check let a
   double-click pay for two engines.
3. **Post-war spending refused** (ruling): build, pod, virus and the
   manual trigger reject after the whistle. The aftermath test now covers
   the COMMAND path, not just the tick path - and it was mutation-checked:
   neuter a guard and it fails.
4. **The watchdog's stall window scales with the ocean** - sqrt(islands/8),
   the law that grows the sea - unless the caller set it explicitly.
5. **The AI buys refits** (ruling): finished plant, twice the price in
   stock, speed first. Battery consequence worth recording: seed 900913,
   a draw at 105,520 since the fuel economy tightened, is now team 0 by
   sinking at 231,651 - two commanders who can re-engine fight it out.
6. **The radar refit has a range test** - undamaged, the full upgraded
   figure stands at the mast.
7. **A table is never larger than its archipelago** (ruling): the fold
   raises islands to teams, in shared/options.js and the start menu both,
   inside the rules hash.
8. **The diorama hands its WebGL context back** on stop
   (forceContextLoss) - look-row flips no longer march toward the
   browser's ~16-context cap at the garbage collector's pace.
9. **The war-over body scrolls** - sixteen score lines no longer push
   RETURN TO PORT off a short screen.

One process scar for the record: the mutation check restored
engine/reducer.js from git to undo the deliberate breakage - and wiped
the not-yet-committed guards with it. Re-applied, re-tested. Neuter a
copy, not the working tree.

## 2026-08-23 — The basic touch pass, and the bug the phone found on the desktop

The bridge was mouse-first, which is nearly touch-first: buttons, helm
scale, held rudder arrows, weapon selector and panels all speak pointer
events. The basic pass (ruling 2026-08-23) added what fingers need:
touch-action locked so the browser cannot scroll or pinch the war (the
icon columns keep pan-y and scroll on short screens), bigger targets on
coarse pointers, held CLIMB/DIVE buttons under TAKE CONTROLS for the hand
with no arrow keys, pointercancel treated as release everywhere. Portrait
during a war gets the HARD rotate card, as ruled - the menu and the war
room stay usable upright.

The emulated Pixel 7 (probe touch_controls, both orientations) earned its
keep three times over:

1. The right column overran a 412 px landscape screen and the launch
   button sat below it - the columns scroll now.
2. Scrolling then did nothing, because a CENTERED flex column that
   overflows overflows both ways and the top is unreachable - the columns
   centre with auto margins now, which collapse to zero when scrolling.
3. Tapping the MANTA button ALSO laid a course to the water behind it:
   the window-level sea-click handler took every tap as a click on the
   sea. The desktop had quietly had that bug all along - every button
   click was also a sea click. Clicks now reach the sea only from the
   view canvas itself.

Still owed to a real device, per the ruling: feel, the 196 px instrument
strip at phone width (the SHIP panel labels already overprint their
values), hoverless tooltips, camera drag, pinch scope. docs/08 §B updated.

## 2026-08-23 — The full ocean: 64 islands for the 16-carrier table

The islands option now runs 4/8/16/32/48/64 in both the start menu and the
war room - 64 being the 1988 original's own count, a ~58 km sea at
unchanged density (the sqrt scaling from ruling #2 needed no change). The
dart-thrower placed 64 first try on every seed; the RING WALK did not:
seed 424242 spawned one of sixteen carriers aground. First fix (walk
toward the centre) made it worse - seed 20260818's seat 15 walked straight
through an island sitting on its centre line. The fix that holds: a
blocked ring seat steps directly OFF the island that blocks it, which
leaves the clearance circle in a bounded number of steps by construction,
clamped to the chart so no spawn leaves the map. The corner walk for four
or fewer teams is untouched - it is pinned.

Five seeds x 64 islands x 16 carriers in the suite: all placed, all
afloat. Headless, a 16-AI war on the full ocean runs ~4,100 ticks/s -
200x real time. Both pins re-pinned with zero event drift: islandCountMax
32 -> 64 in data/world.json is a documentation knob nothing reads, but it
lives in the hashed ruleset. The map itself is byte-identical.

## 2026-08-23 — The models pass: the working clutter, at High

modelDetail lands on the tier (High only) and reaches every builder:
carrier catwalks, lifeboats, point-defence mounts, stern crane, search
dish, deck lights; Manta intakes, underwing rails with rounds, nose probe;
Walrus mudguards, whip, hatch, spade; the lighter's second crate tier,
bollards, stack, fenders; sandbag rings round the turrets and a tracking
dish on the battery. Every style, retro included - sharper 1988 is still
1988, the same contract the 144-vertex terrain keeps. graphics_shots
counts the carrier's parts: 9 at Medium, 28 at High, retro High equal to
modern High. The diorama shows the detailed hulls at any tier - a splash
exists to be looked at.

## 2026-08-23 — The shop window, furnished: war room, title card, surf and guns

Four rulings on the diorama, landed together. The LAN war room gets the
shop window too - it shares the #start-panel root with the solo menu, so
one keeper (openShowcase/closeShowcase) serves both doors and the second
war's reopened room gets it back automatically. A title card stands over
the scrim - letterspaced game name, pointer-events none; the solo menu's
small header steps aside, and in the war room the CARD yields instead,
because the roster is tall and its header already carries the join code
(the first screenshot had them overprinting). The look row now previews
live: flipping it restyles the page and restarts the diorama in the chosen
style - not wired when the URL dictated a style, since the URL wins at
BEGIN and the preview would lie. And the menu has a soundtrack: distant
surf (looped noise, lowpass, a slow swell riding the gain) and far-off
guns, synthesised in sound.js like everything else, started on the first
gesture, stopped with the diorama.

splash_shot now also asserts: card shown + small header hidden on the solo
menu, live restyle actually changes the running scene's sky, war room gets
scrim + diorama with the join code still visible, card yields there. One
probe lesson: three dioramas animating at once starve SwiftShader into
timeouts - close pages when done measuring them.

## 2026-08-23 — The shop window: a diorama behind the start menu

A staged island assault plays behind the start menu now
(`client/render/diorama.js`): a real heightmap island with a gun and a
missile battery on its shoulders, a Walrus working the beach, two Mantas
banking around the peak, the carrier standing off with its bow toward the
fight, and tracers looping both ways. Built entirely from the game's own
world.js builders so the splash cannot drift from what the game renders,
styled by the page's style (retro by default), on its OWN canvas and
renderer — a canvas hands out its WebGL context once, and the war's #view
needs its own — and torn down whole before the war starts. A splash that
throws is caught and skipped: it must never cost anyone the menu.

The menu itself thins to a scrim with its own inner panel
(`#start-panel.showcase`). First composition was a mistake worth recording:
camera at 3.3 km and 850 m up rendered a washed-out pancake with an
invisible cast — a chart, not a diorama. Close and low (1.75 km, 420 m,
thinner fog, bolder island) is what makes the same scene read as a fight.

Probe `splash_shot.mjs`: pixel variance and mesh count on retro AND modern,
scrim present, and after BEGIN the canvas and the `__diorama` hook are both
gone. One unrelated flaky failure observed on a full-suite run (passed on
rerun, second sighting overall — server test timing); worth an eye if it
recurs.

## 2026-08-23 — The scale-up batch: eight slices off one message

Seven rulings arrived in one message (docs/06 "The scale-up batch"); two
clarifications were asked and answered (16 players = 16 carriers free-for-
all; Action Game = the developed war); eight slices landed, each committed
green. 417 tests, battery five for five, one repin with zero event drift.

1. **CI** — `.github/workflows/gate.yml`: tests, Playwright + smoke, the
   battery, on every push to `dev_night`/`dev`/`main`.
2. **Carrier refits** — speed / point defence / radar range as
   `build_on_island` kinds 3/4/5: a factory island manufactures them, the
   ship is fitted on completion, once each. Damage degrades from the
   upgraded base. Quartermaster gained UPGRADES rows.
3. **Replay viewer** — `?mode=replay` walks the autosave through the same
   reducer; a transport, not a format. Probe: `replay_view`.
4. **Action Game** — `engine/action_start.js` builds the developed war at
   tick zero INSIDE createInitialState: per team a stocked factory
   (= stockpile), a resource island, defence islands with guns up, supply
   runs on, the carrier nudged up to 30% toward the centre with an
   open-water check at every step. `actionStart` is a rule in rules.json,
   so base and folded rulesets hash identically — the one repin.
5. **16 carriers, free for all** — lobby `teams` option (2/3/4/8/16); above
   four teams the start is a ring inset from the edges, corners stay pinned
   for the classic table; sixteen distinguishable hull colours.
6. **Observers by consent** — `refereeView` in shared/view.js (every hull
   with owner detail, every stockpile, the live scoreboard) is the
   spectator payload; the war room's `observers` switch closes the door,
   and a seatless connection is then turned away with a reason.
7. **Ports plan** — docs/08: the Luau twin is a transcription priced by
   discipline already paid (the two golden pins are the acceptance test);
   the true mobile tier's blocker is touch controls, an interface ruling.
8. **Graphics phase 2** — Sky.js/Water.js vendored from r162, GENERATED
   tileable water normals (26 integer-frequency sines), physicalSky/
   mirrorWater on modern+hybrid gated by the High-only physicalEffects,
   PMREM once (fixed sun), ACES at 0.32. The probe now asserts the pixel
   contract — and taught us lesson #7: the chase camera never sees the
   zenith, so blueness is measured looking up.

## 2026-08-23 — The gap review becomes systems: course, escort, quartermaster

The owner ruled on all four gaps the 1988 review surfaced, and three became
code the same day (the fourth - split fuel pools - was ruled a deliberate
deviation and documented instead). 403 tests + smoke green, battery five for
five; both pins re-pinned once (carriers grew courseX/courseY, teams grew the
quartermaster bias; zero event drift).

### The course autopilot (map + PROG + A, in one click)

Nothing selected + a click on open water = the ship sails there. The
autopilot steers for the mark every tick; the THROTTLE stays the player's -
the original set speed separately, and so do we. Three ways to lose the
wheel, all deliberate: any hand on the rudder or heading (the helm is one
authority), arrival (which also takes the way off), and grounding - the
autopilot has no answer to a shoal, so it disengages and says so rather than
holding the wheel against the rocks. The mark rides the scope as a hollow
diamond with a dashed bearing line.

### Escort

The one missing order that changes play: the unit takes station on its own
MOVING carrier - target refreshed every tick, like Return but forever - and
fireAll already makes any autopilot hull fight what comes, so the whole
combat half cost nothing. It breaks off for the deck by itself below a third
of a tank, and the boat refuses the order: it has a job.

### The quartermaster (light, as ruled)

Q opens it: every island you hold with stock and role, the depot marked and
movable by clicking a row (the designation the original did from its map),
and the production bias - Low/Med/High per factory output. The arithmetic
rule that made it safe to ship: outputs are reweighted normalised so
all-MEDIUM is bit-identical to the old plant (the battery agreeing five for
five is the proof), LOW starves an output entirely, and all-LOW idles the
plant without eating materials - an order to make nothing is an order to
stop, not to waste.

Everything travels the command path with the ship as authority, so replays
and saves carry the quartermaster's decisions like any other order.

---

## 2026-08-23 — Playtest round three: buttons that explain themselves

Two UI rulings from the owner's third session, both landed; the third ask -
compare the build against the 1988 screenshots for missed systems - produced
a gap list that went back as clarification questions (dev-questions has it).
397 tests + smoke green; client-only.

**Tooltips.** Every action button, plus ? and DBG, raises a tooltip after a
deliberate 600 ms hover: the label NAMES the button, the tooltip EXPLAINS it
- including the costs (a pod is 80 materials, a bomb is 120 ordnance),
because the button is where that knowledge is needed. The delay is the
point: sweeping the pointer across a column must not raise a wall of prose.

**The weapon selector.** V's cycle hid what a row of buttons shows: the
right column now carries one button per weapon the SELECTED hull holds,
radio-style - the chosen one lit, the others dark, live round counts on
each. Rebuilt only when the holder or its loadout changes; selection and
counts update in place (the built-once rule). Clicking sends select_weapon
with the exact id - the command always took an id; only the client ever
cycled. V still cycles for the keyboard hand.

**The gap review** (sourcedata screenshots vs the build): repair priorities,
stockpile designation and the resupply run all EXIST and were discoverability
problems - the tooltips now say so. The real gaps are the Quartermaster
screen (per-item priorities and quantities), split fuel pools with manual
transfer, carrier course autopilot (map + PROG + A), Patrol/Escort orders,
and a message feed. Those are owner decisions, asked as questions rather
than built on spec.

---

## 2026-08-22 — Playtest round two: the mouse gets the ship

Three more rulings from the owner's hands, and the middle one sent me back to
the 1988 sources - which is where the answer was waiting. 397 tests + smoke
green; client-only, no hash moved.

### The strip goes behind DBG

The diagnostic HUD (top-left) now starts hidden behind a DBG button, exactly
like the key list behind `?`. The catch nobody asked about but somebody would
have hit: STATUS lives in that strip, and status is feedback, not
diagnostics - a refused command must be seen. While the strip is hidden,
status lines surface as a transient toast above the instruments. The probe
proves it by pressing P with no Walrus selected and watching the toast.

### The panel becomes mouse-first, which is what the original WAS

The operations manual, quoted in the interface notes: "click directly on
speed scale to set target speed." So the throttle bar now IS the speed scale
- click at four fifths, get 80 - and two rudder arrows under it act while
held and CENTRE UP on release (the original had a dedicated icon for that;
release-to-centre is the same idea with fewer clicks). The helm drives the
SHIP even while a unit is being flown - it is the ship's helm.

The legend's actions became the original's flanking icon columns: ship and
logistics on the left, air and ground ops on the right, each button carrying
the key it mirrors. A button DISPATCHES its key rather than calling a
parallel handler, so the two input paths cannot drift - whatever F does, the
button labelled F does, forever. The hit-test and the drawing share one
geometry table, so the paint and the click cannot disagree either.

### The models earn their silhouettes

More vertices, same flat-shaded retro language. Carrier: bridge with a
window band, mast with a radar bar, runway stripe. Manta: a real delta with
a proud fuselage, canopy, twin canted fins, a nozzle - it reads as an
aircraft from the wing view now. Walrus: sloped glacis, cylindrical turret
with a barrel, wheel drums on the flanks. Lighter: raked bow, gunwales, an
open hold with crates riding in it, a wheelhouse, a stub crane. Photographed
in models-fleet.png and models-unit.png; two layout collisions (icon columns
into the panel, rudder label into the fuel bar) were caught by the
screenshots, which is what screenshots are for.

---

## 2026-08-22 — One join code is an evening

The last rough edge between "playtest" and "hand friends a join code": a LAN
server could hold exactly one war per process. Now the ending screen offers
the host BACK TO THE WAR ROOM, and the table fights again - same process,
same join code (it is derived from the boot id, which was the right call
twice now), fresh everything else. 397 tests + smoke green; no hash moved.

Server: a `lobby_reopen` message, honoured only when the war is OVER (the
host abandoning a live war is a different decision from finishing one, and
stays refused), only from the host, and idempotent when the room is already
open. Reopening saves the finished war one last time, unreadies every seat,
clears any speed vote, and re-welcomes the room. `startWar` now also hands
each war a fresh watchdog - findings from the last war are the last war's
report.

Client: a third button on the war-over screen, LAN only (solo's RETURN TO
PORT is its equivalent), and the piece that took actual thought: **the world
must be rebuilt when the room starts a war**. The renderer caches islands
and nodes by id, and a second war puts different geometry under the same
ids - war two would have been fought over war one's scenery. The first
snapshot after a room-started welcome now rebuilds the scene graph at the
NEW war's size (same renderer and canvas - a browser does not hand out a
second WebGL context on one canvas), which also fixes a pre-existing bug
nobody had hit: a lobby that chose 16 or 32 islands got an ocean sized for
8, even in the first war.

The ws test walks the whole evening - refuse mid-war, reopen at the end,
same code, fresh game, fresh watchdog - and grew the test helper an inbox
cursor (`nextAfter`), because waits that scan the whole inbox were being
satisfied by stale messages from the previous war. `second_war.mjs` drives a
real browser through two wars on one page: 16 islands, ending screen, back
to the room, 32 islands, and exactly 32 island meshes in the scene at the
end - the number that proves the rebuild.

---

## 2026-08-22 — Playtest round one: the button, the gunsight, and the stick

The owner's first session at the controls ruled three things, all landed. 396
tests + smoke green; both pins re-pinned once (units grew `climb` and
`ceiling`; zero event drift).

### The key list hides behind a `?`

The legend used to sit on screen from boot. Now it starts hidden and lives
behind a round `?` button top-right (H still toggles it). The instruments are
the interface; the legend is the manual, and a manual is something you open.

### The gunsight: C's second stop

`C` now cycles chase → **gunsight** → map. The gunsight is first person from
the mount, horizon level, crosshair centred - what the weapon can reach is
what fills the screen, so aiming is looking. Two placements that took the
probe's screenshots to get right: a Manta's eye sits just above the airframe,
but the carrier's eye had to go **out past the bow spike** - from anywhere on
the hull, the ship's own 46 m bow cone towers through the middle of the
picture (the first two placements photographed a handsome dark rectangle).

### The stick's vertical axis (engine change)

Flying had rudder and throttle but no pitch - the one thing the playtest
could not find because it did not exist. Now: `set_unit_helm` carries an
optional `climb` (-1/0/+1) - optional so command logs recorded before pitch
existed still replay - the unit record carries the pilot's climb input and
the airframe's ceiling (data: 800 m), and the flight model resolves the stick
as climb-toward-ceiling / dive-toward-wavetops (12 m) / hold-what-you-have.
The autopilot ignores all of it and flies the contour as before, and the
no-crash terrain rule out-votes the stick: a pilot diving at a hillside is
carried over the summit, same as the autopilot. Arrow keys drive it (left and
right arrows double as rudder), held like the rudder keys - release and the
nose levels.

`playtest_round1.mjs` photographs all three and flies the climb/dive itself.

---

## 2026-08-22 — The two recommendations, taken

Owner ruled: do both. 393 tests + smoke green; the battery distribution is
unchanged, which is itself the measurement - standing scouts off the guns
costs the search nothing.

**Patrols stand off.** The patrol mark is now four kilometres short of the
node, on the homeward side: a scout's radar reaches 5,000 m and a missile
battery 3,500, so from the standoff it sweeps the whole anchorage without
ever entering the guns' reach. Overflying the node was how a patrol fed a
fortress island a steady diet of airframes - each one a kill paid to the
enemy and twelve chassis owed to the yard. A carrier already inside the
standoff keeps its scout overhead instead; its own radar covers the
anchorage from there. Ghost hunts still fly to the exact remembered spot -
that is usually open sea, and the point of a hunt is the spot.

**Spectators watch from altitude.** A seat with no ship - the chart view -
used to leave the camera where it booted, staring at a corner of the ocean.
With nothing to chase, the camera now defaults to the strategic pull-back
over the middle of the map: the spectator sees the archipelago, ownership
colours, and the pods filling, which is exactly what the chart view knows.

---

## 2026-08-21 — The second review: three bugs, two recommendations

The owner asked for another full review after the overnight run. Method as per
the engine-review skill; focus on the new code and its seams with the old.
Three plain bugs, fixed in this slice; two design-tinged flaws left as
recommendations; the rest of the new surface held up.

1. **Destroyed turrets were never struck off the island's books.**
   `sweepTurrets` removed the gun from `state.turrets` but `island.turrets`
   only ever went up (or to zero on capture). A defence island whose guns
   were shot away could never rebuild them - the slot check read four-of-four
   forever - the chart showed batteries that were rubble, and the new patrol
   ranked "least defended" over dead guns. Pre-existing; it took a consumer
   of the count (the patrol) to make it visible. The sweep now decrements the
   owning island.
2. **The watchdog cried stall the moment a resumed war went quiet.**
   `lastEventTick` started at zero, so a war resumed at tick 200,000 read its
   first quiet moment as a 200,000-tick silence. The watchdog now baselines
   on first sight: silence counts from when watching began.
3. **A resumed lobby war lost its chosen speed** - the options carried
   `speed: 8` and the clock restarted at the environment's default. The war
   comes back at the speed its table chose.

Left as recommendations (owner's call): patrol scouts overfly defended
command nodes - the mark should stand off ~4 km, eyes not a raid; and the
spectator camera never places (the chart view has no own carrier) - it should
default to the strategic pull-back.

What held up under the checklist, for the record: no new event codes to
misroute, every new transfer debits a source, the save path is hash-verified
and replays rejected commands as rejections, ghost records are integer-clean
and per-team, and every client path guards the spectator's empty view.

393 tests + smoke green; the battery is unchanged (no battery seed loses all
four guns on one island).

---

## 2026-08-21 — A war on disk is a seed and a log

Save and resume, with no format invented: the autosave is the seed, the
ordered command log, the lobby options the war sailed under, the tick, and
the state hash (`server/save.js`). Resume replays the log through the same
reducer and REFUSES if the result does not hash to what was saved - a save
made under moved data files or changed code says so and stops, instead of
limping back as a subtly different war. Write-then-rename, so a crash
mid-write leaves the previous save whole.

This is the payoff of two earlier decisions arriving at once: "the command
log is the replay" meant the save format already existed, and stripping
advance_tick from the log (the metronome fix) is what made the file small
enough to write every thirty seconds forever.

`SAVE=` names the file (data/autosave.json by default, gitignored), `SAVE=0`
turns it off, `RESUME=1` picks the war back up - and exits with the reason if
it cannot. Seats do not survive the restart; players rejoin and claim their
teams, and the AI keeps whatever seats the log says it holds, because set_ai
is a command and commands are the save. Tests cover the round trip, the
tampered save, the app-level resume, and the lobby (which has no war worth
saving). 390 tests + smoke green.

---

## 2026-08-21 — The battery, the patrol, and the parts that never sailed

`npm run battery`: the headless sim times five, fixed seeds, each war under
the playtest watchdog, failing loudly on a stall or a finding, report to
reports/sweeps/. One seed is a measurement; five is a distribution - and the
distribution paid for itself within an hour, twice.

**First find: patrols, and why they need a gate.** With nothing seen and
nothing remembered the AI now flies one scout over the islands the enemy
holds (chart-level knowledge, like the works and the guns - so the sweep goes
least-defended first, rotating islands every 9,000 ticks, only while the
bunker is above half). The first version had no quiet gate, and the battery
showed wars ending at tick 11,000-20,000 on three of five seeds: the first
patrol flew the moment anybody owned an island, found the enemy carrier in
the opening, and autonomous strike cycles deleted the entire economy game.
Patrols now wait for 30,000 ticks of lost contact - they are for re-finding a
lost war, not for opening-move rushes. The brain grew `lastContactTick`.

**Second find: the parts never sailed.** Seed 424242 stalled for 60,586 ticks
- the watchdog's exact nightmare - and the trace showed why: both air groups
annihilated, full warehouses of replacement chassis ashore, and every boat
run loading nothing but fuel, because fuel loads first and the depot's fuel
alone filled the 25,000-unit hold every time. Two toothless fleets in radar
range of each other, staring. The boat now loads the yard's shopping list
FIRST - exactly the chassis the hangar is waiting for, no more - and parts
travel last again once nothing is lost.

The battery after both: all five seeds resolve, no findings, wars from tick
33,252 to 172,941 (one draw), worst lull anywhere 33,890 ticks. The reference
seed now ends at 36,073 - much earlier than the old 229,482, because a war
with working search and working resupply CONVERGES once contact is made.
That pacing is a real change for the owner to feel in the playtest: the enemy
comes looking now.

---

## 2026-08-21 — The AI reads the same chart

The follow-up the memory slice promised: `ai_strike` now acts on ghosts. When
a team's brain holds a remembered enemy carrier and nothing live, it sends
**one scout** - not a strike package - to the last-known spot.

The design earns its keep by what it does NOT need: no search timer, no patrol
state in the brain, no new fields to copy. The ghost mechanics terminate the
search on their own - the scout's radar either re-acquires the carrier (live
target, and the strike machinery takes over on the next cadence) or scans the
spot clean, which DISPROVES the ghost, and with nothing left to look for the
scout is recalled. The disprove rule from the last slice turns out to be the
whole patrol-management system for free.

A small correctness gain came with it: the old "nothing in sight" branch only
recalled aircraft on the cadence the target was lost (`strikeCarrier !== -1`),
so an ACTIVE Manta with no target and no flag circled until dry. Recall now
runs whenever there is neither sighting nor memory; RETURNING aircraft are
not in the airborne list, so nothing is double-recalled.

Measured: the reference war is unchanged - tick 229,482, won by sinking -
because that seed's ending happens in live contact, where ghosts never come
into play. The hunt is insurance for the wars where contact breaks. The worst
quiet stretch of the whole war is now 46,897 ticks starting at tick 19,003 -
an early steaming leg, not an endgame lull; the old 60,000-tick tail silence
is gone. 384 tests + smoke green.

---

## 2026-08-21 — The chart remembers, and the war ends on a screen

Two Milestone 2 items, by owner ruling (which amends 24.3 - the original said
"no contact memory", and the owner has now asked for exactly that). 382 tests
+ smoke green; the AI-vs-AI endpoint did not move (tick 229,482), because the
AI deliberately does not use the memory yet.

### Contact memory (`engine/contacts.js`)

A contact that leaves your radar leaves a GHOST: last position, heading, and
when. The rules that took thinking:

- **Ghosts are disproved, never expired.** A mark is dropped when your sensors
  scan the remembered spot and find nothing - a chart mark does not fade
  because you looked away, it fades because you looked back.
- **The rim is ambiguous on purpose.** The first implementation disproved a
  ghost when the spot was merely COVERED - but a hull that sails over the
  horizon was last seen essentially at the rim, which is still-covered ground,
  so every naturally-departing contact was disproved on the very next tick.
  The whole feature quietly deleted itself. Disproof now needs the spot 400 m
  inside a sweep.
- **Memory lives in state, per team** - a replay must remember exactly what
  the war remembered, and the fog filter is pure per-tick and cannot hold
  anything. Rebuilt in entity-list order each tick so the array is
  deterministic regardless of when things were first seen.
- **The view carries only ghosts** (stale marks); a hull currently on radar
  arrives through the normal channels, and a scope that drew it twice would be
  lying about how much it knows. Spectators remember nothing.
- Unifying the sensor rule into `covered()` fixed a fog bug on the way: a
  SUNK carrier was still painting contacts for its team - the view's own
  detectedBy never checked hull.

The AI still hunts on live sightings only - `ai_strike` using ghosts is the
next slice, and it is a balance change to measure, not sneak in.

### The war-over screen (`client/panels/warover.js`)

A four-hour war used to end as one HUD line. Now: the result, the reason, the
scoreboard the fog hid until it stopped mattering (`view.scores` is empty
while the war runs and everybody's total once it ends - an ending is a result,
and a result has a scoreboard), islands held, and the war's own running time.
RETURN TO PORT goes back to the menu; KEEP WATCHING dismisses it and the world
keeps winding down behind it. Shows once per war, on the tick the phase flips.

The probe (`war_over.mjs`) photographs both new surfaces in seconds via a
`__debugView` hook - pause the solo war, swap in a doctored view - because
the states it needs take hours to reach honestly. The screenshots are the
review: the ghosts read as memories (faint outlines against solid dots), and
the screen says YOU WON in the right places.

Both pins re-pinned once (state grew `contacts`; zero event drift).

---

## 2026-08-20 — The rulings become a document, and the review becomes a skill

Two records that lived in the wrong places. The owner's rulings were scattered
across an owner-local question queue, this log, and session memory — so
`docs/06-rulings.md` is now the public design of record: every decision, dated,
with its question number where it has one, plus the standing constraints that
follow ("nothing is conjured", "nothing may hard-code two teams", "nothing new
is decided after the end"). The queue itself stays owner-local; what was
*decided* is now in the repo where a contributor can be pointed at it.

And the review method that found ten real issues is written down as
`.claude/skills/engine-review/SKILL.md` — the reading order and, more
usefully, the failure classes that actually produced bugs here: id collisions
across entity lists, per-hull state updated by per-selection rules, event
payload slot routing, conjured goods, contracts described but not enforced,
movers that collide with nothing, transfers that cap away the difference,
classification by the wrong axis, and edges the current config cannot reach.
The next review starts from that list instead of from zero.

Also: plan and README status updated to reflect the review hardening, the AI
table in docs/02 now mentions stockpile siting, and the slice skill records
that a state-shape change moves BOTH pins (M0-A and the golden world hash).

No code changed; no hash moved. 373 tests + smoke gate green.

---

## 2026-08-20 — The minor list, closed, and a reef that means it

The owner read the review, ruled on the one open number, and asked for the
"documented, not fixed" list to be fixed after all. 373 tests + smoke green.

### Grounding out-hurts repair, by exactly one

Ruling: a gentle grounding should cost **one point over the repair rate** — 9
hull per 100 ticks against the yard's 8. A supplied ship on a reef now loses
hull slowly while burning materials fast, instead of shrugging; a ship with an
empty yard grinds down as before. One number in `data/units.json`.

### Spectators get the chart, not team 0's secrets

The fog filter run for a seat that owns nothing turned out to already be the
right observer view: islands, ownership, works, capture progress — the common
knowledge — and no hulls, shots or stores. `buildView(state, -1)` needed three
guards (an UNOWNED island's `owner === -1` matched the spectator's team and
showed its stocks), the snapshot now carries a `spectator` view alongside the
team views, and the server hands it to anyone without a seat.

### The virus bomb learns whose door it went in

`island.virusVictim` records the owner at deployment, and **any** change of
owner abandons the conversion — recapture, the virus team's own pod finishing
first, or a third team taking it, which two-team wars cannot produce and the
rule now survives anyway. And a second bomb on a conversion your own side has
running is **refused** rather than spent: it would only have reset your clock.

### The command log stops recording the metronome

`recordCommand` logged every `advance_tick` — twenty entries a second, 1.7
million a day, each saying nothing that the tick stamps on the real commands
do not. Ticks are no longer recorded; a replay reconstructs the advances by
ticking until the stamps match.

### The watchdog gets the tripwire the network bug earned

`island stock above its cap`: every path that adds stock respects the cap, so
a store above it means one stopped. The cargo network destroyed goods for days
against a full depot and nothing tripped; that class of bug now has an alarm.

M0-A and the golden world hash re-pinned once more (islands grew
`virusVictim`, grounding damage moved) — zero event drift, map byte-identical.
The AI war resolves at tick 229,482.

---

## 2026-08-20 — The review, and what it found

The owner asked for a full review of docs, specs and implementation before the
playtest. Reading every engine module end to end against the documents found
ten things worth fixing and a handful worth writing down. Three slices landed
(1668fc7, 11738bb, 9284f31); 367 tests + smoke gate green after each.

### Four plain bugs

1. **A missile chasing a turret homed on the wrong entity.** Turret ids and
   unit ids are separate sequences that both start at zero, and
   `findTargetPosition` had no turret branch - a round aimed at turret 3
   re-aimed every tick at *unit* 3, wherever that was.
2. **Cycling weapons cleared laser overheat.** Heat lives on the hull but
   cooling followed the SELECTED weapon, and a heatless one zeroed the
   accumulator: overheat, press V to the cluster bomb, V back, fire. The mount
   that heats is now the mount that cools, whatever is selected.
3. **Event fog routing was wrong for three codes.** Scored (29) and AI-seat
   (38) carry the team in slot `a`, not `b` - score events were routed to
   whichever team the *point value* equalled. And a virus conversion (36) was
   heard only by the side that fired it; it is a capture, and the victim is
   the side that most needs to hear it. Conversions and sinkings (21) are now
   chart-level news, like captures.
4. **An attack order classified air by altitude.** `ordered.z > 0` where every
   other module rules by KIND - a Manta parked at sea level was a legal
   Walrus-cannon target.

None of the four moved the pinned fixture: the scripted opening has no
turrets, no overheats, and no parked aircraft under attack orders. Which is
also the honest limit of a 300-tick pin.

### Three holes in ruling #3 (the provisioning slice)

Recovery set `unit.fuel = fuelCapacity` - the comment admitted "instant for
now" and the promised slice never came. Every returning Walrus got a free pod
AND a free virus bomb from a comment that *claimed* they came from stores. A
rebuilt hull got full magazines without touching the ordnance store - four
conjured missiles per rebuild - while a merely-recovered Manta paid.

Now (owner ruling on the costs): fuel from the bunker, partial when short; a
pod is 80 **materials** (a construction device), a virus bomb 120 **ordnance**
(a munition), issued at the ramp only when missing and only when the store can
pay; a Walrus sails with a pod as standard complement but buys every bomb; a
rebuilt hull comes off the line empty and is fitted out from stores; an empty
tank stays on the deck; the ship sails with a finite 400-materials issue.

**What the sim taught before it would resolve again**, because tightening an
economy is measurable and we measured:

- *The lighter must bunker at the depot.* Refuelled from the carrier, the
  logistics network drank the bunker it existed to fill - a boat's tank is a
  fifth of the ship's.
- *The AI's stockpile belongs at the factory.* The network ships everything
  toward the depot and a factory refines only its own pile; depot-at-the-mine
  starved the plant on its 8-a-beat trickle while 60 a beat sat under the
  digger. Both AI carriers drifted to zero fuel at tick ~350,000 with
  materials at capacity. `siteStockpile` in ai_estate fixes the plan.
- *A supplied ship out-repairs a gentle grounding* (8 repair points per 100
  ticks against the reef's 6) - the reef now costs materials instead of hull,
  which reads as a feature and is noted in the grounding test.

M0-A re-pinned - hash drift from the new carrier fields
(`podMaterials`, `virusOrdnance`, `startMaterials`), zero event drift - and
the golden world hash with it; the map is byte-identical.

### Three broken contracts (the aftermath slice)

- **"Nothing new is decided" was only true of the AI.** Guns kept choosing,
  pods completed, viruses converted, points accrued after PHASE_OVER. All
  gated now; hulls still move, boats deliver, the yard mends, and a round
  already in the air still flies - and still hits - because it was decided
  when it left the rail.
- **Nothing collided with terrain except hulls.** Missiles flew through
  mountains, and the tallest peaks (420 m) out-top a Manta's 400 m cruise. A
  shot now flies INTO a hillside (splash rounds detonate on impact; the check
  is at the endpoint - a laser pulse can clip a razor-thin crest and nobody
  will notice). The Manta autopilot flies the contour: 30 m clear of the
  ground here and 1400 m ahead, no crash mechanic (owner ruling).
- **The cargo network destroyed goods.** Source debited, arrival capped,
  difference gone - silently, every accrual. It now ships only what the depot
  has room for, per good, so stock piling at the mine is the visible signal
  the depot needs a warehouse.

The AI-vs-AI war now resolves at tick 229,498, won by sinking (was 396,491 -
the tighter fuel economy shortens the drift phases).

### Found, documented, not fixed

- **Spectators watch team 0's view** - deliberate simplicity, now written down
  in docs/03 as the intelligence channel it is.
- **Virus edge cases**: re-deploying onto an island already being subverted
  (even by your own side) resets progress and wastes the bomb; in a >2-team
  war a virus survives the island changing hands between two *other* teams.
  Both are 2-player-invisible; queued for when team count grows.
- **`game.commandLog` grows unbounded** - fine for a LAN session, worth a cap
  eventually.
- The watchdog has no check for goods conservation; the network bug above was
  found by reading, not by tripwire. A conservation check would be a good
  fourth eye.

---

## 2026-08-20 — Writing down what was built, before the playtest

No code changed; no hash moved. Milestone 1 closed with the reasoning behind it
scattered across 984 lines of this log and nowhere else, which is fine for the
person who wrote it and useless to anyone else — including the same person in
three weeks.

### `docs/`, five numbered files

Mirrors multiciv's convention. They describe **what exists**, not what is
planned — the plan is `plan-version1.md` and the chronology is this file.

| | |
|---|---|
| `00-index.md` | the three rules, and where everything lives |
| `01-simulation.md` | the engine contract, fixed point, the tick order, state shape, hashing |
| `02-systems.md` | the war as built: weapons, damage, islands, supply, capture, scoring, the AI |
| `03-multiplayer.md` | transports, the clock, fog, the war room, seat grace, the speed vote |
| `04-client.md` | no build step, art as data, the instrument panel, panels, sound, keys, i18n |
| `05-testing.md` | the gate, the fixture, the probes, the watchdog, how to land a change |

The bias throughout is towards recording the decisions that look wrong until
explained: why the compass subtracts its sine, why a splash round has to strike,
why the AI takeover is a command rather than a server-side poke, why armour is
read before the section absorbs the hit, why `STUCK_TICKS` is 60,000. Those are
the lines that will stop the next person re-introducing a bug that has already
been fixed once.

### The README was lying in three places

It still said islands paid by *kind*, that a carrier refuelled by lying within
900 m of one, and that weapons, damage, buildable structures and a real HUD were
"not yet built". All four have been false for days. Rewritten, plus the virus
bomb, the roles, the repair chain, and the four end conditions.

`plan-version1.md` now records Milestone 1 as complete and names what is carried
into Milestone 2: fog with a memory, and the Luau twin.

### A skill for the procedure

`.claude/skills/slice/SKILL.md` — the house rules, the gate order, the repin
refusal, the dev-log entry, the commit style, and the branch discipline, in one
place instead of being re-derived from context every session. It exists mostly
so the two rules that cost a day each — a new entity kind needs a line in
`copyState`, and `npm test` can pass on a client that will not start — are
written where they will be read *before* the mistake rather than after.

---

## 2026-08-20 — Coming back to your own war, a room that talks, and a watchdog

351 tests + smoke gate green. Three things asked for before a playtest, and one
of them found a bug in its first three seconds.

### A dropped player keeps their carrier

Adapted from multiciv's seat-grace. A seat is now HELD rather than freed: the
same player, presenting the token they were issued, gets their own seat back
with their own name on it, and a stranger cannot be handed a seat somebody is
coming back to. After ninety seconds the seat is released and **the AI takes the
war over**, because a dropped player's carrier sitting at anchor for the rest of
the war is worse for their opponent than losing to a machine.

The takeover is a COMMAND (`set_ai`), not something the server does to the state
behind the reducer's back: the command log is the replay, so a war where the AI
took over at tick 40,000 has to replay as one where it did.

A late player is still let back in if nobody took the seat. The grace window
exists to stop a race, not to punish somebody whose train went into a tunnel.

**One thing the probe found:** a human joining a war whose second seat was
AI-held ended up sharing one carrier with the AI, both steering. A human at a
seat now takes it off the machine, whether they are returning to it or sitting
down for the first time.

### The room talks

Chat in the war room, bounded and stripped to printable ASCII before it goes
anywhere near another client - the same rule that keeps the state hash honest is
a good rule for anything a stranger can type. The input lives outside the
rebuilt body, so typing into it survives the room changing under you, which it
does every time anybody readies, joins or leaves.

### The watchdog

`server/watch.js`, on by default for the server binary, findings at `/watch`. It
reads the state every tick and never writes it - watching a war cannot change
it, and there is a test that says so by hashing a watched war against an
unwatched one.

It looks for the shapes that mean the simulation has gone somewhere it should
not be: a hull off the map or under the sea, a negative store, a magazine
holding more than it can, more built than the slots allow, the war going quiet
for an implausibly long time, a tick slower than the tick it simulates. One
finding per KIND with the first tick and a count, because a playtest that trips
the same bug four hundred times should report it once.

**It earned itself on the first run.** A build paid for from "the island's own
stock, then the depot" spent the same materials TWICE when the site was itself
the stockpile island, leaving island stock negative from tick 13,401 onward.
Nothing in 339 tests had caught it; a full AI-vs-AI war under the watchdog
caught it in three seconds.

Its one remaining finding is real rather than a false alarm, and is for the
playtest to judge: **the endgame has a 60,000-tick lull** - nothing happened
between ticks 331,050 and 391,050 of a war that ended at 396,491.

---

## 2026-08-20 — Decoy flares

327 tests + smoke gate green. A warning you cannot act on is only bad news
delivered early; flares are what turn the missile-lock alarm into a decision.

`E` fires a burst. Every hostile heat-seeker within 900 m loses its lock and
**flies on blind** on whatever heading it was holding - it is not deleted, which
is both more honest and means a badly timed burst can still leave a round
arriving by luck. Three things make the timing a decision rather than a button:

- a burst is **24 ordnance** out of the same store that feeds the guns and
  rearms the aircraft, so defending yourself and arming yourself compete;
- the launchers take **240 ticks** to reload, so it is a moment you pick;
- the burst is **local**, so a salvo still on its way in is untouched.

The AI plays by the same rule and fires when something is locked on *and* close
enough for the burst to reach it. Firing at the moment of launch wastes it: the
missile is thirty seconds out and the launchers will not have reloaded when it
arrives.

The panel gained a launcher bar that fills as they reload, because what you need
to know in the half second after a warning is whether you may fire yet. The four
ship bars are now two columns: stacked, the fourth pushed the weapon line out
through the bottom of its own bezel.

---

## 2026-08-20 — A war room for LAN play

317 tests + smoke gate green. Adapted from multiciv's lobby
(`../multiciv/server/lobby.js`), cut down to the shape this game has: that
server hosts MANY games and needs a registry keyed by game id, while a Carrier
Dominion server hosts ONE war. What was worth keeping:

- **A join code** - five Crockford characters from the boot id, so a host reads
  it down a phone instead of dictating a URL.
- **A host seat** - the longest-seated player, computed rather than stored, so
  it cannot go stale and the room does not die when the host leaves.
- **Ready before sailing** - and one player alone is unanimous by definition,
  which is the same rule the clock vote already uses.

Changing the war unreadies the room: everybody had agreed to something else. A
value off the ladder is refused rather than clamped, because a silent clamp is
how a host ends up playing a different game from the one they set. The room
folds into a **ruleset** at the end, which is the same path the solo start menu
takes - a war is seed plus rules and nothing else.

`LOBBY=1` is the default for `server/index.js`; `createApp` still defaults to a
war that is already running, so every test, probe and the smoke gate are
untouched.

### Two bugs, and only one of them had a test that could have caught it

**The clock ran the whole time the lobby was open.** The game is built at
construction, and the clock pumped it regardless - so seats received snapshots
of a war nobody had agreed to, and pressing START looked like it had worked
because there was already a war on screen. The clock now declines to run a war
nobody has started.

**Lobby messages were being wrapped as game commands.** The client transport had
one send path, `send(command)`, which wraps everything as `{type:'command'}`.
The server answered every lobby click with "the war has not started" - correctly.
The socket tests could not catch this because they write raw JSON to the wire;
it took two real browsers in a probe. The transport now has a `sendMessage` that
puts a message on the wire as it is, and the lobby uses it.

---

## 2026-08-20 — Sound, and the missile-lock warning

302 tests + smoke gate green. No audio files: every sound is an oscillator and
an envelope, which is what a 1988 machine did and what keeps the repo a repo
rather than a media library. A sound is a few numbers - pitch, shape, length -
so it can be tuned by reading rather than by re-exporting a file.

Sound follows the **view's event list**, which is already fog-filtered: you hear
your own hulls firing and your own ship being hit, and nothing over the horizon.
Gunfire is throttled to one tone per 90 ms, because a hundred overlapping clicks
a second is noise rather than sound. `M` mutes.

**The missile-lock warning is the reason to have sound at all.** It is not an
event, it is a standing condition: a guided round is in the air with your ship's
name on it, and it repeats while that is true. The gunsight goes red and pulses
with it, so it is visible as well as audible.

That needed one new thing in the view, and it is a fog decision rather than a
sound one: a round aimed at YOUR ship is on your scope whether or not anything
of yours can see it, because the ship's own warning receiver is what sees it.
The first version of that check asked only "is it guided at a carrier", which
would have shown every side every missile in the war. It now checks whose
carrier - and a test covers both directions.

`client/sound.js` touches no DOM at all: the two-tone warning is scheduled on
the AUDIO clock rather than with a timer, which is sample-accurate and is why
the whole module can be tested in Node with a fake context.

---

## 2026-08-20 — The 1988 instrument panel

295 tests + smoke gate green. The HUD was a table of labelled numbers; it is now
a panel of instruments across the bottom of the screen, drawn on one 2D canvas.

**The rule the whole panel is built on:** an instrument says ONE thing, in a
shape you can read without stopping to parse it. A bar a third full, a schematic
with a red section, a compass point off the bow. The figures are still there for
when you want the exact number - they are not what you read the situation from.

- **Helm** (left): a heading-up compass rose, and bars for throttle, speed and
  fuel.
- **Scope** (centre): a plan-position indicator, north up, with range rings and
  a sweep. It is fed the **fog-filtered view** like everything else, so it
  cannot show a contact your hulls have not detected - there is no separate
  "radar truth". Its range is the ship's own radar, so it shrinks when the mast
  is shot away: the instrument tells the truth about the sensor.
- **Ship** (right): the damage schematic in plan - the always-on version of the
  `Z` board, no priorities and no numbers, just where the ship is hurt - beside
  bars for hull, ordnance and materials, and what the selected hull is holding.

Instrument colours are part of the art direction (`client/styles.js`), so the
panel changes with `?style=` along with everything else.

What is left of the old overlay is the DIAGNOSTIC strip: tick, hash, seed, fps,
graphics tier. That is the developer's view of a deterministic engine, and it is
a different audience from the ship's own instruments.

**One thing this broke and how it was caught:** the smoke gate proved the helm
answered by reading `#hud-throttle`, a cell that no longer exists. It now reads
the throttle out of the VIEW - a gate that fails when the panel is redesigned is
testing the wrong thing.

**One bug a screenshot caught:** the compass rose was mirrored. Engine bearings
grow counter-clockwise from east and counter-clockwise on screen is to the left,
so the sine has to be subtracted, not added. Facing east, north belongs at nine
o'clock; it was at three, and nothing but looking at it would have said so.

---

## 2026-08-20 — The virus bomb

295 tests + smoke gate green. The last 1988 payload, and the one that makes
taking an island a choice rather than a procedure.

| Payload | What it takes | What you get |
|---|---|---|
| ACCB pod | any island that is not yours | the island, **bare** - the previous owner's works are cleared |
| Virus bomb | an island somebody else **holds** | the island **intact** - factories, warehouses, stores, and the guns that were shooting at you |

The bomb takes twice as long as the pod (2400 ticks against 1200), which is the
whole trade: a longer wait, deeper inside somebody else's defended island, for a
prize that is already built. A conversion is abandoned if the island changes
hands under it - a virus needs a command centre to subvert, and the one it was
working on is gone.

The AI uses it the way you would: only when there is something on the island to
inherit. A bare rock gets the pod.

`B` deploys it. The Walrus sails with one of each and the hangar restocks both.

---

## 2026-08-20 — The clock is a table decision

286 tests + smoke gate green. Time compression in a shared war now moves when
**every player agrees**, and not before (ruling #24.5).

`server/vote.js` is deliberately pure and socket-free - a seat is any object
with a `team` and a `vote` - so the whole rule is testable without a network.
Three things fall out of it rather than being written into it:

- **A vote of one is unanimous by definition**, so a solo player still runs the
  clock as they like with no special case for it.
- **Spectators do not vote**, and do not block one either. They are watching
  somebody else's war.
- **Pausing is a speed like any other**, so stopping the clock takes the same
  agreement as speeding it up.

A seat arriving mid-vote resets it: everybody at the table has to agree, and
the newcomer has not been asked. A seat leaving settles it, because their
departure can complete a vote the rest had already reached.

The table is told where a vote stands (`2/3 for x4`), so nobody is left
wondering whether their key press did anything. Which is what the old message
did wrong: it said "refused", when the honest word was "proposed".

---

## 2026-08-20 — Defence islands, and the deadlock they exposed

276 tests + smoke gate green. Turrets were a number on a report; now they are
guns on the ground.

### A turret is a hull that cannot move

That is the whole design. It has a position, health, a magazine and a mount that
overheats, so it goes through the same firing, aiming and damage machinery as
everything else - no special case anywhere. They sit on a ring around the
command node, **alternating laser and missile**, so a defence island is
dangerous at both ranges: the missiles make a carrier plan around it, the lasers
make the approach cost something.

Turrets belong to the ISLAND. Take it and the previous owner's guns go with the
rest of their works: the reason to storm a defence island is to stop it
shooting, not to acquire it.

### The ratio that has to be legible

One mine could not feed a three-factory plant, so the AI built a plant and then
starved it. Two changes: a mine yields 60 materials (a resource-rich one 96,
against the 90 that three factories eat), and the AI only builds its third
factory when materials are actually piling up. The rule to remember is now
written into `data/economy.json`: **three factories need one rich mine, or two
plain ones.**

### The deadlock

An AI-vs-AI war ran to a permanent stop: both carriers afloat, both immobile at
zero fuel, neither able to win. Both sides had lost every lighter - and **the
parts to build a lighter arrive in a lighter**. No amount of reserve aboard
fixes that; a reserve runs out once, and it also silently resurrected the first
loss of the war for free.

The answer is that boats are not only built at sea. A depot holding the parts
launches one and it sails out to the ship. That is not an exception to ruling #3
- the fuel is still carried, by a boat, from the stockpile - it is what a supply
network is for. With it, a side that loses its whole logistics train recovers if
it still holds the industry, and the war resolves again: tick 396,491, won by
sinking.

---

## 2026-08-20 — Islands become something: roles, works, and replacement hulls

267 tests + smoke gate green. The largest untouched system in the game, and the
one that makes taking an island worth doing (ruling #24.1).

### What an island is FOR is now a decision

The ACCB pod builds the command centre; the command centre makes the island
yours; and then the owner picks one of three roles:

| Role | What it does | What it may build |
|---|---|---|
| Resource | mines materials into the network | warehouses |
| Factory | converts materials into fuel, munitions and **replacement hulls** | up to 3 factories, warehouses |
| Defence | nothing economic at all | up to 4 turrets |

The role can be changed until concrete is poured, and not after. Worldgen's
`kind` is no longer what an island produces - it is a **terrain bonus** when the
role suits the ground, so resource-rich rock rewards a mine and a natural
fortress rewards guns. Losing an island loses the works: the command centre is
what you took it for, but the previous owner's factories are theirs.

Factory throughput is **per factory built**, so three slots are three times the
plant rather than a label, and a factory island with nothing on it is a
building site.

### Replacement hulls close the loop

A factory makes chassis; the lighter carries them as a fourth good; the hangar
assembles one when there is a gap to fill. The unit RECORD is reused - ids are
stable for a whole war, so a Manta that comes back is the same Manta - and a
wrecked hangar deck cannot assemble anything. Losing an air group is no longer
permanent, provided you hold the industry to replace it.

### The AI develops its estate

`engine/ai_estate.js`. Without it the enemy takes islands, develops none, and
drifts out of fuel three hours in.

Two things it taught us, both fixed:

- **Sites could never be paid for.** A build came out of the island's own
  materials, but the cargo network ships a share of every island's stock to the
  stockpile every accrual - so a factory island could never accumulate the price
  of its own factory. The network that empties a site now also supplies it: the
  island's stock first, then the depot's.
- **Terrain-first planning starved a side.** If a team's islands all happened to
  be resource-rich, every one became a mine, no factory was ever planned, and
  the carrier ran on the trickle of crude a mine makes. The plant now comes
  second whatever the ground: a factory on poor ground beats no factory.

With both fixed the AI runs 2 mines and a 3-factory plant, and its fuel curve
turns back upward instead of sliding to zero.

### The board

Click an island you hold: role, works, stock, what is under construction, and
the choices open to you, priced. Same pattern as the damage board - rows built
once, not per frame, because a row rebuilt under the pointer cannot be clicked.

---

## 2026-08-20 — Targeting: the player is back in the loop

252 tests + smoke gate green. The original put the player in the targeting loop
at three levels, and all three are now here (ruling #21 a, b, c).

**Attack orders.** `order_unit_attack` designates an enemy unit or carrier; the
autopilot closes and engages it. The order *chases* - it re-aims at the target
every tick, because a target that is moving is the normal case - and it ENDS
when the target does, rather than sending an aircraft on to an empty patch of
sea. An order on something already dead is refused, so a stale click does
nothing.

**Boresight aiming.** Under direct control the round goes down the nose. A gun
always fires - aiming is the player's problem and a miss is a legitimate
outcome - while a missile needs a lock inside a 22-degree seeker cone, exactly
as a heat-seeker should. The seeker takes the target nearest the NOSE, not the
nearest target, so pointing the aircraft is the skill.

**Pointer mode.** `set_carrier_aim` gives the ship's laser a target the player
clicked; it prefers that while it lives and is in reach, and falls back to its
own judgement when it dies or is cleared. Clicking with a unit selected is an
attack order; clicking with nothing selected hands the contact to the ship's
laser.

`engine/targeting.js` holds all three, and the precedence is one function:
pilot's aim, then the attack order, then whatever the mount would have chosen.
The engine still picks for a hull nobody has an opinion about - that is what
makes an unattended Manta defend itself.

Client: an amber gunsight appears when you take the controls and turns red when
something is in the cone; `V` cycles the loadout; clicking an enemy attacks or
points the ship's laser.

---

## 2026-08-20 — The 1988 weapon sets

242 tests + smoke gate green. One weapon per hull kind is gone; each hull now
carries what the original gave it, and choosing between them is a decision.

| Hull | Loadout |
|---|---|
| Manta | laser / bouncing cluster bomb / napalm / heat-seeking missile |
| Walrus | cannon / mines (the ACCB pod is already its own thing) |
| Carrier | the 360-degree chemical laser |

Weapon records live once in `state.weapons`, indexed by weapon id, with
`state.loadouts` saying which ids each kind carries in cycle order. A hull keeps
only what differs between two identical airframes: which weapon is selected,
rounds of each, cooldown, and how hot the mount is. `V` cycles; the AI picks
missiles for a ship strike and falls back to the gun when the rails are empty.

Three behaviours are new, and all three are data rather than special cases:

- **splash** damages everything inside the blast, not only what it struck -
  cluster bombs and napalm.
- **trigger** is a mine: it does not fly, it waits, and it goes off for anyone
  who is not the side that laid it.
- **heat** puts the lasers - the Manta's and the ship's - out of action under
  sustained fire until they have cooled to a ready line. Burst discipline is
  the skill, exactly as the original had it.

`weapons.js` was past the size cap, so flight and damage moved to `shots.js`:
one module stops at the trigger, the other starts there.

### Three bugs worth recording

- **`guided` fell out of the weapon record** in the rewrite, so every missile
  flew straight at where its target had been and missed a moving Manta. The
  duel test caught it; nothing else would have until an AI-vs-AI war quietly
  got worse.
- **Autopilots seeded the beach with mines.** A mine's "target" is wherever the
  layer is standing, so auto-fire laid one every cooldown until the magazine was
  empty. Laying a mine is now a deliberate act, like deploying the pod.
- **Splash rounds detonated a full blast radius short.** The blast doubled as
  the proximity fuze, so a 120 m napalm canister went off 120 m out and missed
  everything behind the first target. A splash round now has to strike; the
  blast is what it damages, not what sets it off.

---

## 2026-08-20 — The damage board, as the original had it (rulings #21-#23)

226 tests + smoke gate green. Four answers came back; three changed the build.

### Point defence stays automatic; the autopilot defends itself

The line is not the airframe, it is the cockpit. A Manta with somebody in it
fires when that somebody says so; an unattended one defends itself AND presses
home the attack it was sent on. A ship's point defence and a Walrus gun never
wait — nobody asks a close-in mount for permission. One function says it:
`needsTrigger(unit)` is true only when `unit.control !== -1`.

### Seven geometric sections

The five functional ones are gone. Now, as the 1988 damage screen had them:
**bow, midship, stern, port, starboard, topside, engine**. An impact is resolved
in the ship's own frame — height first (anything above the deck hits the island
and the mast), then the beam, then how far forward — so **which way you turn
matters in both axes**, not just fore and aft.

Two consequences follow from a section's health, and the split is what makes
seven geometric sections work where five functional ones did:

1. **Systems**, on the sections that carry one — bow the point-defence mount,
   midship the hangar deck, stern the steering gear, topside the mast and
   sensors, engine the machinery. Exactly as the original named consequences for
   the engine and the weapon sections and left the rest as structure.
2. **Armour**, on *every* section including the bare plating of the sides: a
   hit on a wrecked section does up to half as much again to the hull. That is
   what makes presenting your good side worth doing, and it needs no new system
   to say it. Port and starboard would otherwise have been decoration.

### The automatic repair system

The original did not repair a ship the instant a boat touched alongside, and
neither do we any more. Materials now land in the **ship's own yard stores**;
`engine/repair.js` spends them at 8 points per 100 ticks, working through the
board in the priority the player set — **high, then medium, then low, worst
first inside each tier** — sections before plating. The lighter's job ends at
the store. New command `set_repair_priority`. `repairPerMinute`, which had sat
unused in `data/units.json` since Milestone 0, is gone: the rate is now
`repairPointsPer100Ticks`, in the same per-100-ticks form as fuel burn and
magazine reloading, so all three accumulate the same way.

### The board itself

`Z` opens it: a slowly turning **3D wireframe** of the ship, one box per
section, coloured green/amber/red by damage, with the list underneath showing
percentage and priority. Click a box on the model or a row in the list to cycle
LOW → MED → HIGH. A section on LOW is dimmed on the model, so the priorities
read off the ship and not only the list.

It is `Mesh` with `wireframe: true` rather than `LineSegments` for a reason:
it draws as wire and still raycasts as a solid, so a section can simply be
clicked.

**One bug the probe caught, and it would have bitten a real player.** The list
rows were rebuilt from scratch every frame, so the element under the pointer was
replaced sixty times a second and a click landed on a node that had already been
thrown away. Rows are now built once and only their text rewritten.

**Effect on the war:** faster and still decisive — AI-vs-AI resolves at tick
180,203, won by sinking.

---

## 2026-08-19 — Rulings #17, #18, #19: supply, the trigger, and damaged sections

227 tests + smoke gate green. Three rulings, three slices, in that order.

### #17 Ordnance is carried, not conjured

Rearming was free, so air power was unlimited and a carrier that emptied its
600-round magazine was defenceless for the rest of the war — which is literally
what decided the measured war.

Now the carrier holds an ordnance store (6000, full at start). Rearming a hull
is a withdrawal: 25 per Manta missile, 1 per gun round, and **partial rearms are
normal** — you take what there is. Point defence is fed from the same store at
40 rounds per 100 ticks, because a ship does not teleport shells to the mounts.
The lighter now carries ordnance alongside fuel and materials, in priority
order: fuel moves the ship, ordnance keeps it dangerous, materials put it back
together. The AI calls a run on whichever of fuel or ordnance is emptier.

The withdrawal threshold went from a third of the hull to half. Measured, not
guessed: with point defence reloading, both sides still died together at a
third, because a four-Manta wave carries 640 damage against 1000 hull.

### #18 A Manta fires for its pilot

Auto-fire was blanket. It is now the rule only for hulls that defend themselves
without being asked — a ship's point defence, a Walrus gun. A Manta shoots for
whoever is flying it: the player (`F`), or the AI agent that launched it, which
pulls the trigger in `manageStrike`.

Cooling down had to be split from choosing to shoot. They were the same branch,
so a trigger-fired Manta that was never fired would never have become ready
again. New command `fire_unit`, routed through the existing ownership check.

Target *selection* stays in the engine — nearest enemy in range this weapon can
engage — because that is not the decision the ruling was about.

### #19 Damaged sections

`engine/damage.js`. Five sections laid out along the ship, stern to bow:
engines, hangar, bridge, radar, guns. Where a round lands decides which one
takes it — the impact is projected onto the ship's own axis and read off in
fifths of her length — so **the aspect you present to an enemy is a real
decision**.

A hit costs the general hull its full damage and the section a 60% share, so
"mechanically wrecked but afloat" and "nearly sunk but still fighting" are
different states and the player can tell them apart.

| Section | What it costs you |
|---|---|
| engines | top speed, down to a 25% floor — a wrecked engine room still limps |
| bridge | rudder response, floor 30% |
| radar | detection range, floor 15%; at zero you are blind |
| hangar | binary: a wrecked hangar deck is a closed one, nothing launches or lands |
| guns | point defence slows as the mount is chewed up, then stops |

`maxSpeed`, `turnRate` and `radar` are **derived** onto the carrier record from
untouched base values whenever damage or repair moves, so the helm, the fog
filter and the AI keep reading them directly and know nothing about sections.

Materials landed by the lighter now repair the worst-damaged section first and
the plating second — a ship that cannot move, see, or fly its aircraft is in
worse trouble than one with dents. The HUD gained a damage row
(`eng OUT hgr 71 brg 93 rdr OUT gun 36`); an enemy contact reports `[]`, because
what is broken aboard an enemy ship is exactly what you would most like to know.

**Effect on the war:** decisive and faster. AI-vs-AI now resolves at tick
165,348 (was 233,987), won by sinking, with the loser's sections knocked out
before its hull ran out.

---

## 2026-08-19 — Weapons and damage (M1)

210 tests + smoke gate green. The last big hole in Milestone 1: hulls could be
sunk by running aground, and by nothing else.

### The shape of it

`data/weapons.json` gives each hull kind one weapon. The stats live once in
`state.weapons`, indexed by unit KIND, and a hull carries only `ammo` and
`cooldown` — two integers instead of eleven copied fields, which keeps the
state hash small and the records readable.

A shot is an entity with a life, not an instant line-of-fire test: it flies, it
can miss, and it can be outrun. `life = range / speed`, so a round that misses
runs out of flight instead of being deleted by a special case. Guided rounds
(the Manta's missiles) re-aim within a turn rate each tick; when their target
dies they fly on straight rather than vanishing.

Hit tests are against the **segment travelled this tick**, never the endpoint.
A missile covers 15 m per tick and a Manta is 12 m across, so an endpoint test
would let shots tunnel through their targets — the whole reason for
`segmentDistSq`, which is integer-only and keeps its parameter as a
numerator/denominator pair rather than a fraction.

Classes are by KIND, not altitude: a Walrus gun cannot elevate onto a Manta
whether that Manta is at 400 m or sitting on the deck. That is what makes a
lone Walrus ashore worth escorting.

Tick order gained one step: `stepUnits → stepWeapons → stepCapture`. After
movement, so a hull that just closed to range gets to use it; before capture,
so a Walrus killed on the beach cannot also plant its pod on the tick it died.

### The AI now fights

`engine/ai_strike.js` (split out to keep both AI modules under the size cap):
find the nearest **spotted** enemy carrier — same sensor rule the fog filter
uses, so the AI learns nothing a player would not — launch two Mantas, and vector
them at it. It never manoeuvres the carrier to attack; the carrier is the
airfield.

### Three things the first AI-vs-AI run after weapons taught us

- **The war stopped ending.** Both carriers sank, often on the same tick, and
  `checkVictory` had no case for "nobody afloat" — so it ran 900,000 ticks and
  declared nothing. `WIN_DRAW` now ends it honestly.
- **Trading to the death was the only tactic.** Added `withdraw`: below a third
  of its hull the AI turns directly away, recalls the air group, and calls for
  supply — the lighter brings materials, and materials are hull repair. With
  that in, the war resolves again at tick ~234,000, won by sinking.
- **A carrier that empties its magazine is defenceless forever.** Point defence
  is 600 rounds and nothing refills it. The war above was decided by exactly
  that. Ordnance is already produced by factories and stockpiled on islands, so
  ferrying it is the obvious next slice — recorded as question #17.

### And one from the probe

`combat_shot.mjs` ran on a pocket map and won the war on tick zero holding no
islands: two thirds of a one-island map rounds down to a threshold of nothing.
`checkVictory` now floors the requirement at one island.

---

## 2026-08-19 — Art direction as data, and the port claim (rulings #13, #6)

198 tests + smoke gate green. Nothing here touches the simulation: two players
on different styles see the same war and the same state hash.

**Ruling, same day:** retro is the game's look and is now the default; the
other two stay switchable. Scope is **look only** — no instrument rebuild, no
sea state, no weather, until asked. The carrier stays slow (8 kn) because time
compression, not speed, is the answer to the waiting.

### Three styles, switchable, not described

Ruling #13 asked for options and samples. `client/styles.js` holds them as
data — `retro` (1988), `modern` (the look so far), `hybrid` (a remaster) —
each a flat record of sky, fog scale, ocean treatment, shading, palette steps,
light intensities and HUD colour/font tokens. `?style=retro|modern|hybrid`
picks one; `applyStyleToDocument` pushes the instrument colours into CSS vars
so the HUD matches the scene. `client/render/world.js` and `scene.js` take the
style as an argument rather than reading a global.

`debugging/probes/style_shots.mjs` renders three shots per style (open sea,
closing with land, strategic) into `debugging/shots/styles/`. Passing a style
name re-shoots just that one while a look is being tuned.

### Three real rendering bugs the samples exposed

- **The sea was moire, not water.** A 100 m ripple seen from 7 km crosses
  several waves per pixel; the whole ocean turned into banding. Both the swell
  and the ripple now fade out with camera distance, and the ripple's wavelength
  went from ~100 m to ~450 m. Detail below a pixel is noise, not detail.
- **The retro grid only existed in the distance** — the one place it does
  nothing. `GridHelper` draws lines that span the whole map, so the ones beside
  the ship have an endpoint far behind the camera, and line clipping drops the
  whole segment. The grid is now built by hand, cut at every crossing, ~40k
  vertices once, and fades out at range so the far cells do not pile into a
  slab of blue along the horizon. This is what makes the 1988 option look like
  1988; without it, "retro" was just a dark sea.
- **The client sized the world from `rules.world.sizeMetres`** — the *base*
  size, not the scaled size from ruling #2. With more islands than the base
  count, the ocean plane and grid would have stopped short of the map's far
  corners. Now `worldSizeMetres(rules.world)`, the same function the engine
  uses. Latent at 8 islands; a visible hole at 16.

`window.__scene3d` now exposes the scene graph for render probes. That is how
the grid bug was diagnosed — reasoning about it produced four wrong theories in
a row, and one `page.evaluate` produced the answer.

### Port: 8135, not 8132

8132 is boombrawl's and 8133 is Sunset Runner's. Carrier Dominion claims
**8135**, recorded in the ledger of record — `game-ops/RetroMultiCiv/
multi-game-hosting.md` — with 8134 deliberately left free and labelled as such
so the next game takes it rather than skipping to 8136. `server/index.js` and
`run.sh` default to 8135; `PORT=` still overrides. `CarrierDominion/ops` is now
a symlink into the private `game-ops` repo, so the port row and deploy notes
live with the other games' rather than in a gitignored island of their own.

---

## 2026-08-19 — Milestone 1: the economy loop closes

Islands now pay for the ship, and the ship takes islands. 149 tests green.

`data/economy.json` gives each island kind an income row — resource islands pay
fuel and materials, factories pay materials and ordnance, radar and airfield
islands pay nothing because their value is sight and reach. A carrier lying
within 900 m of an island its team owns draws fuel from the stores and patches
its hull.

Two decisions worth recording:

- **Income accrues in a lump every 100 ticks**, not as a fraction every tick.
  With integer resources the two are identical, and the lump needs no per-team
  accumulator in state: one less field to forget in `copyState`, and a hash
  that does not churn on 19 ticks out of 20.
- **The carrier carries its own `maxHull`**, like every other stat. The repair
  cap could have come from the ruleset, but then the reducer would need the
  ruleset, and the whole point of snapshotting stats onto records is that
  `apply` never reaches outside the state it was given.

The tests caught the thing that always catches economy tests: a carrier burns
fuel while it sits there, and the idle-burn window is exactly the accrual
window, so every resupply figure has to account for it. `IDLE_BURN` is spelled
out at the top of `test/engine_economy.test.js` for the next person.

---

## 2026-08-19 — Milestone 1: an enemy, and a way to win

It is a game now: the other carrier plays, and somebody wins. 139 tests green,
smoke gate green.

### The AI carrier

`engine/ai_carrier.js` is a three-state machine — SEEK an island, INVADE it
with a Walrus, WAIT for the pod — running **inside the reducer** on the 3-tick
cadence, exactly as `plan-version1.md` §2.4 called for. That placement is the
whole point: the AI is part of the deterministic war, so every replay, every
golden hash, and every headless sim covers it. There is no separate AI process
to desync.

`engine/victory.js` ends the war two ways: hold two-thirds of the islands, or
be the last carrier afloat. The second is unreachable until weapons exist, but
wiring it now means the end-of-war path has tests from the start.

### The bug that justified the trace probe

The first AI took an island, turned for the next one, **ran aground on the
island it had just captured, and sat there for three hours of game time** with
the throttle at 40%. The brain kept steering at the target; the hull kept
refusing to move; nothing in the state machine could see the contradiction.

`debugging/probes/ai_trace.mjs` prints a line whenever the brain's situation
changes, and the fault was obvious in ten lines of output — a carrier at a
fixed position, throttle up, speed zero, grounded, forever.

The fix is `backOff`: aground, the carrier commits to a course straight out to
sea for 6000 ticks before the brain gets the helm back. The commitment has to
be that long because a carrier needs over a thousand ticks just to come about,
and a shorter escape puts it back on the same shelf on the next leg. It is the
same shape as the Walrus's contour-following: **the pattern that keeps
appearing is "when blocked, commit to an escape for long enough to matter".**

After the fix the AI takes all five islands it needs and wins at tick 361,000.

### Measurements

| | |
|---|---|
| AI takes its first island | tick 74,438 |
| AI vs AI, war decided | tick 338,375 (4.7 h of game time) |
| Headless tick rate, AI active | ~2,400 ticks/s (120x real time) |

The tick rate is down from 20,000/s because the AI's carrier now steams near
islands, where terrain sampling stops early-outing. Still ample, but the sweep
batteries planned for balance work will feel it — a memoised terrain sample is
the obvious lever when they do.

---

## 2026-08-19 — Milestone 1, first two groups: units, and taking an island

The game is now playable end to end: steam to an island, put a Walrus in the
water, drive it up the beach to the command node, deploy an ACCB pod, hold
while it builds, own the island. `test/integration_capture.test.js` does
exactly that through commands only - no reaching into state - and is the single
most valuable test in the suite.

127 tests green, smoke gate green.

### S1.1 Units: Manta and Walrus

Every airframe and vehicle exists from tick zero, STOWED in a hangar. Launching
is a state change, not a spawn: ids are stable for a whole war, a lost Manta is
a record rather than a missing one, and the fog filter has one less special
case.

- `engine/units.js` - records, life cycle, orders, fuel.
- `engine/flight.js` - Manta. Sim-lite: thrust, turn rate, a separate altitude
  axis, no stall. Runs dry over the sea and it is gone.
- `engine/drive.js` - Walrus. Swims, crawls ashore at a lower speed, refuses
  slopes past its climb limit.
- `engine/hangar.js` - launch geometry, recovery, refuel and re-arm.
- `engine/fleet.js` - one tick per unit. A returning unit re-aims at its
  carrier EVERY tick, because the carrier it is chasing is under way.

Two bugs worth remembering, both in the Walrus:

1. **Slope measured per-step deadlocked it.** Integer terrain rises by at least
   one unit, so at speed 3 a one-unit step reads as a 333-per-mil cliff: stop,
   accelerate, re-block, forever. Slope is now measured over a FIXED 2 m probe.
2. **A blocked Walrus never got anywhere**, because the autopilot kept steering
   into the same rock. It now looks 45 degrees either way, commits to the
   gentler side for 80 ticks, and follows the contour until the way up opens.
   Not path-finding - a driver, and a deterministic one.

### S1.2 Direct control

`take_control` / `release_control` / `set_unit_helm`, with the chase camera
following whatever the player is actually flying. The helm keys drive the
piloted unit when there is one and the carrier's own helm otherwise, so there
is one set of controls rather than two modes to learn.

### S1.3 Islands and the ACCB pod (ruling Q9)

A command node per island, placed at worldgen by scanning a fixed ring of
candidates for somewhere ashore, flat, and not on the summit - putting it on
the peak looks right and makes some islands impossible to capture.

A Walrus carries one pod, deploys it within 60 m of the node, and the pod
builds over 1200 ticks (a minute). An enemy pod deploying displaces one that is
still building and restarts the clock - the peaceful race; combat will provide
the louder answer later.

### Terrain: two changes that were really gameplay changes

- **A skirt of shallow water** around every island (to 1.6 radii). Without it
  the seabed was a 200 m cliff at the shoreline, which reads fine but means a
  Walrus meets an unclimbable wall at the beach and a carrier can anchor with
  its bow touching the sand. The skirt is what makes "keep the ship off the
  shallows" a real constraint - and it immediately found that the seed's
  spawn had a shoal 200 m off the bow, so `startPositions` now clears the
  shelf, not just the shore.
- **A warped coastline.** The distance from the island centre is displaced by a
  coarse noise field before the falloff is applied, which costs one noise
  sample and turns a bullseye dome into something with bays and headlands.

### Two rendering bugs the screenshots caught

- **Islands were invisible from above and unlit from the side.** Engine north
  maps to three.js -z, which flips the handedness of the terrain grid, so the
  naive triangle winding faced the seabed. Winding decides both which side is
  culled and which way `computeVertexNormals` points.
- **The strategic view showed an empty ocean** - same cause. Worth noting that
  neither bug could fail a headless test; both were found by looking at the
  smoke gate's screenshots, which is the argument for taking them.

### What this told us about pacing

The integration test reports its timings: a 7.6 km crossing takes **20,561
ticks (17 minutes)**, the Walrus run ashore another **15,518 (13 minutes)**,
the pod **1,200 (1 minute)**. Taking one island is half an hour of real time at
1x. That is the strongest evidence yet for time compression - it is question 1
in `dev-questions.md` and now has numbers behind it.

---

## 2026-08-19 — Milestone 0 complete (S0.1 … S0.8)

A carrier drives across a procedural ocean past procedural islands, in a
browser, driven end to end through both transports. 100 tests green plus the
browser smoke gate.

### S0.1 Repo scaffold

`package.json` (one runtime dependency: `ws`), `run.sh`, `README.md`, the
directory layout from the plan, `node --test` wiring, `/healthz`.

three.js is **vendored, not npm'd**: `client/vendor/three.module.min.js` is
r162, copied from multiciv, reached through an importmap. The client therefore
has zero install-time dependencies.

### S0.2 shared/

- `fixed.js` — 256 units = 1 m, 16-bit BAM angles, `floorDiv`/`truncDiv`,
  `mulDiv` with an exact-range assertion, `isqrt`, `turnToward`, `stepToward`.
  Every division normalises negative zero away at the source: `-0` compares
  equal to `0` but is not the same value everywhere, and it leaks in through
  `Math.floor(-0/n)`.
- `prng.js` — xorshift32 with the state in game state, `deriveSeed` for
  independent streams so adding a subsystem that rolls does not shift every
  other subsystem's numbers.
- `trig.js` + `trig_table.js` (generated by `tools/gen_trig.mjs`) — a committed
  1025-entry quadrant sine table plus a 257-entry arctangent table, integer
  linear interpolation between entries. Worst observed error vs `Math.sin`:
  well inside the 8/65536 tolerance the test pins.
- `statehash.js` — canonical string + FNV-1a **64** in 16-bit limbs. The FNV
  vectors for `""`, `"a"`, `"foobar"` are asserted, so the limb arithmetic is
  checked against the published algorithm rather than against itself.
- `noise.js` — integer value noise and fbm, shared by collision and mesher.
- `view.js` — per-team fog filtering, the only thing a client ever receives.

### S0.3 Reducer

`apply(state, command) -> state`, pure; `copyState` deep-copies every nested
array and object; commands validated and **dropped, never thrown on** (they
arrive from the network); events are integers in state so they are hashed and
replayed.

`test/fixtures/m0a.json` pins the state hash after each of 300 scripted ticks.
`tools/repin_m0a.mjs` refuses to re-pin when the **event stream** moved rather
than just the numbers — that is the signal that behaviour changed and wants an
explanation here first.

### S0.4 Worldgen

Dart-throwing with a minimum-separation reject. Terrain is a **pure function**
of the island's dozen integers — radial falloff times fbm — so no heightmap
grid is stored in state, the state hash stays small, and the client mesher and
the server's collision cannot disagree about where the beach is.

Golden world hash for seed 20260818: `94fca572b0e7ebf2`.

### S0.5 Carrier and helm

Turn, accelerate, translate, test the seabed, burn fuel — in that order,
and the order is part of the hash.

Grounding took two attempts. The first version tested only the next position;
at one unit per tick a hull creeps into a shoal and re-reports grounding every
tick. The fix tests a point 250 m ahead of the bow, so a ship held against a
shore stays grounded, reports **once**, and clears only when steered away.

### S0.6 Transports

One interface, two drivers. `createLocalTransport` runs the real engine in the
browser tab; `createWsTransport` talks to the authoritative server. Both feed
the renderer the same fog-filtered view object, and both run the same
`engine/authority.js` check — solo play has nobody to cheat, but running the
check there means a bug in a command path cannot hide until the LAN game finds
it.

`engine/authority.js` sits in `engine/` rather than `server/` precisely because
the browser loads the same file.

### S0.7 Client

three.js scene, shader ocean (medium/high) or flat ocean (low), island meshes
sampled from `engine/heightmap.js`, placeholder carrier, chase camera and a
strategic pull-back, WASD helm through the transport, and the three graphics
presets with multiciv's GPU auto-detect and a persisted override.

Two rendering bugs found and fixed by looking at the smoke screenshots:

- **Heading was mirrored.** Flipping engine north onto three.js `-z` also flips
  the sense of rotation, and the two negations cancel — so yaw is the heading
  unnegated. The first version negated it and every ship sailed backwards.
- **Everything was a silhouette.** The directional light aimed at the scene
  origin, which is the map's south-west *corner*, not its middle. It now aims
  at the map centre, with a weak fill from the opposite quarter.

### S0.8 Gates

`test/client_smoke.mjs` starts a real server on an ephemeral port, loads the
real client in Chromium, fails on **any** console error, page exception, or
failed request, drives the helm through the keyboard and asserts the engine
answered, checks the WebGL context is alive, and screenshots both transports to
`debugging/shots/`. It skips (exit 0) where Playwright browsers are absent.

`test/headless/sim_m0.mjs` runs the war headless: 6000 ticks in ~300 ms, about
1000x real time, which is the number that matters for future AI-vs-AI sweeps.

### Deviations from plan-version1.md

1. **Hashing.** The plan inherited Fireline's hand-maintained field list. I used
   multiciv's whole-state canonical walk instead: a new field cannot be
   forgotten by the hash, and the walk doubles as the hygiene assertion.
   `trajectoryHash` and `behaviorHash` cover the cases the field list was for.
2. **three.js r162**, vendored from multiciv, rather than `^0.165` from npm.
3. **No heightmap in state.** The plan's state sketch had a `heightmapRef`;
   terrain turned out to need no storage at all.

Both are recorded in `dev-questions.md` for the owner to confirm or reverse.
