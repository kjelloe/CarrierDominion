// client/native.js - the native client's download line under the start menu
// and the war room (request C10). The server says what is on offer at
// /native.json; with nothing configured the line never appears.
//
// Hidden on touch screens by CSS: the builds are Windows and Linux, and the
// page a phone reaches through an invite link is the game it should play.

function describeSize(bytes) {
  const mb = bytes / 1048576;
  return mb >= 10 ? `${Math.round(mb)} MB` : `${Math.max(0.1, Math.round(mb * 10) / 10)} MB`;
}

// The zips carry no readme, so the line is a player's only instructions
// (C11). The target is the name's suffix; both engines name their binary
// `carrierdominion` (no extension on Linux). bj-engine also ships a DLSS
// build of the Windows one, which is first in the list so the plain suffix
// does not claim it.
const NATIVE_TARGETS = [
  { suffix: /-win64-dlss\.zip$/i, platform: 'start.nativeWindowsDlss', note: 'start.nativeRunWindows', exe: 'carrierdominion.exe' },
  { suffix: /-win64\.zip$/i, platform: 'start.nativeWindows', note: 'start.nativeRunWindows', exe: 'carrierdominion.exe' },
  { suffix: /-linux64\.zip$/i, platform: 'start.nativeLinux', note: 'start.nativeRun', exe: 'carrierdominion' },
];

// Which port built a zip, read off its name as the target is, in the order
// the selector offers them. Unity's builds carry no tag and are not offered
// (owner, 2026-11-19): an untagged name is no engine, and no line.
const ENGINES = [
  { id: 'fe', tag: /-fe-/i, label: 'start.engineFe' },
  { id: 'bj', tag: /-bj-/i, label: 'start.engineBj' },
];

function engineOf(name) {
  const engine = ENGINES.find((each) => each.tag.test(name));
  return engine === undefined ? '' : engine.id;
}

// [{ label, href, note, engine }] for a listing from the server, empty when
// there is none. `note` is '' where there is nothing to say (a linked page,
// an unknown target); `engine` is '' for a linked page.
function nativeLinks(listing, t) {
  if (listing === null || typeof listing !== 'object') return [];
  if (listing.kind === 'url') return [{ label: t('start.nativeLink'), href: listing.url, note: '', engine: '' }];
  if (listing.kind !== 'folder' || !Array.isArray(listing.files)) return [];
  return listing.files.filter((file) => engineOf(file.name) !== '').map((file) => {
    const target = NATIVE_TARGETS.find((each) => each.suffix.test(file.name));
    const size = `${file.name} (${describeSize(file.size)})`;
    return {
      label: target === undefined ? size : `${t(target.platform)} · ${size}`,
      href: file.url,
      note: target === undefined ? '' : t(target.note, { exe: target.exe }),
      engine: engineOf(file.name),
    };
  });
}

// The engines that have something on offer, in the selector's order.
function nativeEngines(links) {
  return ENGINES.map((engine) => engine.id).filter((id) => links.some((link) => link.engine === id));
}

// The viewer's last choice, kept in this browser only; any failure of
// storage simply means the first engine on offer.
const ENGINE_KEY = 'carrier-dominion-native-engine';

function rememberedEngine(engines) {
  try {
    const kept = window.localStorage.getItem(ENGINE_KEY);
    if (engines.includes(kept)) return kept;
  } catch (error) {
    // Storage off: the default below.
  }
  return engines[0];
}

function rememberEngine(id) {
  try {
    window.localStorage.setItem(ENGINE_KEY, id);
  } catch (error) {
    // Storage off: the choice lasts as long as the page.
  }
}

// Up to three ports times three targets is too many lines, so with more than
// one engine on offer the line carries a selector and shows that engine's
// builds only. With one engine it reads as it always did.
function showNativeLinks(listing, t) {
  const box = document.getElementById('native-links');
  if (box === null) return;
  const links = nativeLinks(listing, t);
  box.textContent = '';
  box.hidden = links.length === 0;
  if (links.length === 0) return;
  const engines = nativeEngines(links);
  const caption = document.createElement('div');
  caption.textContent = t('start.native');
  box.append(caption);
  const list = document.createElement('div');
  if (engines.length > 1) {
    const picker = document.createElement('select');
    picker.id = 'native-engine';
    for (const id of engines) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = t(ENGINES.find((engine) => engine.id === id).label);
      picker.append(option);
    }
    picker.value = rememberedEngine(engines);
    picker.addEventListener('change', () => {
      rememberEngine(picker.value);
      showRows(list, links.filter((link) => link.engine === picker.value), listing.kind, t);
    });
    caption.append(' ', picker);
  }
  box.append(list);
  const chosen = engines.length > 1 ? rememberedEngine(engines) : '';
  showRows(list, chosen === '' ? links : links.filter((link) => link.engine === chosen), listing.kind, t);
}

function showRows(list, links, kind, t) {
  list.textContent = '';
  for (const link of links) {
    const anchor = document.createElement('a');
    anchor.href = link.href;
    anchor.textContent = link.label;
    // A folder's files download; a linked page opens beside the game.
    if (kind === 'url') {
      anchor.target = '_blank';
      anchor.rel = 'noopener';
    } else {
      anchor.setAttribute('download', '');
    }
    const row = document.createElement('div');
    row.append(anchor);
    if (link.note !== '') {
      const note = document.createElement('span');
      note.className = 'note';
      note.textContent = link.note;
      row.append(note);
    }
    list.append(row);
  }
  if (links.some((link) => link.note !== '')) {
    const keys = document.createElement('div');
    keys.textContent = t('start.nativeKeys');
    list.append(keys);
  }
}

// Never in the way: a server without the endpoint, or one that cannot be
// reached, simply has no line.
async function loadNativeLinks(t) {
  try {
    const response = await fetch('/native.json', { cache: 'no-cache' });
    showNativeLinks(response.ok ? await response.json() : null, t);
  } catch (error) {
    showNativeLinks(null, t);
  }
}

export { describeSize, nativeEngines, nativeLinks, loadNativeLinks };
