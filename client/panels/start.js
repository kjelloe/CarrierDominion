// client/panels/start.js - the war you are about to fight.
//
// Everything the original set from a menu before you sailed: how big the
// archipelago is, whether there is anybody in it, how the war can end, and how
// fast the clock runs. Until now these were data in `data/rules.json`, which
// meant a host edited a file to change them.
//
// The options are applied to the RULESET, not smuggled in beside it, so the
// war a player starts is described entirely by seed plus rules - which is what
// keeps a replay a replay and a state hash a state hash.
//
// It only appears when the URL does not already say what to run: a link with
// `?mode=` in it is somebody who has already chosen, including every probe and
// the smoke gate.

const OPTIONS = [
  {
    key: 'islands',
    label: 'start.islands',
    values: [4, 8, 16, 32],
    apply: (rules, value) => { rules.world.islandCount = value; },
  },
  {
    key: 'teams',
    label: 'start.teams',
    values: [2, 3, 4, 8, 16],
    apply: (rules, value) => { rules.rules.teamCount = value; },
  },
  {
    key: 'enemy',
    label: 'start.enemy',
    values: [1, 0],
    text: ['start.enemyOn', 'start.enemyOff'],
    apply: (rules, value) => {
      // Solo: every team but yours is the machine when the enemy is on. The
      // teams row is listed above this one, so teamCount is already applied.
      const machine = [];
      if (value === 1) {
        for (let t = 1; t < rules.rules.teamCount; t++) machine.push(t);
      }
      rules.rules.aiTeams = machine;
    },
  },
  {
    key: 'ending',
    label: 'start.ending',
    values: [0, 1, 2],
    text: ['start.endIslands', 'start.endPoints', 'start.endTime'],
    apply: (rules, value) => {
      rules.rules.pointCap = value === 1 ? 4000 : 0;
      // Twenty minutes of game time at x1, which the compression ladder then
      // makes as long or short a sitting as the table wants.
      rules.rules.timeCapTicks = value === 2 ? 24000 : 0;
    },
  },
  {
    key: 'game',
    label: 'start.game',
    values: [0, 1],
    text: ['start.gameStrategy', 'start.gameAction'],
    apply: (rules, value) => { rules.rules.actionStart = value === 1 ? 1 : 0; },
  },
  {
    key: 'speed',
    label: 'start.speed',
    values: [1, 2, 4, 8, 16],
    apply: () => {},
  },
  {
    key: 'style',
    label: 'start.style',
    values: ['retro', 'modern', 'hybrid'],
    text: ['start.style1988', 'start.styleModern', 'start.styleRemaster'],
    apply: () => {},
  },
];

function defaultChoices() {
  const out = {};
  for (const option of OPTIONS) out[option.key] = option.values[0];
  return out;
}

function labelFor(t, option, value) {
  const index = option.values.indexOf(value);
  if (option.text === undefined) return String(value);
  return t(option.text[index] ?? option.text[0]);
}

function row(panel, option) {
  const line = document.createElement('div');
  line.className = 'start-row';
  const label = document.createElement('span');
  label.className = 'hud-label';
  label.textContent = panel.t(option.label);
  const value = document.createElement('span');
  value.className = 'start-value';
  value.textContent = labelFor(panel.t, option, panel.choices[option.key]);
  line.append(label, value);
  line.addEventListener('click', () => {
    const values = option.values;
    const next = values[(values.indexOf(panel.choices[option.key]) + 1) % values.length];
    panel.choices[option.key] = next;
    value.textContent = labelFor(panel.t, option, next);
    // The look row restyles the page live (owner ruling 2026-08-23): the
    // diorama and the menu's own colours are the preview of the choice.
    if (option.key === 'style' && panel.onStyle !== undefined) panel.onStyle(next);
  });
  return line;
}

// A seed you can read out over the table. Not from Math.random: the seed IS the
// war, and one a player can dictate to a friend is worth more than one that is
// merely unpredictable.
function seedFromClock() {
  return Number(String(Date.now()).slice(-8));
}

function createStartPanel(t, seed) {
  return { t: t, choices: defaultChoices(), seed: seed };
}

// Draws the menu and resolves with the choices when BEGIN is pressed.
function showStartPanel(panel) {
  const root = document.getElementById('start-panel');
  const body = document.getElementById('start-body');
  document.getElementById('start-title').textContent = panel.t('start.title');
  body.textContent = '';

  const seedRow = document.createElement('div');
  seedRow.className = 'start-row';
  const seedLabel = document.createElement('span');
  seedLabel.className = 'hud-label';
  seedLabel.textContent = panel.t('start.seed');
  const seedValue = document.createElement('span');
  seedValue.className = 'start-value';
  seedValue.textContent = panel.seed;
  seedRow.append(seedLabel, seedValue);
  seedRow.addEventListener('click', () => {
    panel.seed = seedFromClock();
    seedValue.textContent = panel.seed;
  });
  body.append(seedRow);

  for (const option of OPTIONS) body.append(row(panel, option));

  const begin = document.createElement('div');
  begin.id = 'start-begin';
  begin.textContent = panel.t('start.begin');
  body.append(begin);
  document.getElementById('start-note').textContent = panel.t('start.note');
  root.classList.add('open');
  document.body.classList.add('menu');

  return new Promise((resolve) => {
    const go = () => {
      root.classList.remove('open');
      document.body.classList.remove('menu');
      window.removeEventListener('keydown', onKey);
      resolve({ seed: panel.seed, choices: panel.choices });
    };
    const onKey = (event) => {
      if (event.key === 'Enter') go();
    };
    begin.addEventListener('click', go);
    window.addEventListener('keydown', onKey);
  });
}

// Fold the choices into the ruleset. Returns the pieces that are not rules -
// the starting clock speed and the art style - which belong to the client.
function applyChoices(rules, choices) {
  for (const option of OPTIONS) option.apply(rules, choices[option.key]);
  return { speed: choices.speed, style: choices.style };
}

export { OPTIONS, createStartPanel, showStartPanel, applyChoices, defaultChoices, seedFromClock };
