# POETRY

P – Poetic

O – Orchestrator

E– Exoskeleton

T – Template driven

R – Resource generator

Y – Yielder of JS

JSON-first filesystem creator/editor for Node.js.

## Docs

- [Documents/LEGEND.md](Documents/LEGEND.md) for the JSON field legend, command meanings, and translation rules
- [Documents/WHAT-THIS-IS.md](Documents/WHAT-THIS-IS.md) for the plain-English overview, workflow explanation, and infographic

## Install

```bash
npm install
npm link
npm test
```

## CLI usage

- `json-forge help`
- `json-forge demo [outDir]`  (creates Code/hello-world.txt and Code/demo-script.js)
- `json-forge run spec.json [outDir]` (runs your JSON spec)
- `json-forge code <plan.json> [outDir]` (runs high-level code DSL plan)
- `json-forge modules [outDir]` (finds `json/` folders and turns them into JS-friendly module folders)
- `json-forge watch [outDir]` (watches for changes inside discovered `json/` folders and keeps JS wrappers synced)

## JSON folder to JS module

If you create a folder literally named `json` anywhere in your project, `json-forge` can make that folder work like a JavaScript module surface for Node.

Example:

```text
src/
  json/
    users.json
    config.json
    nested/
      flags.json
```

Run:

```bash
npm run modules
```

`json-forge` will generate managed JS files like these:

```text
src/
  json/
    users.js
    config.js
    index.js
    nested/
      flags.js
      index.js
```

That gives you Node-friendly imports such as:

```js
const jsonBundle = require('./src/json');
const users = require('./src/json/users');
const flags = require('./src/json/nested/flags');
```

The generated files are safe to re-run. `json-forge` only updates files it manages itself and skips existing user-authored `.js` files.

For live syncing while you work:

```bash
npm run watch:json
```

### Configure discovery

By default, `json-forge` looks for folders named `json`. You can change that in `package.json`:

```json
{
  "jsonForge": {
    "moduleFolders": ["json", "data-json"],
    "ignoreFolders": ["node_modules", ".git", "dist"],
    "watchDebounceMs": 150
  }
}
```
## JSON schema examples

### Simple folder + file

```json
{
  "operations": [
    {
      "Folder": "MyApp",
      "File": "index",
      "file_type": "js",
      "content": "console.log('Hello from MyApp');"
    }
  ]
}
```

### Create + rename + edit

```json
{
  "operations": [
    { "op": "createFolder", "path": "Workspace" },
    { "op": "createFile", "path": "Workspace/start.txt", "content": "start" },
    { "op": "rename", "from": "Workspace/start.txt", "to": "Workspace/ready.txt" },
    { "op": "edit", "path": "Workspace/ready.txt", "append": "\nDone" }
  ]
}
```

## Code DSL (phase 3)

A code plan supports:
- `action: "code"`
- `language` (js, py, sh, ruby, cpp, c)
- `folder`, `file`, `content`
- `templateVars` object for `{{var}}` interpolation
- `scope: ["folder", "file", "edit"]`
- `edit: { append, prepend, replace }`
- `run: true` / `exec: true`
- nested plans via `operations`, `children`, `items`

### Template vars example

```json
{
  "action": "code",
  "language": "cpp",
  "name": "cpp-hello",
  "folder": "Code/CPPProject",
  "file": "main",
  "templateVars": {
    "message": "Hello from C++!",
    "number": 42
  },
  "content": "#include <iostream>\n\nint main() {\n    std::cout << \"{{message}}\" << std::endl;\n    std::cout << \"Number: {{number}}\" << std::endl;\n    return 0;\n}\n",
  "scope": ["folder", "file"],
  "run": true
}
```

### Nested plan example

```json
{
  "action": "code",
  "name": "parent",
  "language": "js",
  "folder": "Code/DSLProject",
  "file": "parent",
  "content": "console.log('Parent code');\n",
  "scope": ["folder","file"],
  "operations": [
    {
      "action": "code",
      "name": "child",
      "folder": "Code/DSLProject",
      "file": "child",
      "content": "console.log('Child code');\n",
      "scope": ["file","edit"],
      "edit": { "append": "console.log('Child append');\n" },
      "run": true
    }
  ]
}
```


## API usage

```js
const { runSchema, runJsonFile, syncJsonModules, watchJsonModules } = require('json-forge');
await runJsonFile('my-spec.json', process.cwd());

await syncJsonModules(process.cwd());

const watcher = await watchJsonModules(process.cwd(), {
  onSync(result) {
    console.log(result.discoveredDirs);
  }
});
```

## Feature set

- create folder (nested)
- create file
- rename file/folder
- edit file (append/prepend/replace)
- read JSON spec file and execute actions
- discover `json/` folders and generate JS wrappers
- generate `index.js` exports for JSON module folders
- watch JSON folders and auto-sync generated module files

## Next step: "code with JSON"

Spec can be extended and transformed into an editor DSL. For now, use values in `Folder`/`File`/`file_type` and actions to gain automation.
