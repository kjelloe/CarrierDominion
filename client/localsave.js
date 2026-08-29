// client/localsave.js - a solo war that survives the tab.
//
// In solo the engine runs in THIS TAB (client/transport.js), so closing it,
// reloading it, or changing the graphics tier used to be the end of the war.
// The tier chip made that reachable by accident on 2026-08-29 - a button
// beside PAUSE whose second click restarted the evening - and the honest fix
// is not a warning but a save.
//
// The record IS the ordinary save format (shared/savefile.js): seed, the
// start choices, the tick, the state hash and the command log. A war written
// here and a war written by the server are the same object, so a solo save is
// resumable by the same code that resumes a LAN one, and the hash check
// refuses a save the rules have moved underneath rather than limping back as
// a subtly different war.
//
// Multiciv reached the same shape from the other end (client/ui/saves.js
// there): autosave to localStorage on a boundary and on tab-hide, and offer
// the resume on the way back in.

import { saveGame } from '../shared/savefile.js';

// A permanent codename, like multiciv's rmc_* keys: it outlives any rename of
// the game and any reshuffle of the options object.
const SAVE_KEY = 'cd_solo_autosave';

// How often a war writes itself down while it is running. Thirty seconds is
// the server's autosave interval too, and the cost is the same shape: the log
// is integers, and re-serialising it is the only work.
const AUTOSAVE_MS = 30000;

function readSoloSave(store) {
  try {
    const raw = store.getItem(SAVE_KEY);
    if (raw === null || raw === undefined) return 0;
    const record = JSON.parse(raw);
    if (record === null || typeof record !== 'object') return 0;
    if (record.save === undefined) return 0;
    return record;
  } catch (error) {
    // A corrupt record is not a crash: it is a record we do not offer.
    return 0;
  }
}

function clearSoloSave(store) {
  try {
    store.removeItem(SAVE_KEY);
  } catch (error) {
    // Nothing to do and nothing worth saying.
  }
}

// Write the war down. Returns '' on success, or a short reason - the caller
// says it ONCE and the war carries on, because a full disk quota is not a
// reason to stop playing.
function writeSoloSave(store, game, seed, options, extra) {
  try {
    const record = {
      format: 'carrier-dominion-solo-autosave',
      savedAt: Date.now(),
      tick: game.state.tick,
      style: extra === undefined ? '' : extra.style,
      islands: extra === undefined ? 0 : extra.islands,
      save: saveGame(game, seed, options),
    };
    store.setItem(SAVE_KEY, JSON.stringify(record));
    return '';
  } catch (error) {
    return error.name === undefined ? 'error' : error.name;
  }
}

// How long ago, in words a player reads rather than a timestamp.
function agoText(savedAt, nowMs) {
  const seconds = Math.max(0, Math.round((nowMs - savedAt) / 1000));
  if (seconds < 90) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export { SAVE_KEY, AUTOSAVE_MS, readSoloSave, writeSoloSave, clearSoloSave, agoText };
