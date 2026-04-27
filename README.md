# Jarvis

Jarvis is a local-first personal AI assistant built for Jimmy Eliasson.

The goal is to create a clean, modular and secure assistant that runs locally, uses Ollama as the only AI model provider, and can grow over time with tools for file editing, project help, drafts, email, smart home integrations, voice control and automation.

## Core idea

Jarvis should work as a personal local AI control center.

It should be able to:

- Chat with the user using local Ollama models.
- Help with coding and project planning.
- Read project files when allowed.
- Suggest file changes before writing anything.
- Show diffs before applying changes.
- Save chat history locally.
- Keep local project memory.
- Create drafts for emails, documents and prompts.
- Later integrate with Home Assistant, cameras, sensors and speakers.
- Later support voice input and text-to-speech.

## Important rule

Ollama is the only AI provider.

No OpenAI, Claude API, Gemini API or other cloud AI provider should be added to the application unless explicitly requested by Jimmy.

Claude may be used as a development assistant to build the code, but the Jarvis app itself must only use Ollama.

## Project path

C:\Users\Jimmy\Documents\GitHub\Jarvis

## Structure

apps/web        - Frontend dashboard and chat UI
apps/api        - Backend API, Ollama integration and tool router
packages/core   - Shared Jarvis logic, prompts, types and flows
packages/tools  - File tools, email tools, system tools and future integrations
packages/memory - Local memory and chat storage
packages/config - Shared configuration and environment validation
data            - Local runtime data such as chats, memory, logs and uploads
workspace       - Safe workspace for files Jarvis may work with
docs            - Architecture, prompts, decisions and setup notes
scripts         - Setup and maintenance scripts
docker          - Future Docker files
tests           - Unit, integration and e2e tests

## Development phases

### v0.1 - Jarvis Core

- Create the basic web dashboard.
- Connect frontend to backend.
- Connect backend to Ollama.
- Add simple local chat.
- Add system activity log.
- Add basic project structure.
- Add local chat persistence.

### v0.2 - File Tools

- Allow Jarvis to read files inside allowed folders.
- Allow Jarvis to propose file edits.
- Show diffs before applying changes.
- Require user approval before writing files.

### v0.3 - Memory

- Add local memory storage.
- Add project memory.
- Add user preferences.
- Add searchable notes.

### v0.4 - Email Drafts

- Allow Jarvis to write email drafts.
- Do not send emails automatically.
- Add approval before sending anything.

### v0.5 - Voice

- Add microphone button.
- Add speech-to-text.
- Add text-to-speech.

### v0.6 - Smart Home

- Add Home Assistant integration later if needed.
- Support sensors, cameras, speakers and automations through Home Assistant.

## Safety principles

Jarvis must never:

- Send emails without explicit approval.
- Modify files without showing a diff first.
- Delete files without explicit approval.
- Run dangerous terminal commands without explicit approval.
- Use cloud AI providers unless explicitly requested.
- Store secrets in committed files.

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
- No file editing yet.
- No email yet.
- No Home Assistant yet.
- No voice yet.

## Development setup

### Prerequisites

- Node.js >= 20
- npm >= 10
- Ollama installed locally (not required for v0.1 skeleton)

### Install dependencies

```bash
npm install
```

### Run in development

Both apps together:

```bash
npm run dev
```

Frontend only (http://localhost:3000):

```bash
npm run dev:web
```

API only (http://localhost:4000):

```bash
npm run dev:api
```

### Environment variables

Copy the example files and adjust if needed:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

## Current status

v0.1 skeleton is in place.

- Next.js frontend running on http://localhost:3000
- Express API running on http://localhost:4000
- API health check wired into the dashboard status panel
- Ollama integration is the next step