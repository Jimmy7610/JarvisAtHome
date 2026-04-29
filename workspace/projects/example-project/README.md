# Example Project

This is a sample project inside the Jarvis Project Library.

## What is the Project Library?

The Project Library lets you browse and read text files from any project folder
stored under `workspace/projects/`. It is a read-only sandbox — files can only
be viewed, not edited through this panel.

## How to add your own project

1. Create a subdirectory under `workspace/projects/` — e.g. `workspace/projects/my-app/`.
2. Copy or create text files inside it (`.md`, `.ts`, `.js`, `.json`, `.yaml`, etc.).
3. Open the Project Library panel in Jarvis and click your project name.

## Supported file types

| Extension | Type |
|-----------|------|
| `.md` | Markdown |
| `.txt` | Plain text |
| `.ts` `.tsx` | TypeScript |
| `.js` `.jsx` `.mjs` `.cjs` | JavaScript |
| `.json` | JSON |
| `.yml` `.yaml` | YAML |
| `.css` | CSS |
| `.html` `.htm` | HTML |
| `.sh` | Shell script |
| `.ps1` | PowerShell script |

## Safety rules

- Files are read-only — no changes can be made from this panel.
- Each file is capped at 200 KB.
- Binary files are rejected.
- The browser never contacts the local TTS server or file system directly.

## Next steps for the Project Library (planned)

- Attach a project file to chat so Jarvis can reason about it.
- Search across project files.
- RAG/semantic indexing for large projects.
