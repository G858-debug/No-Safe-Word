/**
 * Test deduplicateWeightedTokens with various cases.
 */
import { deduplicateWeightedTokens } from '../packages/image-gen/src/prompt-decomposer';

const cases = [
  {
    name: 'Pass 2 dual-character (the actual bug)',
    input: '(1man, 1woman:1.3), (1man, 1woman:1.5), (night scene:1.3), (single amber streetlight:1.3), man leaning over car engine',
  },
  {
    name: 'Same weight duplicates',
    input: '(night scene:1.3), some stuff, (night scene:1.3), more stuff',
  },
  {
    name: 'Different weight — higher first',
    input: '(masterpiece:1.5), some stuff, (masterpiece:1.1)',
  },
  {
    name: 'Different weight — lower first',
    input: '(masterpiece:1.1), some stuff, (masterpiece:1.5)',
  },
  {
    name: 'No duplicates — should be unchanged',
    input: '(night scene:1.3), (single amber streetlight:1.3), mechanic workshop, Middelburg',
  },
  {
    name: 'Triple duplicate',
    input: '(1man:1.2), stuff, (1man:1.4), more, (1man:1.1)',
  },
  {
    name: '2women variant',
    input: '(2women:1.3), (2women:1.5), two women dancing',
  },
  {
    name: 'Unweighted duplicates preserved (tok trigger words)',
    input: '(1man, 1woman:1.3), scene stuff, tok, primary identity, tok, secondary identity',
  },
  {
    name: 'Shared traits preserved (dark brown eyes in both characters)',
    input: '(1man, 1woman:1.5), scene, tok, dark brown eyes, male stuff, tok, dark brown eyes, female stuff',
  },
];

for (const c of cases) {
  console.log(`\n=== ${c.name} ===`);
  console.log(`IN:  ${c.input}`);
  console.log(`OUT: ${deduplicateWeightedTokens(c.input)}`);
}
