# Copilot instructions for Smarttime Data Quality repository

This repository stores Power BI report packages and decomposed semantic model projects. The guidance below is tailored for an AI coding agent working on this repo — focus on text-first, reviewable changes and avoid editing binaries unless explicitly requested.

- Repo purpose: store report and tabular model metadata in decomposed, reviewable text forms so reviewers can inspect changes in Git. Top-level packaged files exist (e.g. `*.pbip`) for authoring, while `*.Report/` and `*.SemanticModel/` folders hold the decomposed representations.

- Key locations and examples:
  - Report package (authoring): `Activity Time Recorded.pbip`, `smarttime_data_semantic_model.pbip`
  - Report decomposed folder: `Activity Time Recorded.Report/definition.pbir` and `Activity Time Recorded.Report/definition/`
  - Semantic model folder: `dynamic_structure_chart.SemanticModel/definition.pbism` and `dynamic_structure_chart.SemanticModel/definition/`
  - Dataset folder: `Income and Contribution by Sales Contract.Dataset/`
  - Static assets: `*.Report/StaticResources/` (images, icons)
  - Diagram/layout metadata: `diagramLayout.json`, `semanticModelDiagramLayout.json`

- Editing priorities (AI agent rules):
  1. Prefer editing text/JSON under `*.Report/definition/` and `*.SemanticModel/definition/` over binary files.
 2. When model changes are required, produce edits to `definition.pbism` (or the decomposed JSON files under `definition/`) and matching `diagramLayout.json` updates so layout metadata stays consistent.
 3. Do not modify `*.pbip`, `*.pbix` or `*.pbism` binary blobs unless the user explicitly asks and provides guidance. If asked to change a binary, request a clear backup and confirm Git LFS is enabled for `*.pbix`/`*.pbip`.

- Conventions to follow:
  - Folder naming: `<ReportName>.Report`, `<ModelName>.SemanticModel`, `<Name>.Dataset` — follow exact casing and punctuation used in existing folders.
  - Commits: keep PRs focused (model-only, report-only, or assets-only). Small, targeted PRs make reviewable diffs easier.
  - Branching: create feature branches from `dev` and open PRs against `dev`. The repo uses `dev` for integration and `main` as default release branch.

- What to change and how to propose changes:
  - For UI/visual tweaks: edit files under `*.Report/definition/` and `StaticResources/`. Provide the exact JSON patch or file diff in the PR description.
  - For model logic (measures, relationships): propose edits to the `definition/` JSON entries or provide Tabular Editor TMSL/TOM scripts and a short verification checklist (Tabular Editor validation + Power BI Desktop visual smoke test).
  - For diagram/layout updates: include `diagramLayout.json` and `semanticModelDiagramLayout.json` edits alongside model changes.

- Validation steps to include in PR descriptions (examples):
  - "Ran Tabular Editor validation" for model changes
  - "DAX Studio smoke query executed (example query included)" when altering measures
  - "Opened report in Power BI Desktop and visually checked affected pages" for visual changes

- Tools the maintainers expect: Power BI Desktop, Tabular Editor, DAX Studio. There are no automated unit tests or CI build scripts in the repository; the primary validation loop is manual authoring + Tabular Editor checks.

- When you cannot safely propose an edit:
  - If a requested change requires knowledge of live data sources, credentials, or gateway config, stop and ask for the necessary environment details or a test dataset.
  - If a change touches binary `.pbix` or other large package content, ask the user whether they want a textual export (decomposed `definition/`) or an authored binary change.

- Examples of explicit file references you can edit and how to present them in a PR:
  - Edit: `smarttime_data_semantic_model.SemanticModel/definition/Model/Measures/measureName.json`
    - PR description: short summary, Tabular Editor validation result, a minimal DAX smoke query, and a note to visually check report page `X` after compose.
  - Edit: `Activity Time Recorded.Report/StaticResources/logo.png`
    - PR description: include new asset path, reference in `definition.pbir` if changed, and a visual-check note.

- Final notes for an AI agent:
  - Be conservative: present proposed diffs for text files rather than applying broad transformations to binaries.
  - When generating code or TMSL to modify models, include 1–2-line rationales and a validation checklist in the PR body.
  - Reference existing files in your suggested edits (use exact paths listed above).

If anything in these instructions is unclear or you need additional repository access (binary blobs, dataset credentials, CI pipelines), tell me which part and I will adjust the guidance.
