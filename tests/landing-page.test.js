import { readFileSync } from 'fs';
import { convertHtmlFile } from '../src/pipeline/convert.js';

test('vela fixture matches the deterministic snapshot', async () => {
  const actual = await convertHtmlFile('./tests/vela/input.html', {
    viewport: { width: 1440, height: 900 },
  });

  const expected = JSON.parse(readFileSync('./tests/vela/expected-snapshot.json', 'utf8'));
  expect(actual).toEqual(expected);
}, 30000);
