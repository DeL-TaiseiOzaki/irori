import test from 'node:test';
import assert from 'node:assert/strict';
import {
  currentLanguage,
  displayLocale,
  onLanguageChange,
  setLanguage,
  t,
} from '../src/domain/i18n';

test('interface text follows the chosen language and tells subscribers once per change', () => {
  let changes = 0;
  const stop = onLanguageChange(() => changes++);
  try {
    assert.equal(currentLanguage(), 'ja');
    assert.equal(t('閉じる', 'Close'), '閉じる');
    setLanguage('en');
    assert.equal(t('閉じる', 'Close'), 'Close');
    assert.equal(displayLocale(), 'en-US');
    setLanguage('en');
    assert.equal(changes, 1);
    setLanguage('ja');
    assert.equal(t('閉じる', 'Close'), '閉じる');
    assert.equal(changes, 2);
  } finally {
    stop();
    setLanguage('ja');
  }
});
