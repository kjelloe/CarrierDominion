// client/panels/lobby.js - the room, on screen.
//
// The same furniture as the solo start menu, because it is the same decision:
// what war are we about to fight. What is different is that the answer is the
// SERVER's, not this client's - the room is drawn from the lobby message and
// every change is a request the host may or may not be allowed to make.
//
// So there is no local state here worth the name. Click a line, send a message,
// wait for the room to come back saying what happened. That is the only way a
// lobby stays honest when three people are clicking at once.

const OPTION_ROWS = [
  { key: 'islands', label: 'start.islands', values: [4, 8, 16, 32] },
  { key: 'teams', label: 'start.teams', values: [2, 3, 4, 8, 16] },
  {
    key: 'enemy',
    label: 'start.enemy',
    values: [1, 0],
    text: ['start.enemyOn', 'start.enemyOff'],
  },
  {
    key: 'ending',
    label: 'start.ending',
    values: [0, 1, 2],
    text: ['start.endIslands', 'start.endPoints', 'start.endTime'],
  },
  {
    key: 'game',
    label: 'start.game',
    values: [0, 1],
    text: ['start.gameStrategy', 'start.gameAction'],
  },
  { key: 'speed', label: 'start.speed', values: [1, 2, 4, 8, 16] },
  {
    key: 'observers',
    label: 'start.observers',
    values: [1, 0],
    text: ['start.observersOn', 'start.observersOff'],
  },
];

function createLobbyPanel(ctx) {
  return { ctx: ctx, room: undefined, stamp: '', wired: false };
}

// The chat line is wired once and lives outside the rebuilt body, so typing
// into it survives the room changing under you - which it does every time
// anybody readies, joins or leaves.
function wireChat(panel) {
  if (panel.wired) return;
  panel.wired = true;
  const input = document.getElementById('lobby-say');
  input.placeholder = panel.ctx.t('lobby.sayPlaceholder');
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const text = input.value;
    input.value = '';
    if (text.trim() !== '') panel.ctx.send({ type: 'lobby_say', text: text });
  });
}

function drawChat(panel, room) {
  const box = document.getElementById('lobby-chat');
  box.hidden = false;
  const log = document.getElementById('lobby-log');
  log.textContent = '';
  for (const line of room.chat) {
    const row = document.createElement('div');
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = `${line.name}: `;
    const said = document.createElement('span');
    said.textContent = line.text;
    row.append(who, said);
    log.append(row);
  }
  log.scrollTop = log.scrollHeight;
}

function labelFor(t, option, value) {
  if (option.text === undefined) return String(value);
  return t(option.text[option.values.indexOf(value)] ?? option.text[0]);
}

function line(className, left, right) {
  const row = document.createElement('div');
  row.className = className;
  const a = document.createElement('span');
  a.className = 'hud-label';
  a.textContent = left;
  const b = document.createElement('span');
  b.className = 'start-value';
  b.textContent = right;
  row.append(a, b);
  return row;
}

// Am I the host? The room says so; this client does not get to decide.
function meIn(room, team) {
  return room.seats.find((s) => s.team === team);
}

function drawRoster(panel, room, body) {
  const t = panel.ctx.t;
  for (const seat of room.seats) {
    const who = seat.team === -1 ? t('lobby.watching') : t('lobby.seat', { team: seat.team + 1 });
    const marks = [];
    if (seat.host === 1) marks.push(t('lobby.host'));
    marks.push(t(seat.ready === 1 ? 'lobby.ready' : 'lobby.waiting'));
    body.append(line('start-row', `${who}  ${seat.name}`, marks.join(' - ')));
  }
}

function drawOptions(panel, room, body, host) {
  const t = panel.ctx.t;
  body.append(line('start-row', t('start.seed'), String(room.options.seed)));
  for (const option of OPTION_ROWS) {
    const value = room.options[option.key];
    const row = line(
      host ? 'start-row island-act' : 'start-row',
      t(option.label),
      labelFor(t, option, value),
    );
    if (!host) {
      body.append(row);
      continue;
    }
    row.addEventListener('click', () => {
      const next = option.values[(option.values.indexOf(value) + 1) % option.values.length];
      panel.ctx.send({ type: 'lobby_option', key: option.key, value: next });
    });
    body.append(row);
  }
}

// Rebuilt only when the room actually changes: the rows are clickable, and an
// element replaced under the pointer cannot be clicked.
function renderLobbyPanel(panel, room, team) {
  const root = document.getElementById('start-panel');
  if (room === undefined || room.status !== 'lobby') {
    root.classList.remove('open');
    document.body.classList.remove('menu');
    document.getElementById('lobby-chat').hidden = true;
    panel.stamp = '';
    return;
  }
  const stamp = JSON.stringify(room);
  if (stamp === panel.stamp) return;
  panel.stamp = stamp;
  panel.room = room;

  const t = panel.ctx.t;
  const me = meIn(room, team);
  const host = me !== undefined && me.host === 1;
  root.classList.add('open');
  document.body.classList.add('menu');
  document.getElementById('start-title').textContent = t('lobby.title', { code: room.code });

  const body = document.getElementById('start-body');
  body.textContent = '';
  drawRoster(panel, room, body);
  body.append(document.createElement('br'));
  drawOptions(panel, room, body, host);

  const ready = me !== undefined && me.ready === 1;
  const readyRow = document.createElement('div');
  readyRow.id = 'start-begin';
  readyRow.textContent = t(ready ? 'lobby.unready' : 'lobby.iAmReady');
  readyRow.addEventListener('click', () => {
    panel.ctx.send({ type: 'lobby_ready', ready: !ready });
  });
  body.append(readyRow);

  if (host) {
    const start = document.createElement('div');
    start.id = 'start-begin';
    start.textContent = t('lobby.start');
    start.style.opacity = room.ready === 1 ? '1' : '0.4';
    start.addEventListener('click', () => {
      if (room.ready === 1) panel.ctx.send({ type: 'lobby_start' });
    });
    body.append(start);
  }
  document.getElementById('start-note').textContent = host
    ? t('lobby.hostNote')
    : t('lobby.guestNote');
  wireChat(panel);
  drawChat(panel, room);
}

export { OPTION_ROWS, createLobbyPanel, renderLobbyPanel };
