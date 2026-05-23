import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFocusedFileDirective,
  isNpmInstallIntent,
  shouldAttachWorkspaceSetup,
} from './project-context.js';

describe('isNpmInstallIntent', () => {
  it('detects install from package.json mentions', () => {
    assert.equal(
      isNpmInstallIntent('install my project specific packages using @package.json'),
      true
    );
    assert.equal(isNpmInstallIntent('npm install dependencies'), true);
    assert.equal(isNpmInstallIntent('set up project dependencies'), true);
  });

  it('does not treat generic file edits as install', () => {
    assert.equal(isNpmInstallIntent('update @server.js routes'), false);
  });
});

describe('shouldAttachWorkspaceSetup', () => {
  it('attaches setup for install intent even with @package.json', () => {
    assert.equal(shouldAttachWorkspaceSetup('install packages from @package.json'), true);
  });

  it('skips setup for unrelated @file edits', () => {
    assert.equal(shouldAttachWorkspaceSetup('fix @server.js'), false);
  });
});

describe('buildFocusedFileDirective', () => {
  it('returns npm install directive for @package.json install requests', () => {
    const d = buildFocusedFileDirective(
      'install project packages using @package.json',
      '/tmp/ws'
    );
    assert.ok(d?.includes('npm install'));
    assert.ok(d?.includes('Do **NOT** loop'));
  });
});
