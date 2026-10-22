# SCW CSU Custom Org Chart Visual (`scwOrgChart`)

A 100% free, in-house Power BI Custom Visual (`.pbiviz`) built specifically for **NHS South, Central and West CSU (SCW CSU)** to replace the paid/trial third-party AppSource Org Chart (`orgChart021B261450284A21B688B59A7342AC52`).

---

## 1. Key Capabilities

* **Instant Search & Path Auto-Expansion:**
  * Search across **Full Name**, **Directorate (`Level3`)**, **Service Line (`Level6`)**, **Hierarchy Status**, or **Person ID (`PersonFk`)**.
  * Automatically expands ancestor chains for all matching staff, highlights matching cards in NHS Crimson/Amber, dims non-matching nodes, and smoothly pans/zooms the canvas to the active match (`Enter` / `Shift+Enter` or `▼` / `▲` buttons cycle through matches).
* **Subtree Expand/Collapse & Level Controls:**
  * Interactive pill button at the bottom of every line manager card showing **Direct Reports** and **Total Subtree Size** (`▼ 6 direct · 142 all` / `▶ +6 (142 total)`).
  * Toolbar buttons to expand/collapse the entire chart by depth (`+1 Level`, `-1 Level`, `Reset`).
* **Hierarchy Health Badges (`● Health Badges: ON/OFF`):**
  * Automatically highlights staff whose reporting line was auto-repaired by the PySpark notebook (`Bridged via Leaver`, `Fallback: Level6 Lead`, `Fallback: CostCentre Lead`, `Fallback: Level3 Lead`, `Manual Override`, or `Cycle Repaired`) with an amber top strip and `⚡` status badge so HR/Operations can spot upstream ESR line-manager gaps at a glance.
* **Client-Side Single-Tree Safeguard:**
  * Even if bound to raw/uncleaned data with missing `SupervisorId` values or supervisory loops, the visual breaks cycles and attaches secondary roots under the primary root (`4037`) so staff never scatter into disconnected islands across the canvas.
* **Power BI Cross-Filtering:**
  * Clicking any staff card invokes Power BI's `ISelectionManager` (`Ctrl+Click` for multi-select) to filter other visuals on the report page.

---

## 2. How to Import into Power BI Desktop (1-Click)

The pre-compiled package is tracked directly in this repository at:
[`visuals/scw-org-chart/dist/scwOrgChartB8A4E9C14F2D48E79A1234567890ABCD.1.0.0.0.pbiviz`](dist/scwOrgChartB8A4E9C14F2D48E79A1234567890ABCD.1.0.0.0.pbiviz)

1. Open [`semantic_model_smarttime.pbip`](../../semantic_model_smarttime.pbip) in **Power BI Desktop**.
2. In the **Visualizations** pane, click the **`...` (Get more visuals)** ellipsis icon and select **Import a visual from a file**.
3. Select [`visuals/scw-org-chart/dist/scwOrgChartB8A4E9C14F2D48E79A1234567890ABCD.1.0.0.0.pbiviz`](dist/scwOrgChartB8A4E9C14F2D48E79A1234567890ABCD.1.0.0.0.pbiviz).
4. Click the existing Org Chart container on **Duplicate of Page 7** (`SCWCSU Hierarchy Chart`) and click the newly imported **SCW CSU Org Chart** icon in the Visualizations pane to switch its visual type.
5. Verify the field wells:
   * **Employee ID:** `support_rls_hierarchy_gold[PersonFk]`
   * **Manager ID:** `support_rls_hierarchy_gold[supervisorid_corrected]`
   * **Full Name:** `support_rls_hierarchy_gold[fullname]`
   * **Extra Details:** `Level3`, `Level6`, `HierarchyStatus`

---

## 3. Building from Source

If you modify [`src/visual.ts`](src/visual.ts), [`style/visual.less`](style/visual.less), or [`capabilities.json`](capabilities.json):

```bash
cd visuals/scw-org-chart
npm install
npm run package
```

This outputs the updated `.pbiviz` binary to `visuals/scw-org-chart/dist/`.
