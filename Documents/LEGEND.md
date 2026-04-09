# json-forge Legend

This file is the quick reference for what each JSON field means, what it turns into, and how `json-forge` interprets it.

## Core idea

`json-forge` reads JSON and translates it into filesystem actions or code-generation actions.

There are two main modes:

- Schema mode: create folders, create files, rename things, edit files
- Code plan mode: generate code projects/files with language-aware defaults and optional execution

## Command legend

### Schema mode commands

Use these with `json-forge run your-file.json`.

| JSON value | Meaning | Translates to |
| --- | --- | --- |
| `op: "createFolder"` | Make a folder | `mkdir -p` style folder creation |
| `op: "createFile"` | Make a file | Create file with `content` |
| `op: "rename"` | Rename file or folder | Move `from` to `to` |
| `op: "edit"` | Change an existing file | Append, prepend, or replace text |
| `Folder` + `File` | Shortcut form | Auto-create folder and file |
| `operations` | List of steps | Run each item in order |
| `children` or `items` | Nested steps | Run child actions recursively |

### Code plan mode commands

Use these with `json-forge code your-plan.json`.

| JSON value | Meaning | Translates to |
| --- | --- | --- |
| `action: "code"` | Use code-plan mode | Language-aware file generation |
| `language` | Target language | Picks extension and runtime command |
| `folder` | Output folder | Where the project/file is created |
| `file` | Output file name | Base name before extension |
| `content` | File body | Written into the generated file |
| `scope` | What to do | Folder creation, file creation, edit stage |
| `edit` | Post-write change | Append, prepend, or replace after create |
| `run: true` | Execute after write | Run Node, Python, Bash, Ruby, GCC, or G++ flow |
| `templateVars` | Reusable values | Replaces `{{var}}` placeholders |

## Field legend

### Shared fields

| Field | Meaning | Example |
| --- | --- | --- |
| `path` | Relative path from the chosen base directory | `Code/app.js` |
| `content` | Text written into a file | `"console.log('hi');\n"` |
| `context` | Extra values passed into interpolation | `{ "name": "script" }` |
| `operations` | Array of child actions | `[ {...}, {...} ]` |
| `children` | Alternate nested action list | `[ {...} ]` |
| `items` | Another nested action list alias | `[ {...} ]` |

### Schema mode fields

| Field | Means | Notes |
| --- | --- | --- |
| `op` | The operation name | `createFolder`, `createFile`, `rename`, `edit` |
| `Folder` or `folder` | Target folder | Used in shortcut and code plans |
| `File` or `file` | File base name or path | Depends on mode |
| `file_type` or `fileType` | File extension | `js`, `md`, `txt`, `py` |
| `from`, `src`, `old` | Rename source | Any one of these works |
| `to`, `dest`, `new` | Rename destination | Any one of these works |
| `append` | Add text to the end | Used by `edit` |
| `prepend` | Add text to the start | Used by `edit` |
| `replace` | Replace text | Format: `{ "find": "x", "with": "y" }` |

### Code plan fields

| Field | Means | Notes |
| --- | --- | --- |
| `action` | Must be `code` | Enables code-plan behavior |
| `language` | Language name | `js`, `py`, `sh`, `rb`, `cpp`, `c` |
| `name` | Plan/project name | Also used as a fallback file/folder name |
| `folder` or `path` | Output folder | Resolved from the base directory |
| `file` or `script` | Output file base name | Extension comes from `language` |
| `scope` | Stages to run | Usually `folder`, `file`, `edit` |
| `edit` | Edit instructions | Same append/prepend/replace model |
| `run`, `exec`, `execute` | Execute after write | Any of these triggers run |
| `templateVars` | Placeholder values | Replaces `{{name}}`, `{{message}}`, etc. |

## Translation rules

### Interpolation

If a string contains `{{name}}`, `json-forge` replaces it with a value from:

1. The top-level `context`
2. The operation's own values
3. `templateVars` in code-plan mode

Example:

```json
{
  "context": { "name": "script" },
  "operations": [
    {
      "op": "createFile",
      "path": "Code/{{name}}.js",
      "content": "console.log('Hi from {{name}}');\n"
    }
  ]
}
```

Translates to:

- File path: `Code/script.js`
- File content: `console.log('Hi from script');`

### Extension mapping

| `language` | Output extension |
| --- | --- |
| `js`, `javascript` | `.js` |
| `py`, `python` | `.py` |
| `sh`, `bash` | `.sh` |
| `rb`, `ruby` | `.rb` |
| `cpp`, `cxx` | `.cpp` |
| `c` | `.c` |
| `txt` | `.txt` |

### Runtime mapping

If `run: true` is enabled in code-plan mode, `json-forge` uses these executors:

| `language` | Execution command |
| --- | --- |
| `js`, `javascript` | `node file.js` |
| `py`, `python` | `python file.py` |
| `sh`, `bash` | `bash file.sh` |
| `rb`, `ruby` | `ruby file.rb` |
| `cpp`, `cxx` | `g++ file.cpp -o app && run app` |
| `c` | `gcc file.c -o app && run app` |

## JSON folder module legend

Use these with `json-forge modules` or `json-forge watch`.

| Folder/file | Means | Translates to |
| --- | --- | --- |
| `json/` folder | A watched/discovered JSON module root | A folder that gets JS wrappers |
| `users.json` | Raw JSON data | `users.js` wrapper + export entry |
| `index.js` | Managed module barrel | Exports all JSON files and nested folders |
| nested `json` content | Child module scope | Nested `index.js` and file wrappers |

Example translation:

```text
src/json/users.json
```

becomes:

```text
src/json/users.js
src/json/index.js
```

which allows:

```js
const users = require('./src/json/users');
const bundle = require('./src/json');
```

## Quick reading guide

- If you want filesystem automation, use schema mode.
- If you want generated source code, use code-plan mode.
- If you want plain JSON folders to behave like JS modules in Node, use module sync/watch mode.