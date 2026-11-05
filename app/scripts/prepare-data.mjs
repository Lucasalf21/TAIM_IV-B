import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

export function prepare(raw) {
  assert.equal(raw.threshold, 5);
  assert.equal(raw.n_members, 10);
  assert.equal(raw.window_h, 3);
  const entries = Object.entries(raw.episodes);
  assert.equal(entries.length, 20);
  const episodes = entries.map(([id, e]) => {
    assert.match(id, /^E\d{2}$/);
    assert.equal(e.members.length, 10);
    assert.ok(Number.isInteger(e.window_start_index) && e.window_start_index >= 0);
    assert.equal(e.window_len, 1);
    assert.equal(e.window_start_index + e.window_len, e.times.length);
    const timestamps = e.times.map(t => {
      assert.match(t, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/);
      const ms = Date.parse(t + 'Z');
      assert.ok(Number.isFinite(ms));
      return ms;
    });
    timestamps.slice(1).forEach((t, i) => assert.equal(t - timestamps[i], 10800000));
    e.members.forEach(member => {
      assert.equal(member.length, e.times.length);
      member.forEach(v => assert.ok(Number.isFinite(v) && v >= 0));
    });
    return {id, hours: timestamps.map(t => (t - timestamps[e.window_start_index]) / 3600000),
      members: e.members, windowStart: e.window_start_index};
  });
  const clean = {threshold: 5, windowHours: 3, episodes};
  const version = 'taim-ivb-' + createHash('sha256').update(JSON.stringify(clean)).digest('hex').slice(0, 16);
  return {version, ...clean};
}

const source = new URL('../../data/episodes_members.json', import.meta.url);
export const output = prepare(JSON.parse(readFileSync(source, 'utf8')));
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const raw = JSON.parse(readFileSync(source, 'utf8'));
  const summary = readFileSync(new URL('../../data/episodes.csv', import.meta.url), 'utf8').trim().split(/\r?\n/);
  const headers = summary.shift().split(',');
  const rows = summary.map(line => Object.fromEntries(line.split(',').map((v, i) => [headers[i], v])));
  assert.equal(rows.length, 20);
  assert.equal(new Set(rows.map(r => r.episode)).size, 20);
  for (const row of rows) {
    const e = raw.episodes[row.episode];
    assert.ok(e);
    assert.equal(Number(row.n_members), 10);
    assert.equal(Number(row.threshold), 5);
    assert.equal(Number(row.window_h), 3);
    assert.equal(row.window_start, e.times[e.window_start_index]);
    assert.equal(Number(row.exceeded), e.exceeded);
    assert.equal(Number(row.p_ensemble), e.p_ensemble);
    assert.equal(e.p_ensemble, e.members.filter(m => m[e.window_start_index] > 5).length / 10);
  }
  const memberLines = readFileSync(new URL('../../data/episodes_members.csv', import.meta.url), 'utf8').trim().split(/\r?\n/);
  assert.equal(memberLines.shift(), 'episode,member,step,time,in_window,wind_speed_100m');
  const seen = new Set();
  for (const line of memberLines) {
    const [id, member, step, time, inWindow, wind] = line.split(',');
    const e = raw.episodes[id];
    assert.ok(e);
    assert.ok(Number.isInteger(Number(member)) && Number(member) >= 1 && Number(member) <= 10);
    assert.ok(Number.isInteger(Number(step)) && Number(step) >= 0 && Number(step) < e.times.length);
    const key = `${id}/${member}/${step}`;
    assert.ok(!seen.has(key)); seen.add(key);
    assert.equal(time, e.times[Number(step)]);
    assert.equal(Number(wind), e.members[Number(member) - 1][Number(step)]);
    assert.equal(Number(inWindow), Number(Number(step) === e.window_start_index));
  }
  assert.equal(seen.size, output.episodes.reduce((n, e) => n + e.hours.length * 10, 0));
  mkdirSync(new URL('../src/generated/', import.meta.url), {recursive: true});
  writeFileSync(new URL('../src/generated/stimuli.json', import.meta.url), JSON.stringify(output));
  const sources = Object.fromEntries(['episodes.csv', 'episodes_members.csv', 'episodes_members.json'].map(name =>
    [name, createHash('sha256').update(readFileSync(new URL('../../data/' + name, import.meta.url))).digest('hex')]));
  writeFileSync(new URL('./source-manifest.json', import.meta.url), JSON.stringify({version: output.version, sources}, null, 2) + '\n');
  console.log(`Prepared ${output.episodes.length} episodes (${output.version}); no scoring fields exported.`);
}
