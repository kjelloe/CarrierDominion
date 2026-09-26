import { cpus } from 'node:os';
import { spawnSync } from 'node:child_process';
const lanes = Math.max(1, cpus().length - 2);
const out = [];
for (let i = 0; i < lanes; i++) {
  const p = spawnSync(process.execPath, ['tools/sweep.mjs', '--count', '120', '--shards', String(lanes), '--shard', String(i)],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  for (const l of (p.stdout ?? '').split('\n')) if (l && !l.startsWith('#') && !l.startsWith('seed,')) out.push(l.split(','));
}
const isl = out.filter((r) => r[6] === 'islands');
const ticks = isl.map((r) => Number(r[3])).sort((a, b) => a - b);
console.log(`${isl.length} island wins of ${out.length} wars`);
console.log('  earliest', ticks[0], ' median', ticks[Math.floor(ticks.length/2)], ' latest', ticks[ticks.length-1]);
console.log('  splits at the win:', isl.slice(0, 8).map((r) => r[12] ?? r[11]).join('  '));
console.log(`  under 20k ticks (suspiciously early): ${ticks.filter((t) => t < 20000).length}`);
