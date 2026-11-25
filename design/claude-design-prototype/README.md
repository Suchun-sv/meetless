# Claude Design prototype: "Meetless Prototype"

## Origin

- Source: Claude Design project `52541e51-171d-433e-9140-207f9ff2033f` ("Meetless Prototype").
- Copied on 2026-11-24 with the claude-design MCP `read_file` tool.
- Copied verbatim. The only processing was decoding the tool's HTML-entity escaping (`&lt;`, `&gt;`, `&amp;`). Every file's byte size matches the size in the project listing.
- Why it is here: the Claude Design service shuts down by 2026-12-14, so this repo has to hold the design.

## What this is

- An **interactive prototype** built on **SIMULATED data** (`proto/data.js`). It is **not product code**. Nothing in it connects to a sync service or a model.
- `Meetless Prototype.html` loads React 18, ReactDOM and Babel standalone from `unpkg.com`, then compiles the `.jsx` files in the browser. **You need network access to open the HTML.** There is no build step.

## Files

| File | Contents |
|---|---|
| `Meetless Prototype.html` | Entry page: CSS design tokens (`:root` variables) and all layout and component styles; loads the scripts below |
| `proto/app.jsx` | One client instance (its own user, language, timeline cut-off and view) and the two-client demo wrapper |
| `proto/core.jsx` | Shared client context and small primitives (avatar, person, badge, buttons, section, version chip), including the translation chip (`Tx`) |
| `proto/shell.jsx` | Sidebar and the draggable project timeline |
| `proto/workspace.jsx` | Overview: artifact list and artifact preview (PPTX / DOCX / code diff), plus the right-hand context and review panel |
| `proto/pages.jsx` | Change request, requirements, meetings, deliveries, inbox, skills and roles pages |
| `proto/i18n.js` | Prototype UI strings in zh-CN and en |
| `proto/data.js` | Simulated scenario data from PRD §13 (people, artifacts, versions, issues, meetings, skills, event log) and `stateAt(cut)` |

The project's `.thumbnail` preview image was not copied.

## Relation to the product

The product renderer's design tokens were copied to `apps/desktop/src/renderer/styles/tokens.css`.
