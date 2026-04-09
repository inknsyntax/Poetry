# What This Is

`json-forge` is a Node module and CLI that lets you describe work in JSON instead of writing the setup steps by hand.

It can do three main jobs:

1. Create and edit folders/files from JSON instructions.
2. Generate code files from a higher-level JSON code plan.
3. Turn folders named `json` into JS-friendly module folders that Node can `require`.

## How This Works

### 1. You write JSON

You create a JSON file that describes what you want.

That JSON can mean:

- create a folder
- create a file
- rename something
- edit text in a file
- generate a code file in JS, Python, C++, and more
- sync raw `.json` files into JS wrappers for Node

### 2. json-forge reads the JSON

The CLI or API loads the JSON, validates the shape, and decides which mode to use.

- `json-forge run ...` uses schema mode
- `json-forge code ...` uses code-plan mode
- `json-forge modules ...` uses JSON-folder module sync
- `json-forge watch ...` keeps JSON-folder module sync running live

### 3. json-forge translates JSON into real output

That translation becomes real filesystem changes:

- folders get created
- files get written
- files get edited
- code files get generated
- JS wrappers and `index.js` files get generated for JSON module folders

### 4. You use the result like normal files

After the translation step, you work with real files on disk.

Examples:

- generated `README.md`
- generated `app.js`
- generated `users.js` wrapper around `users.json`
- generated `index.js` exporting a whole `json/` folder

## Infographic

```text
                json-forge
                    |
      +-------------+-------------+
      |             |             |
      v             v             v
  Schema Mode   Code Plan     Module Mode
   run spec     code plan     modules/watch
      |             |             |
      |             |             |
      v             v             v
  JSON fields   language +     json/ folder
  become file   templateVars   with .json files
  operations    become code        |
      |             |             |
      +-------------+-------------+
                    |
                    v
            Real files on disk
                    |
      +-------------+-------------+
      |             |             |
      v             v             v
   folders       source files   JS wrappers
   README.md     app.js         index.js
   renamed files main.cpp       require('./json')
```

## Plain-English examples

### Example A: Make files from JSON

You write:

```json
{
  "operations": [
    { "op": "createFolder", "path": "Docs" },
    { "op": "createFile", "path": "Docs/readme.txt", "content": "hello" }
  ]
}
```

Result:

- `Docs/` is created
- `Docs/readme.txt` is created

### Example B: Generate code from JSON

You write:

```json
{
  "action": "code",
  "language": "js",
  "folder": "Code/App",
  "file": "app",
  "content": "console.log('hello');\n"
}
```

Result:

- `Code/App/app.js` is created

### Example C: Make a JSON folder work as JS

You create:

```text
src/json/users.json
```

Then run:

```bash
json-forge modules .
```

Result:

```text
src/json/users.js
src/json/index.js
```

Now Node can use:

```js
const users = require('./src/json/users');
```

## Mental model

The easiest way to think about `json-forge` is:

- JSON in
- rules applied
- files out

Or for module mode:

- raw `.json` in a `json/` folder
- wrappers generated
- Node-friendly JS modules out

## Best use cases

- bootstrapping small projects
- generating repetitive files
- teaching or demoing file automation
- using JSON as a lightweight DSL
- exposing structured JSON data through CommonJS modules