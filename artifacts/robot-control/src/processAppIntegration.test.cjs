const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = ts.createSourceFile('App.tsx', fs.readFileSync(path.join(__dirname, 'App.tsx'), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const lessons = [], locks = [];
function visit(node) {
  if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(source) === 'ProcessCellLesson') lessons.push(node);
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'useVirtualLock') locks.push(node);
  ts.forEachChild(node, visit);
}
visit(source);

test('restored process lesson blocks DT execution throughout hardware mode and connection transitions', () => {
  assert.equal(lessons.length, 1, 'chapter 4 mounts the original four-level process lesson');
  const attr = lessons[0].attributes.properties.find(node => ts.isJsxAttribute(node) && node.name.text === 'hardwareConnected');
  assert.ok(attr?.initializer && ts.isJsxExpression(attr.initializer));
  const blocked = new Function('practice', 'connectedTo', 'dialogStatus', 'return (' + attr.initializer.expression.getText(source) + ');');
  for (const hardware of [false, true]) for (const connected of [false, true]) {
    for (const status of ['disconnected', 'connecting', 'connected', 'error']) {
      assert.equal(blocked({ hardware }, connected ? { ip: '192.0.2.1' } : null, status),
        hardware || connected || status === 'connecting' || status === 'connected',
        JSON.stringify({ hardware, connected, status }));
    }
  }
});

test('process execution and prediction playback both hold the virtual mode lock only while active', () => {
  const call = locks.find(node => node.arguments[0]?.getText(source).includes('processVisual'));
  assert.ok(call, 'process playback participates in the shared mode lock');
  const active = new Function('isPickLesson', 'processVisual', 'return (' + call.arguments[0].getText(source) + ');');
  for (const isPickLesson of [false, true]) {
    assert.equal(active(isPickLesson, null), false);
    for (const running of [false, true]) for (const playing of [false, true]) {
      assert.equal(active(isPickLesson, { running, predictionPreview: { playing } }), isPickLesson && (running || playing));
    }
  }
});
