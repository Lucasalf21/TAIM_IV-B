import {readdirSync, readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
for (const file of readdirSync(new URL('../dist/assets/', import.meta.url))) {
  if (!file.endsWith('.js')) continue;
  const text = readFileSync(new URL('../dist/assets/' + file, import.meta.url), 'utf8');
  for (const field of ['p_ensemble', 'exceeded', 'normative', 'ens_median', 'window_start_index']) {
    assert.ok(!text.includes(field), `Researcher-only field in bundle: ${field}`);
  }
}
console.log('Participant bundle contains no supplied scoring fields.');
