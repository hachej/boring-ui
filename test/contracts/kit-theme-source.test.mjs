import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

// The chat and feedback items read the host's shadcn tokens and declare no palette of their own: no token values on :root, no
// prefers-color-scheme dark block, no colours redeclared for the ambient contrast variant, and no hard-coded colour or font in feedback.css.
const root = new URL('../../', import.meta.url);
const registry = JSON.parse(readFileSync(new URL('registry.json', root), 'utf8'));
const TOKENS = ['background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground', 'primary', 'primary-foreground', 'secondary',
  'secondary-foreground', 'muted', 'muted-foreground', 'accent', 'accent-foreground', 'destructive', 'border', 'input', 'ring'];
const KIT = ['pi-chat', 'pi-chat-markdown', 'pi-chat-slash', 'pi-chat-mentions', 'pi-chat-pickers', 'pi-chat-voice', 'pi-chat-attachments', 'pi-chat-question', 'pi-chat-approval', 'pi-chat-subagent', 'pi-artifacts', 'pi-chat-plugins', 'pi-ambient', 'pi-workspace', 'feedback', 'feedback-preview', 'button', 'utils'];

/** Every [selector path, property] declared in an item's `css` object. */
function declarations(css, path = []) {
  return Object.entries(css ?? {}).flatMap(([key, value]) => typeof value === 'object' ? declarations(value, [...path, key]) : [[path, key]]);
}

test('kit items declare no shadcn palette token, no :root block and no prefers-color-scheme dark mode', () => {
  for (const name of KIT) {
    const item = registry.items.find(entry => entry.name === name);
    assert.ok(item, name);
    assert.equal(item.cssVars, undefined, `${name} declares no cssVars: the theme item and the host own the tokens`);
    for (const [path, property] of declarations(item.css)) {
      const where = `${name}: ${path.join(' > ')} { ${property} }`;
      assert.ok(!(property.startsWith('--') && TOKENS.includes(property.slice(2))), `palette token declared in ${where}`);
      assert.ok(!path.some(selector => /:root|prefers-color-scheme/.test(selector)), `theme block in ${where}`);
      assert.ok(!path.some(selector => /data-variant=\\?"?contrast/.test(selector)), `contrast variant styled by colour declarations in ${where}`);
    }
  }
});

test('the ambient contrast variant is the host\'s own dark theme: its root carries .dark', () => {
  for (const file of ['ambient.tsx', 'notifications.tsx']) {
    const source = readFileSync(new URL(`registry/pi-ambient/${file}`, root), 'utf8');
    assert.match(source, /variant === 'contrast' && 'dark scheme-dark'/, file);
    assert.doesNotMatch(source, /oklch\(|#[0-9a-f]{3,8}\b/i, `${file} hard-codes no colour`);
  }
});

test('feedback.css reads tokens only: no hex colour, no font stack of its own, no fixed 16px text', () => {
  const css = readFileSync(new URL('registry/feedback/feedback.css', root), 'utf8');
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, 'no hex colour');
  assert.doesNotMatch(css, /ui-sans-serif|system-ui|Segoe UI/, 'the host font is inherited');
  assert.doesNotMatch(css, /font-size:\s*16px/, 'text sizes are rem (text-base), not px');
  assert.doesNotMatch(css, /\boklch\(|\brgb\((?!0 0 0 \/)|\bhsl\(/, 'no colour literal other than the black shadow tints');
  assert.doesNotMatch(css, /prefers-color-scheme|:root/, 'no theme block');
  assert.match(css, /--boring-feedback-surface: var\(--popover\);/);
  const overlay = readFileSync(new URL('registry/feedback/picker-overlay.ts', root), 'utf8');
  assert.doesNotMatch(overlay, /#[0-9a-f]{3,8}\b/i, 'the picker overlay styles read tokens too');
});
