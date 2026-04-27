# CLAUDE.md - Jarvis Development Rules

You are Claude Code working on Jimmy Eliasson's Jarvis project.

Jarvis is a local-first personal AI assistant.

## Absolute requirements

- The Jarvis app must use Ollama as the only AI provider.
- Do not add OpenAI, Anthropic, Gemini, Groq or other cloud AI providers to the app.
- Claude is only used as a development assistant, not as a runtime dependency.
- Build the app slowly and methodically.
- Prefer small safe patches over large rewrites.
- Always preserve existing working functionality.
- Never remove comments from code unless Jimmy explicitly asks.
- Always explain what changed after each task.
- Always list touched files after each task.
- Always include how to run and how to test after each task.

## Project location

C:\Users\Jimmy\Documents\GitHub\Jarvis

## Planned architecture

apps/web        - Next.js frontend
apps/api        - Node.js backend
packages/core   - Shared types, prompts, agent flow and tool routing logic
packages/tools  - Filesystem tools, email drafts, system tools and future integrations
packages/memory - Local memory, chat history and database helpers
packages/config - Shared config and environment validation
data            - Runtime data, not committed
workspace       - Safe working area for Jarvis-created or Jarvis-edited files
docs            - Architecture, prompts, decisions and setup notes
scripts         - Setup and maintenance scripts
docker          - Future Docker files
tests           - Unit, integration and e2e tests

## Runtime AI provider

Use only Ollama.

Expected local Ollama base URL:

http://localhost:11434

The app should make this configurable through environment variables.

Example environment variables:

OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_DEFAULT_MODEL=qwen2.5-coder:latest

Do not hardcode model names in many places. Use shared config.

## Safety rules for tools

Jarvis tools must be permission-based.

### File tools

Jarvis may eventually read and edit files, but only with strict rules:

1. Only read or edit inside approved directories.
2. Show a diff before writing changes.
3. Require user approval before applying changes.
4. Never delete files without explicit approval.
5. Never modify files outside allowed workspace paths.
6. Never overwrite files silently.
7. Always log file tool activity.

Initial allowed workspace:

C:\Users\Jimmy\Documents\GitHub\Jarvis\workspace

### Email tools

Jarvis may write email drafts.

Jarvis must not send emails automatically.

Sending email requires explicit user approval.

Early versions should only create local draft text, not connect to real email sending.

### Terminal tools

Do not add autonomous terminal execution in early versions.

When terminal execution is added later, it must require approval for risky commands.

Never run destructive commands automatically.

Examples of risky commands:

- delete/remove commands
- format commands
- git reset
- git clean
- package uninstall commands
- commands that modify system settings
- commands that expose secrets

## Development style

- Use TypeScript where possible.
- Keep frontend and backend clearly separated.
- Use readable file names.
- Prefer simple architecture over clever abstractions.
- Add comments for important logic.
- Do not introduce unnecessary dependencies.
- Avoid breaking working features.
- Keep UI modern, dark, clean and Jarvis-like.
- Make all changes easy to review.
- Build one milestone at a time.
- Do not add Home Assistant, email sending, voice, or file writing in v0.1 unless Jimmy explicitly asks.

## UI direction

The Jarvis UI should feel like a modern local AI control center.

Style direction:

- Dark mode first.
- Clean sci-fi inspired dashboard.
- Glass-like cards.
- Subtle cyan/blue accents.
- Clear readable typography.
- Left navigation.
- Main chat area.
- Right system activity panel.
- Cards for system status, Ollama status, memory and quick actions.

Avoid:

- Overcomplicated animations.
- Heavy UI libraries unless needed.
- Unreadable neon effects.
- Cluttered layouts.

## First milestone

The first milestone is Jarvis Core v0.1.

It should include:

- Next.js frontend in apps/web.
- Node.js backend in apps/api.
- A Jarvis dashboard page.
- A chat input.
- Backend route for chat.
- Ollama connection.
- Simple model/status check.
- Local system activity log.
- Basic chat history.
- No file editing yet.
- No email yet.
- No Home Assistant yet.
- No voice yet.

## Expected local development commands

The exact commands may change depending on the implementation, but the final project should ideally support:

npm install
npm run dev

The web app should run on:

http://localhost:3000

The API should run on:

http://localhost:4000

Ollama should run on:

http://localhost:11434

## Documentation rules

When adding new features, update documentation when relevant.

Important docs should live in:

docs/architecture
docs/prompts
docs/decisions
docs/setup

For important decisions, create a short decision note in docs/decisions.

Example:

docs/decisions/001-ollama-only.md

## Git rules

Make small commits.

Do not commit secrets.

Do not commit runtime data from:

data/chats
data/memory
data/logs
data/uploads
data/exports

Do not commit node_modules.

Do not commit .env files.

Use .env.example for safe example values.

## Response format after each implementation task

After completing any task, report:

1. What was changed.
2. Which files were created or modified.
3. How to run it.
4. How to test it.
5. Any known issues.
6. The next recommended step.

## Important reminder

Jarvis is not EvoFlow.

Do not reuse EvoFlow code unless Jimmy explicitly requests it.

This is a clean standalone Jarvis project.