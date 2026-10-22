# Copilot & AI Agent Instructions — `scw_corporate_data_products`

This repository stores Microsoft Fabric orchestration assets (`pipelines/`, `dataflows/`, `notebooks/`), a custom Power BI visual (`visuals/scw-org-chart/`), and decomposed Power BI Project (`pbi/*.pbip`, `pbi/*.Report/`, `pbi/*.SemanticModel/`) definitions for **P00278 (SmartTime Data Quality Report)** and **P00287 (Dynamic Structure Chart)**.

## 1. Architecture Summary
* **Upstream ETL (`dataflows/`, `notebooks/`, `pipelines/`):**
  * 6 Fabric Dataflows Gen2 (`.pqt` templates and extracted `.pq` M scripts) ingest data from on-prem SQL Server (`BIS-000-SP05:14431` and `CSU-000-SP03`), Microsoft Graph API, SharePoint Online, and GOV.UK into the **`scw_corporate_data_products`** Fabric Lakehouse (`6o7iqqh3u5ruxod3jwhnucnsru-h3xe24f5b4fe7h3tmfs6pskvcy.datawarehouse.fabric.microsoft.com`).
  * 1 PySpark Notebook (`notebooks/support_rls_dynamic_merged_path.ipynb`) computes the loop-safe `OrgPath` hierarchy (`support_rls_hierarchy_gold`).
  * 3 Fabric Data Pipelines (`pipelines/`) orchestrate scheduled and on-demand refreshes.
* **Semantic Models & Reports (`pbi/`):**
  * **Core Hub Model:** `pbi/semantic_model_smarttime.SemanticModel` (DirectQuery to Lakehouse + imported `RLS_Metadata` calculated table). Houses central DAX measures, calculated columns, relationships, and 6 RLS roles.
  * **Spoke Composite Models:** `pbi/dynamic_structure_chart.SemanticModel` and `pbi/smartworking_operational_report_*.SemanticModel` connect via DirectQuery to `semantic_model_smarttime` in workspace `[DI] SCW Corporate Products` (except `_project`, which connects to `pbi/smarttime_data_semantic_model_project_view.SemanticModel`).
  * **Thin Reports:** `pbi/Activity Time Recorded.Report` and `pbi/Activity Time Billable_Int.Report` bind directly (`byPath`) to `../semantic_model_smarttime.SemanticModel`.
* **Custom Visual (`visuals/scw-org-chart/`):**
  * Standalone Power BI custom visual (`powerbi-visuals-api` TypeScript + LESS) powering the interactive NHS SCW hierarchy chart in `pbi/dynamic_structure_chart.Report`, packaged to `visuals/scw-org-chart/dist/*.pbiviz`.

## 2. Required Agent Tooling & MCP Servers
* **Power BI Modeling MCP (`powerbi-modeling`):**
  * **Always prefer the `powerbi-modeling` MCP server** when inspecting or modifying semantic models (tables, measures, columns, relationships, calculation groups, or RLS roles) rather than raw text manipulation alone, so changes are validated against the Tabular Object Model (TOM):
    * **Local PBIP / TMDL on disk:** Use `connection_operations` with `operation: "ConnectFolder"` targeting `pbi/<model>.SemanticModel/definition` (e.g. `pbi/semantic_model_smarttime.SemanticModel/definition`).
    * **Open Power BI Desktop instance:** Use `connection_operations` with `operation: "ListLocalInstances"` and `operation: "Connect"`.
    * **Fabric Workspace (`[DI] SCW Corporate Products`):** Use `connection_operations` with `operation: "ConnectFabric"` (`workspaceName: "[DI] SCW Corporate Products"`, `semanticModelName: "semantic_model_smarttime"`) and `dax_query_operations` to validate DAX queries and inspect live data.
* **Power BI Visuals CLI (`powerbi-visuals-tools` / `pbiviz`):**
  * Installed locally in `visuals/scw-org-chart/node_modules`. Run `npm run package` (`pbiviz package --no-minify`) inside `visuals/scw-org-chart/` to compile TypeScript/LESS and bundle the `.pbiviz` package.

## 3. Editing Rules for AI Agents
1. **Semantic Model & Report Edits:** Use the **`powerbi-modeling` MCP** (`ConnectFolder` or live connection) for semantic model mutations under `pbi/*.SemanticModel/definition/` (`*.tmdl`), and edit visual/page definitions in `.json` files under `pbi/*.Report/definition/`.
2. **Centralise DAX Logic:** When adding new SmartTime measures or calculated columns, add them to `pbi/semantic_model_smarttime.SemanticModel/definition/tables/data_smarttime.tmdl` (under the appropriate `_Calculations` display folder) rather than duplicating logic across spoke reports.
3. **Keep `.pqt` and `.pq` in Sync:** If modifying Power Query M logic in `dataflows/*.pq`, repackage `MashupDocument.pq` inside the corresponding `dataflows/*.pqt` archive so the template remains ready to import into Fabric.
4. **Repackage Custom Visual on Source Edits:** When modifying `visuals/scw-org-chart/src/visual.ts`, `style/visual.less`, `capabilities.json`, or `pbiviz.json`, run `npm run package` (`pbiviz package --no-minify`) inside `visuals/scw-org-chart/` so `dist/*.pbiviz` stays in sync with the source.
5. **Documentation Sync:** Update the relevant guide under `docs/` (`01-architecture-and-data-lineage.md`, `02-semantic-models-and-dax-dictionary.md`, `03-security-and-rls-guide.md`, `04-operations-and-handover-runbook.md`) whenever tables, measures, RLS roles, or pipelines change.
