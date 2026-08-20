// client/panels/warover.js - the war has an ending, so it gets a screen.
//
// Until now the end of a four-hour war was one line in the HUD, easy to sail
// straight past. This is the full-screen result: who won, how, the scoreboard
// the fog hid until it stopped mattering, the islands, and how long the war
// ran in its own time.
//
// It shows itself ONCE per war, on the tick the phase flips, and stays out of
// the way after that: KEEP WATCHING dismisses it (the world still ticks - it
// winds down, it does not freeze), RETURN TO PORT goes back to the start menu.
//
// The model is a pure function of the view so it can be tested in Node; the
// DOM below it is built once and filled in, never rebuilt per frame.

// What the screen says, as data. `t` is the i18n lookup.
function outcomeModel(view, t) {
  const mine = view.winner === view.team;
  const draw = view.winner < 0;
  const reasons = [
    'war.unknown', 'war.byIslands', 'war.byCarrier', 'war.draw', 'war.byPoints', 'war.byTime',
  ];
  const scores = [];
  for (const entry of view.scores ?? []) {
    scores.push(entry.id === view.team
      ? t('warover.scoreYou', { score: entry.score })
      : t('warover.scoreTheirs', { team: entry.id + 1, score: entry.score }));
  }
  let held = 0;
  for (const island of view.islands) if (island.owner === view.team) held += 1;
  const totalSeconds = Math.floor(view.tick / (view.params.tickHz > 0 ? view.params.tickHz : 20));
  return {
    title: draw ? t('warover.drawTitle') : t(mine ? 'war.won' : 'war.lost'),
    reason: t(reasons[view.winReason] ?? 'war.unknown'),
    scores: scores,
    islands: t('warover.islands', { held: held, total: view.islands.length }),
    length: t('warover.length', {
      hours: Math.floor(totalSeconds / 3600),
      minutes: Math.floor((totalSeconds % 3600) / 60),
    }),
  };
}

// Built once against the ids in index.html.
function createWaroverPanel(t) {
  const panel = {
    root: document.getElementById('warover-panel'),
    title: document.getElementById('warover-title'),
    reason: document.getElementById('warover-reason'),
    body: document.getElementById('warover-body'),
    menu: document.getElementById('warover-menu'),
    watch: document.getElementById('warover-watch'),
    t: t,
    // Which war the screen has already been shown for: the tick the phase
    // flipped. A new war starts at phase 0 and resets this.
    shown: 0,
  };
  panel.menu.textContent = t('warover.menu');
  panel.watch.textContent = t('warover.watch');
  panel.menu.addEventListener('click', () => { window.location.href = '/'; });
  panel.watch.addEventListener('click', () => panel.root.classList.remove('open'));
  return panel;
}

// Called every snapshot. Shows on the RUNNING -> OVER transition, exactly
// once, and re-arms if a new war starts behind the same page.
function updateWaroverPanel(panel, view) {
  if (panel === undefined || panel.root === null || view === undefined) return;
  if (view.phase === 0) {
    panel.shown = 0;
    panel.root.classList.remove('open');
    return;
  }
  if (panel.shown === 1) return;
  panel.shown = 1;
  const model = outcomeModel(view, panel.t);
  panel.title.textContent = model.title;
  panel.reason.textContent = model.reason;
  const lines = model.scores.concat([model.islands, model.length]);
  panel.body.textContent = '';
  for (const line of lines) {
    const row = document.createElement('div');
    row.textContent = line;
    panel.body.appendChild(row);
  }
  panel.root.classList.add('open');
}

export { outcomeModel, createWaroverPanel, updateWaroverPanel };
