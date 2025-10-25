# ai-code-app-ronnakit README

This is the README for your extension "ai-code-app-ronnakit". After writing up a brief description, we recommend including the following sections.

## Features

- AI: Set Config — configure API key, base URL, and model for the AI provider
- AI: Generate Paths — plan directories/files to create from a natural language prompt (does not write files)
- AI: Create Project By AI — plan files from a prompt and generate full file contents on disk
- AI: Prompt Templates (CRUD + Run) — create, manage, and run reusable prompt templates with optional {{placeholders}}

## Requirements

- OpenAI-compatible API key and endpoint

Configure via the command palette:

1. Run “AI: Set Config” and set API Key, API URL (optional), and Model
2. Ensure the workspace folder you want to generate into is open

## Extension Settings

This extension contributes the following settings under the `ai` namespace:

- `ai.apiKey`: API Key for AI service
- `ai.apiUrl`: Base URL for AI API
- `ai.model`: Default AI model (e.g., `gpt-4o-mini`)

## Usage

1. Use “AI: Generate Paths” to preview a plan of directories and files the AI recommends creating. Select the entries you want to scaffold.
2. Use “AI: Create Project By AI” to generate full file contents. You can choose which files to create and whether to overwrite existing files.
3. Use “AI: Prompt Templates (CRUD + Run)” to:
	- Create a template by providing a name and content (supports placeholders like `{{file}}`, `{{framework}}`).
	- Manage templates (rename, edit content, set a specific model, or delete).
	- Run a template: you’ll be prompted to fill any placeholders, then the AI response will open in the “AI Prompt Runner” output.

Notes:
- The extension avoids overwriting existing files by default (you can choose to overwrite).
- If the AI API is unavailable, the extension falls back to basic scaffolding.
 - Template prompts are stored locally in your VS Code global state.

## Known Issues

Calling out known issues can help limit users opening duplicate issues against your extension.

## Release Notes

Users appreciate release notes as you update your extension.

### 1.0.0

Initial release of ...

### 1.0.1

Fixed issue #.

### 1.1.0

Added features X, Y, and Z.

---

## Working with Markdown

You can author your README using Visual Studio Code.  Here are some useful editor keyboard shortcuts:

* Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux)
* Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux)
* Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets

## For more information

* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**
