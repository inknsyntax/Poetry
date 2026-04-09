const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const {
  syncJsonModules,
  watchJsonModules
} = require('../index');

async function createTempProject() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'json-forge-'));
  await fs.writeFile(
    path.join(tempRoot, 'package.json'),
    JSON.stringify({ name: 'json-forge-test', version: '1.0.0' }, null, 2),
    'utf8'
  );
  return tempRoot;
}

async function removeTempProject(tempRoot) {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

async function readText(filePath) {
  return fs.readFile(filePath, 'utf8');
}

async function waitFor(predicate, timeoutMs = 4000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

test('syncJsonModules creates wrappers and nested index exports', async () => {
  const tempRoot = await createTempProject();

  try {
    await writeJson(path.join(tempRoot, 'src', 'json', 'users.json'), {
      users: [{ id: 1, name: 'Ada' }]
    });
    await writeJson(path.join(tempRoot, 'src', 'json', 'nested', 'flags.json'), {
      beta: true
    });

    const result = await syncJsonModules(tempRoot);

    assert.equal(result.discoveredDirs.length, 1);

    const indexModule = require(path.join(tempRoot, 'src', 'json'));
    const usersModule = require(path.join(tempRoot, 'src', 'json', 'users'));
    const flagsModule = require(path.join(tempRoot, 'src', 'json', 'nested', 'flags'));

    assert.deepEqual(Object.keys(indexModule), ['nested', 'users']);
    assert.deepEqual(usersModule, { users: [{ id: 1, name: 'Ada' }] });
    assert.deepEqual(flagsModule, { beta: true });

    const wrapperText = await readText(path.join(tempRoot, 'src', 'json', 'users.js'));
    assert.match(wrapperText, /json-forge managed file/);
  } finally {
    await removeTempProject(tempRoot);
  }
});

test('syncJsonModules does not overwrite user-authored js files', async () => {
  const tempRoot = await createTempProject();

  try {
    const jsonDir = path.join(tempRoot, 'src', 'json');
    await writeJson(path.join(jsonDir, 'users.json'), { active: true });
    await fs.mkdir(jsonDir, { recursive: true });
    await fs.writeFile(path.join(jsonDir, 'users.js'), "module.exports = { custom: true };\n", 'utf8');

    const result = await syncJsonModules(tempRoot);
    const summary = result.results[0];
    const wrapperText = await readText(path.join(jsonDir, 'users.js'));
    const indexText = await readText(path.join(jsonDir, 'index.js'));

    assert.equal(wrapperText, "module.exports = { custom: true };\n");
    assert.equal(summary.skipped.length, 1);
    assert.match(summary.warnings[0], /Skipped existing user file/);
    assert.match(indexText, /require\("\.\/users\.json"\)/);
  } finally {
    await removeTempProject(tempRoot);
  }
});

test('cli modules command honors package jsonForge moduleFolders config', async () => {
  const tempRoot = await createTempProject();

  try {
    await fs.writeFile(
      path.join(tempRoot, 'package.json'),
      JSON.stringify({
        name: 'json-forge-test',
        version: '1.0.0',
        jsonForge: {
          moduleFolders: ['data-json']
        }
      }, null, 2),
      'utf8'
    );
    await writeJson(path.join(tempRoot, 'src', 'data-json', 'config.json'), { env: 'test' });

    const cliPath = path.join(__dirname, '..', 'cli.js');
    const { stdout } = await execFileAsync(process.execPath, [cliPath, 'modules', tempRoot], {
      cwd: path.join(__dirname, '..')
    });

    assert.match(stdout, /folders=1/);

    const moduleValue = require(path.join(tempRoot, 'src', 'data-json', 'config'));
    assert.deepEqual(moduleValue, { env: 'test' });
  } finally {
    await removeTempProject(tempRoot);
  }
});

test('watchJsonModules resyncs when json files change', async () => {
  const tempRoot = await createTempProject();
  const syncEvents = [];

  try {
    await fs.writeFile(
      path.join(tempRoot, 'package.json'),
      JSON.stringify({
        name: 'json-forge-test',
        version: '1.0.0',
        jsonForge: {
          watchDebounceMs: 25
        }
      }, null, 2),
      'utf8'
    );
    await writeJson(path.join(tempRoot, 'src', 'json', 'initial.json'), { ok: true });

    const watcher = await watchJsonModules(tempRoot, {
      onSync(result) {
        syncEvents.push(result.trigger);
      }
    });

    try {
      await writeJson(path.join(tempRoot, 'src', 'json', 'live.json'), { changed: true });

      await waitFor(async () => {
        const filePath = path.join(tempRoot, 'src', 'json', 'live.js');
        try {
          const text = await readText(filePath);
          return /live\.json/.test(text) && syncEvents.length >= 2;
        } catch {
          return false;
        }
      });

      const liveModule = require(path.join(tempRoot, 'src', 'json', 'live'));
      assert.deepEqual(liveModule, { changed: true });
      assert.equal(watcher.initial.discoveredDirs.length, 1);
    } finally {
      watcher.close();
    }
  } finally {
    await removeTempProject(tempRoot);
  }
});