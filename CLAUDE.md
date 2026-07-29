# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

Converts Word documents (course notes: modules, prose, code snippets, images) into Notion subpages under course rows in a `Cursos` database. The pipeline has two stages: `.docx` → markdown + extracted images (cached on disk, human-reviewable), then markdown → Notion blocks (uploaded via the Notion API, resumable/idempotent per module).

The project is public. `.docx` source files and any generated `*.notion/` output (markdown, images, upload state) are course content from paid platforms (Udemy, Platzi, etc.) and must never be committed — see `.gitignore`.

## Project state

No `package.json` or `src/` exist yet — this repository currently holds only the reference prototype and the spec-driven workflow scaffolding described below. There are no build/lint/test commands to run yet. Once a TypeScript project is scaffolded (per an approved spec), update this section with the real commands (build, test, single-test invocation, lint).

## `references/notion-sync.js`

A working, manually-validated Node prototype — **not shipped code**, and not something to import from or extend directly. It exists so future specs can be mined from proven behavior. Its three parts, in order:

1. **docx → markdown** (pandoc + tokenizer): classifies each unit of text as heading/list/quote/image/code-or-prose. The code-vs-prose classification is the hardest part of the file — it's heuristic (NBSP indentation, keyword/API-token matching, Spanish-language connector words as a "this is prose" brake, a scoring system) because the source `.docx` files mark pasted code with no formatting at all. Read the inline comments (`DEFECTO N`) before touching this logic; each documents a real edge case found against actual course material.
2. **markdown → Notion blocks**: maps markdown constructs to the Notion block API, respecting Notion's limits (2000 chars per rich_text fragment, 100 blocks per request). Images go through a two-mode marker system (`callout` for validation without uploading, `marker` for real upload) because image blocks need a file_upload id that only exists after the image is actually uploaded.
3. **Notion client + orchestration**: rate-limited/retrying fetch wrapper, image upload (Notion gives a 1-hour window to attach an uploaded file, so images are uploaded per-module, not all at once), and a resumable state file (`.notion-sync-state.json`) that tracks which modules were already pushed under which parent page — a half-finished page from a prior run gets archived and redone rather than duplicated.

The eventual TypeScript rewrite is expected to split these three concerns into separate packages/modules, each independently unit-testable (the first two stages are pure functions; only the third touches the network).

## Spec-driven workflow

This repo uses two custom skills for spec-driven development, installed under `.agents/skills/` (symlinked into `.claude/skills/`, source: `Klerith/fernando-skills`):

- **`/spec`** — guided spec authoring. Asks clarifying questions in phases, builds a spec section by section (header, scope, data model, implementation plan, acceptance criteria, decisions), and saves it to `specs/NN-slug.md` in `Draft` state. Never writes code.
- **`/spec-impl NN-slug`** — implements an approved spec. Refuses to run unless the spec's state means `Approved` (set manually by the user after review, in any language). Creates/switches to a git branch `spec-NN-slug` (controlled by `AutoCreateBranch` in `specs/.spec-config.yml`), then implements the plan step by step, pausing for review after each step.

**Practical implication for any session working in this repo: don't write implementation code without an approved spec backing it.** If asked to build a feature and no relevant spec exists (or it's still `Draft`), use `/spec` first rather than improvising code directly.
