import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../src/', import.meta.url));
const files = fs.readdirSync(root).filter(file => file.endsWith('.tsx'));
const failures = [];
let buttonCount = 0;
let refreshCount = 0;

function attribute(opening, source, name) {
  return opening.attributes.properties.find(property =>
    ts.isJsxAttribute(property) && property.name.getText(source) === name,
  );
}

function stringAttribute(opening, source, name) {
  const value = attribute(opening, source, name)?.initializer;
  return value && ts.isStringLiteral(value) ? value.text : '';
}

for (const file of files) {
  const sourceText = fs.readFileSync(path.join(root, file), 'utf8');
  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  function visit(node, insideForm = false) {
    const isElement = ts.isJsxElement(node);
    const opening = isElement ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
    const tag = opening?.tagName.getText(source);
    const nextInsideForm = insideForm || tag === 'form';

    if (opening && tag === 'button') {
      buttonCount++;
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      const location = `${file}:${line}`;
      const onClick = Boolean(attribute(opening, source, 'onClick'));
      const disabled = Boolean(attribute(opening, source, 'disabled'));
      const type = stringAttribute(opening, source, 'type');
      const buttonSource = node.getText(source);
      const label = `${stringAttribute(opening, source, 'aria-label')} ${buttonSource}`;

      if (insideForm && !type) failures.push(`${location} button inside a form needs an explicit type`);
      if (!onClick && type !== 'submit' && !disabled) failures.push(`${location} button has no click handler, submit action, or disabled state`);
      if (/refresh/i.test(label)) {
        refreshCount++;
        if (!onClick) failures.push(`${location} Refresh button has no click handler`);
      }
    }

    ts.forEachChild(node, child => visit(child, nextInsideForm));
  }

  visit(source);
}

assert(buttonCount >= 400, `Expected the full app button inventory; found only ${buttonCount}`);
assert(refreshCount >= 20, `Expected all Refresh controls; found only ${refreshCount}`);
assert.deepEqual(failures, [], failures.join('\n'));
console.log(`PASS ${buttonCount} native buttons across ${files.length} pages/components, including ${refreshCount} Refresh controls, have explicit actions and safe form behavior`);
