# Smarttime Data Quality

Power BI reports and decomposed semantic models for monitoring Smarttime data quality, compliance and utilisation. The repository stores report and tabular model metadata in a decomposed format so changes are reviewable in Git.

## Overview

This repository contains Power BI report packages and decomposed report + semantic model projects. The layout allows model metadata and report definitions to be reviewed and versioned in text form.

## Table of contents

- [Smarttime Data Quality](#smarttime-data-quality)
  - [Overview](#overview)
  - [Table of contents](#table-of-contents)
  - [Repository contents \& layout](#repository-contents--layout)
    - [Packages](#packages)
    - [Report folders](#report-folders)
    - [Semantic model folders](#semantic-model-folders)
    - [Datasets](#datasets)
  - [Quick start](#quick-start)
  - [Recommended tools \& workflow](#recommended-tools--workflow)
  - [Data refresh \& deployment](#data-refresh--deployment)
  - [Security \& sensitive data](#security--sensitive-data)
  - [Contribution guidelines](#contribution-guidelines)
  - [Troubleshooting](#troubleshooting)
  - [Contact \& maintainers](#contact--maintainers)

## Repository contents & layout

The repository typically contains the following item types. Example names are taken from this repository.

### Packages

- `Activity Time Billable_Int.pbip`
- `Activity Time Recorded.pbip`
- `dynamic_structure_chart.pbip`
- `Income and Contribution by Sales Contract.pbip`
- `smarttime_data_semantic_model.pbip`
- `smarttime_data_semantic_model_project_view.pbip`
- `smartworking_operational_report_121_compliance.pbip`
- `smartworking_operational_report_cover.pbip`
- `smartworking_operational_report_directorate_costcentre.pbip`
- `smartworking_operational_report_line_manager.pbip`
- `smartworking_operational_report_project.pbip`
- `smartworking_operational_report_utilisation.pbip`

### Report folders

- `Activity Time Billable_Int.Report/`
- `Activity Time Recorded.Report/`
- `dynamic_structure_chart.Report/`
- `Income and Contribution by Sales Contract.Report/`
- `smarttime_data_semantic_model.Report/`
- `smarttime_data_semantic_model_project_view.Report/`
- `smartworking_operational_report_121_compliance.Report/`
- `smartworking_operational_report_cover.Report/`
- `smartworking_operational_report_directorate_costcentre.Report/`
- `smartworking_operational_report_line_manager.Report/`
- `smartworking_operational_report_project.Report/`
- `smartworking_operational_report_utilisation.Report/`

Each report folder generally contains a `definition.pbir`, a `definition/` subfolder for report parts, and `StaticResources/` for images and assets.

### Semantic model folders

- `dynamic_structure_chart.SemanticModel/`
- `smarttime_data_semantic_model.SemanticModel/`
- `smarttime_data_semantic_model_project_view.SemanticModel/`
- `smartworking_operational_report_121_compliance.SemanticModel/`
- `smartworking_operational_report_cover.SemanticModel/`
- `smartworking_operational_report_directorate_costcentre.SemanticModel/`
- `smartworking_operational_report_line_manager.SemanticModel/`
- `smartworking_operational_report_project.SemanticModel/`
- `smartworking_operational_report_utilisation.SemanticModel/`

Semantic model folders typically contain a `definition.pbism`, `diagramLayout.json` and a `definition/` folder with model metadata.

### Datasets

- `Income and Contribution by Sales Contract.Dataset/`

Dataset folders may hold exported dataset/model files used by reports.

## Quick start

1. Requirements: Windows + Power BI Desktop (latest stable). Optional: Tabular Editor, DAX Studio, ALM Toolkit.
2. Open a packaged report: double-click `*.pbip`/`*.pbix` or use `File -> Open` in Power BI Desktop.
3. Work with decomposed projects: open `*.Report/definition.pbir` in Power BI Desktop; edit models using Tabular Editor or via XMLA.
4. Update static assets in `*.Report/StaticResources/` as needed and commit changes.

## Recommended tools & workflow

- Power BI Desktop — authoring and local validation.
- Tabular Editor — model metadata editing and validation.
- DAX Studio — query profiling and measure validation.
- Git + Git LFS — store large binaries (`*.pbix`, `*.pbip`) using LFS to keep the repo performant.

Add this to `.gitattributes` to enable Git LFS for typical Power BI files:

```text
*.pbix filter=lfs diff=lfs merge=lfs -text
*.pbip filter=lfs diff=lfs merge=lfs -text
```

## Data refresh & deployment

- Local refresh: open the report in Power BI Desktop and click `Refresh` (ensure data source credentials are configured locally).
- Publish: use Power BI Desktop `Publish` to send the report to the Power BI Service; configure gateways and scheduled refresh in the service.
- CI/CD: use the decomposed `definition.pbism` and deployment scripts (Tabular Editor, TMSL, Azure DevOps pipelines, PowerShell) for automated model deployments.

## Security & sensitive data

- Do not commit credentials, connection strings, or secrets. Use secure secret storage (e.g. Azure Key Vault, pipeline variables) for CI/CD.
- If secrets are committed accidentally: rotate credentials immediately and remove them from history using `git filter-repo` or equivalent.

## Contribution guidelines

- Branching: create feature branches from `dev`. Open PRs against `dev`; merge to `main` for releases.
- PRs should be small and focused (model-only, report-only, or assets-only) to simplify reviews.
- Include validation checks in PR descriptions, e.g. "Tabular Editor validation", "DAX Studio smoke test", "Power BI Desktop visual check".

## Troubleshooting

- Decomposed report recompose issues: inspect the `definition/` folder for missing files and check `definition.pbir` references.
- Model compatibility problems: use Tabular Editor and DAX Studio to validate measures and metadata.

## Contact & maintainers

- Repository owner / primary maintainer: `brunoalvesdesousa`.
- For dataset access, credentials or environment details, contact the Smarttime BI team or the repository owner.
