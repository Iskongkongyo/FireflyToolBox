import { reverseText } from './helper.js';

export function run(input, action) {
  if (action !== 'reverse') throw new Error('Unsupported action');
  return { text: reverseText(input.text) };
}
