// shared/weather.js - the sky, as a function of the war.
//
// Owner's ask (2026-08-26): a lifelike ocean, wind aligned with the waves,
// weather that tells a story from near-white cloud to a grey-blue storm with
// lightning, and a sun that crosses the sky casting shadows - never full
// darkness.
//
// The whole thing is ONE PURE FUNCTION of (seed, tick). Nothing about the
// weather is stored in the state, so the state hash never carries it, and
// yet every client in a LAN game and every replay of every war sees exactly
// the same sky at exactly the same moment. That is the property that lets
// the weather be read by the renderer for looks AND by the engine for
// effect without the two ever disagreeing.
//
// Integer arithmetic throughout, in per-mil, because this file is read by
// the engine and therefore lives inside the Luau-portable subset (docs/01).
// No floats, no array methods, no exceptions - test/engine_subset.test.js
// checks.

import { mulCos, mulSin } from './trig.js';

// A day is thirty minutes of war at 1x (ruled 2026-08-26). Time compression
// speeds the sky up with everything else, because it is the same clock.
const DAY_TICKS = 36000;

// A weather front every twenty minutes or so, and a slower swing under it so
// two fronts are never quite the same. Coprime-ish periods keep the pattern
// from repeating audibly.
const FRONT_TICKS = 24000;
const SWING_TICKS = 91000;
const WIND_TURN_TICKS = 53000;

// How high the sun climbs at noon, and how far below the horizon it sinks.
// The night floor is deliberately shallow: the owner asked for no complete
// darkness, so midnight is a low blue rather than black.
const NOON_ELEVATION_PERMIL = 780;  // ~46 degrees, as a fraction of straight up
const NIGHT_DEPTH_PERMIL = 220;

// The lightning clock. A flash is a short, bright thing that must not be
// random per frame: it is derived from which "flash slot" the tick falls in,
// so every client flashes together.
const FLASH_SLOT_TICKS = 140;
const FLASH_LENGTH_TICKS = 7;

// A small integer hash. Deterministic, cheap, and portable - the same three
// multiplies in Lua.
function mix(a, b) {
  let h = (a * 374761393 + b * 668265263) % 2147483647;
  if (h < 0) h = h + 2147483647;
  h = (h ^ Math.floor(h / 8192)) % 2147483647;
  return (h * 1274126177) % 2147483647;
}

// A smooth 0..1000 wave from a period and a phase, in per-mil.
function wavePermil(tick, period, phaseBam) {
  const bam = ((Math.floor((tick % period) * 65536 / period) + phaseBam) % 65536 + 65536) % 65536;
  return 500 + Math.floor(mulSin(500, bam));
}

function clampPermil(value) {
  if (value < 0) return 0;
  if (value > 1000) return 1000;
  return value;
}

// The sky at this moment of this war.
//
//   sunBam        where the sun is around the compass
//   sunHeightPermil  +1000 straight up, 0 on the horizon, negative below it
//   dayPermil     1000 broad day, 0 deep night - what the light is worth
//   windBam       where the wind blows TO; the swell runs with it
//   windPermil    0 glassy, 1000 a gale
//   cloudPermil   0 clear, 1000 an overcast that has made its mind up
//   stormPermil   0 nothing, 1000 the middle of it - lightning, spray, dark
//   flashPermil   this tick's lightning, 0 most of the time
//
// All integers. The client divides by 1000; nothing below it does.
function weatherAt(seed, tick) {
  // --- the day ---
  const dayBam = Math.floor((tick % DAY_TICKS) * 65536 / DAY_TICKS);
  // Dawn at a quarter turn, so a war that starts at tick 0 starts at night
  // and comes up into morning - which is the nicer opening to look at.
  const solarBam = (dayBam + 49152) % 65536;
  const rise = Math.floor(mulSin(1000, solarBam));
  const sunHeightPermil = rise >= 0
    ? Math.floor(rise * NOON_ELEVATION_PERMIL / 1000)
    : Math.floor(rise * NIGHT_DEPTH_PERMIL / 1000);
  // What the light is worth. Twilight is generous on purpose: the ask was
  // for no complete darkness, so the floor is a moonlit 180 rather than 0.
  let dayPermil = 180 + Math.floor((sunHeightPermil + 200) * 820 / 980);
  dayPermil = clampPermil(dayPermil);

  // --- the fronts ---
  // Two slow waves with seed-derived phases, so each war's weather is its
  // own but neither wave ever jumps.
  const frontPhase = mix(seed, 1) % 65536;
  const swingPhase = mix(seed, 2) % 65536;
  const front = wavePermil(tick, FRONT_TICKS, frontPhase);
  const swing = wavePermil(tick, SWING_TICKS, swingPhase);
  // Weighted to the slower swing so a war has a MOOD that fronts move
  // through, rather than a sequence of unrelated squalls.
  const weather = clampPermil(Math.floor((front * 400 + swing * 600) / 1000));

  // Cloud arrives before the wind and leaves after it, which is what makes a
  // front read as weather rather than as a dial being turned.
  const cloudPermil = clampPermil(Math.floor(weather * 1100 / 1000));
  // Wind is the top half of the range: below that the sea is just breathing.
  const windPermil = clampPermil(Math.floor((weather - 200) * 1250 / 1000));
  // A storm is the top third, and it climbs fast once it starts.
  const stormPermil = weather <= 660 ? 0 : clampPermil((weather - 660) * 3);

  // --- the wind ---
  // It turns slowly and never spins: a third of a turn either side of the
  // war's own prevailing direction.
  const prevailing = mix(seed, 3) % 65536;
  const turn = wavePermil(tick, WIND_TURN_TICKS, mix(seed, 4) % 65536) - 500;
  const windBam = ((prevailing + turn * 26) % 65536 + 65536) % 65536;

  // --- the lightning ---
  // Which slot this tick is in, whether that slot flashes at all, and how
  // far through the flash we are. Nothing here reads a clock.
  let flashPermil = 0;
  if (stormPermil > 250) {
    const slot = Math.floor(tick / FLASH_SLOT_TICKS);
    const roll = mix(seed ^ 0x5f3a, slot) % 1000;
    if (roll < Math.floor(stormPermil / 3)) {
      const into = tick - slot * FLASH_SLOT_TICKS;
      if (into < FLASH_LENGTH_TICKS) {
        // Bright on the first tick, gone by the last: a stroke, not a lamp.
        flashPermil = 1000 - Math.floor(into * 1000 / FLASH_LENGTH_TICKS);
      }
    }
  }

  return {
    sunBam: solarBam,
    sunHeightPermil: sunHeightPermil,
    dayPermil: dayPermil,
    windBam: windBam,
    windPermil: windPermil,
    cloudPermil: cloudPermil,
    stormPermil: stormPermil,
    flashPermil: flashPermil,
  };
}

// What the weather does to a radar set (ruled 2026-08-26: wire one effect
// now). Heavy weather is sea clutter and rain in the beam - it shortens the
// picture, it does not blind you. Returns a per-mil multiplier on range.
//
// The floor matters more than the curve: a set that keeps two thirds of its
// reach in the worst storm changes how a war is fought without ever taking
// the player's eyes away.
function radarPermilFor(weather, worstPermil) {
  const worst = worstPermil === undefined ? 1000 : worstPermil;
  const loss = Math.floor(weather.stormPermil * (1000 - worst) / 1000);
  return 1000 - loss;
}

// Where the swell runs from, as a unit vector in per-mil - the renderer
// aligns its waves to this and the engine does not care.
function windVectorPermil(weather) {
  return { x: Math.floor(mulCos(1000, weather.windBam)), y: Math.floor(mulSin(1000, weather.windBam)) };
}

export {
  DAY_TICKS,
  FRONT_TICKS,
  weatherAt,
  radarPermilFor,
  windVectorPermil,
};
