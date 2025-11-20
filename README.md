# Smarttime Data Quality

**Purpose**: This repository contains the Power BI reports and semantic models used to monitor and improve Smarttime data quality, compliance and utilisation across the organisation. The project is stored in a decomposed structure so report definitions, semantic models and static resources can be tracked in source control.

## Contents

- **Top-level reports**: Multiple Power BI report package files (e.g. `smarttime_data_quality.pbip`, `dynamic_structure_chart.pbip`, `smartworking_operational_report_*.pbip`).
- **Report folders**: Each report has a `*.Report/` folder containing `definition.pbir`, `definition/` and `StaticResources/` used to build the report.
- **Semantic models**: Each report also has a corresponding `*.SemanticModel/` folder containing `definition.pbism`, `diagramLayout.json` and `definition/` for the tabular model.

## Quick Start

- **Requirements**: Power BI Desktop (latest stable build recommended). Optional: Tabular Editor, DAX Studio, ALM Toolkit for advanced model editing.

- **Open a report**: Double-click a `.pbip` file or open it from Power BI Desktop. If working from the decomposed folders, open `*.Report/definition.pbir` in Power BI Desktop (or recompose using the tooling that produced the decomposition).
- **Edit semantic model**: Use Tabular Editor or connect to the model using an XMLA endpoint and edit `*.SemanticModel/definition.pbism` or load the model project into your editor of choice.
- **Static resources**: Update images and other assets in `*.Report/StaticResources/`.

## Structure (example)

- `smarttime_data_quality.pbip` — primary data quality report package
- `smarttime_data_quality.Report/definition.pbir` — report definition
- `smarttime_data_quality.SemanticModel/definition.pbism` — tabular model definition
- `dynamic_structure_chart.Report/` and `dynamic_structure_chart.SemanticModel/` — supporting chart & model

## Data Refresh & Deployment

- Local refresh: Open the report in Power BI Desktop and click `Refresh`.
- Service deployment: Publish the report to the Power BI Service workspace, configure credentials and schedule refresh there.
- For model deployments in environments using ALM/CI, use the `definition.pbism` and TMSL scripts (Tabular Model Scripting Language) or automation tooling (Tabular Editor, Azure DevOps pipelines) as appropriate.

## Development Notes

- This repository keeps report and model definitions decomposed to make diffs reviewable. Avoid committing full Power BI Desktop `*.pbix` binaries when possible — prefer the decomposed project layout already in this repo.
- When adding a new report, follow the existing convention: create `YourReport.Report/` and `YourReport.SemanticModel/` directories and include `definition.pbir` / `definition.pbism` plus any `StaticResources/`.
- Validate DAX and measures with DAX Studio and Tabular Editor before publishing.

## Contributing

- Fork/branch from `main` or create feature branches from `dev` as per team workflow.
- Open pull requests against `dev` for development work; merge to `main` for releases.
- Keep PRs small and focused (model-only, report-only, or assets-only changes when possible).

## Troubleshooting

- If a decomposed report doesn't recompose correctly, check `definition/` contents for missing files and confirm Power BI Desktop compatibility.
- For model compatibility issues, use Tabular Editor to inspect metadata and run validation.

## Contact & Authors

- Repository owner: `brunoalvesdesousa`.
- For questions or access to datasets and credentials, contact the repository owner or the Smarttime BI team.

## License

- No license specified. Contact the repository owner if you need to add or confirm licensing terms.
