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
// (C11). The target is the name's suffix; the executables are Unity's names,
// except a fastengine build's Linux binary, which has no extension.
const NATIVE_TARGETS = [
  { suffix: /-win64\.zip$/i, platform: 'start.nativeWindows', note: 'start.nativeRunWindows', exe: () => 'carrierdominion.exe' },
  {
    suffix: /-linux64\.zip$/i,
    platform: 'start.nativeLinux',
    note: 'start.nativeRun',
    exe: (name) => (/-fe-/i.test(name) ? 'carrierdominion' : 'carrierdominion.x86_64'),
  },
];

// [{ label, href, note }] for a listing from the server, empty when there is
// none. `note` is '' where there is nothing to say (a linked page, an
// unknown target).
function nativeLinks(listing, t) {
  if (listing === null || typeof listing !== 'object') return [];
  if (listing.kind === 'url') return [{ label: t('start.nativeLink'), href: listing.url, note: '' }];
  if (listing.kind !== 'folder' || !Array.isArray(listing.files)) return [];
  return listing.files.map((file) => {
    const target = NATIVE_TARGETS.find((each) => each.suffix.test(file.name));
    const size = `${file.name} (${describeSize(file.size)})`;
    return {
      label: target === undefined ? size : `${t(target.platform)} · ${size}`,
      href: file.url,
      note: target === undefined ? '' : t(target.note, { exe: target.exe(file.name) }),
    };
  });
}

function showNativeLinks(listing, t) {
  const box = document.getElementById('native-links');
  if (box === null) return;
  const links = nativeLinks(listing, t);
  box.textContent = '';
  box.hidden = links.length === 0;
  if (links.length === 0) return;
  const caption = document.createElement('div');
  caption.textContent = t('start.native');
  box.append(caption);
  for (const link of links) {
    const anchor = document.createElement('a');
    anchor.href = link.href;
    anchor.textContent = link.label;
    // A folder's files download; a linked page opens beside the game.
    if (listing.kind === 'url') {
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
    box.append(row);
  }
  if (links.some((link) => link.note !== '')) {
    const keys = document.createElement('div');
    keys.textContent = t('start.nativeKeys');
    box.append(keys);
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

export { describeSize, nativeLinks, loadNativeLinks };
