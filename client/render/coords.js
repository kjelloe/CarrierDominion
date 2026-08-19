// client/render/coords.js - the one place the engine's integer world becomes
// three.js floats.
//
// Engine: x east, y north, z up, 256 units per metre, all integers.
// three.js: x east, y up, z SOUTH - so north is -z and the mapping flips y.
// Floats exist on this side of the line only; nothing here ever flows back.

const UNITS_PER_METRE = 256;

function toMetres(units) {
  return units / UNITS_PER_METRE;
}

function toUnits(metres) {
  return Math.round(metres * UNITS_PER_METRE);
}

// Engine heading is BAM counter-clockwise from +x (east) toward +y (north).
// Flipping north onto -z also flips the sense of rotation, and the two
// negations cancel: yaw is the heading, converted to radians, unnegated.
// The forward vector of a mesh at this yaw is (cos yaw, 0, -sin yaw).
function headingToYaw(bam) {
  return (bam / 65536) * Math.PI * 2;
}

function yawToHeading(yaw) {
  const turns = yaw / (Math.PI * 2);
  return ((Math.round(turns * 65536) % 65536) + 65536) % 65536;
}

function forwardFromHeading(bam) {
  const yaw = headingToYaw(bam);
  return { x: Math.cos(yaw), z: -Math.sin(yaw) };
}

function scenePosition(xUnits, yUnits, altitudeUnits = 0) {
  return {
    x: toMetres(xUnits),
    y: toMetres(altitudeUnits),
    z: -toMetres(yUnits),
  };
}

export {
  UNITS_PER_METRE,
  toMetres,
  toUnits,
  headingToYaw,
  yawToHeading,
  forwardFromHeading,
  scenePosition,
};
