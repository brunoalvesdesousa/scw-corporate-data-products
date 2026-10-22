"use strict";

import powerbi from "powerbi-visuals-api";
import "./../style/visual.less";

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ISelectionId = powerbi.visuals.ISelectionId;
import DataView = powerbi.DataView;
import DataViewTable = powerbi.DataViewTable;
import EnumerateVisualObjectInstancesOptions = powerbi.EnumerateVisualObjectInstancesOptions;
import VisualObjectInstanceEnumeration = powerbi.VisualObjectInstanceEnumeration;
import VisualObjectInstance = powerbi.VisualObjectInstance;

type LayoutMode = "compact" | "horizontal" | "classic";
type DensityMode = "mini" | "compact" | "detailed";

interface StaffNode {
    id: string;
    managerId: string | null;
    rawManagerId: string | null;
    name: string;
    level3: string;
    level6: string;
    extras: { label: string; value: string }[];
    status: string;
    selectionId: ISelectionId | null;
    children: StaffNode[];
    parent: StaffNode | null;
    depth: number;
    directReports: number;
    totalReports: number;
    expanded: boolean;
    x: number;
    y: number;
    subtreeWidth: number;
    subtreeHeight: number;
    isMatch: boolean;
    isActiveMatch: boolean;
}

interface DensityMetrics {
    cardW: number;
    cardH: number;
    hGap: number;
    vGap: number;
    nameFont: number;
    subFont: number;
    pillH: number;
    pillW: number;
}

const SVG_NS = "http://www.w3.org/2000/svg";

export class Visual implements IVisual {
    private host: IVisualHost;
    private selectionManager: ISelectionManager;
    private rootElement: HTMLElement;
    private searchInput: HTMLInputElement;
    private orgFilterSelect: HTMLSelectElement;
    private matchCountLabel: HTMLElement;
    private layoutSelect: HTMLSelectElement;
    private densitySelect: HTMLSelectElement;
    private accordionBtn: HTMLButtonElement;
    private autoFitBtn: HTMLButtonElement;
    private badgeToggleBtn: HTMLButtonElement;
    private minimapToggleBtn: HTMLButtonElement;
    private breadcrumbBar: HTMLElement;
    private minimapContainer: HTMLElement;
    private minimapSvg: SVGSVGElement;
    private statusLeftPill: HTMLElement;
    private statusRightPill: HTMLElement;
    private svgElement: SVGSVGElement;
    private viewportGroup: SVGGElement;
    private linksGroup: SVGGElement;
    private nodesGroup: SVGGElement;

    private allNodesMap: Map<string, StaffNode> = new Map();
    private rootNode: StaffNode | null = null;
    private focusedNodeId: string | null = null;
    private matchedNodes: StaffNode[] = [];
    private activeMatchIndex: number = -1;
    private selectedNodeId: string | null = null;

    // Layout, Density & Workaround states
    private layoutMode: LayoutMode = "compact";
    private densityMode: DensityMode = "compact";
    private accordionMode: boolean = true;
    private autoFitOnToggle: boolean = true;
    private showHealthBadges: boolean = true;
    private showMinimap: boolean = true;
    private maxExpandedDepth: number = 1;
    private hasInitializedExpansion: boolean = false;

    // Custom Format Pane & Toolbar scaling
    private cardScalePct: number = 100;
    private fontScalePct: number = 100;
    private maxColumnsWrap: number = 6;
    private customCardBg: string = "#ffffff";
    private searchHighlightColor: string = "#da291c";
    private showPersonId: boolean = false;

    // Camera Pan & Zoom state
    private panX: number = 0;
    private panY: number = 0;
    private scale: number = 0.85;
    private isDragging: boolean = false;
    private dragStartX: number = 0;
    private dragStartY: number = 0;

    // Last computed tree bounds for minimap
    private treeMinX: number = 0;
    private treeMaxX: number = 1000;
    private treeMinY: number = 0;
    private treeMaxY: number = 600;
    private lastVisibleNodes: StaffNode[] = [];

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.selectionManager = this.host.createSelectionManager();

        this.rootElement = document.createElement("div");
        this.rootElement.className = "scw-org-root";
        options.element.appendChild(this.rootElement);

        this.buildToolbar();
        this.buildBreadcrumbBar();
        this.buildCanvas();
        this.buildMinimap();
        this.buildStatusBar();
    }

    private getMetrics(): DensityMetrics {
        let base: DensityMetrics;
        if (this.densityMode === "mini") {
            base = {
                cardW: 138,
                cardH: 46,
                hGap: 10,
                vGap: 28,
                nameFont: 10,
                subFont: 8.5,
                pillH: 15,
                pillW: 92,
            };
        } else if (this.densityMode === "detailed") {
            base = {
                cardW: 224,
                cardH: 100,
                hGap: 22,
                vGap: 56,
                nameFont: 13,
                subFont: 10.5,
                pillH: 20,
                pillW: 128,
            };
        } else {
            // "compact" default
            base = {
                cardW: 174,
                cardH: 68,
                hGap: 14,
                vGap: 40,
                nameFont: 11.5,
                subFont: 9.5,
                pillH: 17,
                pillW: 110,
            };
        }

        const cFactor = Math.max(0.55, Math.min(1.5, this.cardScalePct / 100));
        const fFactor = Math.max(0.65, Math.min(1.5, this.fontScalePct / 100));

        return {
            cardW: Math.round(base.cardW * cFactor),
            cardH: Math.round(base.cardH * cFactor),
            hGap: Math.max(6, Math.round(base.hGap * cFactor)),
            vGap: Math.max(18, Math.round(base.vGap * cFactor)),
            nameFont: +(base.nameFont * fFactor).toFixed(1),
            subFont: +(base.subFont * fFactor).toFixed(1),
            pillH: Math.max(13, Math.round(base.pillH * cFactor)),
            pillW: Math.min(Math.round(base.cardW * cFactor) - 10, Math.round(base.pillW * cFactor)),
        };
    }

    private buildToolbar(): void {
        const toolbar = document.createElement("div");
        toolbar.className = "scw-org-toolbar";

        // 1. Search bar + Quick Filter group
        const searchGroup = document.createElement("div");
        searchGroup.className = "scw-search-group";

        this.searchInput = document.createElement("input");
        this.searchInput.type = "search";
        this.searchInput.className = "scw-search-input";
        this.searchInput.placeholder = "Search name, Directorate, Service Line, ID...";
        this.searchInput.addEventListener("input", () => {
            this.runSearch(this.searchInput.value);
        });
        this.searchInput.addEventListener("keydown", (e: KeyboardEvent) => {
            if (e.key === "Enter") {
                this.stepSearchMatch(e.shiftKey ? -1 : 1);
            } else if (e.key === "Escape") {
                this.searchInput.value = "";
                this.runSearch("");
            }
        });

        this.matchCountLabel = document.createElement("span");
        this.matchCountLabel.className = "scw-match-count";
        this.matchCountLabel.textContent = "";

        const prevBtn = this.createButton("◀", "Previous search match (Shift+Enter)", () =>
            this.stepSearchMatch(-1)
        );
        const nextBtn = this.createButton("▶", "Next search match (Enter)", () =>
            this.stepSearchMatch(1)
        );

        // Quick Filter Dropdown for Directorate (Level 3) / Service Line (Level 6)
        this.orgFilterSelect = document.createElement("select");
        this.orgFilterSelect.className = "scw-select";
        this.orgFilterSelect.title = "Quick-focus a Directorate (Level 3) or Service Line (Level 6)";
        this.orgFilterSelect.addEventListener("change", () => {
            this.applyOrgQuickFilter(this.orgFilterSelect.value);
        });

        searchGroup.appendChild(this.searchInput);
        searchGroup.appendChild(this.matchCountLabel);
        searchGroup.appendChild(prevBtn);
        searchGroup.appendChild(nextBtn);
        searchGroup.appendChild(this.orgFilterSelect);

        // 2. Controls group (Layout, Density, Font/Box Size, Depth, Workaround Toggles)
        const controlsGroup = document.createElement("div");
        controlsGroup.className = "scw-btn-group";

        // Layout Mode Selector
        this.layoutSelect = document.createElement("select");
        this.layoutSelect.className = "scw-select";
        this.layoutSelect.title = "Switch Tree Layout Mode";
        [
            { value: "compact", label: "Layout: Compact Grid" },
            { value: "horizontal", label: "Layout: Left-to-Right" },
            { value: "classic", label: "Layout: Classic Wide" },
        ].forEach((opt) => {
            const o = document.createElement("option");
            o.value = opt.value;
            o.textContent = opt.label;
            this.layoutSelect.appendChild(o);
        });
        this.layoutSelect.value = this.layoutMode;
        this.layoutSelect.addEventListener("change", () => {
            this.layoutMode = this.layoutSelect.value as LayoutMode;
            this.renderTree();
            if (this.autoFitOnToggle) this.fitToScreen();
        });

        // Density / Card Size Selector
        this.densitySelect = document.createElement("select");
        this.densitySelect.className = "scw-select";
        this.densitySelect.title = "Switch Card & Font Density";
        [
            { value: "mini", label: "Size: Mini Pills" },
            { value: "compact", label: "Size: Compact" },
            { value: "detailed", label: "Size: Detailed" },
        ].forEach((opt) => {
            const o = document.createElement("option");
            o.value = opt.value;
            o.textContent = opt.label;
            this.densitySelect.appendChild(o);
        });
        this.densitySelect.value = this.densityMode;
        this.densitySelect.addEventListener("change", () => {
            this.densityMode = this.densitySelect.value as DensityMode;
            this.renderTree();
            if (this.autoFitOnToggle) this.fitToScreen();
        });

        // Quick Box & Font shrink / grow buttons
        const shrinkBoxBtn = this.createButton(
            "A-",
            "Make boxes and fonts 10% smaller",
            () => {
                this.cardScalePct = Math.max(60, this.cardScalePct - 10);
                this.fontScalePct = Math.max(65, this.fontScalePct - 8);
                this.renderTree();
                if (this.autoFitOnToggle) this.fitToScreen();
            }
        );
        const growBoxBtn = this.createButton(
            "A+",
            "Make boxes and fonts 10% larger",
            () => {
                this.cardScalePct = Math.min(140, this.cardScalePct + 10);
                this.fontScalePct = Math.min(140, this.fontScalePct + 8);
                this.renderTree();
                if (this.autoFitOnToggle) this.fitToScreen();
            }
        );

        // Depth expansion presets
        const lvl1Btn = this.createButton("L1", "Show Root + Executive Direct Reports", () => {
            this.setExpansionToDepth(1);
            this.fitToScreen();
        });
        const lvl2Btn = this.createButton("L2", "Expand 2 Levels", () => {
            this.setExpansionToDepth(2);
            this.fitToScreen();
        });
        const lvl3Btn = this.createButton("L3", "Expand 3 Levels", () => {
            this.setExpansionToDepth(3);
            this.fitToScreen();
        });
        const expandAllBtn = this.createButton("All", "Expand All Under Current Root", () => {
            this.setExpansionToDepth(99);
            this.fitToScreen();
        });

        // Accordion Mode Toggle
        this.accordionBtn = this.createButton(
            "Accordion",
            "Accordion Mode: Auto-collapse sibling branches when expanding a manager",
            () => {
                this.accordionMode = !this.accordionMode;
                this.syncToggleButtons();
            }
        );

        // Auto-Fit Mode Toggle
        this.autoFitBtn = this.createButton(
            "Auto-Fit",
            "Automatically fit chart to page whenever branches are expanded or collapsed",
            () => {
                this.autoFitOnToggle = !this.autoFitOnToggle;
                this.syncToggleButtons();
                if (this.autoFitOnToggle) this.fitToScreen();
            }
        );

        // Health badge toggle
        this.badgeToggleBtn = this.createButton(
            "⚡ Badges",
            "Toggle Hierarchy Safeguard Badges (Bridged via Leaver / Tiered Fallbacks)",
            () => {
                this.showHealthBadges = !this.showHealthBadges;
                this.syncToggleButtons();
                this.renderTree();
            }
        );

        // Minimap toggle
        this.minimapToggleBtn = this.createButton(
            "🗺️ Map",
            "Toggle bottom-right overview minimap",
            () => {
                this.showMinimap = !this.showMinimap;
                this.syncToggleButtons();
                this.updateMinimap();
            }
        );

        // Camera controls
        const zoomInBtn = this.createButton("＋", "Zoom In", () => this.zoomBy(1.25));
        const zoomOutBtn = this.createButton("－", "Zoom Out", () => this.zoomBy(0.8));
        const fitBtn = this.createButton("Fit", "Fit visible chart to screen", () =>
            this.fitToScreen()
        );
        fitBtn.classList.add("scw-btn-primary");

        controlsGroup.appendChild(this.layoutSelect);
        controlsGroup.appendChild(this.densitySelect);
        controlsGroup.appendChild(shrinkBoxBtn);
        controlsGroup.appendChild(growBoxBtn);
        controlsGroup.appendChild(this.createDivider());
        controlsGroup.appendChild(lvl1Btn);
        controlsGroup.appendChild(lvl2Btn);
        controlsGroup.appendChild(lvl3Btn);
        controlsGroup.appendChild(expandAllBtn);
        controlsGroup.appendChild(this.createDivider());
        controlsGroup.appendChild(this.accordionBtn);
        controlsGroup.appendChild(this.autoFitBtn);
        controlsGroup.appendChild(this.badgeToggleBtn);
        controlsGroup.appendChild(this.minimapToggleBtn);
        controlsGroup.appendChild(this.createDivider());
        controlsGroup.appendChild(zoomOutBtn);
        controlsGroup.appendChild(zoomInBtn);
        controlsGroup.appendChild(fitBtn);

        toolbar.appendChild(searchGroup);
        toolbar.appendChild(controlsGroup);
        this.rootElement.appendChild(toolbar);

        this.syncToggleButtons();
    }

    private syncToggleButtons(): void {
        if (this.accordionBtn) {
            this.accordionBtn.classList.toggle("scw-btn-active", this.accordionMode);
        }
        if (this.autoFitBtn) {
            this.autoFitBtn.classList.toggle("scw-btn-active", this.autoFitOnToggle);
        }
        if (this.badgeToggleBtn) {
            this.badgeToggleBtn.classList.toggle("scw-btn-badge-active", this.showHealthBadges);
        }
        if (this.minimapToggleBtn) {
            this.minimapToggleBtn.classList.toggle("scw-btn-active", this.showMinimap);
        }
    }

    private createDivider(): HTMLElement {
        const div = document.createElement("span");
        div.className = "scw-divider";
        return div;
    }

    private createButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "scw-btn";
        btn.textContent = label;
        btn.title = title;
        btn.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation();
            onClick();
        });
        return btn;
    }

    private buildBreadcrumbBar(): void {
        this.breadcrumbBar = document.createElement("div");
        this.breadcrumbBar.className = "scw-breadcrumb-bar scw-hidden";
        this.rootElement.appendChild(this.breadcrumbBar);
    }

    private updateBreadcrumbBar(): void {
        while (this.breadcrumbBar.firstChild) {
            this.breadcrumbBar.removeChild(this.breadcrumbBar.firstChild);
        }

        const activeRoot = this.getActiveRoot();
        if (!activeRoot || !this.rootNode || activeRoot.id === this.rootNode.id) {
            this.breadcrumbBar.classList.add("scw-hidden");
            return;
        }

        this.breadcrumbBar.classList.remove("scw-hidden");

        // Build ancestor chain from global root down to activeRoot
        const chain: StaffNode[] = [];
        let curr: StaffNode | null = activeRoot;
        while (curr) {
            chain.unshift(curr);
            curr = curr.parent;
        }

        const homeCrumb = document.createElement("span");
        homeCrumb.className = "scw-crumb";
        homeCrumb.textContent = "🏠 Full Organisation";
        homeCrumb.title = "Return to full organisation root";
        homeCrumb.addEventListener("click", () => {
            this.focusOnNode(null);
        });
        this.breadcrumbBar.appendChild(homeCrumb);

        chain.forEach((node, idx) => {
            if (idx === 0 && node.id === this.rootNode?.id) {
                return;
            }
            const sep = document.createElement("span");
            sep.className = "scw-crumb-sep";
            sep.textContent = "›";
            this.breadcrumbBar.appendChild(sep);

            const crumb = document.createElement("span");
            const isLast = idx === chain.length - 1;
            crumb.className = isLast ? "scw-crumb scw-crumb-active" : "scw-crumb";
            crumb.textContent = `${node.name} (${node.totalReports})`;
            if (!isLast) {
                crumb.addEventListener("click", () => {
                    this.focusOnNode(node.id);
                });
            }
            this.breadcrumbBar.appendChild(crumb);
        });
    }

    private focusOnNode(nodeId: string | null): void {
        this.focusedNodeId = nodeId;
        const targetRoot = this.getActiveRoot();
        if (targetRoot) {
            targetRoot.expanded = true;
            // Expand direct children one level relative to focused node
            targetRoot.children.forEach((ch) => {
                ch.expanded = false;
            });
        }
        this.updateBreadcrumbBar();
        this.renderTree();
        this.fitToScreen();
    }

    private getActiveRoot(): StaffNode | null {
        if (this.focusedNodeId && this.allNodesMap.has(this.focusedNodeId)) {
            return this.allNodesMap.get(this.focusedNodeId)!;
        }
        return this.rootNode;
    }

    private buildCanvas(): void {
        this.svgElement = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
        this.svgElement.setAttribute("class", "scw-canvas-svg");

        this.viewportGroup = document.createElementNS(SVG_NS, "g") as SVGGElement;
        this.linksGroup = document.createElementNS(SVG_NS, "g") as SVGGElement;
        this.nodesGroup = document.createElementNS(SVG_NS, "g") as SVGGElement;

        this.viewportGroup.appendChild(this.linksGroup);
        this.viewportGroup.appendChild(this.nodesGroup);
        this.svgElement.appendChild(this.viewportGroup);
        this.rootElement.appendChild(this.svgElement);

        // Mouse pan events
        this.svgElement.addEventListener("mousedown", (e: MouseEvent) => {
            if (e.button !== 0) return;
            this.isDragging = true;
            this.dragStartX = e.clientX - this.panX;
            this.dragStartY = e.clientY - this.panY;
        });

        window.addEventListener("mousemove", (e: MouseEvent) => {
            if (!this.isDragging) return;
            this.panX = e.clientX - this.dragStartX;
            this.panY = e.clientY - this.dragStartY;
            this.applyTransform();
        });

        window.addEventListener("mouseup", () => {
            this.isDragging = false;
        });

        // Click background to clear Power BI selection
        this.svgElement.addEventListener("click", (e: MouseEvent) => {
            if (e.target === this.svgElement) {
                this.selectedNodeId = null;
                this.selectionManager.clear();
                this.renderTree();
            }
        });

        // Mouse wheel zoom centered on cursor
        this.svgElement.addEventListener(
            "wheel",
            (e: WheelEvent) => {
                e.preventDefault();
                const factor = e.deltaY < 0 ? 1.14 : 0.88;
                const rect = this.svgElement.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;

                const nextScale = Math.min(2.4, Math.max(0.05, this.scale * factor));
                const prevScale = this.scale;
                this.panX = mouseX - ((mouseX - this.panX) / prevScale) * nextScale;
                this.panY = mouseY - ((mouseY - this.panY) / prevScale) * nextScale;

                const crossedLod =
                    (prevScale < 0.48 && nextScale >= 0.48) ||
                    (prevScale >= 0.48 && nextScale < 0.48);
                this.scale = nextScale;
                if (crossedLod) {
                    this.renderTree();
                } else {
                    this.applyTransform();
                }
            },
            { passive: false }
        );
    }

    private buildMinimap(): void {
        this.minimapContainer = document.createElement("div");
        this.minimapContainer.className = "scw-minimap-container";
        this.minimapSvg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
        this.minimapSvg.setAttribute("class", "scw-minimap-svg");
        this.minimapContainer.appendChild(this.minimapSvg);
        this.rootElement.appendChild(this.minimapContainer);

        const panFromMinimap = (e: MouseEvent) => {
            const rect = this.minimapContainer.getBoundingClientRect();
            const relX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            const relY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
            const targetTreeX = this.treeMinX + relX * (this.treeMaxX - this.treeMinX);
            const targetTreeY = this.treeMinY + relY * (this.treeMaxY - this.treeMinY);

            const mainRect = this.svgElement.getBoundingClientRect();
            this.panX = mainRect.width / 2 - targetTreeX * this.scale;
            this.panY = mainRect.height / 2 - targetTreeY * this.scale;
            this.applyTransform();
        };

        let miniDrag = false;
        this.minimapContainer.addEventListener("mousedown", (e: MouseEvent) => {
            e.stopPropagation();
            miniDrag = true;
            panFromMinimap(e);
        });
        window.addEventListener("mousemove", (e: MouseEvent) => {
            if (!miniDrag) return;
            panFromMinimap(e);
        });
        window.addEventListener("mouseup", () => {
            miniDrag = false;
        });
    }

    private buildStatusBar(): void {
        const statusBar = document.createElement("div");
        statusBar.className = "scw-status-bar";

        this.statusLeftPill = document.createElement("div");
        this.statusLeftPill.className = "scw-status-pill";
        this.statusLeftPill.textContent = "Ready";

        this.statusRightPill = document.createElement("div");
        this.statusRightPill.className = "scw-status-pill";
        this.statusRightPill.textContent =
            "Tip: Double-click or click 🎯 on any manager to focus their branch · Scroll to zoom";

        statusBar.appendChild(this.statusLeftPill);
        statusBar.appendChild(this.statusRightPill);
        this.rootElement.appendChild(statusBar);
    }

    public update(options: VisualUpdateOptions): void {
        const dataView: DataView | undefined = options.dataViews?.[0];
        if (!dataView || !dataView.table || !dataView.table.rows) {
            return;
        }

        this.parseFormatSettings(dataView);

        const table: DataViewTable = dataView.table;
        const columns = table.columns;

        let empIdx = -1;
        let mgrIdx = -1;
        let nameIdx = -1;
        const extraCols: { index: number; displayName: string }[] = [];

        columns.forEach((col, i) => {
            if (col.roles?.["employeeId"]) {
                empIdx = i;
            } else if (col.roles?.["managerId"]) {
                mgrIdx = i;
            } else if (col.roles?.["name"]) {
                nameIdx = i;
            } else if (col.roles?.["Extra"]) {
                extraCols.push({ index: i, displayName: col.displayName || `Field ${i}` });
            }
        });

        if (empIdx === -1) {
            empIdx = 0;
        }
        if (mgrIdx === -1 && columns.length > 1) {
            mgrIdx = 1;
        }
        if (nameIdx === -1 && columns.length > 2) {
            nameIdx = 2;
        }

        const prevExpandedIds = new Set<string>();
        this.allNodesMap.forEach((node, id) => {
            if (node.expanded) {
                prevExpandedIds.add(id);
            }
        });

        this.allNodesMap.clear();

        table.rows.forEach((row, rowIndex) => {
            const rawId = row[empIdx];
            if (rawId === null || rawId === undefined || String(rawId).trim() === "") {
                return;
            }
            const id = String(rawId).trim();
            const rawMgr =
                mgrIdx >= 0 && row[mgrIdx] !== null && row[mgrIdx] !== undefined
                    ? String(row[mgrIdx]).trim()
                    : null;
            const fullName =
                nameIdx >= 0 && row[nameIdx] !== null && row[nameIdx] !== undefined
                    ? String(row[nameIdx]).trim()
                    : `Staff #${id}`;

            const extras: { label: string; value: string }[] = [];
            let statusValue = "Direct";
            let level3Val = "";
            let level6Val = "";

            extraCols.forEach((ec) => {
                const cellVal = row[ec.index];
                if (cellVal !== null && cellVal !== undefined && String(cellVal).trim() !== "") {
                    const strVal = String(cellVal).trim();
                    const lowerName = ec.displayName.toLowerCase();
                    if (
                        lowerName.includes("status") ||
                        strVal.startsWith("Bridged") ||
                        strVal.startsWith("Fallback") ||
                        strVal === "Direct" ||
                        strVal === "Manual Override"
                    ) {
                        statusValue = strVal;
                    } else {
                        if (lowerName.includes("level3") || lowerName.includes("directorate")) {
                            level3Val = strVal;
                        } else if (lowerName.includes("level6") || lowerName.includes("service")) {
                            level6Val = strVal;
                        }
                        extras.push({ label: ec.displayName, value: strVal });
                    }
                }
            });

            if (!level3Val && extras.length > 0) {
                level3Val = extras[0].value;
            }
            if (!level6Val && extras.length > 1) {
                level6Val = extras[1].value;
            }

            const selectionId = this.host
                .createSelectionIdBuilder()
                .withTable(table, rowIndex)
                .createSelectionId();

            if (!this.allNodesMap.has(id)) {
                this.allNodesMap.set(id, {
                    id,
                    managerId: rawMgr === "" || rawMgr === id ? null : rawMgr,
                    rawManagerId: rawMgr,
                    name: fullName,
                    level3: level3Val,
                    level6: level6Val,
                    extras,
                    status: statusValue,
                    selectionId,
                    children: [],
                    parent: null,
                    depth: 0,
                    directReports: 0,
                    totalReports: 0,
                    expanded: prevExpandedIds.has(id),
                    x: 0,
                    y: 0,
                    subtreeWidth: 0,
                    subtreeHeight: 0,
                    isMatch: false,
                    isActiveMatch: false,
                });
            }
        });

        this.assembleSafeHierarchy();
        this.populateOrgQuickFilter();

        if (!this.hasInitializedExpansion) {
            this.hasInitializedExpansion = true;
            this.setExpansionToDepth(this.maxExpandedDepth, false);
            this.renderTree();
            this.fitToScreen();
        } else {
            if (this.searchInput.value.trim().length > 0) {
                this.runSearch(this.searchInput.value, false);
            } else {
                this.updateBreadcrumbBar();
                this.renderTree();
            }
        }
    }

    private parseFormatSettings(dataView: DataView): void {
        const objs = dataView.metadata?.objects;
        if (!objs) return;

        const layoutObj = objs["layoutSettings"];
        if (layoutObj) {
            if (typeof layoutObj["DefaultLayout"] === "string" && !this.hasInitializedExpansion) {
                this.layoutMode = layoutObj["DefaultLayout"] as LayoutMode;
                this.layoutSelect.value = this.layoutMode;
            }
            if (typeof layoutObj["DefaultDensity"] === "string" && !this.hasInitializedExpansion) {
                this.densityMode = layoutObj["DefaultDensity"] as DensityMode;
                this.densitySelect.value = this.densityMode;
            }
            if (typeof layoutObj["DefaultDepth"] === "number" && !this.hasInitializedExpansion) {
                this.maxExpandedDepth = Math.max(1, Math.min(10, layoutObj["DefaultDepth"] as number));
            }
            if (typeof layoutObj["AccordionMode"] === "boolean" && !this.hasInitializedExpansion) {
                this.accordionMode = layoutObj["AccordionMode"] as boolean;
            }
            if (typeof layoutObj["AutoFitOnToggle"] === "boolean" && !this.hasInitializedExpansion) {
                this.autoFitOnToggle = layoutObj["AutoFitOnToggle"] as boolean;
            }
            if (typeof layoutObj["ShowMinimap"] === "boolean" && !this.hasInitializedExpansion) {
                this.showMinimap = layoutObj["ShowMinimap"] as boolean;
            }
            this.syncToggleButtons();
        }

        const cardObj = objs["dataCard"];
        if (cardObj) {
            const bgFill = cardObj["NodeBackgroundColor"] as any;
            if (bgFill?.solid?.color) {
                this.customCardBg = bgFill.solid.color;
            }
            if (typeof cardObj["FontSizeScale"] === "number") {
                this.fontScalePct = Math.max(60, Math.min(150, cardObj["FontSizeScale"] as number));
            }
            if (typeof cardObj["CardSizeScale"] === "number") {
                this.cardScalePct = Math.max(55, Math.min(150, cardObj["CardSizeScale"] as number));
            }
            if (typeof cardObj["MaxColumnsWrap"] === "number") {
                this.maxColumnsWrap = Math.max(2, Math.min(14, cardObj["MaxColumnsWrap"] as number));
            }
            if (typeof cardObj["ShowID"] === "boolean") {
                this.showPersonId = cardObj["ShowID"] as boolean;
            }
        }

        const searchObj = objs["SearchSettings"];
        if (searchObj) {
            const hlFill = searchObj["SearchHighlightColor"] as any;
            if (hlFill?.solid?.color) {
                this.searchHighlightColor = hlFill.solid.color;
            }
        }
    }

    public enumerateObjectInstances(
        options: EnumerateVisualObjectInstancesOptions
    ): VisualObjectInstanceEnumeration {
        const instances: VisualObjectInstance[] = [];
        switch (options.objectName) {
            case "layoutSettings":
                instances.push({
                    objectName: "layoutSettings",
                    selector: null as any,
                    properties: {
                        DefaultLayout: this.layoutMode,
                        DefaultDensity: this.densityMode,
                        DefaultDepth: this.maxExpandedDepth,
                        AccordionMode: this.accordionMode,
                        AutoFitOnToggle: this.autoFitOnToggle,
                        ShowMinimap: this.showMinimap,
                    },
                });
                break;
            case "dataCard":
                instances.push({
                    objectName: "dataCard",
                    selector: null as any,
                    properties: {
                        NodeBackgroundColor: { solid: { color: this.customCardBg } },
                        FontSizeScale: this.fontScalePct,
                        CardSizeScale: this.cardScalePct,
                        MaxColumnsWrap: this.maxColumnsWrap,
                        ShowID: this.showPersonId,
                    },
                });
                break;
            case "SearchSettings":
                instances.push({
                    objectName: "SearchSettings",
                    selector: null as any,
                    properties: {
                        SearchHighlightColor: { solid: { color: this.searchHighlightColor } },
                    },
                });
                break;
        }
        return instances;
    }

    private populateOrgQuickFilter(): void {
        const prevVal = this.orgFilterSelect.value;
        while (this.orgFilterSelect.firstChild) {
            this.orgFilterSelect.removeChild(this.orgFilterSelect.firstChild);
        }

        const defaultOpt = document.createElement("option");
        defaultOpt.value = "";
        defaultOpt.textContent = "Filter Directorate / Service Line...";
        this.orgFilterSelect.appendChild(defaultOpt);

        const l3Set = new Set<string>();
        const l6Set = new Set<string>();

        this.allNodesMap.forEach((n) => {
            if (n.level3) l3Set.add(n.level3);
            if (n.level6) l6Set.add(n.level6);
        });

        if (l3Set.size > 0) {
            const grp3 = document.createElement("optgroup");
            grp3.label = "Directorate (Level 3)";
            Array.from(l3Set)
                .sort()
                .forEach((val) => {
                    const o = document.createElement("option");
                    o.value = `L3:${val}`;
                    o.textContent = val;
                    grp3.appendChild(o);
                });
            this.orgFilterSelect.appendChild(grp3);
        }

        if (l6Set.size > 0) {
            const grp6 = document.createElement("optgroup");
            grp6.label = "Service Line (Level 6)";
            Array.from(l6Set)
                .sort()
                .forEach((val) => {
                    const o = document.createElement("option");
                    o.value = `L6:${val}`;
                    o.textContent = val;
                    grp6.appendChild(o);
                });
            this.orgFilterSelect.appendChild(grp6);
        }

        if (prevVal) {
            this.orgFilterSelect.value = prevVal;
        }
    }

    private applyOrgQuickFilter(filterVal: string): void {
        if (!filterVal) {
            this.focusOnNode(null);
            this.searchInput.value = "";
            this.runSearch("");
            return;
        }

        const isL3 = filterVal.startsWith("L3:");
        const targetOrg = filterVal.slice(3);

        // Find all nodes belonging to this Directorate / Service Line
        const members: StaffNode[] = [];
        this.allNodesMap.forEach((node) => {
            const val = isL3 ? node.level3 : node.level6;
            if (val === targetOrg) {
                members.push(node);
            }
        });

        if (members.length === 0) return;

        // Sort by depth ascending and totalReports descending to find the lead of this Directorate / Service Line
        members.sort((a, b) => {
            if (a.depth !== b.depth) return a.depth - b.depth;
            return b.totalReports - a.totalReports;
        });

        const topLead = members[0];
        // Check if topLead is an ancestor of most members (>= 50%); if so, focus on topLead!
        const memberIds = new Set(members.map((m) => m.id));
        let coveredByTopLead = 0;
        members.forEach((m) => {
            let curr: StaffNode | null = m;
            while (curr) {
                if (curr.id === topLead.id) {
                    coveredByTopLead++;
                    break;
                }
                curr = curr.parent;
            }
        });

        if (topLead.directReports > 0 && coveredByTopLead >= Math.max(1, members.length * 0.45)) {
            this.focusedNodeId = topLead.id;
            // Collapse everything first, then expand paths to members under topLead
            this.allNodesMap.forEach((n) => {
                n.expanded = false;
                n.isMatch = memberIds.has(n.id);
                n.isActiveMatch = n.id === topLead.id;
            });
            topLead.expanded = true;
            members.forEach((m) => {
                let p = m.parent;
                while (p && p.id !== topLead.parent?.id) {
                    p.expanded = true;
                    p = p.parent;
                }
            });
            this.matchedNodes = members;
            this.activeMatchIndex = 0;
            this.matchCountLabel.textContent = `${members.length} staff`;
            this.updateBreadcrumbBar();
            this.renderTree();
            this.fitToScreen();
        } else {
            // Otherwise run search filter across full tree and fit
            this.focusedNodeId = null;
            this.allNodesMap.forEach((n) => {
                n.expanded = false;
                n.isMatch = false;
                n.isActiveMatch = false;
            });
            members.forEach((m) => {
                m.isMatch = true;
                let p = m.parent;
                while (p) {
                    p.expanded = true;
                    p = p.parent;
                }
            });
            this.matchedNodes = members;
            this.activeMatchIndex = 0;
            members[0].isActiveMatch = true;
            this.matchCountLabel.textContent = `${members.length} staff`;
            this.updateBreadcrumbBar();
            this.renderTree();
            this.fitToScreen();
        }
    }

    /**
     * Builds a guaranteed single-root, cycle-free hierarchy tree with defensive client-side
     * cycle breaking and orphan collection so no staff member is ever lost or scattered.
     */
    private assembleSafeHierarchy(): void {
        this.allNodesMap.forEach((node) => {
            node.children = [];
            node.parent = null;
        });

        let explicitRoot: StaffNode | null = null;
        if (this.allNodesMap.has("4037")) {
            explicitRoot = this.allNodesMap.get("4037")!;
        } else {
            this.allNodesMap.forEach((node) => {
                if (!explicitRoot && (!node.managerId || !this.allNodesMap.has(node.managerId))) {
                    explicitRoot = node;
                }
            });
        }

        if (!explicitRoot) {
            explicitRoot = {
                id: "ROOT",
                managerId: null,
                rawManagerId: null,
                name: "SCW CSU Organisation",
                level3: "",
                level6: "",
                extras: [],
                status: "Root",
                selectionId: null,
                children: [],
                parent: null,
                depth: 0,
                directReports: 0,
                totalReports: 0,
                expanded: true,
                x: 0,
                y: 0,
                subtreeWidth: 0,
                subtreeHeight: 0,
                isMatch: false,
                isActiveMatch: false,
            };
            this.allNodesMap.set("ROOT", explicitRoot);
        }

        this.allNodesMap.forEach((node) => {
            if (node === explicitRoot) {
                node.managerId = null;
                return;
            }
            const visited = new Set<string>([node.id]);
            let currMgrId = node.managerId;
            let hasCycle = false;

            while (currMgrId && this.allNodesMap.has(currMgrId)) {
                if (visited.has(currMgrId)) {
                    hasCycle = true;
                    break;
                }
                visited.add(currMgrId);
                const mgrNode = this.allNodesMap.get(currMgrId)!;
                if (mgrNode === explicitRoot) {
                    break;
                }
                currMgrId = mgrNode.managerId;
            }

            if (hasCycle || !node.managerId || !this.allNodesMap.has(node.managerId)) {
                node.parent = explicitRoot!;
                explicitRoot!.children.push(node);
                if (hasCycle) {
                    node.status = "Cycle Broken -> Root";
                } else if (node.status === "Direct") {
                    node.status = "Fallback: Executive Root";
                }
            } else {
                const parentNode = this.allNodesMap.get(node.managerId)!;
                node.parent = parentNode;
                parentNode.children.push(node);
            }
        });

        this.rootNode = explicitRoot;
        this.computeMetricsRecursive(this.rootNode, 0);

        let bridgedOrFallback = 0;
        this.allNodesMap.forEach((n) => {
            if (n.status !== "Direct" && n.status !== "Root") {
                bridgedOrFallback++;
            }
        });
        this.statusLeftPill.textContent =
            bridgedOrFallback > 0
                ? `Total Active Staff: ${this.allNodesMap.size} · Auto-Healed Links: ${bridgedOrFallback}`
                : `Total Active Staff: ${this.allNodesMap.size} · 100% Connected Tree`;
    }

    private computeMetricsRecursive(node: StaffNode, depth: number): number {
        node.depth = depth;
        node.directReports = node.children.length;
        node.children.sort((a, b) => {
            if (b.children.length !== a.children.length) {
                return b.children.length - a.children.length;
            }
            return a.name.localeCompare(b.name);
        });
        let total = 0;
        for (const ch of node.children) {
            total += 1 + this.computeMetricsRecursive(ch, depth + 1);
        }
        node.totalReports = total;
        return total;
    }

    private setExpansionToDepth(targetDepth: number, rerender: boolean = true): void {
        this.maxExpandedDepth = targetDepth;
        const activeRoot = this.getActiveRoot();
        const baseDepth = activeRoot ? activeRoot.depth : 0;

        this.allNodesMap.forEach((node) => {
            node.expanded = node.depth >= baseDepth && node.depth - baseDepth < targetDepth;
        });
        if (rerender) {
            this.renderTree();
        }
    }

    private runSearch(query: string, centerFirst: boolean = true): void {
        const q = query.trim().toLowerCase();
        this.matchedNodes = [];
        this.activeMatchIndex = -1;

        this.allNodesMap.forEach((node) => {
            node.isMatch = false;
            node.isActiveMatch = false;
        });

        if (!q) {
            this.matchCountLabel.textContent = "";
            this.renderTree();
            return;
        }

        const activeRoot = this.getActiveRoot();

        this.allNodesMap.forEach((node) => {
            const hay = [
                node.name,
                node.id,
                node.status,
                node.level3,
                node.level6,
                ...node.extras.map((e) => e.value),
            ]
                .join(" ")
                .toLowerCase();
            if (hay.includes(q)) {
                node.isMatch = true;
                this.matchedNodes.push(node);
                // Expand all ancestors so this matched node is visible in the layout
                let p = node.parent;
                while (p) {
                    p.expanded = true;
                    if (activeRoot && p.id === activeRoot.id) break;
                    p = p.parent;
                }
            }
        });

        if (this.matchedNodes.length > 0) {
            this.activeMatchIndex = 0;
            this.matchedNodes[0].isActiveMatch = true;
            this.matchCountLabel.textContent = `1 / ${this.matchedNodes.length}`;
            this.renderTree();
            if (centerFirst) {
                this.centerOnNode(this.matchedNodes[0]);
            }
        } else {
            this.matchCountLabel.textContent = "0 matches";
            this.renderTree();
        }
    }

    private stepSearchMatch(delta: number): void {
        if (this.matchedNodes.length === 0) return;
        if (this.activeMatchIndex >= 0 && this.activeMatchIndex < this.matchedNodes.length) {
            this.matchedNodes[this.activeMatchIndex].isActiveMatch = false;
        }
        this.activeMatchIndex =
            (this.activeMatchIndex + delta + this.matchedNodes.length) % this.matchedNodes.length;
        const target = this.matchedNodes[this.activeMatchIndex];
        target.isActiveMatch = true;
        this.matchCountLabel.textContent = `${this.activeMatchIndex + 1} / ${this.matchedNodes.length}`;

        let p = target.parent;
        while (p) {
            p.expanded = true;
            p = p.parent;
        }
        this.renderTree();
        this.centerOnNode(target);
    }

    // =========================================================================
    // MULTI-MODE LAYOUT ENGINE (Compact Hybrid Grid / Horizontal / Classic)
    // =========================================================================

    private computeLayout(node: StaffNode, m: DensityMetrics): void {
        if (this.layoutMode === "horizontal") {
            this.computeHorizontalLayout(node, m);
        } else if (this.layoutMode === "compact") {
            this.computeCompactHybridLayout(node, m);
        } else {
            this.computeClassicLayout(node, m);
        }
    }

    private assignCoordinates(
        node: StaffNode,
        leftX: number,
        topY: number,
        m: DensityMetrics
    ): void {
        if (this.layoutMode === "horizontal") {
            this.assignHorizontalCoordinates(node, leftX, topY, m);
        } else if (this.layoutMode === "compact") {
            this.assignCompactHybridCoordinates(node, leftX, topY, m);
        } else {
            this.assignClassicCoordinates(node, leftX, topY, m);
        }
    }

    /**
     * COMPACT HYBRID LAYOUT:
     * 1. Leaf children (directReports === 0) are arranged in a tight 2-column vertical block
     *    directly underneath their parent manager.
     * 2. Sub-manager children (directReports > 0) are wrapped into rows of at most `maxColumnsWrap`
     *    columns so wide departments never create a 20,000px horizontal ribbon.
     */
    private computeCompactHybridLayout(node: StaffNode, m: DensityMetrics): void {
        if (!node.expanded || node.children.length === 0) {
            node.subtreeWidth = m.cardW;
            node.subtreeHeight = m.cardH;
            return;
        }

        const managers = node.children.filter((c) => c.children.length > 0);
        const leaves = node.children.filter((c) => c.children.length === 0);

        // Compute leaf grid block dimensions (2 columns if >= 2 leaves)
        let leafBlockW = 0;
        let leafBlockH = 0;
        if (leaves.length > 0) {
            leaves.forEach((l) => {
                l.subtreeWidth = m.cardW;
                l.subtreeHeight = m.cardH;
            });
            const leafCols = leaves.length >= 2 ? 2 : 1;
            const leafRows = Math.ceil(leaves.length / leafCols);
            leafBlockW = leafCols * m.cardW + (leafCols - 1) * m.hGap;
            leafBlockH = leafRows * m.cardH + (leafRows - 1) * Math.max(8, Math.round(m.hGap * 0.8));
        }

        // Compute sub-managers wrapped into rows of maxColumnsWrap
        let mgrBlockW = 0;
        let mgrBlockH = 0;
        if (managers.length > 0) {
            managers.forEach((mgr) => this.computeCompactHybridLayout(mgr, m));
            const wrapCols = Math.max(2, this.maxColumnsWrap);
            for (let i = 0; i < managers.length; i += wrapCols) {
                const rowSlice = managers.slice(i, i + wrapCols);
                let rowW = 0;
                let rowH = 0;
                rowSlice.forEach((ch, idx) => {
                    if (idx > 0) rowW += m.hGap;
                    rowW += ch.subtreeWidth;
                    rowH = Math.max(rowH, ch.subtreeHeight);
                });
                mgrBlockW = Math.max(mgrBlockW, rowW);
                if (i > 0) mgrBlockH += m.vGap;
                mgrBlockH += rowH;
            }
        }

        const combinedChildrenW = Math.max(leafBlockW, mgrBlockW);
        let combinedChildrenH = 0;
        if (leafBlockH > 0 && mgrBlockH > 0) {
            combinedChildrenH = leafBlockH + Math.round(m.vGap * 0.75) + mgrBlockH;
        } else {
            combinedChildrenH = leafBlockH + mgrBlockH;
        }

        node.subtreeWidth = Math.max(m.cardW, combinedChildrenW);
        node.subtreeHeight = m.cardH + m.vGap + combinedChildrenH;
    }

    private assignCompactHybridCoordinates(
        node: StaffNode,
        leftX: number,
        topY: number,
        m: DensityMetrics
    ): void {
        node.x = leftX + node.subtreeWidth / 2 - m.cardW / 2;
        node.y = topY;

        if (!node.expanded || node.children.length === 0) return;

        const managers = node.children.filter((c) => c.children.length > 0);
        const leaves = node.children.filter((c) => c.children.length === 0);

        let currentY = topY + m.cardH + m.vGap;

        // 1. Place leaf staff in a compact 2-column vertical sub-grid right below the manager
        if (leaves.length > 0) {
            const leafCols = leaves.length >= 2 ? 2 : 1;
            const leafRows = Math.ceil(leaves.length / leafCols);
            const vLeafGap = Math.max(8, Math.round(m.hGap * 0.8));
            const leafBlockW = leafCols * m.cardW + (leafCols - 1) * m.hGap;
            const startLeafX = leftX + (node.subtreeWidth - leafBlockW) / 2;

            leaves.forEach((leaf, idx) => {
                const col = idx % leafCols;
                const row = Math.floor(idx / leafCols);
                leaf.x = startLeafX + col * (m.cardW + m.hGap);
                leaf.y = currentY + row * (m.cardH + vLeafGap);
            });

            currentY += leafRows * m.cardH + (leafRows - 1) * vLeafGap;
            if (managers.length > 0) {
                currentY += Math.round(m.vGap * 0.75);
            }
        }

        // 2. Place sub-managers in wrapped rows of up to maxColumnsWrap columns
        if (managers.length > 0) {
            const wrapCols = Math.max(2, this.maxColumnsWrap);
            for (let i = 0; i < managers.length; i += wrapCols) {
                const rowSlice = managers.slice(i, i + wrapCols);
                let rowW = 0;
                let rowH = 0;
                rowSlice.forEach((ch, idx) => {
                    if (idx > 0) rowW += m.hGap;
                    rowW += ch.subtreeWidth;
                    rowH = Math.max(rowH, ch.subtreeHeight);
                });

                let currX = leftX + (node.subtreeWidth - rowW) / 2;
                rowSlice.forEach((ch) => {
                    this.assignCompactHybridCoordinates(ch, currX, currentY, m);
                    currX += ch.subtreeWidth + m.hGap;
                });

                currentY += rowH + m.vGap;
            }
        }
    }

    /**
     * HORIZONTAL (LEFT-TO-RIGHT) LAYOUT:
     * Hierarchy flows left-to-right; siblings stack vertically.
     */
    private computeHorizontalLayout(node: StaffNode, m: DensityMetrics): void {
        if (!node.expanded || node.children.length === 0) {
            node.subtreeWidth = m.cardW;
            node.subtreeHeight = m.cardH;
            return;
        }
        let totalH = 0;
        let maxChildW = 0;
        const vSiblingGap = Math.max(8, Math.round(m.hGap * 0.85));
        node.children.forEach((ch, idx) => {
            this.computeHorizontalLayout(ch, m);
            if (idx > 0) totalH += vSiblingGap;
            totalH += ch.subtreeHeight;
            maxChildW = Math.max(maxChildW, ch.subtreeWidth);
        });
        node.subtreeHeight = Math.max(m.cardH, totalH);
        node.subtreeWidth = m.cardW + m.vGap + maxChildW;
    }

    private assignHorizontalCoordinates(
        node: StaffNode,
        leftX: number,
        topY: number,
        m: DensityMetrics
    ): void {
        node.x = leftX;
        node.y = topY + node.subtreeHeight / 2 - m.cardH / 2;

        if (!node.expanded || node.children.length === 0) return;

        const vSiblingGap = Math.max(8, Math.round(m.hGap * 0.85));
        let childrenTotalH = 0;
        node.children.forEach((ch, idx) => {
            if (idx > 0) childrenTotalH += vSiblingGap;
            childrenTotalH += ch.subtreeHeight;
        });

        let currY = topY + (node.subtreeHeight - childrenTotalH) / 2;
        const nextX = leftX + m.cardW + m.vGap;

        node.children.forEach((ch) => {
            this.assignHorizontalCoordinates(ch, nextX, currY, m);
            currY += ch.subtreeHeight + vSiblingGap;
        });
    }

    /**
     * CLASSIC TOP-DOWN LAYOUT:
     */
    private computeClassicLayout(node: StaffNode, m: DensityMetrics): void {
        if (!node.expanded || node.children.length === 0) {
            node.subtreeWidth = m.cardW;
            node.subtreeHeight = m.cardH;
            return;
        }
        let totalW = 0;
        let maxChildH = 0;
        node.children.forEach((ch, idx) => {
            this.computeClassicLayout(ch, m);
            if (idx > 0) totalW += m.hGap;
            totalW += ch.subtreeWidth;
            maxChildH = Math.max(maxChildH, ch.subtreeHeight);
        });
        node.subtreeWidth = Math.max(m.cardW, totalW);
        node.subtreeHeight = m.cardH + m.vGap + maxChildH;
    }

    private assignClassicCoordinates(
        node: StaffNode,
        leftX: number,
        topY: number,
        m: DensityMetrics
    ): void {
        node.x = leftX + node.subtreeWidth / 2 - m.cardW / 2;
        node.y = topY;

        if (!node.expanded || node.children.length === 0) return;

        let childrenTotalW = 0;
        node.children.forEach((ch, idx) => {
            if (idx > 0) childrenTotalW += m.hGap;
            childrenTotalW += ch.subtreeWidth;
        });

        let currX = leftX + (node.subtreeWidth - childrenTotalW) / 2;
        const nextY = topY + m.cardH + m.vGap;

        node.children.forEach((ch) => {
            this.assignClassicCoordinates(ch, currX, nextY, m);
            currX += ch.subtreeWidth + m.hGap;
        });
    }

    // =========================================================================
    // RENDERING & SEMANTIC ZOOM (AUTO-LOD)
    // =========================================================================

    private renderTree(): void {
        while (this.linksGroup.firstChild) {
            this.linksGroup.removeChild(this.linksGroup.firstChild);
        }
        while (this.nodesGroup.firstChild) {
            this.nodesGroup.removeChild(this.nodesGroup.firstChild);
        }

        const activeRoot = this.getActiveRoot();
        if (!activeRoot) return;

        const m = this.getMetrics();
        this.computeLayout(activeRoot, m);
        this.assignCoordinates(activeRoot, 0, 0, m);

        const visibleNodes: StaffNode[] = [];
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;

        const collectVisible = (n: StaffNode) => {
            visibleNodes.push(n);
            minX = Math.min(minX, n.x);
            maxX = Math.max(maxX, n.x + m.cardW);
            minY = Math.min(minY, n.y);
            maxY = Math.max(maxY, n.y + m.cardH);
            if (n.expanded) {
                n.children.forEach(collectVisible);
            }
        };
        collectVisible(activeRoot);

        this.lastVisibleNodes = visibleNodes;
        this.treeMinX = isFinite(minX) ? minX : 0;
        this.treeMaxX = isFinite(maxX) ? maxX : m.cardW;
        this.treeMinY = isFinite(minY) ? minY : 0;
        this.treeMaxY = isFinite(maxY) ? maxY : m.cardH;

        // Draw connectors
        visibleNodes.forEach((n) => {
            if (!n.expanded || n.children.length === 0) return;

            if (this.layoutMode === "horizontal") {
                const startX = n.x + m.cardW;
                const startY = n.y + m.cardH / 2;
                n.children.forEach((ch) => {
                    const endX = ch.x;
                    const endY = ch.y + m.cardH / 2;
                    const midX = (startX + endX) / 2;
                    const path = document.createElementNS(SVG_NS, "path");
                    path.setAttribute(
                        "d",
                        `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`
                    );
                    path.setAttribute(
                        "class",
                        ch.isMatch || ch.isActiveMatch ? "scw-link scw-link-highlighted" : "scw-link"
                    );
                    this.linksGroup.appendChild(path);
                });
            } else {
                const startX = n.x + m.cardW / 2;
                const startY = n.y + m.cardH;
                const elbowY = startY + Math.round(m.vGap * 0.45);
                n.children.forEach((ch) => {
                    const endX = ch.x + m.cardW / 2;
                    const endY = ch.y;
                    const path = document.createElementNS(SVG_NS, "path");
                    // Orthogonal rounded step connector for clean multi-row / grid clarity
                    const d = `M ${startX} ${startY} L ${startX} ${elbowY} L ${endX} ${elbowY} L ${endX} ${endY}`;
                    path.setAttribute("d", d);
                    path.setAttribute(
                        "class",
                        ch.isMatch || ch.isActiveMatch ? "scw-link scw-link-highlighted" : "scw-link"
                    );
                    this.linksGroup.appendChild(path);
                });
            }
        });

        // Draw Node Cards
        const hasAnySearch = this.matchedNodes.length > 0;
        const isSemanticZoomOut = this.scale < 0.48;
        visibleNodes.forEach((node) => {
            const g = this.renderNodeCard(node, m, hasAnySearch, isSemanticZoomOut);
            this.nodesGroup.appendChild(g);
        });

        this.applyTransform();
    }

    private renderNodeCard(
        node: StaffNode,
        m: DensityMetrics,
        hasAnySearch: boolean,
        isSemanticZoomOut: boolean
    ): SVGGElement {
        const g = document.createElementNS(SVG_NS, "g") as SVGGElement;
        g.setAttribute("class", "scw-node-group");
        g.setAttribute("transform", `translate(${node.x}, ${node.y})`);

        const isSelected = this.selectedNodeId === node.id;
        const isDimmed = hasAnySearch && !node.isMatch;
        if (isDimmed) {
            g.setAttribute("opacity", "0.38");
        }

        // Native SVG Tooltip (<title>) with complete details regardless of card size
        const titleEl = document.createElementNS(SVG_NS, "title");
        const extraTooltip = node.extras.map((e) => `${e.label}: ${e.value}`).join("\n");
        titleEl.textContent = [
            `${node.name} (#${node.id})`,
            extraTooltip,
            `Direct Reports: ${node.directReports} | Total Subtree: ${node.totalReports}`,
            `Hierarchy Status: ${node.status}`,
            node.directReports > 0 ? "Double-click or click 🎯 to focus this branch" : "",
        ]
            .filter(Boolean)
            .join("\n");
        g.appendChild(titleEl);

        // Card background
        const rect = document.createElementNS(SVG_NS, "rect");
        rect.setAttribute("width", String(m.cardW));
        rect.setAttribute("height", String(m.cardH));
        rect.setAttribute("rx", "6");
        rect.setAttribute("ry", "6");
        rect.setAttribute(
            "fill",
            node.isActiveMatch
                ? "#fff5f5"
                : isSelected
                ? "#eff6ff"
                : this.customCardBg || "#ffffff"
        );

        let strokeColor = "#cbd5e1";
        let strokeWidth = "1.25";
        if (node.isActiveMatch) {
            strokeColor = this.searchHighlightColor || "#da291c";
            strokeWidth = "3";
        } else if (node.isMatch) {
            strokeColor = "#ed8b00";
            strokeWidth = "2.5";
        } else if (isSelected) {
            strokeColor = "#005eb8";
            strokeWidth = "2.5";
        }
        rect.setAttribute("stroke", strokeColor);
        rect.setAttribute("stroke-width", strokeWidth);
        g.appendChild(rect);

        // Top NHS Accent Strip
        const isNonStandard = node.status !== "Direct" && node.status !== "Root";
        const headerColor =
            node.depth <= 1
                ? "#003087"
                : node.isActiveMatch
                ? this.searchHighlightColor || "#da291c"
                : this.showHealthBadges && isNonStandard
                ? "#ed8b00"
                : "#005eb8";

        const topBar = document.createElementNS(SVG_NS, "rect");
        topBar.setAttribute("x", "0");
        topBar.setAttribute("y", "0");
        topBar.setAttribute("width", String(m.cardW));
        topBar.setAttribute("height", this.densityMode === "mini" ? "4" : "6");
        topBar.setAttribute("rx", "6");
        topBar.setAttribute("fill", headerColor);
        g.appendChild(topBar);

        const maxNameChars = Math.max(12, Math.floor((m.cardW - 30) / (m.nameFont * 0.56)));
        const maxSubChars = Math.max(14, Math.floor((m.cardW - 20) / (m.subFont * 0.54)));

        // SEMANTIC ZOOM (Auto-LOD when zoomed out < 48%) OR MINI DENSITY
        if (isSemanticZoomOut || this.densityMode === "mini") {
            const nameText = document.createElementNS(SVG_NS, "text");
            nameText.setAttribute("x", "8");
            nameText.setAttribute("y", String(Math.round(m.cardH * 0.48)));
            nameText.setAttribute("fill", "#0f172a");
            const lodFontSize = isSemanticZoomOut ? Math.max(12, m.nameFont * 1.2) : m.nameFont;
            nameText.setAttribute("font-size", `${lodFontSize}px`);
            nameText.setAttribute("font-weight", "700");
            nameText.textContent = this.truncate(
                this.showPersonId ? `${node.name} (#${node.id})` : node.name,
                isSemanticZoomOut ? Math.max(12, maxNameChars - 3) : maxNameChars
            );
            g.appendChild(nameText);

            if (!isSemanticZoomOut && node.level3) {
                const sub1 = document.createElementNS(SVG_NS, "text");
                sub1.setAttribute("x", "8");
                sub1.setAttribute("y", String(Math.round(m.cardH * 0.76)));
                sub1.setAttribute("fill", "#475569");
                sub1.setAttribute("font-size", `${m.subFont}px`);
                sub1.textContent = this.truncate(node.level3, maxSubChars);
                g.appendChild(sub1);
            }
        } else {
            // COMPACT OR DETAILED MODE
            const nameText = document.createElementNS(SVG_NS, "text");
            nameText.setAttribute("x", "10");
            nameText.setAttribute("y", this.densityMode === "compact" ? "21" : "25");
            nameText.setAttribute("fill", "#0f172a");
            nameText.setAttribute("font-size", `${m.nameFont}px`);
            nameText.setAttribute("font-weight", "700");
            nameText.textContent = this.truncate(
                this.showPersonId ? `${node.name} (#${node.id})` : node.name,
                maxNameChars
            );
            g.appendChild(nameText);

            // Subtitle 1 (Level 3 Directorate or Level 6)
            const line1Val =
                node.level3 || (node.extras.length > 0 ? node.extras[0].value : `ID: ${node.id}`);
            const sub1 = document.createElementNS(SVG_NS, "text");
            sub1.setAttribute("x", "10");
            sub1.setAttribute("y", this.densityMode === "compact" ? "36" : "43");
            sub1.setAttribute("fill", "#334155");
            sub1.setAttribute("font-size", `${m.subFont}px`);
            sub1.setAttribute("font-weight", "600");
            sub1.textContent = this.truncate(line1Val, maxSubChars);
            g.appendChild(sub1);

            // Subtitle 2 (Level 6 Service Line)
            const line2Val =
                node.level6 && node.level6 !== line1Val
                    ? node.level6
                    : node.extras.length > 1
                    ? node.extras[1].value
                    : "";
            if (line2Val) {
                const sub2 = document.createElementNS(SVG_NS, "text");
                sub2.setAttribute("x", "10");
                sub2.setAttribute("y", this.densityMode === "compact" ? "49" : "58");
                sub2.setAttribute("fill", "#64748b");
                sub2.setAttribute("font-size", `${Math.max(8, m.subFont - 0.5)}px`);
                sub2.textContent = this.truncate(line2Val, maxSubChars + 2);
                g.appendChild(sub2);
            }

            // Health Status Badge in Detailed mode (or Compact if no line2)
            if (
                this.showHealthBadges &&
                isNonStandard &&
                (this.densityMode === "detailed" || !line2Val)
            ) {
                const badgeText = document.createElementNS(SVG_NS, "text");
                badgeText.setAttribute("x", "10");
                badgeText.setAttribute("y", this.densityMode === "detailed" ? "74" : "50");
                badgeText.setAttribute("fill", "#b45309");
                badgeText.setAttribute("font-size", `${Math.max(8, m.subFont - 1)}px`);
                badgeText.setAttribute("font-weight", "700");
                badgeText.textContent = `⚡ ${this.truncate(node.status, maxSubChars)}`;
                g.appendChild(badgeText);
            }
        }

        // Focus / Pin Subtree Icon Button (🎯) in top-right of manager cards
        if (node.directReports > 0) {
            const focusG = document.createElementNS(SVG_NS, "g") as SVGGElement;
            const btnSize = this.densityMode === "mini" ? 14 : 18;
            const fx = m.cardW - btnSize - 4;
            const fy = 7;

            const focusBg = document.createElementNS(SVG_NS, "rect");
            focusBg.setAttribute("x", String(fx));
            focusBg.setAttribute("y", String(fy));
            focusBg.setAttribute("width", String(btnSize));
            focusBg.setAttribute("height", String(btnSize));
            focusBg.setAttribute("rx", "4");
            focusBg.setAttribute(
                "fill",
                this.focusedNodeId === node.id ? "#dbeafe" : "#f1f5f9"
            );
            focusBg.setAttribute("stroke", "#94a3b8");
            focusBg.setAttribute("stroke-width", "0.8");

            const focusLabel = document.createElementNS(SVG_NS, "text");
            focusLabel.setAttribute("x", String(fx + btnSize / 2));
            focusLabel.setAttribute("y", String(fy + btnSize * 0.74));
            focusLabel.setAttribute("text-anchor", "middle");
            focusLabel.setAttribute("font-size", this.densityMode === "mini" ? "8.5px" : "10px");
            focusLabel.textContent = "🎯";

            const focusTitle = document.createElementNS(SVG_NS, "title");
            focusTitle.textContent =
                this.focusedNodeId === node.id
                    ? "Unpin branch (Return to Full Organisation)"
                    : `Focus on ${node.name}'s branch (${node.totalReports} staff)`;
            focusG.appendChild(focusTitle);
            focusG.appendChild(focusBg);
            focusG.appendChild(focusLabel);

            focusG.addEventListener("click", (e: MouseEvent) => {
                e.stopPropagation();
                if (this.focusedNodeId === node.id) {
                    this.focusOnNode(null);
                } else {
                    this.focusOnNode(node.id);
                }
            });
            g.appendChild(focusG);
        }

        // Click card body -> cross-filter in Power BI
        g.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation();
            this.selectedNodeId = this.selectedNodeId === node.id ? null : node.id;
            if (node.selectionId) {
                this.selectionManager.select(node.selectionId, e.ctrlKey || e.metaKey);
            }
            this.renderTree();
        });

        // Double-click manager card -> focus/unfocus subtree
        g.addEventListener("dblclick", (e: MouseEvent) => {
            e.stopPropagation();
            if (node.directReports > 0) {
                this.focusOnNode(this.focusedNodeId === node.id ? null : node.id);
            }
        });

        // Expand/Collapse Pill at bottom of card if node has direct reports
        if (node.directReports > 0) {
            const pillG = document.createElementNS(SVG_NS, "g") as SVGGElement;
            const pillW = m.pillW;
            const pillH = m.pillH;
            const pillX = (m.cardW - pillW) / 2;
            const pillY = m.cardH - pillH / 2 - 1;

            const pillRect = document.createElementNS(SVG_NS, "rect");
            pillRect.setAttribute("x", String(pillX));
            pillRect.setAttribute("y", String(pillY));
            pillRect.setAttribute("width", String(pillW));
            pillRect.setAttribute("height", String(pillH));
            pillRect.setAttribute("rx", String(Math.round(pillH / 2)));
            pillRect.setAttribute("fill", node.expanded ? "#e2e8f0" : "#005eb8");
            pillRect.setAttribute("stroke", node.expanded ? "#94a3b8" : "#003087");
            pillRect.setAttribute("stroke-width", "1");

            const pillLabel = document.createElementNS(SVG_NS, "text");
            pillLabel.setAttribute("x", String(m.cardW / 2));
            pillLabel.setAttribute("y", String(pillY + pillH * 0.72));
            pillLabel.setAttribute("text-anchor", "middle");
            pillLabel.setAttribute("fill", node.expanded ? "#1e293b" : "#ffffff");
            pillLabel.setAttribute(
                "font-size",
                `${Math.max(8, Math.min(10, m.subFont - 0.5))}px`
            );
            pillLabel.setAttribute("font-weight", "700");
            pillLabel.textContent =
                this.densityMode === "mini"
                    ? node.expanded
                        ? `▼ ${node.directReports} (${node.totalReports})`
                        : `▶ +${node.directReports} (${node.totalReports})`
                    : node.expanded
                    ? `▼ ${node.directReports} direct · ${node.totalReports} all`
                    : `▶ +${node.directReports} (${node.totalReports} total)`;

            pillG.appendChild(pillRect);
            pillG.appendChild(pillLabel);

            pillG.addEventListener("click", (e: MouseEvent) => {
                e.stopPropagation();
                const willExpand = !node.expanded;
                // Accordion Mode: auto-collapse sibling managers when opening a branch
                if (willExpand && this.accordionMode && node.parent) {
                    node.parent.children.forEach((sib) => {
                        if (sib.id !== node.id) {
                            this.collapseSubtreeRecursive(sib);
                        }
                    });
                }
                node.expanded = willExpand;
                this.renderTree();
                if (this.autoFitOnToggle) {
                    this.fitToScreen();
                }
            });

            g.appendChild(pillG);
        }

        return g;
    }

    private collapseSubtreeRecursive(node: StaffNode): void {
        node.expanded = false;
        node.children.forEach((ch) => this.collapseSubtreeRecursive(ch));
    }

    private truncate(str: string, maxChars: number): string {
        if (!str) return "";
        return str.length > maxChars ? str.slice(0, maxChars - 1) + "…" : str;
    }

    private applyTransform(): void {
        this.viewportGroup.setAttribute(
            "transform",
            `translate(${this.panX.toFixed(1)}, ${this.panY.toFixed(1)}) scale(${this.scale.toFixed(4)})`
        );
        this.updateMinimap();
    }

    private updateMinimap(): void {
        if (!this.minimapContainer || !this.minimapSvg) return;
        if (!this.showMinimap || this.lastVisibleNodes.length <= 1) {
            this.minimapContainer.classList.add("scw-hidden");
            return;
        }
        this.minimapContainer.classList.remove("scw-hidden");

        while (this.minimapSvg.firstChild) {
            this.minimapSvg.removeChild(this.minimapSvg.firstChild);
        }

        const m = this.getMetrics();
        const pad = 40;
        const minX = this.treeMinX - pad;
        const maxX = this.treeMaxX + pad;
        const minY = this.treeMinY - pad;
        const maxY = this.treeMaxY + pad;
        const spanW = Math.max(200, maxX - minX);
        const spanH = Math.max(150, maxY - minY);

        this.minimapSvg.setAttribute("viewBox", `${minX} ${minY} ${spanW} ${spanH}`);
        this.minimapSvg.setAttribute("preserveAspectRatio", "xMidYMid meet");

        // Draw miniature rectangles for visible nodes
        this.lastVisibleNodes.forEach((n) => {
            const r = document.createElementNS(SVG_NS, "rect");
            r.setAttribute("x", String(n.x));
            r.setAttribute("y", String(n.y));
            r.setAttribute("width", String(m.cardW));
            r.setAttribute("height", String(m.cardH));
            r.setAttribute("rx", "4");
            r.setAttribute(
                "fill",
                n.isActiveMatch
                    ? "#da291c"
                    : n.isMatch
                    ? "#ed8b00"
                    : n.depth <= 1
                    ? "#003087"
                    : "#64748b"
            );
            this.minimapSvg.appendChild(r);
        });

        // Draw current viewport rectangle
        const svgRect = this.svgElement.getBoundingClientRect();
        const viewW = (svgRect.width || 1100) / this.scale;
        const viewH = (svgRect.height || 640) / this.scale;
        const viewX = -this.panX / this.scale;
        const viewY = -this.panY / this.scale;

        const vpRect = document.createElementNS(SVG_NS, "rect");
        vpRect.setAttribute("x", String(viewX));
        vpRect.setAttribute("y", String(viewY));
        vpRect.setAttribute("width", String(viewW));
        vpRect.setAttribute("height", String(viewH));
        vpRect.setAttribute("fill", "rgba(0, 94, 184, 0.12)");
        vpRect.setAttribute("stroke", "#005eb8");
        vpRect.setAttribute("stroke-width", String(Math.max(4, spanW * 0.012)));
        this.minimapSvg.appendChild(vpRect);
    }

    private zoomBy(factor: number): void {
        const rect = this.svgElement.getBoundingClientRect();
        const cx = rect.width / 2;
        const cy = rect.height / 2;
        const prevScale = this.scale;
        const nextScale = Math.min(2.4, Math.max(0.05, this.scale * factor));
        this.panX = cx - ((cx - this.panX) / prevScale) * nextScale;
        this.panY = cy - ((cy - this.panY) / prevScale) * nextScale;

        const crossedLod =
            (prevScale < 0.48 && nextScale >= 0.48) ||
            (prevScale >= 0.48 && nextScale < 0.48);
        this.scale = nextScale;
        if (crossedLod) {
            this.renderTree();
        } else {
            this.applyTransform();
        }
    }

    private centerOnNode(node: StaffNode): void {
        const rect = this.svgElement.getBoundingClientRect();
        const w = rect.width || 1100;
        const h = rect.height || 640;
        const m = this.getMetrics();
        const prevScale = this.scale;
        this.scale = Math.max(this.scale, 0.85);
        this.panX = w / 2 - (node.x + m.cardW / 2) * this.scale;
        this.panY = h / 2 - (node.y + m.cardH / 2) * this.scale;
        if (prevScale < 0.48 && this.scale >= 0.48) {
            this.renderTree();
        } else {
            this.applyTransform();
        }
    }

    private fitToScreen(): void {
        const activeRoot = this.getActiveRoot();
        if (!activeRoot) return;
        const rect = this.svgElement.getBoundingClientRect();
        const w = rect.width || 1100;
        const h = rect.height || 640;
        const m = this.getMetrics();

        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;

        const walk = (n: StaffNode) => {
            minX = Math.min(minX, n.x);
            maxX = Math.max(maxX, n.x + m.cardW);
            minY = Math.min(minY, n.y);
            maxY = Math.max(maxY, n.y + m.cardH);
            if (n.expanded) {
                n.children.forEach(walk);
            }
        };
        walk(activeRoot);

        const treeW = Math.max(m.cardW, maxX - minX);
        const treeH = Math.max(m.cardH, maxY - minY);
        const hasBreadcrumbs = !this.breadcrumbBar.classList.contains("scw-hidden");
        const padX = 36;
        const padTop = hasBreadcrumbs ? 92 : 62;
        const padBottom = 40;

        const availW = Math.max(200, w - padX * 2);
        const availH = Math.max(150, h - padTop - padBottom);

        const prevScale = this.scale;
        this.scale = Math.min(1.05, Math.max(0.06, Math.min(availW / treeW, availH / treeH)));
        this.panX = (w - treeW * this.scale) / 2 - minX * this.scale;
        this.panY = padTop + (availH - treeH * this.scale) / 2 - minY * this.scale;

        const crossedLod =
            (prevScale < 0.48 && this.scale >= 0.48) ||
            (prevScale >= 0.48 && this.scale < 0.48);
        if (crossedLod) {
            this.renderTree();
        } else {
            this.applyTransform();
        }
    }
}
