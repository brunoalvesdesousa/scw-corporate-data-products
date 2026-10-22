# 04 — Operations & Handover Runbook

This runbook provides a step-by-step **Handover Checklist** for the incoming owner/developer, followed by standard operating procedures (SOPs) and troubleshooting guides.

---

## 1. CRITICAL: Day-1 Handover Checklist (Account & Credential Re-binding)

> [!CAUTION]
> Several Fabric Pipeline connections and Dataflow credentials are currently bound to **Bruno Alves de Sousa's** personal NHS account (`bruno.alvesdesousa@nhs.net`). If his account is disabled upon departure without re-binding these connections, **scheduled refreshes will fail immediately**.

Complete the following 5 steps in the Microsoft Fabric workspace **`[DI] SCW Corporate Products`** (`704dee3e-0fbd-4f0a-9f73-6165e7c95516`):

### Step 1: Re-bind the Semantic Model Refresh Activity in All 3 Fabric Pipelines
All three pipelines in [`pipelines/`](../pipelines/) currently reference the linked service connection parameter:
```json
"externalReferences": {
  "connection": "[parameters('PowerBIDatasets Bruno.Alvesdesousa')]"
}
```
1. Open **`scw_corporate_data_products`** in Fabric Data Factory.
2. Click the **`refresh overal semantic model`** activity $\rightarrow$ **Settings** tab $\rightarrow$ **Connection** dropdown.
3. Select **Browse all / New** and authenticate with a **Service Principal** or the **incoming owner's organisational account** (must have Admin/Member rights on `[DI] SCW Corporate Products`).
4. Save and publish the pipeline.
5. Repeat for:
   * **`metadata update (on demand)`** $\rightarrow$ activity `refresh semantic model`.
   * **`static_rls_update (on demand)`** $\rightarrow$ activity `smarttime data`.

### Step 2: Take Over Ownership of All 6 Dataflows Gen2
In workspace **`[DI] SCW Corporate Products`**, open the settings for each Dataflow Gen2 and click **Take Over**, then re-authenticate its data source credentials:
1. **`data_smarttime` (`4c85c7a5-ff1e-4892-bae5-1f741839ed46`)**:
   * **Source:** SQL Server `BIS-000-SP05.bis.xswhealth.nhs.uk, 14431` / Database `Corporate_Data_Strategy` (verify On-Premises Data Gateway mapping).
   * **Destination:** Fabric Lakehouse `scw_corporate_data_products`.
   * *(Note: Import the updated [`dataflows/data_smarttime.pqt`](../dataflows/data_smarttime.pqt) template if `Activity Time Recorded` / `Activity Time Billable_Int` columns need to be populated in the Lakehouse).*
2. **`base_calendar` (`3e17b2e0-a0e8-47d1-b7de-183fc5186117`)**:
   * **Source:** None (generated via M `List.Dates`).
   * **Destination:** Fabric Lakehouse `scw_corporate_data_products`.
3. **`base_metadata` (`f617c090-d635-4e59-a325-df08327d1482`)**:
   * **Source:** SharePoint Online `https://nhs.sharepoint.com/sites/msteams_8489d9/` (Organisational OAuth2).
   * **Destination:** Fabric Lakehouse `scw_corporate_data_products`.
4. **`support_bank_holidays` (`62cc6a58-1cca-40fc-b139-c2a3c0eb6f4d`)**:
   * **Source:** Anonymous Web (`https://www.gov.uk/bank-holidays.json`).
   * **Destination:** Fabric Lakehouse `scw_corporate_data_products`.
5. **`support_dynamic_rls` (`189306b6-c8ce-43e0-beef-bf3e96da2528`)**:
   * **Sources:**
     * On-Prem SQL Server `CSU-000-SP03` / Database `SWCSUDataReporting` (via Gateway).
     * Microsoft Graph Web API `https://graph.microsoft.com/v1.0/users` and `/groups` (Organisational OAuth2 / Service Principal with `User.Read.All` & `Group.Read.All`).
   * **Destination:** Fabric Lakehouse `scw_corporate_data_products`.
6. **`support_teams_static_rls` (`3141b376-c20d-400c-a09b-583c353f93e5`)**:
   * **Source:** SharePoint Online `https://nhs.sharepoint.com/sites/msteams_7026cb-P00278SmartTimeDataQualityReporting/` (Organisational OAuth2).
   * **Destination:** Fabric Lakehouse `scw_corporate_data_products`.

### Step 3: Take Over Semantic Models in Power BI Service
1. Go to **Settings** for **`semantic_model_smarttime`** (`3c2a1e45-2d30-4277-b239-5c61f37a31d6`) and **`smarttime_data_semantic_model_project_view`**.
2. Click **Take Over** and bind the cloud Lakehouse SQL Endpoint credentials (`OAuth2`) and `BIS-000-SP05` gateway connection.
3. Publish the updated `semantic_model_smarttime`, `Activity Time Recorded`, and `Activity Time Billable_Int` from this repository if not already synced via Fabric Git Integration.

### Step 4: Verify SharePoint Site Permissions
Ensure the incoming developer/owner has **Member/Edit** permissions on both SharePoint sites:
* **Product Registry Site:** `https://nhs.sharepoint.com/sites/msteams_8489d9/` (List: `Products`, Items `404` & `426`)
* **P00278 Supporting Docs Site:** `https://nhs.sharepoint.com/sites/msteams_7026cb-P00278SmartTimeDataQualityReporting/` (`rls_static.xlsx`)

---

## 2. Standard Operating Procedures (SOPs)

### 2.1 Updating Static RLS Permissions for a User
1. Open `rls_static.xlsx` in SharePoint (`Shared Documents/P00278 SmartTime Data Quality Reporting/Supporting Docs/rls_static.xlsx`).
2. Add or modify the row for the user on the `rls_static` worksheet:
   * Populate `scwcsu email` with their exact Entra ID User Principal Name (UPN).
   * Populate `Access Level3` (for `person_cost_centre_l3`), `Access L4` (for `person_cost_centre_l4`), or `Access CostCentre` (for `person_cost_centre_l6`).
3. Ensure the user is assigned to the corresponding RLS Role (`person_cost_centre_l3`, `person_cost_centre_l4`, or `person_cost_centre_l6`) in the Power BI Service (**`semantic_model_smarttime` $\rightarrow$ Security**).
4. In the Fabric workspace, run the pipeline **`static_rls_update (on demand)`**.

### 2.2 Updating Product Metadata (Version, Owner, Description)
1. Open the `Products` SharePoint list on `https://nhs.sharepoint.com/sites/msteams_8489d9/`.
2. Edit item **ID `404`** (`P00278 - SmartTime Data Quality Report`) or **ID `426`** (`P00287 - Dynamic Structure Chart`).
3. In the Fabric workspace, run the pipeline **`metadata update (on demand)`**.
4. Verify the updated metadata on the **Cover** and **Notes** tabs of the reports.

### 2.3 Fixing a Broken Line-Manager Link in the Dynamic Hierarchy
If a staff member or manager does not appear under the right supervisor in the **Dynamic Structure Chart (`P00287`)** or **Line Manager (`P00278`)** report:
1. Check `dbo.vw_StaffHierarchy` on `CSU-000-SP03` (`SWCSUDataReporting`) first—if ESR/HR data is wrong upstream, ask HR/ESR to fix the supervisor assignment.
2. If an immediate override is required:
   * Open Dataflow **`support_dynamic_rls`** in Fabric.
   * Click the **`Source`** gear icon on query **`support_rls_dynamic_missing`** to open the Enter Data grid and add/update the employee's `PersonFk` and `SupervisorId`.
   * If the employee already exists in `vw_StaffHierarchy` with bad data (like `PersonFk = 3207`), exclude their `PersonFk` in the last step of `support_rls_dynamic` so the row from `support_rls_dynamic_missing` wins during `Table.Distinct`.
   * Run the main pipeline **`scw_corporate_data_products`** (which runs `support_dynamic_rls` $\rightarrow$ `RLS` PySpark notebook $\rightarrow$ `semantic_model_smarttime` refresh).

---

## 3. Troubleshooting Guide

| Symptom | Root Cause | Resolution |
| :--- | :--- | :--- |
| **Freshness card on `Activity Time Recorded` turns red (`#F80101`)** | `MAX(data_smarttime[Activity_Created_Date])` is more than 1 day behind `TODAY()`. | Check whether the `scw_corporate_data_products` Fabric pipeline failed, or whether the upstream SQL table `dbo.Smart_Time` on `BIS-000-SP05` failed its overnight load. |
| **Pipeline fails at step `refresh overal semantic model`** | Expired OAuth token on `PowerBIDatasets` connection, or schema mismatch between Lakehouse and `semantic_model_smarttime`. | Re-authenticate the `PBISemanticModelRefresh` connection in the pipeline, or inspect the refresh error in `semantic_model_smarttime` Refresh History. |
| **Line Manager sees blank visuals when opening report** | User's `USERPRINCIPALNAME()` in Power BI does not match `userPrincipalName` in `RLS_Metadata` (e.g. `@nhs.net` vs `@scwcsu.nhs.uk` mismatch or missing email in `vw_StaffHierarchy`). | Query `dbo.support_rls_hierarchy_gold` in the Lakehouse SQL Endpoint for the user's `PersonFk`. Check whether the fuzzy join in `support_rls_dynamic` matched their Entra ID `mail` to `vw_StaffHierarchy[Email]`. |
| **1:1 Compliance shows `0%` despite manager holding a 1:1** | Timesheet entry was logged under a different Work Activity ID instead of **`Work_Activity_Id = 7016`**, or the timesheet was logged in a different month. | `calc_121_compliance_ActiveStaff` specifically checks for `data_smarttime[Work_Activity_Id] = 7016`. Advise staff to log 1:1 time against `WA7016`. |

---

## 4. Key Contacts & Stakeholders

| Role | Name | Contact / Organisation | Scope |
| :--- | :--- | :--- | :--- |
| **Product Owner (`P00278` SmartTime DQ)** | Lisa Buck | NHS SCW CSU | Business sign-off, UAT, and operational requirements for SmartTime Data Quality & Utilisation reports |
| **Product Owner (`P00287` Dynamic Structure Chart)** | Paul Toomer | NHS SCW CSU | Business sign-off and requirements for the Dynamic Structure Chart |
| **Original Primary Developer / Author** | Bruno Alves de Sousa | `bruno.alvesdesousa@nhs.net` (BI Analytics) | Original architecture, Fabric migration, PySpark &PBIP authoring |
| **Registry / Catalogue Creator (`P00287`)** | Vicky Spark | NHS SCW CSU | SharePoint Product Catalogue administration |
