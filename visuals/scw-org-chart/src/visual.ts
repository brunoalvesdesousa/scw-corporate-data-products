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
type CardTheme = "navy" | "light";

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
    spineGap: number;
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
    private cardTheme: CardTheme = "navy";
    private accordionMode: boolean = true;
    private autoFitOnToggle: boolean = true;
    private showHealthBadges: boolean = true;
    private showMinimap: boolean = true;
    private hasInitializedExpansion: boolean = false;

    // Custom Format Pane & Toolbar scaling
    private cardScalePct: number = 100;
    private fontScalePct: number = 100;
    private maxColumnsWrap: number = 4;
    private customCardBg: string = "#1C355E";
    private searchHighlightColor: string = "#FF0000";
    private showPersonId: boolean = false;

    // Camera Pan & Zoom state
    private panX: number = 0;
    private panY: number = 0;
    private scale: number = 0.85;
    private isDragging: boolean = false;
    private dragStartX: number = 0;
    private dragStartY: number = 0;

    // Last computed tree bounds for minimap & SVG export
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
                cardW: 144,
                cardH: 46,
                hGap: 12,
                vGap: 28,
                spineGap: 22,
                nameFont: 10.5,
                subFont: 8.5,
                pillH: 15,
                pillW: 84,
            };
        } else if (this.densityMode === "detailed") {
            base = {
                cardW: 230,
                cardH: 98,
                hGap: 22,
                vGap: 52,
                spineGap: 32,
                nameFont: 13.5,
                subFont: 10.5,
                pillH: 20,
                pillW: 118,
            };
        } else {
            // "compact" default
            base = {
                cardW: 184,
                cardH: 68,
                hGap: 16,
                vGap: 38,
                spineGap: 26,
                nameFont: 12,
                subFont: 9.5,
                pillH: 17,
                pillW: 98,
            };
        }

        const cFactor = Math.max(0.55, Math.min(1.5, this.cardScalePct / 100));
        const fFactor = Math.max(0.65, Math.min(1.5, this.fontScalePct / 100));

        return {
            cardW: Math.round(base.cardW * cFactor),
            cardH: Math.round(base.cardH * cFactor),
            hGap: Math.max(8, Math.round(base.hGap * cFactor)),
            vGap: Math.max(20, Math.round(base.vGap * cFactor)),
            spineGap: Math.max(16, Math.round(base.spineGap * cFactor)),
            nameFont: +(base.nameFont * fFactor).toFixed(1),
            subFont: +(base.subFont * fFactor).toFixed(1),
            pillH: Math.max(13, Math.round(base.pillH * cFactor)),
            pillW: Math.min(Math.round(base.cardW * cFactor) - 12, Math.round(base.pillW * cFactor)),
        };
    }

    private buildToolbar(): void {
        const toolbar = document.createElement("div");
        toolbar.className = "scw-org-toolbar";

        // 1. Search bar + Quick Filter + Reset group
        const searchGroup = document.createElement("div");
        searchGroup.className = "scw-search-group";

        this.searchInput = document.createElement("input");
        this.searchInput.type = "search";
        this.searchInput.className = "scw-search-input";
        this.searchInput.placeholder = "Search staff name, Directorate, Service Line, ID...";
        this.searchInput.addEventListener("input", () => {
            this.runSearch(this.searchInput.value);
        });
        this.searchInput.addEventListener("keydown", (e: KeyboardEvent) => {
            if (e.key === "Enter") {
                this.stepSearchMatch(e.shiftKey ? -1 : 1);
            } else if (e.key === "Escape") {
                this.resetToDefaultState();
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

        // Prominent Reset Button (restores original initial L1 state, clears filters/search/focus, fits screen)
        const resetBtn = this.createButton(
            "↺ Reset",
            "Reset chart to initial default state (Root + Level 1 only), clear search/filters, and center",
            () => this.resetToDefaultState()
        );
        resetBtn.classList.add("scw-btn-reset");

        searchGroup.appendChild(this.searchInput);
        searchGroup.appendChild(this.matchCountLabel);
        searchGroup.appendChild(prevBtn);
        searchGroup.appendChild(nextBtn);
        searchGroup.appendChild(this.orgFilterSelect);
        searchGroup.appendChild(resetBtn);

        // 2. Streamlined Right Controls Group
        const controlsGroup = document.createElement("div");
        controlsGroup.className = "scw-btn-group";

        // Layout Mode Selector
        this.layoutSelect = document.createElement("select");
        this.layoutSelect.className = "scw-select";
        this.layoutSelect.title = "Switch Tree Layout Mode";
        [
            { value: "compact", label: "Layout: Dense Spine" },
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
            { value: "mini", label: "Size: Mini" },
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

        // Accordion Mode Toggle
        this.accordionBtn = this.createButton(
            "Accordion",
            "Accordion Mode: Expanding a manager automatically collapses sibling branches at the same level",
            () => {
                this.accordionMode = !this.accordionMode;
                this.syncToggleButtons();
            }
        );

        // Auto-Fit Mode Toggle
        this.autoFitBtn = this.createButton(
            "Auto-Fit",
            "Automatically fit chart to page whenever a node is expanded or collapsed",
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

        // Camera & Export controls
        const zoomOutBtn = this.createButton("－", "Zoom Out", () => this.zoomBy(0.8));
        const zoomInBtn = this.createButton("＋", "Zoom In", () => this.zoomBy(1.25));
        const fitBtn = this.createButton("Fit", "Fit visible chart to screen", () =>
            this.fitToScreen()
        );
        fitBtn.classList.add("scw-btn-primary");

        const exportBtn = this.createButton(
            "⬇ SVG",
            "Export current visible org chart view as a crisp SVG vector file",
            () => this.exportCurrentSvg()
        );

        controlsGroup.appendChild(this.layoutSelect);
        controlsGroup.appendChild(this.densitySelect);
        controlsGroup.appendChild(shrinkBoxBtn);
        controlsGroup.appendChild(growBoxBtn);
        controlsGroup.appendChild(this.createDivider());
        controlsGroup.appendChild(this.accordionBtn);
        controlsGroup.appendChild(this.autoFitBtn);
        controlsGroup.appendChild(this.badgeToggleBtn);
        controlsGroup.appendChild(this.minimapToggleBtn);
        controlsGroup.appendChild(this.createDivider());
        controlsGroup.appendChild(zoomOutBtn);
        controlsGroup.appendChild(zoomInBtn);
        controlsGroup.appendChild(fitBtn);
        controlsGroup.appendChild(exportBtn);

        toolbar.appendChild(searchGroup);
        toolbar.appendChild(controlsGroup);
        this.rootElement.appendChild(toolbar);

        this.syncToggleButtons();
    }

    /**
     * Resets the entire visual back to its exact original landing state:
     * - Clears search, Directorate/Service Line filter, and selection
     * - Unpins any focused subtree root
     * - Collapses all nodes except the top Root (so only Root + Level 1 direct reports show)
     * - Fits and centers the chart on screen
     */
    private resetToDefaultState(rerender: boolean = true): void {
        this.focusedNodeId = null;
        this.selectedNodeId = null;
        this.matchedNodes = [];
        this.activeMatchIndex = -1;
        this.selectionManager.clear();

        if (this.searchInput) {
            this.searchInput.value = "";
        }
        if (this.matchCountLabel) {
            this.matchCountLabel.textContent = "";
        }
        if (this.orgFilterSelect) {
            this.orgFilterSelect.value = "";
        }

        // Strictly collapse every node in the tree, then open ONLY the root node (1 level below visible)
        this.allNodesMap.forEach((node) => {
            node.expanded = false;
            node.isMatch = false;
            node.isActiveMatch = false;
        });
        if (this.rootNode) {
            this.rootNode.expanded = true;
        }

        this.updateBreadcrumbBar();
        this.updateStatusBarSummary();

        if (rerender) {
            this.renderTree();
            this.fitToScreen();
        }
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
            this.resetToDefaultState();
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

    /**
     * Focuses a specific manager as the temporary root and expands strictly 1 level below them.
     */
    private focusOnNode(nodeId: string | null): void {
        if (!nodeId) {
            this.resetToDefaultState();
            return;
        }
        this.focusedNodeId = nodeId;
        const targetRoot = this.getActiveRoot();
        if (targetRoot) {
            // Collapse everything in this subtree first, then expand ONLY targetRoot (1 level below)
            this.collapseSubtreeRecursive(targetRoot);
            targetRoot.expanded = true;
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
                this.updateStatusBarSummary();
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
                    (prevScale < 0.45 && nextScale >= 0.45) ||
                    (prevScale >= 0.45 && nextScale < 0.45);
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
            "Click +N badge to expand 1 level · Double-click or 🎯 to focus branch · ↺ Reset to start over";

        statusBar.appendChild(this.statusLeftPill);
        statusBar.appendChild(this.statusRightPill);
        this.rootElement.appendChild(statusBar);
    }

    private updateStatusBarSummary(): void {
        if (!this.statusLeftPill) return;
        if (this.selectedNodeId && this.allNodesMap.has(this.selectedNodeId)) {
            const sel = this.allNodesMap.get(this.selectedNodeId)!;
            const mgrName = sel.parent ? sel.parent.name : "None (Root)";
            const dirPart = sel.level3 ? ` · Dir: ${sel.level3}` : "";
            const svcPart = sel.level6 ? ` · Svc: ${sel.level6}` : "";
            this.statusLeftPill.textContent = `👤 ${sel.name} (#${sel.id}) · Manager: ${mgrName}${dirPart}${svcPart} · Reports: ${sel.directReports} direct (${sel.totalReports} total) · ${sel.status}`;
            this.statusLeftPill.title = this.statusLeftPill.textContent;
            return;
        }

        let bridgedOrFallback = 0;
        this.allNodesMap.forEach((n) => {
            if (n.status !== "Direct" && n.status !== "Root") {
                bridgedOrFallback++;
            }
        });
        this.statusLeftPill.textContent =
            bridgedOrFallback > 0
                ? `Active Staff: ${this.allNodesMap.size} · Auto-Healed Links: ${bridgedOrFallback}`
                : `Active Staff: ${this.allNodesMap.size} · 100% Connected Tree`;
        this.statusLeftPill.title = this.statusLeftPill.textContent;
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

        if (empIdx === -1) empIdx = 0;
        if (mgrIdx === -1 && columns.length > 1) mgrIdx = 1;
        if (nameIdx === -1 && columns.length > 2) nameIdx = 2;

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
            this.resetToDefaultState(true);
        } else {
            this.updateStatusBarSummary();
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
            if (typeof cardObj["CardTheme"] === "string") {
                this.cardTheme = cardObj["CardTheme"] as CardTheme;
            }
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
                this.maxColumnsWrap = Math.max(2, Math.min(10, cardObj["MaxColumnsWrap"] as number));
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
                        CardTheme: this.cardTheme,
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
        defaultOpt.textContent = "Jump to Directorate / Service Line...";
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

    /**
     * When the user selects a Directorate or Service Line from the toolbar dropdown,
     * find the highest-level manager of that Directorate/Service Line, focus on them,
     * and expand ONLY 1 level below them so the view stays clean and compact!
     */
    private applyOrgQuickFilter(filterVal: string): void {
        if (!filterVal) {
            this.resetToDefaultState();
            return;
        }

        const isL3 = filterVal.startsWith("L3:");
        const targetOrg = filterVal.slice(3);

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
        const focusTarget =
            topLead.directReports > 0 ? topLead : topLead.parent || this.rootNode!;

        // Focus on the lead of this Directorate/Service Line and expand strictly 1 level below them
        this.focusedNodeId = focusTarget.id;
        this.allNodesMap.forEach((n) => {
            n.expanded = false;
            n.isMatch = (isL3 ? n.level3 : n.level6) === targetOrg;
            n.isActiveMatch = n.id === topLead.id;
        });
        focusTarget.expanded = true;

        this.matchedNodes = members;
        this.activeMatchIndex = 0;
        this.matchCountLabel.textContent = `${members.length} in unit`;
        this.updateBreadcrumbBar();
        this.renderTree();
        this.fitToScreen();
    }

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
        this.updateStatusBarSummary();
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

    /**
     * Search opens ONLY the ancestor chain of the currently active match (1 path at a time),
     * rather than exploding every matched person's branch simultaneously!
     */
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
            }
        });

        if (this.matchedNodes.length > 0) {
            this.activeMatchIndex = 0;
            this.revealSingleSearchMatch(this.matchedNodes[0], centerFirst);
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
        this.revealSingleSearchMatch(target, true);
    }

    /**
     * Expands ONLY the ancestor path leading to `target` (collapsing unrelated branches
     * when Accordion Mode is ON) so searching never explodes the entire organisation tree.
     */
    private revealSingleSearchMatch(target: StaffNode, centerCamera: boolean): void {
        target.isActiveMatch = true;
        this.matchCountLabel.textContent = `${this.activeMatchIndex + 1} / ${this.matchedNodes.length}`;

        const ancestorIds = new Set<string>();
        let p = target.parent;
        while (p) {
            ancestorIds.add(p.id);
            p = p.parent;
        }

        if (this.accordionMode) {
            this.allNodesMap.forEach((n) => {
                n.expanded = ancestorIds.has(n.id);
            });
            if (this.rootNode) this.rootNode.expanded = true;
        } else {
            ancestorIds.forEach((id) => {
                const anc = this.allNodesMap.get(id);
                if (anc) anc.expanded = true;
            });
        }

        this.renderTree();
        if (centerCamera) {
            this.centerOnNode(target);
        }
    }

    // =========================================================================
    // MULTI-MODE LAYOUT ENGINE (Dense 2-Column Center Spine / Horizontal / Classic)
    // =========================================================================

    private computeLayout(node: StaffNode, m: DensityMetrics): void {
        if (this.layoutMode === "horizontal") {
            this.computeHorizontalLayout(node, m);
        } else if (this.layoutMode === "compact") {
            this.computeDenseSpineLayout(node, m);
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
            this.assignDenseSpineCoordinates(node, leftX, topY, m);
        } else {
            this.assignClassicCoordinates(node, leftX, topY, m);
        }
    }

    /**
     * WORKFORCEVISION / D3-ORG-CHART 'DENSE' CENTER-SPINE LAYOUT:
     * - Every currently-collapsed child (`!c.expanded || c.children.length === 0`) — including
     *   collapsed managers! — is stacked into a compact 2-column vertical spine directly
     *   underneath its parent manager (`├─ ┤`).
     * - Only children that are actively expanded (`c.expanded && c.children.length > 0`)
     *   branch out below the 2-column spine.
     */
    private computeDenseSpineLayout(node: StaffNode, m: DensityMetrics): void {
        if (!node.expanded || node.children.length === 0) {
            node.subtreeWidth = m.cardW;
            node.subtreeHeight = m.cardH;
            return;
        }

        const collapsedOrLeaf = node.children.filter(
            (c) => !c.expanded || c.children.length === 0
        );
        const expandedManagers = node.children.filter(
            (c) => c.expanded && c.children.length > 0
        );

        let compactBlockW = 0;
        let compactBlockH = 0;
        const vRowGap = Math.max(10, Math.round(m.hGap * 0.8));

        if (collapsedOrLeaf.length > 0) {
            collapsedOrLeaf.forEach((c) => {
                c.subtreeWidth = m.cardW;
                c.subtreeHeight = m.cardH;
            });
            const cols = collapsedOrLeaf.length >= 2 ? 2 : 1;
            const rows = Math.ceil(collapsedOrLeaf.length / cols);
            compactBlockW = cols === 2 ? 2 * m.cardW + m.spineGap : m.cardW;
            compactBlockH = rows * m.cardH + (rows - 1) * vRowGap;
        }

        let expandedBlockW = 0;
        let expandedBlockH = 0;
        if (expandedManagers.length > 0) {
            expandedManagers.forEach((mgr) => this.computeDenseSpineLayout(mgr, m));
            const wrapCols = Math.max(2, this.maxColumnsWrap);
            for (let i = 0; i < expandedManagers.length; i += wrapCols) {
                const rowSlice = expandedManagers.slice(i, i + wrapCols);
                let rowW = 0;
                let rowH = 0;
                rowSlice.forEach((ch, idx) => {
                    if (idx > 0) rowW += m.hGap;
                    rowW += ch.subtreeWidth;
                    rowH = Math.max(rowH, ch.subtreeHeight);
                });
                expandedBlockW = Math.max(expandedBlockW, rowW);
                if (i > 0) expandedBlockH += m.vGap;
                expandedBlockH += rowH;
            }
        }

        const totalChildrenW = Math.max(compactBlockW, expandedBlockW);
        const totalChildrenH =
            compactBlockH > 0 && expandedBlockH > 0
                ? compactBlockH + m.vGap + expandedBlockH
                : compactBlockH + expandedBlockH;

        node.subtreeWidth = Math.max(m.cardW, totalChildrenW);
        node.subtreeHeight = m.cardH + m.vGap + totalChildrenH;
    }

    private assignDenseSpineCoordinates(
        node: StaffNode,
        leftX: number,
        topY: number,
        m: DensityMetrics
    ): void {
        const centerX = leftX + node.subtreeWidth / 2;
        node.x = centerX - m.cardW / 2;
        node.y = topY;

        if (!node.expanded || node.children.length === 0) return;

        const collapsedOrLeaf = node.children.filter(
            (c) => !c.expanded || c.children.length === 0
        );
        const expandedManagers = node.children.filter(
            (c) => c.expanded && c.children.length > 0
        );

        let currentY = topY + m.cardH + m.vGap;
        const vRowGap = Math.max(10, Math.round(m.hGap * 0.8));

        // 1. Place all collapsed/leaf children in a 2-column vertical spine straddling centerX
        if (collapsedOrLeaf.length === 1 && expandedManagers.length === 0) {
            const single = collapsedOrLeaf[0];
            single.x = centerX - m.cardW / 2;
            single.y = currentY;
            currentY += m.cardH;
        } else if (collapsedOrLeaf.length > 0) {
            const rows = Math.ceil(collapsedOrLeaf.length / 2);
            collapsedOrLeaf.forEach((ch, idx) => {
                const col = idx % 2;
                const row = Math.floor(idx / 2);
                if (col === 0) {
                    // Left of center spine
                    ch.x = centerX - m.spineGap / 2 - m.cardW;
                } else {
                    // Right of center spine
                    ch.x = centerX + m.spineGap / 2;
                }
                ch.y = currentY + row * (m.cardH + vRowGap);
            });
            currentY += rows * m.cardH + (rows - 1) * vRowGap;
            if (expandedManagers.length > 0) {
                currentY += m.vGap;
            }
        }

        // 2. Place any actively expanded child managers below the 2-column spine
        if (expandedManagers.length > 0) {
            const wrapCols = Math.max(2, this.maxColumnsWrap);
            for (let i = 0; i < expandedManagers.length; i += wrapCols) {
                const rowSlice = expandedManagers.slice(i, i + wrapCols);
                let rowW = 0;
                let rowH = 0;
                rowSlice.forEach((ch, idx) => {
                    if (idx > 0) rowW += m.hGap;
                    rowW += ch.subtreeWidth;
                    rowH = Math.max(rowH, ch.subtreeHeight);
                });

                let currX = leftX + (node.subtreeWidth - rowW) / 2;
                rowSlice.forEach((ch) => {
                    this.assignDenseSpineCoordinates(ch, currX, currentY, m);
                    currX += ch.subtreeWidth + m.hGap;
                });

                currentY += rowH + m.vGap;
            }
        }
    }

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
    // RENDERING, CENTER-SPINE CONNECTORS & CARDS
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
                    this.appendLinkPath(
                        `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`,
                        ch.isMatch || ch.isActiveMatch
                    );
                });
            } else if (this.layoutMode === "compact") {
                this.drawDenseSpineLinks(n, m);
            } else {
                const startX = n.x + m.cardW / 2;
                const startY = n.y + m.cardH;
                const elbowY = startY + Math.round(m.vGap * 0.45);
                n.children.forEach((ch) => {
                    const endX = ch.x + m.cardW / 2;
                    const endY = ch.y;
                    this.appendLinkPath(
                        `M ${startX} ${startY} L ${startX} ${elbowY} L ${endX} ${elbowY} L ${endX} ${endY}`,
                        ch.isMatch || ch.isActiveMatch
                    );
                });
            }
        });

        // Draw Node Cards
        const hasAnySearch = this.matchedNodes.length > 0;
        const isSemanticZoomOut = this.scale < 0.45;
        visibleNodes.forEach((node) => {
            const g = this.renderNodeCard(node, m, hasAnySearch, isSemanticZoomOut);
            this.nodesGroup.appendChild(g);
        });

        this.applyTransform();
    }

    /**
     * Draws clean Center-Spine connectors (`├─ ┤`) for the 2-column vertical block of
     * collapsed/leaf children and orthogonal branches for any expanded child managers below.
     */
    private drawDenseSpineLinks(n: StaffNode, m: DensityMetrics): void {
        const spineX = n.x + m.cardW / 2;
        const startY = n.y + m.cardH;

        const collapsedOrLeaf = n.children.filter(
            (c) => !c.expanded || c.children.length === 0
        );
        const expandedManagers = n.children.filter(
            (c) => c.expanded && c.children.length > 0
        );

        if (collapsedOrLeaf.length === 1 && expandedManagers.length === 0) {
            const ch = collapsedOrLeaf[0];
            this.appendLinkPath(
                `M ${spineX} ${startY} L ${ch.x + m.cardW / 2} ${ch.y}`,
                ch.isMatch || ch.isActiveMatch
            );
            return;
        }

        let lowestSpineY = startY;

        // Horizontal ticks from center spine into left/right column cards
        collapsedOrLeaf.forEach((ch) => {
            const midY = ch.y + m.cardH / 2;
            lowestSpineY = Math.max(lowestSpineY, midY);
            const isLeftCol = ch.x + m.cardW <= spineX + 1;
            const targetEdgeX = isLeftCol ? ch.x + m.cardW : ch.x;
            this.appendLinkPath(
                `M ${spineX} ${midY} L ${targetEdgeX} ${midY}`,
                ch.isMatch || ch.isActiveMatch
            );
        });

        // Branches to any expanded managers placed below the 2-column block
        if (expandedManagers.length > 0) {
            expandedManagers.forEach((mgr) => {
                const elbowY = mgr.y - Math.round(m.vGap * 0.45);
                lowestSpineY = Math.max(lowestSpineY, elbowY);
                const mgrCenterX = mgr.x + m.cardW / 2;
                this.appendLinkPath(
                    `M ${spineX} ${elbowY} L ${mgrCenterX} ${elbowY} L ${mgrCenterX} ${mgr.y}`,
                    mgr.isMatch || mgr.isActiveMatch
                );
            });
        }

        // Main center vertical spine trunk
        if (lowestSpineY > startY) {
            this.appendLinkPath(`M ${spineX} ${startY} L ${spineX} ${lowestSpineY}`, false);
        }
    }

    private appendLinkPath(d: string, highlighted: boolean): void {
        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", d);
        path.setAttribute(
            "class",
            highlighted ? "scw-link scw-link-highlighted" : "scw-link"
        );
        this.linksGroup.appendChild(path);
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
            g.setAttribute("opacity", "0.35");
        }

        const isNavy = this.cardTheme === "navy";
        const isNonStandard = node.status !== "Direct" && node.status !== "Root";

        // Native SVG Tooltip (<title>)
        const titleEl = document.createElementNS(SVG_NS, "title");
        const extraTooltip = node.extras.map((e) => `${e.label}: ${e.value}`).join("\n");
        titleEl.textContent = [
            `${node.name} (#${node.id})`,
            extraTooltip,
            `Direct Reports: ${node.directReports} | Total Subtree: ${node.totalReports}`,
            `Hierarchy Status: ${node.status}`,
            node.directReports > 0 ? "Click +N to expand 1 level · Double-click or 🎯 to focus branch" : "",
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

        let cardFill: string;
        if (isNavy) {
            cardFill =
                this.customCardBg && this.customCardBg !== "#ffffff"
                    ? this.customCardBg
                    : "#1C355E";
            if (node.depth === 0) cardFill = "#112240";
            if (isSelected) cardFill = "#004b93";
        } else {
            cardFill = node.isActiveMatch
                ? "#fff5f5"
                : isSelected
                ? "#eff6ff"
                : "#ffffff";
        }
        rect.setAttribute("fill", cardFill);

        let strokeColor = isNavy ? "#334155" : "#cbd5e1";
        let strokeWidth = "1.5";
        if (node.isActiveMatch) {
            strokeColor = this.searchHighlightColor || "#FF0000";
            strokeWidth = "3.5";
        } else if (node.isMatch) {
            strokeColor = "#f59e0b";
            strokeWidth = "2.5";
        } else if (isSelected) {
            strokeColor = isNavy ? "#38bdf8" : "#005eb8";
            strokeWidth = "2.5";
        } else if (this.showHealthBadges && isNonStandard) {
            strokeColor = "#f59e0b";
            strokeWidth = "2";
        }
        rect.setAttribute("stroke", strokeColor);
        rect.setAttribute("stroke-width", strokeWidth);
        g.appendChild(rect);

        // Top Accent Strip
        const headerColor = node.isActiveMatch
            ? this.searchHighlightColor || "#FF0000"
            : this.showHealthBadges && isNonStandard
            ? "#f59e0b"
            : isNavy
            ? "#38bdf8"
            : "#005eb8";

        const topBar = document.createElementNS(SVG_NS, "rect");
        topBar.setAttribute("x", "0");
        topBar.setAttribute("y", "0");
        topBar.setAttribute("width", String(m.cardW));
        topBar.setAttribute("height", this.densityMode === "mini" ? "3.5" : "5");
        topBar.setAttribute("rx", "6");
        topBar.setAttribute("fill", headerColor);
        g.appendChild(topBar);

        const nameColor = isNavy ? "#FFFFFF" : "#0f172a";
        const sub1Color = isNavy ? "#dbeafe" : "#334155";
        const sub2Color = isNavy ? "#cbd5e1" : "#64748b";
        const badgeColor = isNavy ? "#fcd34d" : "#b45309";

        const maxNameChars = Math.max(12, Math.floor((m.cardW - 30) / (m.nameFont * 0.56)));
        const maxSubChars = Math.max(14, Math.floor((m.cardW - 20) / (m.subFont * 0.54)));

        // SEMANTIC ZOOM (Auto-LOD when zoomed out < 45%) OR MINI DENSITY
        if (isSemanticZoomOut || this.densityMode === "mini") {
            const nameText = document.createElementNS(SVG_NS, "text");
            nameText.setAttribute("x", "8");
            nameText.setAttribute("y", String(Math.round(m.cardH * 0.46)));
            nameText.setAttribute("fill", nameColor);
            const lodFontSize = isSemanticZoomOut ? Math.max(12, m.nameFont * 1.18) : m.nameFont;
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
                sub1.setAttribute("y", String(Math.round(m.cardH * 0.74)));
                sub1.setAttribute("fill", sub1Color);
                sub1.setAttribute("font-size", `${m.subFont}px`);
                sub1.textContent = this.truncate(node.level3, maxSubChars);
                g.appendChild(sub1);
            }
        } else {
            // COMPACT OR DETAILED MODE
            const nameText = document.createElementNS(SVG_NS, "text");
            nameText.setAttribute("x", "10");
            nameText.setAttribute("y", this.densityMode === "compact" ? "20" : "24");
            nameText.setAttribute("fill", nameColor);
            nameText.setAttribute("font-size", `${m.nameFont}px`);
            nameText.setAttribute("font-weight", "700");
            nameText.textContent = this.truncate(
                this.showPersonId ? `${node.name} (#${node.id})` : node.name,
                maxNameChars
            );
            g.appendChild(nameText);

            // Subtitle 1 (Level 3 Directorate)
            const line1Val =
                node.level3 || (node.extras.length > 0 ? node.extras[0].value : `ID: ${node.id}`);
            const sub1 = document.createElementNS(SVG_NS, "text");
            sub1.setAttribute("x", "10");
            sub1.setAttribute("y", this.densityMode === "compact" ? "35" : "42");
            sub1.setAttribute("fill", sub1Color);
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
                sub2.setAttribute("y", this.densityMode === "compact" ? "48" : "57");
                sub2.setAttribute("fill", sub2Color);
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
                badgeText.setAttribute("y", this.densityMode === "detailed" ? "73" : "49");
                badgeText.setAttribute("fill", badgeColor);
                badgeText.setAttribute("font-size", `${Math.max(8, m.subFont - 1)}px`);
                badgeText.setAttribute("font-weight", "700");
                badgeText.textContent = `⚡ ${this.truncate(node.status, maxSubChars)}`;
                g.appendChild(badgeText);
            }
        }

        // Focus / Pin Subtree Icon Button (🎯) in top-right of manager cards
        if (node.directReports > 0) {
            const focusG = document.createElementNS(SVG_NS, "g") as SVGGElement;
            const btnSize = this.densityMode === "mini" ? 14 : 17;
            const fx = m.cardW - btnSize - 4;
            const fy = 6;

            const focusBg = document.createElementNS(SVG_NS, "rect");
            focusBg.setAttribute("x", String(fx));
            focusBg.setAttribute("y", String(fy));
            focusBg.setAttribute("width", String(btnSize));
            focusBg.setAttribute("height", String(btnSize));
            focusBg.setAttribute("rx", "4");
            focusBg.setAttribute(
                "fill",
                this.focusedNodeId === node.id
                    ? "#38bdf8"
                    : isNavy
                    ? "rgba(255,255,255,0.14)"
                    : "#f1f5f9"
            );
            focusBg.setAttribute("stroke", isNavy ? "rgba(255,255,255,0.35)" : "#94a3b8");
            focusBg.setAttribute("stroke-width", "0.8");

            const focusLabel = document.createElementNS(SVG_NS, "text");
            focusLabel.setAttribute("x", String(fx + btnSize / 2));
            focusLabel.setAttribute("y", String(fy + btnSize * 0.74));
            focusLabel.setAttribute("text-anchor", "middle");
            focusLabel.setAttribute("font-size", this.densityMode === "mini" ? "8px" : "9.5px");
            focusLabel.textContent = "🎯";

            const focusTitle = document.createElementNS(SVG_NS, "title");
            focusTitle.textContent =
                this.focusedNodeId === node.id
                    ? "Unpin branch (Return to Full Organisation)"
                    : `Focus on ${node.name}'s branch (${node.directReports} direct, ${node.totalReports} total)`;
            focusG.appendChild(focusTitle);
            focusG.appendChild(focusBg);
            focusG.appendChild(focusLabel);

            focusG.addEventListener("click", (e: MouseEvent) => {
                e.stopPropagation();
                if (this.focusedNodeId === node.id) {
                    this.resetToDefaultState();
                } else {
                    this.focusOnNode(node.id);
                }
            });
            g.appendChild(focusG);
        }

        // Click card body -> cross-filter in Power BI + show full details in bottom status pill
        g.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation();
            this.selectedNodeId = this.selectedNodeId === node.id ? null : node.id;
            if (node.selectionId) {
                this.selectionManager.select(node.selectionId, e.ctrlKey || e.metaKey);
            }
            this.updateStatusBarSummary();
            this.renderTree();
        });

        // Double-click manager card -> focus/unfocus subtree
        g.addEventListener("dblclick", (e: MouseEvent) => {
            e.stopPropagation();
            if (node.directReports > 0) {
                if (this.focusedNodeId === node.id) {
                    this.resetToDefaultState();
                } else {
                    this.focusOnNode(node.id);
                }
            }
        });

        // Expand/Collapse Pill at bottom border of card (strictly expands 1 level below!)
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

            if (isNavy) {
                pillRect.setAttribute("fill", node.expanded ? "#0284c7" : "#ffffff");
                pillRect.setAttribute("stroke", node.expanded ? "#38bdf8" : "#1c355e");
            } else {
                pillRect.setAttribute("fill", node.expanded ? "#e2e8f0" : "#005eb8");
                pillRect.setAttribute("stroke", node.expanded ? "#94a3b8" : "#003087");
            }
            pillRect.setAttribute("stroke-width", "1.2");

            const pillLabel = document.createElementNS(SVG_NS, "text");
            pillLabel.setAttribute("x", String(m.cardW / 2));
            pillLabel.setAttribute("y", String(pillY + pillH * 0.72));
            pillLabel.setAttribute("text-anchor", "middle");
            pillLabel.setAttribute(
                "fill",
                isNavy
                    ? node.expanded
                        ? "#ffffff"
                        : "#1c355e"
                    : node.expanded
                    ? "#1e293b"
                    : "#ffffff"
            );
            pillLabel.setAttribute(
                "font-size",
                `${Math.max(8, Math.min(10, m.subFont - 0.3))}px`
            );
            pillLabel.setAttribute("font-weight", "700");
            pillLabel.textContent = node.expanded
                ? `▲ -${node.directReports} (${node.totalReports})`
                : `▼ +${node.directReports} (${node.totalReports})`;

            pillG.appendChild(pillRect);
            pillG.appendChild(pillLabel);

            pillG.addEventListener("click", (e: MouseEvent) => {
                e.stopPropagation();
                this.toggleSingleLevelExpansion(node);
            });

            g.appendChild(pillG);
        }

        return g;
    }

    /**
     * Strictly expands ONLY 1 level below `node` when expanding (forcing all grandchildren
     * collapsed so a whole subtree never pops open unexpectedly), and recursively collapses
     * all descendants when collapsing `node`.
     */
    private toggleSingleLevelExpansion(node: StaffNode): void {
        const willExpand = !node.expanded;
        if (willExpand) {
            // 1. If Accordion Mode is ON, collapse sibling branches at the same level
            if (this.accordionMode && node.parent) {
                node.parent.children.forEach((sib) => {
                    if (sib.id !== node.id) {
                        this.collapseSubtreeRecursive(sib);
                    }
                });
            }
            // 2. Ensure ALL children of `node` start collapsed so ONLY 1 level below opens!
            node.children.forEach((ch) => {
                this.collapseSubtreeRecursive(ch);
            });
            node.expanded = true;
        } else {
            // Recursively collapse `node` and all its descendants
            this.collapseSubtreeRecursive(node);
        }

        this.renderTree();
        if (this.autoFitOnToggle) {
            this.fitToScreen();
        }
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
                    ? "#FF0000"
                    : n.isMatch
                    ? "#f59e0b"
                    : "#1C355E"
            );
            this.minimapSvg.appendChild(r);
        });

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
        vpRect.setAttribute("fill", "rgba(0, 94, 184, 0.14)");
        vpRect.setAttribute("stroke", "#005eb8");
        vpRect.setAttribute("stroke-width", String(Math.max(4, spanW * 0.014)));
        this.minimapSvg.appendChild(vpRect);
    }

    private exportCurrentSvg(): void {
        if (!this.svgElement || this.lastVisibleNodes.length === 0) return;

        const pad = 32;
        const vx = Math.floor(this.treeMinX - pad);
        const vy = Math.floor(this.treeMinY - pad);
        const vw = Math.ceil(this.treeMaxX - this.treeMinX + pad * 2);
        const vh = Math.ceil(this.treeMaxY - this.treeMinY + pad * 2);

        const cloneSvg = document.createElementNS(SVG_NS, "svg");
        cloneSvg.setAttribute("xmlns", SVG_NS);
        cloneSvg.setAttribute("viewBox", `${vx} ${vy} ${vw} ${vh}`);
        cloneSvg.setAttribute("width", String(vw));
        cloneSvg.setAttribute("height", String(vh));

        const styleEl = document.createElementNS(SVG_NS, "style");
        styleEl.textContent = `
            svg { font-family: "Segoe UI", Arial, sans-serif; background: #f8fafc; }
            .scw-link { fill: none; stroke: #64748b; stroke-width: 1.75px; stroke-linecap: round; stroke-linejoin: round; }
            .scw-link-highlighted { fill: none; stroke: #da291c; stroke-width: 2.75px; }
        `;
        cloneSvg.appendChild(styleEl);

        const contentGroup = document.createElementNS(SVG_NS, "g");
        contentGroup.appendChild(this.linksGroup.cloneNode(true));
        contentGroup.appendChild(this.nodesGroup.cloneNode(true));
        cloneSvg.appendChild(contentGroup);

        const serializer = new XMLSerializer();
        const svgString = serializer.serializeToString(cloneSvg);
        const dataUri = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgString);

        try {
            const a = document.createElement("a");
            a.href = dataUri;
            a.download = "scw-org-chart.svg";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } catch {
            this.host.launchUrl(dataUri);
        }
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
            (prevScale < 0.45 && nextScale >= 0.45) ||
            (prevScale >= 0.45 && nextScale < 0.45);
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
        if (prevScale < 0.45 && this.scale >= 0.45) {
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
        const padTop = hasBreadcrumbs ? 90 : 58;
        const padBottom = 38;

        const availW = Math.max(200, w - padX * 2);
        const availH = Math.max(150, h - padTop - padBottom);

        const prevScale = this.scale;
        this.scale = Math.min(1.05, Math.max(0.06, Math.min(availW / treeW, availH / treeH)));
        this.panX = (w - treeW * this.scale) / 2 - minX * this.scale;
        this.panY = padTop + (availH - treeH * this.scale) / 2 - minY * this.scale;

        const crossedLod =
            (prevScale < 0.45 && this.scale >= 0.45) ||
            (prevScale >= 0.45 && this.scale < 0.45);
        if (crossedLod) {
            this.renderTree();
        } else {
            this.applyTransform();
        }
    }
}
