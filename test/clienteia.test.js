const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../www/js/core/clienteia.js');
const S = require('../www/js/core/schema.js');

const ollama = { tipoServer: 'ollama', indirizzoServer: 'http://localhost:11434', modello: 'qwen3:8b', chiaveApi: '' };
const openai = { tipoServer: 'openai', indirizzoServer: 'http://localhost:4000', modello: 'gpt-x', chiaveApi: '' };

test('schema: valori predefiniti e migrazione dei campi tipoServer/chiaveApi', () => {
  const d = S.statoDefault().impostazioniIA;
  assert.equal(d.tipoServer, 'ollama');
  assert.equal(d.chiaveApi, '');
  const vecchio = S.migra({ impostazioniIA: { abilitata: true, indirizzoServer: 'http://x:1', modello: 'm' } });
  assert.equal(vecchio.impostazioniIA.tipoServer, 'ollama');
  assert.equal(vecchio.impostazioniIA.chiaveApi, '');
  assert.equal(vecchio.impostazioniIA.indirizzoServer, 'http://x:1');
  assert.equal(vecchio.impostazioniIA.abilitata, true);
  const nuovo = S.migra({ impostazioniIA: { tipoServer: 'openai', chiaveApi: 'k' } });
  assert.equal(nuovo.impostazioniIA.tipoServer, 'openai');
  assert.equal(nuovo.impostazioniIA.chiaveApi, 'k');
});

test('elenco modelli Ollama: /api/tags, nessuna intestazione di autorizzazione', () => {
  const r = C.costruisciElencoModelli(ollama);
  assert.equal(r.url, 'http://localhost:11434/api/tags');
  assert.ok(!('Authorization' in r.headers));
  assert.equal(C.costruisciElencoModelli({ ...ollama, indirizzoServer: 'http://h:1///' }).url, 'http://h:1/api/tags');
});

test('elenco modelli OpenAI: /v1/models, base con e senza /v1', () => {
  assert.equal(C.costruisciElencoModelli(openai).url, 'http://localhost:4000/v1/models');
  assert.equal(C.costruisciElencoModelli({ ...openai, indirizzoServer: 'http://localhost:4000/v1' }).url, 'http://localhost:4000/v1/models');
  assert.equal(C.costruisciElencoModelli({ ...openai, indirizzoServer: 'http://localhost:4000/v1/' }).url, 'http://localhost:4000/v1/models');
});

test('chiave API: Bearer solo se non vuota; mai nell\'URL', () => {
  assert.ok(!('Authorization' in C.costruisciElencoModelli(openai).headers));
  assert.ok(!('Authorization' in C.costruisciElencoModelli({ ...openai, chiaveApi: '   ' }).headers));
  const r = C.costruisciElencoModelli({ ...openai, chiaveApi: 'sk-segreta' });
  assert.equal(r.headers.Authorization, 'Bearer sk-segreta');
  assert.ok(!r.url.includes('sk-segreta'));
  const g = C.costruisciGenerazione({ ...openai, chiaveApi: 'sk-segreta' }, 'ciao', 'sys');
  assert.equal(g.headers.Authorization, 'Bearer sk-segreta');
  assert.ok(!g.url.includes('sk-segreta'));
});

test('generazione Ollama: /api/generate con model, prompt, system, stream:false', () => {
  const g = C.costruisciGenerazione(ollama, 'ciao', 'sei utile');
  assert.equal(g.url, 'http://localhost:11434/api/generate');
  assert.equal(g.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(g.corpo), { model: 'qwen3:8b', prompt: 'ciao', system: 'sei utile', stream: false });
  assert.ok(!g.url.includes('qwen3'));
  assert.ok(!('system' in JSON.parse(C.costruisciGenerazione(ollama, 'ciao').corpo)));
});

test('generazione OpenAI: /v1/chat/completions con messaggi system e user', () => {
  const g = C.costruisciGenerazione(openai, 'ciao', 'sei utile');
  assert.equal(g.url, 'http://localhost:4000/v1/chat/completions');
  assert.deepEqual(JSON.parse(g.corpo), {
    model: 'gpt-x', stream: false,
    messages: [{ role: 'system', content: 'sei utile' }, { role: 'user', content: 'ciao' }]
  });
  assert.ok(!g.url.includes('gpt-x'));
  const senza = JSON.parse(C.costruisciGenerazione({ ...openai, indirizzoServer: 'http://h/v1' }, 'ciao').corpo);
  assert.deepEqual(senza.messages, [{ role: 'user', content: 'ciao' }]);
  assert.equal(C.costruisciGenerazione({ ...openai, indirizzoServer: 'http://h/v1' }, 'x').url, 'http://h/v1/chat/completions');
});

test('lettura elenco modelli', () => {
  assert.deepEqual(C.leggiElencoModelli('ollama', { models: [{ name: 'a' }, { name: 'b' }] }), ['a', 'b']);
  assert.deepEqual(C.leggiElencoModelli('openai', { data: [{ id: 'm1' }, { id: 'm2' }] }), ['m1', 'm2']);
  assert.deepEqual(C.leggiElencoModelli('openai', { data: [] }), []);
});

test('lettura elenco modelli: risposta malformata, errore chiaro', () => {
  assert.throws(() => C.leggiElencoModelli('openai', null), /non valida|non nel formato/i);
  assert.throws(() => C.leggiElencoModelli('openai', { models: [] }), /non valida|non nel formato/i);
  assert.throws(() => C.leggiElencoModelli('openai', { data: 'x' }), /non valida|non nel formato/i);
  assert.throws(() => C.leggiElencoModelli('ollama', { data: [] }), /non valida|non nel formato/i);
  assert.throws(() => C.leggiElencoModelli('ollama', 'testo'), /non valida|non nel formato/i);
});

test('lettura generazione', () => {
  assert.equal(C.leggiGenerazione('ollama', { response: 'ciao' }), 'ciao');
  assert.equal(C.leggiGenerazione('openai', { choices: [{ message: { content: 'hey' } }] }), 'hey');
});

test('lettura generazione: risposta malformata, errore chiaro', () => {
  assert.throws(() => C.leggiGenerazione('openai', {}), /non valida|non nel formato/i);
  assert.throws(() => C.leggiGenerazione('openai', { choices: [] }), /non valida|non nel formato/i);
  assert.throws(() => C.leggiGenerazione('openai', { choices: [{ message: {} }] }), /non valida|non nel formato/i);
  assert.throws(() => C.leggiGenerazione('openai', null), /non valida|non nel formato/i);
  assert.throws(() => C.leggiGenerazione('ollama', { }), /non valida|non nel formato/i);
});

test('tipo di server sconosciuto: errore', () => {
  assert.throws(() => C.costruisciElencoModelli({ ...ollama, tipoServer: 'boh' }), /tipo di server/i);
  assert.throws(() => C.leggiGenerazione('boh', {}), /tipo di server/i);
});
