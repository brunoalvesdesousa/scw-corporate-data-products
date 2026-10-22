# Copilot & AI Agent Instructions — `scw_corporate_data_products`

This repository stores Microsoft Fabric orchestration assets (`pipelines/`, `dataflows/`, `notebooks/`) alongside decomposed Power BI Project (`*.pbip`, `*.Report/`, `*.SemanticModel/`) definitions for **P00278 (SmartTime Data Quality Report)** and **P00287 (Dynamic Structure Chart)**.

## 1. Architecture Summary
* **Upstream ETL (`dataflows/` & `notebooks/`):**
  * 6 Fabric Dataflows Gen2 (`.pqt` templates and extracted `.pq` M scripts) ingest data from on-prem SQL Server (`BIS-000-SP05:14431` and `CSU-000-SP03`), Microsoft Graph API, SharePoint Online, and GOV.UK into the **`scw_corporate_data_products`** Fabric Lakehouse (`6o7iqqh3u5ruxod3jwhnucnsru-h3xe24f5b4fe7h3tmfs6pskvcy.datawarehouse.fabric.microsoft.com`).
  * 1 PySpark Notebook (`notebooks/support_rls_dynamic_merged_path.ipynb`) computes the loop-safe `OrgPath` hierarchy (`support_rls_hierarchy_gold`).
  * 3 Fabric Data Pipelines (`pipelines/`) orchestrate scheduled and on-demand refreshes.
* **Semantic Models (`*.SemanticModel/`):**
  * **Core Hub Model:** `semantic_model_smarttime.SemanticModel` (DirectQuery to Lakehouse + imported `RLS_Metadata` calculated table). Houses central DAX measures, calculated columns, relationships, and 6 RLS roles.
  * **Spoke Composite Models:** `dynamic_structure_chart.SemanticModel` and `smartworking_operational_report_*.SemanticModel` connect via DirectQuery to `semantic_model_smarttime` in workspace `[DI] SCW Corporate Products` (except `_project`, which connects to `smarttime_data_semantic_model_project_view`).
  * **Thin Reports:** `Activity Time Recorded.Report` and `Activity Time Billable_Int.Report` bind directly (`byPath`) to `../semantic_model_smarttime.SemanticModel`.

## 2. Editing Rules for AI Agents
1. **Text-First Edits:** Always edit `.tmdl` files under `*.SemanticModel/definition/` and `.json` files under `*.Report/definition/`.
2. **Centralise DAX Logic:** When adding new SmartTime measures or calculated columns, add them to `semantic_model_smarttime.SemanticModel/definition/tables/data_smarttime.tmdl` (under the appropriate `_Calculations` display folder) rather than duplicating logic across spoke reports.
3. **Keep `.pqt` and `.pq` in Sync:** If modifying Power Query M logic in `dataflows/*.pq`, repackage `MashupDocument.pq` inside the corresponding `dataflows/*.pqt` archive so the template remains ready to import into Fabric.
4. **Documentation Sync:** Update the relevant guide under `docs/` (`01-architecture-and-data-lineage.md`, `02-semantic-models-and-dax-dictionary.md`, `03-security-and-rls-guide.md`, `04-operations-and-handover-runbook.md`) whenever tables, measures, RLS roles, or pipelines change.
