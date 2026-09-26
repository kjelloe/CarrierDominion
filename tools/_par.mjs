import { cpus } from 'node:os';
import { spawnSync } from 'node:child_process';
const N = Number(process.argv[2] ?? 120);
const lanes = Math.max(1, cpus().length - 2);
const out = [];
const procs = [];
for (let i = 0; i < lanes; i++) {
  procs.push(spawnSync(process.execPath, ['tools/sweep.mjs', '--count', String(N), '--shards', String(lanes), '--shard', String(i)],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
}
for (const p of procs) for (const l of (p.stdout ?? '').split('\n')) if (l && !l.startsWith('#') && !l.startsWith('seed,')) out.push(l.split(','));
const res = out.filter((r) => r[4] === '1');
const reasons = {};
for (const r of res) reasons[r[6]] = (reasons[r[6]] ?? 0) + 1;
const ticks = res.map((r) => Number(r[3])).sort((a, b) => a - b);
console.log(`${out.length} wars, ${res.length} resolved (${Math.round(res.length / out.length * 100)}%)`);
console.log('by:', JSON.stringify(reasons));
console.log('median tick', ticks[Math.floor(ticks.length / 2)], 'longest', ticks[ticks.length - 1]);
