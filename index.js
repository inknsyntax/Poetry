const fsNative = require('fs');
const fs = fsNative.promises;
const path = require('path');
const { z, ZodError } = require('zod');

const GENERATED_FILE_HEADER = '// json-forge managed file. Do not edit directly.\n';
const DEFAULT_JSON_MODULE_FOLDERS = ['json'];
const DEFAULT_JSON_MODULE_IGNORES = ['node_modules', '.git'];

async function ensureDir(targetPath) {
  await fs.mkdir(targetPath, { recursive: true });
}

async function createFile(targetPath, content = '') {
  const dir = path.dirname(targetPath);
  await ensureDir(dir);
  await fs.writeFile(targetPath, content, 'utf8');
  return targetPath;
}

async function renamePath(fromPath, toPath) {
  await ensureDir(path.dirname(toPath));
  await fs.rename(fromPath, toPath);
  return toPath;
}

async function editFile(targetPath, opts = {}) {
  const exists = await fs.stat(targetPath).catch(() => null);
  if (!exists || !exists.isFile()) {
    throw new Error(`editFile: file does not exist: ${targetPath}`);
  }

  let text = await fs.readFile(targetPath, 'utf8');
  if (typeof opts.replace === 'object' && opts.replace !== null) {
    const { find, with: replacement } = opts.replace;
    text = text.split(find).join(replacement);
  }
  if (typeof opts.append === 'string') {
    text += opts.append;
  }
  if (typeof opts.prepend === 'string') {
    text = opts.prepend + text;
  }
  await fs.writeFile(targetPath, text, 'utf8');
  return targetPath;
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function toModulePath(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  return normalized.startsWith('.') ? normalized : `./${normalized}`;
}

function isManagedFileContent(content) {
  return typeof content === 'string' && content.startsWith(GENERATED_FILE_HEADER);
}

async function shouldWriteManagedFile(targetPath, nextContent) {
  if (!(await pathExists(targetPath))) {
    return { write: true, reason: 'create' };
  }

  const currentContent = await fs.readFile(targetPath, 'utf8');
  if (currentContent === nextContent) {
    return { write: false, reason: 'unchanged' };
  }
  if (isManagedFileContent(currentContent)) {
    return { write: true, reason: 'update' };
  }
  return { write: false, reason: 'user-file' };
}

function buildJsonWrapperSource(jsonFileName) {
  return `${GENERATED_FILE_HEADER}'use strict';\n\nmodule.exports = require(${JSON.stringify(`./${jsonFileName}`)});\n`;
}

function buildDirectoryIndexSource(moduleEntries) {
  const lines = moduleEntries
    .sort((left, right) => left.key.localeCompare(right.key))
    .map(entry => `  ${JSON.stringify(entry.key)}: require(${JSON.stringify(entry.requirePath)})`);

  return `${GENERATED_FILE_HEADER}'use strict';\n\nmodule.exports = {\n${lines.join(',\n')}\n};\n`;
}

function normalizeJsonModuleOptions(options = {}) {
  const folderNames = Array.isArray(options.moduleFolders) && options.moduleFolders.length > 0
    ? options.moduleFolders
    : DEFAULT_JSON_MODULE_FOLDERS;
  const ignoreFolders = Array.isArray(options.ignoreFolders)
    ? options.ignoreFolders
    : DEFAULT_JSON_MODULE_IGNORES;

  return {
    moduleFolders: folderNames.map(name => name.toString().trim()).filter(Boolean),
    ignoreFolders: ignoreFolders.map(name => name.toString().trim()).filter(Boolean),
    watchDebounceMs: Number.isFinite(options.watchDebounceMs) ? options.watchDebounceMs : 150,
    onSync: typeof options.onSync === 'function' ? options.onSync : null,
    onError: typeof options.onError === 'function' ? options.onError : null
  };
}

async function loadJsonForgeConfig(baseDir = process.cwd()) {
  const packageJsonPath = path.resolve(baseDir, 'package.json');
  const defaults = normalizeJsonModuleOptions();

  if (!(await pathExists(packageJsonPath))) {
    return defaults;
  }

  try {
    const packageJsonText = await fs.readFile(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(packageJsonText);
    return normalizeJsonModuleOptions(packageJson.jsonForge || {});
  } catch {
    return defaults;
  }
}

async function discoverJsonModuleDirs(baseDir = process.cwd(), options = {}) {
  const rootDir = path.resolve(baseDir);
  const settings = normalizeJsonModuleOptions(options);
  const matches = [];

  async function walk(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (settings.ignoreFolders.includes(entry.name)) {
        continue;
      }

      const fullPath = path.join(currentDir, entry.name);
      if (settings.moduleFolders.includes(entry.name)) {
        matches.push(fullPath);
      }

      await walk(fullPath);
    }
  }

  await walk(rootDir);
  return matches.sort();
}

async function writeManagedFile(targetPath, content, summary) {
  const decision = await shouldWriteManagedFile(targetPath, content);
  if (!decision.write) {
    if (decision.reason === 'user-file') {
      summary.skipped.push(targetPath);
      summary.warnings.push(`Skipped existing user file: ${targetPath}`);
    }
    return false;
  }

  await createFile(targetPath, content);
  summary.written.push(targetPath);
  return true;
}

async function syncJsonModuleDirectory(rootDir, options = {}) {
  const summary = {
    rootDir,
    written: [],
    skipped: [],
    warnings: []
  };

  async function visit(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    const jsonFiles = [];
    const childDirs = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        childDirs.push(entry.name);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
        jsonFiles.push(entry.name);
      }
    }

    const exports = [];

    for (const jsonFileName of jsonFiles) {
      const parsed = path.parse(jsonFileName);
      const jsWrapperPath = path.join(currentDir, `${parsed.name}.js`);
      const wrapperSource = buildJsonWrapperSource(jsonFileName);
      await writeManagedFile(jsWrapperPath, wrapperSource, summary);
      exports.push({ key: parsed.name, requirePath: `./${jsonFileName}` });
    }

    for (const childDirName of childDirs) {
      const childDirPath = path.join(currentDir, childDirName);
      const childSummary = await visit(childDirPath);
      if (childSummary.hasExports) {
        exports.push({ key: childDirName, requirePath: `./${childDirName}` });
      }
    }

    const indexPath = path.join(currentDir, 'index.js');
    if (exports.length > 0) {
      const indexSource = buildDirectoryIndexSource(exports);
      await writeManagedFile(indexPath, indexSource, summary);
    }

    return { hasExports: exports.length > 0 };
  }

  await visit(rootDir);
  return summary;
}

async function syncJsonModules(baseDir = process.cwd(), options = {}) {
  const projectDir = path.resolve(baseDir);
  const config = await loadJsonForgeConfig(projectDir);
  const settings = normalizeJsonModuleOptions({ ...config, ...options });
  const discoveredDirs = await discoverJsonModuleDirs(projectDir, settings);
  const results = [];

  for (const jsonDir of discoveredDirs) {
    const result = await syncJsonModuleDirectory(jsonDir, settings);
    results.push(result);
  }

  return {
    baseDir: projectDir,
    discoveredDirs,
    results,
    settings
  };
}

async function watchJsonModules(baseDir = process.cwd(), options = {}) {
  const projectDir = path.resolve(baseDir);
  const config = await loadJsonForgeConfig(projectDir);
  const settings = normalizeJsonModuleOptions({ ...config, ...options });
  let disposed = false;
  let timeoutId = null;
  let activeSync = null;

  const runSync = async trigger => {
    if (disposed) {
      return null;
    }
    if (activeSync) {
      return activeSync;
    }

    activeSync = syncJsonModules(projectDir, settings)
      .then(result => {
        activeSync = null;
        if (settings.onSync) {
          settings.onSync({ trigger, ...result });
        }
        return result;
      })
      .catch(error => {
        activeSync = null;
        if (settings.onError) {
          settings.onError(error);
          return null;
        }
        throw error;
      });

    return activeSync;
  };

  const scheduleSync = trigger => {
    if (disposed) {
      return;
    }
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      runSync(trigger).catch(() => undefined);
    }, settings.watchDebounceMs);
  };

  const initial = await runSync('initial');
  const watcher = fsNative.watch(projectDir, { recursive: true }, (eventType, filename) => {
    const relativeName = typeof filename === 'string' ? filename.split(path.sep).join('/') : '';
    if (!relativeName) {
      scheduleSync(`${eventType}:unknown`);
      return;
    }

    const parts = relativeName.split('/');
    const hitsJsonFolder = parts.some(part => settings.moduleFolders.includes(part));
    if (hitsJsonFolder) {
      scheduleSync(`${eventType}:${relativeName}`);
    }
  });

  return {
    initial,
    close() {
      disposed = true;
      clearTimeout(timeoutId);
      watcher.close();
    },
    syncNow() {
      return runSync('manual');
    }
  };
}

function normalizeSpec(spec) {
  if (Array.isArray(spec)) {
    return spec;
  }
  if (typeof spec === 'object' && spec !== null) {
    if (!spec.operations && (spec.folder || spec.file || spec.Folder || spec.File)) {
      return [spec];
    }
    if (spec.operations) {
      return spec.operations;
    }
  }
  throw new Error('Invalid JSON schema. Expect object or { operations: [] }');
}

function interpolateString(raw, ctx = {}) {
  if (typeof raw !== 'string') return raw;
  return raw.replace(/\{\{(.+?)\}\}/g, (_, key) => {
    const keys = key.trim().split('.');
    let value = ctx;
    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        value = undefined;
        break;
      }
    }
    return value === undefined || value === null ? '' : String(value);
  });
}

function getLanguageFileExtension(language) {
  const map = {
    js: 'js',
    javascript: 'js',
    py: 'py',
    python: 'py',
    sh: 'sh',
    bash: 'sh',
    rb: 'rb',
    ruby: 'rb',
    cpp: 'cpp',
    cxx: 'cpp',
    c: 'c',
    txt: 'txt'
  };
  return map[(language || '').toString().toLowerCase()] || '';
}

function getLanguageExecutor(language) {
  const map = {
    js: 'node',
    javascript: 'node',
    py: 'python',
    python: 'python',
    sh: 'bash',
    bash: 'bash',
    rb: 'ruby',
    ruby: 'ruby',
    cpp: 'g++',
    cxx: 'g++',
    c: 'gcc'
  };
  return map[(language || '').toString().toLowerCase()] || null;
}

const OperationSchema = z.object({
  op: z.string().optional(),
  operation: z.string().optional(),
  Folder: z.string().optional(),
  folder: z.string().optional(),
  File: z.string().optional(),
  file: z.string().optional(),
  file_type: z.string().optional(),
  fileType: z.string().optional(),
  path: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  src: z.string().optional(),
  dest: z.string().optional(),
  old: z.string().optional(),
  new: z.string().optional(),
  content: z.string().optional(),
  append: z.string().optional(),
  prepend: z.string().optional(),
  replace: z.object({ find: z.string(), with: z.string() }).optional(),
  operations: z.array(z.any()).optional(),
  children: z.array(z.any()).optional(),
  items: z.array(z.any()).optional(),
  context: z.record(z.any()).optional()
}).superRefine((op, ctx) => {
  const command = (op.op || op.operation || 'auto').toString().toLowerCase();
  const hasFolder = !!(op.path || op.folder || op.Folder);
  const hasFile = !!(op.path || op.file || op.File);

  if (['createfolder', 'mkdir', 'folder'].includes(command) && !hasFolder) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'create folder operations require path/folder/Folder' });
  }
  if (['createfile', 'touch', 'file'].includes(command) && !hasFile) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'create file operations require path/file/File' });
  }
  if (['rename', 'renamefile', 'renamefolder'].includes(command) && !(op.from && op.to || op.src && op.dest || op.old && op.new)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'rename operations require from/to (or src/dest or old/new)' });
  }
  if (['edit', 'editfile', 'write'].includes(command) && !hasFile) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'edit operations require path/file/File' });
  }
});

const CodePlanSchema = z.object({}).catchall(z.unknown());

const { exec } = require('child_process');
function executeFile(filePath, language, baseDir = process.cwd()) {
  return new Promise((resolve, reject) => {
    const lang = (language || '').toString().toLowerCase();
    if (lang === 'cpp' || lang === 'cxx' || lang === 'c') {
      // Compile and run
      const isCpp = lang === 'cpp' || lang === 'cxx';
      const compiler = isCpp ? 'g++' : 'gcc';
      const outputExe = filePath.replace(/\.(cpp|cxx|c)$/, '') + (process.platform === 'win32' ? '.exe' : '');
      const compileCmd = `${compiler} "${filePath}" -o "${outputExe}"`;
      exec(compileCmd, { cwd: baseDir, timeout: 60_000 }, (compileErr, compileStdout, compileStderr) => {
        if (compileErr) {
          return resolve({ success: false, error: `Compile error: ${compileErr.message}`, stdout: compileStdout, stderr: compileStderr });
        }
        // Now run the executable
        exec(`"${outputExe}"`, { cwd: baseDir, timeout: 60_000, maxBuffer: 10 * 1024 * 1024 }, (runErr, runStdout, runStderr) => {
          if (runErr) {
            return resolve({ success: false, error: runErr.message || String(runErr), stdout: runStdout, stderr: runStderr });
          }
          resolve({ success: true, stdout: runStdout.trim(), stderr: runStderr.trim() });
        });
      });
    } else {
      const executor = getLanguageExecutor(language);
      if (!executor) {
        return resolve({ success: false, error: `No executor configured for language: ${language}` });
      }
      const command = `${executor} "${filePath}"`;
      exec(command, { cwd: baseDir, timeout: 60_000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          return resolve({ success: false, error: err.message || String(err), stdout, stderr });
        }
        resolve({ success: true, stdout: stdout.trim(), stderr: stderr.trim() });
      });
    }
  });
}

async function runCodePlan(rawPlan, baseDir = process.cwd(), context = {}) {
  const plans = Array.isArray(rawPlan) ? rawPlan : [rawPlan];
  const results = [];

  for (const plan of plans) {
    const validation = CodePlanSchema.safeParse(plan);
    if (!validation.success) {
      const details = validation.error.errors.map(err => `${err.path.join('.') || '<root>'}: ${err.message}`).join('; ');
      throw new Error(`Code plan validation failed: ${details}`);
    }

    const planData = validation.data;

    // Manual validation for action and required fields
    if ((planData.action || '').toString().toLowerCase() !== 'code') {
      throw new Error('Code plan validation failed: action must be "code" for code plans');
    }
    if (!(planData.folder || planData.path || planData.name || planData.project)) {
      throw new Error('Code plan validation failed: one of folder/path/name/project is required');
    }
    if (!(planData.file || planData.script || planData.name || planData.project)) {
      throw new Error('Code plan validation failed: one of file/script/name/project is required');
    }
    const mergedContext = { ...context, ...(planData.context || {}), ...(planData.templateVars || {}), ...planData };
    const interp = value => interpolateString(value, mergedContext);

    if ((planData.action || '').toString().toLowerCase() !== 'code') {
      // fallback to runSchema for non-code operations
      const childResults = await runSchema(planData, baseDir, mergedContext);
      results.push(...childResults);
      continue;
    }

    const language = (planData.language || planData.lang || 'js').toString().toLowerCase();
    const ext = planData.extension || getLanguageFileExtension(language) || 'js';
    const projectName = interp(planData.name || planData.project || 'code-project');
    const folderName = interp(planData.folder || planData.path || projectName);
    const scriptName = interp(planData.file || planData.script || projectName);
    const scope = planData.scope || ['folder', 'file'];

    const targetFolder = path.resolve(baseDir, folderName);
    if (scope.includes('folder')) {
      await ensureDir(targetFolder);
      results.push({ type: 'folder', path: targetFolder });
    }

    const finalFileName = ext ? `${scriptName}.${ext}` : scriptName;
    const targetFilePath = path.resolve(targetFolder, finalFileName);

    if (scope.includes('file')) {
      let codeText = planData.content || planData.template || '';
      if (typeof codeText === 'string') {
        codeText = interp(codeText);
      }
      if (!codeText) {
        const defaultCode = {
          js: "console.log('Hello from json-forge code');\n",
          py: "print('Hello from json-forge code')\n",
          sh: "echo 'Hello from json-forge code'\n"
        };
        codeText = defaultCode[language] || defaultCode.js;
      }
      await createFile(targetFilePath, codeText);
      results.push({ type: 'file', path: targetFilePath });
    }

    if (scope.includes('edit') && planData.edit) {
      await editFile(targetFilePath, {
        append: planData.edit.append ? interp(planData.edit.append) : undefined,
        prepend: planData.edit.prepend ? interp(planData.edit.prepend) : undefined,
        replace: planData.edit.replace
      });
      results.push({ type: 'edit', path: targetFilePath });
    }

    if (planData.run || planData.exec || planData.execute) {
      const execResult = await executeFile(targetFilePath, language, targetFolder);
      results.push({ type: 'execute', path: targetFilePath, result: execResult });
    }

    if (Array.isArray(planData.operations)) {
      const nestedResults = await runCodePlan(planData.operations, baseDir, mergedContext);
      results.push(...nestedResults);
    }
    if (Array.isArray(planData.children)) {
      const nestedResults = await runCodePlan(planData.children, baseDir, mergedContext);
      results.push(...nestedResults);
    }
    if (Array.isArray(planData.items)) {
      const nestedResults = await runCodePlan(planData.items, baseDir, mergedContext);
      results.push(...nestedResults);
    }
  }

  return results;
}

async function runSchema(rawSchema, baseDir = process.cwd(), context = {}) {
  const ops = normalizeSpec(rawSchema);
  const results = [];
  for (const op of ops) {
    const validation = OperationSchema.safeParse(op);
    if (!validation.success) {
      const details = validation.error.errors.map(err => `${err.path.join('.') || '<root>'}: ${err.message}`).join('; ');
      throw new Error(`Schema operation validation failed: ${details}`);
    }

    const validOp = validation.data;
    const opContext = { ...context, ...(validOp.templateVars || {}), ...validOp };
    const interp = value => interpolateString(value, opContext);
    const cmd = (validOp.op || validOp.operation || 'auto').toString().toLowerCase();

    switch (cmd) {
      case 'auto':
        if (op.Folder || op.folder) {
          const folderName = interp(op.Folder || op.folder);
          const folderPath = path.resolve(baseDir, folderName);
          await ensureDir(folderPath);
          results.push({ type: 'folder', path: folderPath });
          if (op.File || op.file) {
            const fileName = interp(op.File || op.file);
            const fileType = interp(op.file_type || op.fileType || '');
            const finalFile = fileType ? `${fileName}.${fileType}` : fileName;
            const fullPath = path.resolve(folderPath, finalFile);
            await createFile(fullPath, typeof op.content === 'string' ? interp(op.content) : op.content || '');
            results.push({ type: 'file', path: fullPath });
          }
        } else if (op.File || op.file) {
          const fileName = interp(op.File || op.file);
          const fileType = interp(op.file_type || op.fileType || '');
          const finalFile = fileType ? `${fileName}.${fileType}` : fileName;
          const fullPath = path.resolve(baseDir, finalFile);
          await createFile(fullPath, typeof op.content === 'string' ? interp(op.content) : op.content || '');
          results.push({ type: 'file', path: fullPath });
        }
        break;
      case 'createfolder':
      case 'mkdir':
      case 'folder':
        {
          const folderPath = path.resolve(baseDir, interp(op.path || op.folder || op.Folder));
          await ensureDir(folderPath);
          results.push({ type: 'folder', path: folderPath });
        }
        break;
      case 'createfile':
      case 'touch':
      case 'file':
        {
          const filePath = path.resolve(baseDir, interp(op.path || op.file || op.File));
          await createFile(filePath, typeof op.content === 'string' ? interp(op.content) : op.content || '');
          results.push({ type: 'file', path: filePath });
        }
        break;
      case 'rename':
      case 'renamefile':
      case 'renamefolder':
        {
          const fromPath = path.resolve(baseDir, interp(op.from || op.src || op.old));
          const toPath = path.resolve(baseDir, interp(op.to || op.dest || op.new));
          await renamePath(fromPath, toPath);
          results.push({ type: 'rename', from: fromPath, to: toPath });
        }
        break;
      case 'edit':
      case 'editfile':
      case 'write':
        {
          const filePath = path.resolve(baseDir, interp(op.path || op.file || op.File));
          await editFile(filePath, {
            append: typeof op.append === 'string' ? interp(op.append) : op.append,
            prepend: typeof op.prepend === 'string' ? interp(op.prepend) : op.prepend,
            replace: op.replace
          });
          results.push({ type: 'edit', path: filePath });
        }
        break;
      default:
        throw new Error(`Unsupported operation: ${cmd}`);
    }

    if (op.operations && Array.isArray(op.operations)) {
      const childResults = await runSchema(op.operations, baseDir);
      results.push(...childResults);
    }

    if (op.children && Array.isArray(op.children)) {
      const childResults = await runSchema(op.children, baseDir);
      results.push(...childResults);
    }

    if (op.items && Array.isArray(op.items)) {
      const childResults = await runSchema(op.items, baseDir);
      results.push(...childResults);
    }
  }
  return results;
}

async function runJsonFile(jsonPath, baseDir = process.cwd(), context = {}) {
  const content = await fs.readFile(jsonPath, 'utf8');
  const schema = JSON.parse(content);
  const schemaContext = (schema && typeof schema.context === 'object' && schema.context !== null) ? schema.context : {};
  const mergedContext = { ...schemaContext, ...context };
  return runSchema(schema, baseDir, mergedContext);
}

module.exports = {
  ensureDir,
  createFile,
  renamePath,
  editFile,
  loadJsonForgeConfig,
  discoverJsonModuleDirs,
  syncJsonModuleDirectory,
  syncJsonModules,
  watchJsonModules,
  runSchema,
  runJsonFile,
  runCodePlan
};
