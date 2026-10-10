// The page must carry the current modules: inline_modules.mjs embeds the js/
// files into glmm_analyzer.html, and this fails whenever a module was edited
// without re-running it. It also checks the loader's one assumption, that no
// module contains a sequence that would end its text block early.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFresh, listModules, buildBlocks } from '../inline_modules.mjs';

test('every module is embedded and the page is current', () => {
  const mods = listModules();
  assert.ok(mods.includes('js/main.js'));
  assert.ok(mods.length >= 12, 'expected the full module set, found ' + mods.length);
  assert.doesNotThrow(buildBlocks);
  assert.ok(isFresh(), 'glmm_analyzer.html is stale: run node glmm_analyzer/inline_modules.mjs');
});
