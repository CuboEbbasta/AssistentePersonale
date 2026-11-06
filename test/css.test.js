'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('il badge nascosto (attributo hidden) non viene riattivato da .badge{display:inline-flex}', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'www', 'css', 'style.css'), 'utf8');
  assert.match(css, /\.badge\[hidden\]\s*\{\s*display:\s*none/);
});
