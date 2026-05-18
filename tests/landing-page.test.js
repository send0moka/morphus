import { readFileSync } from 'fs';
import { convertHtmlFile } from '../src/pipeline/convert.js';

test('landing page fixture matches the deterministic snapshot', async () => {
  const actual = await convertHtmlFile('./tests/landing-page/input.html', {
    viewport: { width: 1440, height: 900 },
  });

  const expected = JSON.parse(readFileSync('./tests/landing-page/expected-snapshot.json', 'utf8'));
  expect(actual).toEqual(expected);
}, 30000);
