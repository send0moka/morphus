import { resolveFonts } from '../src/figma/font-resolver.js';

function node(computed, children = []) {
  return { computed, children };
}

test('preserves named font families and still honors available fallback fonts in the stack', async () => {
  const domTree = node({}, [
    node({
      fontFamily: 'Marcellus, serif',
      fontWeight: '400',
      fontStyle: 'normal',
    }),
    node({
      fontFamily: 'Lora, serif',
      fontWeight: '400',
      fontStyle: 'italic',
    }),
    node({
      fontFamily: 'Brand Serif, "Playfair Display", serif',
      fontWeight: '700',
      fontStyle: 'normal',
    }),
    node({
      fontFamily: 'Some Sans, sans-serif',
      fontWeight: '400',
      fontStyle: 'normal',
    }),
    node({
      fontFamily: '"Neulis Neue"',
      fontWeight: '600',
      fontStyle: 'normal',
    }),
    node({
      fontFamily: 'Gelica',
      fontWeight: '600',
      fontStyle: 'normal',
    }),
  ]);

  const fontMap = await resolveFonts(domTree);

  expect(fontMap['Marcellus, serif|400|normal']).toEqual({
    family: 'Marcellus',
    style: 'Regular',
  });
  expect(fontMap['Lora, serif|400|italic']).toEqual({
    family: 'Lora',
    style: 'Italic',
  });
  expect(fontMap['Brand Serif, "Playfair Display", serif|700|normal']).toEqual({
    family: 'Playfair Display',
    style: 'Bold',
  });
  expect(fontMap['Some Sans, sans-serif|400|normal']).toEqual({
    family: 'Some Sans',
    style: 'Regular',
  });
  expect(fontMap['"Neulis Neue"|600|normal']).toEqual({
    family: 'Neulis Neue',
    style: 'Semi Bold',
  });
  expect(fontMap['Gelica|600|normal']).toEqual({
    family: 'Gelica',
    style: 'SemiBold',
  });
});
