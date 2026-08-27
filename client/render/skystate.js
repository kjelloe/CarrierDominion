// client/render/skystate.js - turning the war's weather into light.
//
// `shared/weather.js` says what the sky IS, in integers, for both halves of
// the game. This file says what that looks like: where the sun sits, what
// colour the light is, how hazy the air is, what the exposure should be, and
// how dark the cloud has gone.
//
// Everything here is cosmetic and High-tier only. Nothing in this file may
// reach the ruleset (test/engine_cosmetic.test.js checks), and the weather it
// reads is derived rather than stored, so no state hash depends on any of it.
//
// The curves are the reference scene's (docs/07 §3, lessons 1-7), with one
// that we had banked and never spent: **exposure must DECREASE as the sun
// rises.** High exposure desaturates the day sky toward white, so the naive
// "brighter day, higher exposure" makes noon look washed out. 0.5 at the
// horizon, 0.3 at high sun. Rayleigh stays at 2.0 - raising it makes the sky
// brighter, not bluer.

import * as THREE from '../vendor/three.module.min.js';

// Colours the light passes through in a day. Warm and low at the horizon,
// neutral at noon, and a cold blue at night that is deliberately not black -
// the owner's ask was for no complete darkness.
const NIGHT_LIGHT = new THREE.Color(0x2b3f66);
const DAWN_LIGHT = new THREE.Color(0xff8f3d);
const NOON_LIGHT = new THREE.Color(0xfff2df);

const NIGHT_FOG = new THREE.Color(0x0d1626);
const DAWN_FOG = new THREE.Color(0xe8a87c);
const NOON_FOG = new THREE.Color(0xbcd6e4);
// What the haze goes to when the weather closes in: not grey, but the
// grey-blue of a sea storm, which is what the owner asked for.
const STORM_FOG = new THREE.Color(0x2f3a49);
const STORM_LIGHT = new THREE.Color(0x8f9aa8);

function clamp01(value) {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

// How hard the storm pulls a colour, given how stormy it is.
//
// This curve exists because of a non-obvious fact about three.js, and it cost
// three rounds of guessing to find: **Color.lerp interpolates in LINEAR
// space**, not in sRGB. Colour management converts every `new THREE.Color(hex)`
// into the linear working space, and a bright warm colour is far brighter
// there than its hex suggests - so a linear blend keeps the warmth long after
// the weight "looks" nearly complete.
//
// Concretely: a dawn peach lerped 94% of the way to a cold slate still came
// out #5a4e51, a warm brown, which is why a squall kept reading brown however
// hard the weight was pushed. Measuring the uniform said so immediately; three
// rounds of raising the weight by eye had not.
//
// The fix is the curve, not a bigger number. Raising storm to a fractional
// power reaches deep weights early: a storm of 0.9 pulls at 0.95 rather than
// 0.85, and the last few per cent are the ones that actually change the hue.
function stormWeight(storm) {
  return Math.pow(clamp01(storm), 0.45);
}

// 0 at night, 1 in broad day, smooth across the horizon - the curve every
// other curve here is keyed on, as in the reference scene.
function dayFactor(weather) {
  return clamp01((weather.sunHeightPermil + 120) / 620);
}

// Where the sun is, as a unit vector. Height is the per-mil the weather
// function reports; the compass bearing walks with the day.
function sunDirection(weather, out) {
  const height = weather.sunHeightPermil / 1000;
  const flat = Math.sqrt(Math.max(0.0001, 1 - height * height));
  const bam = (weather.sunBam / 65536) * Math.PI * 2;
  // Engine north is -z in the scene (client/render/coords.js), and the sun
  // walks the same circle every other bearing in the game walks.
  out.set(Math.cos(bam) * flat, height, -Math.sin(bam) * flat);
  return out.normalize();
}

// Everything the renderer needs for one frame of sky, in one object so the
// caller does no arithmetic of its own.
function skyStateOf(weather) {
  const day = dayFactor(weather);
  const storm = weather.stormPermil / 1000;
  const cloud = weather.cloudPermil / 1000;

  // Light colour: night -> dawn -> noon, then drained toward storm grey.
  const light = NIGHT_LIGHT.clone();
  if (day > 0) light.lerp(DAWN_LIGHT, clamp01(day * 2));
  if (day > 0.5) light.lerp(NOON_LIGHT, clamp01((day - 0.5) * 2));
  light.lerp(STORM_LIGHT, stormWeight(storm) * 0.9);

  const fog = NIGHT_FOG.clone();
  if (day > 0) fog.lerp(DAWN_FOG, clamp01(day * 2));
  if (day > 0.5) fog.lerp(NOON_FOG, clamp01((day - 0.5) * 2));
  // The storm takes the colour, and takes it hard.
  fog.lerp(STORM_FOG, stormWeight(storm));
  // Cloud alone cools the air even without a storm behind it.
  fog.lerp(STORM_FOG, cloud * 0.4);

  // A flash lights the whole sky for a few ticks, which is most of what
  // sells lightning without drawing a bolt at all.
  const flash = weather.flashPermil / 1000;

  return {
    day: day,
    storm: storm,
    cloud: cloud,
    flash: flash,
    lightColour: light,
    fogColour: fog,
    // Never fully dark: the floor is the owner's ask, and 0.35 of a sun is
    // enough to steer by.
    sunIntensity: (0.35 + 2.1 * day) * (1 - storm * 0.55) + flash * 2.5,
    hemiIntensity: (0.25 + 0.5 * day) * (1 - storm * 0.35) + flash * 0.8,
    // Exposure DECREASES as the sun rises (docs/07 lesson 3), and a storm
    // pulls it down further so the grey reads as heavy rather than as fog.
    // The storm's exposure penalty is deliberately SMALL. At 0.25 a squall
    // came out as a black ceiling with no shape in it, which is not what a
    // storm looks like - a storm sky is dark and busy, and losing the busy
    // half loses the weather. The darkness comes from the colours; the
    // exposure only tips it.
    exposure: (0.5 - 0.2 * day) * (1 - storm * 0.12),
    // Haze: more at dawn, much more in weather.
    turbidity: 2 + 8 * (1 - day) + 14 * cloud,
    // Fog closes in with the weather. A clear day sees the whole
    // archipelago; a squall sees the next island and not the one beyond.
    fogFar: 1 - 0.55 * storm - 0.15 * cloud,
  };
}

export { skyStateOf, sunDirection, dayFactor };
