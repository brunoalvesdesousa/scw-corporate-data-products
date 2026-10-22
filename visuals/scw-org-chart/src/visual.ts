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

interface StaffNode {
    id: string;
    managerId: string | null;
    rawManagerId: string | null;
    name: string;
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
    isMatch: boolean;
    isActiveMatch: boolean;
}

const CARD_WIDTH = 230;
const CARD_HEIGHT = 104;
const H_GAP = 28;
const V_GAP = 68;
const SVG_NS = "http://www.w3.org/2000/svg";

export class Visual implements IVisual {
    private host: IVisualHost;
    private selectionManager: ISelectionManager;
    private rootElement: HTMLElement;
    private searchInput: HTMLInputElement;
    private matchCountLabel: HTMLElement;
    private badgeToggleBtn: HTMLButtonElement;
    private statusLeftPill: HTMLElement;
    private statusRightPill: HTMLElement;
    private svgElement: SVGSVGElement;
    private viewportGroup: SVGGElement;
    private linksGroup: SVGGElement;
    private nodesGroup: SVGGElement;

    private allNodesMap: Map<string, StaffNode> = new Map();
    private rootNode: StaffNode | null = null;
    private matchedNodes: StaffNode[] = [];
    private activeMatchIndex: number = -1;
    private selectedNodeId: string | null = null;
    private showHealthBadges: boolean = true;
    private maxExpandedDepth: number = 2;
    private hasInitializedExpansion: boolean = false;

    // Camera Pan & Zoom state
    private panX: number = 0;
    private panY: number = 0;
    private scale: number = 0.85;
    private isDragging: boolean = false;
    private dragStartX: number = 0;
    private dragStartY: number = 0;

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.selectionManager = this.host.createSelectionManager();

        this.rootElement = document.createElement("div");
        this.rootElement.className = "scw-org-root";
        options.element.appendChild(this.rootElement);

        this.buildToolbar();
        this.buildCanvas();
        this.buildStatusBar();
    }

    private buildToolbar(): void {
        const toolbar = document.createElement("div");
        toolbar.className = "scw-org-toolbar";

        // Search bar + match navigation
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
            }
        });

        this.matchCountLabel = document.createElement("span");
        this.matchCountLabel.className = "scw-match-count";
        this.matchCountLabel.textContent = "";

        const prevBtn = this.makeButton("▲", "Previous search match (Shift+Enter)", () => this.stepSearchMatch(-1));
        const nextBtn = this.makeButton("▼", "Next search match (Enter)", () => this.stepSearchMatch(1));

        searchGroup.appendChild(this.searchInput);
        searchGroup.appendChild(this.matchCountLabel);
        searchGroup.appendChild(prevBtn);
        searchGroup.appendChild(nextBtn);

        // Action buttons
        const btnGroup = document.createElement("div");
        btnGroup.className = "scw-btn-group";

        const expandLvlBtn = this.makeButton("+1 Level", "Expand one hierarchy level deeper", () => {
            this.setExpansionToDepth(this.maxExpandedDepth + 1);
        });
        const collapseLvlBtn = this.makeButton("-1 Level", "Collapse deepest visible hierarchy level", () => {
            this.setExpansionToDepth(Math.max(1, this.maxExpandedDepth - 1));
        });
        const resetBtn = this.makeButton("Reset", "Reset to Top 2 levels", () => {
            this.searchInput.value = "";
            this.matchedNodes = [];
            this.activeMatchIndex = -1;
            this.matchCountLabel.textContent = "";
            this.allNodesMap.forEach((n) => {
                n.isMatch = false;
                n.isActiveMatch = false;
            });
            this.setExpansionToDepth(2);
            this.fitToScreen();
        });

        const zoomInBtn = this.makeButton("＋", "Zoom In", () => this.zoomBy(1.25));
        const zoomOutBtn = this.makeButton("－", "Zoom Out", () => this.zoomBy(0.8));
        const fitBtn = this.makeButton("Fit", "Fit visible chart to screen", () => this.fitToScreen(), true);

        this.badgeToggleBtn = this.makeButton("● Health Badges: ON", "Toggle visibility of Bridged/Fallback data health badges", () => {
            this.showHealthBadges = !this.showHealthBadges;
            this.badgeToggleBtn.textContent = this.showHealthBadges ? "● Health Badges: ON" : "○ Health Badges: OFF";
            this.badgeToggleBtn.className = this.showHealthBadges ? "scw-btn scw-btn-badge-active" : "scw-btn";
            this.renderTree();
        });
        this.badgeToggleBtn.className = "scw-btn scw-btn-badge-active";

        btnGroup.appendChild(expandLvlBtn);
        btnGroup.appendChild(collapseLvlBtn);
        btnGroup.appendChild(resetBtn);
        btnGroup.appendChild(zoomOutBtn);
        btnGroup.appendChild(zoomInBtn);
        btnGroup.appendChild(fitBtn);
        btnGroup.appendChild(this.badgeToggleBtn);

        toolbar.appendChild(searchGroup);
        toolbar.appendChild(btnGroup);
        this.rootElement.appendChild(toolbar);
    }

    private makeButton(label: string, title: string, onClick: () => void, primary: boolean = false): HTMLButtonElement {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = primary ? "scw-btn scw-btn-primary" : "scw-btn";
        btn.textContent = label;
        btn.title = title;
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            onClick();
        });
        return btn;
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

        // Mouse drag pan
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

        // Click background to clear Power BI cross-filter selection
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
                const rect = this.svgElement.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;
                const zoomFactor = e.deltaY < 0 ? 1.12 : 0.89;
                const nextScale = Math.min(2.2, Math.max(0.12, this.scale * zoomFactor));
                this.panX = mouseX - ((mouseX - this.panX) / this.scale) * nextScale;
                this.panY = mouseY - ((mouseY - this.panY) / this.scale) * nextScale;
                this.scale = nextScale;
                this.applyTransform();
            },
            { passive: false }
        );
    }

    private buildStatusBar(): void {
        const bar = document.createElement("div");
        bar.className = "scw-status-bar";

        this.statusLeftPill = document.createElement("div");
        this.statusLeftPill.className = "scw-status-pill";
        this.statusLeftPill.textContent = "SCW CSU Organisational Hierarchy";

        this.statusRightPill = document.createElement("div");
        this.statusRightPill.className = "scw-status-pill";
        this.statusRightPill.textContent = "Scroll to zoom · Drag to pan · Click card to filter";

        bar.appendChild(this.statusLeftPill);
        bar.appendChild(this.statusRightPill);
        this.rootElement.appendChild(bar);
    }

    public update(options: VisualUpdateOptions): void {
        const dataView: DataView | undefined = options.dataViews && options.dataViews[0];
        if (!dataView || !dataView.table || !dataView.table.rows || dataView.table.rows.length === 0) {
            this.statusLeftPill.textContent = "Bind Employee ID, Manager ID, and Full Name to render hierarchy.";
            return;
        }

        this.parseTableAndBuildTree(dataView.table);
        if (!this.hasInitializedExpansion && this.rootNode) {
            this.setExpansionToDepth(2, false);
            this.hasInitializedExpansion = true;
            this.renderTree();
            this.fitToScreen();
        } else {
            if (this.searchInput.value.trim().length > 0) {
                this.runSearch(this.searchInput.value, false);
            } else {
                this.renderTree();
            }
        }
    }

    private cleanId(val: any): string | null {
        if (val === null || val === undefined) return null;
        let s = String(val).trim();
        if (s === "" || s.toLowerCase() === "null" || s.toLowerCase() === "none" || s === "0" || s === "-1") {
            return null;
        }
        if (s.endsWith(".0")) {
            s = s.slice(0, -2);
        }
        return s;
    }

    private parseTableAndBuildTree(table: DataViewTable): void {
        const prevExpanded = new Map<string, boolean>();
        this.allNodesMap.forEach((n, id) => prevExpanded.set(id, n.expanded));

        this.allNodesMap.clear();

        let empIdx = -1;
        let mgrIdx = -1;
        let nameIdx = -1;
        const extraCols: { idx: number; displayName: string }[] = [];

        table.columns.forEach((col, i) => {
            const roles = col.roles || {};
            if (roles["employeeId"] && empIdx === -1) {
                empIdx = i;
            } else if (roles["managerId"] && mgrIdx === -1) {
                mgrIdx = i;
            } else if (roles["name"] && nameIdx === -1) {
                nameIdx = i;
            } else if (roles["Extra"]) {
                extraCols.push({ idx: i, displayName: col.displayName || `Field ${i}` });
            }
        });

        if (empIdx === -1) empIdx = 0;
        if (mgrIdx === -1 && table.columns.length > 1) mgrIdx = 1;
        if (nameIdx === -1 && table.columns.length > 2) nameIdx = 2;

        table.rows.forEach((row, rowIndex) => {
            const id = this.cleanId(row[empIdx]);
            if (!id) return;

            const rawMgr = mgrIdx >= 0 ? this.cleanId(row[mgrIdx]) : null;
            const fullName = nameIdx >= 0 && row[nameIdx] != null ? String(row[nameIdx]).trim() : `Staff ${id}`;

            let statusVal = "Direct";
            const extras: { label: string; value: string }[] = [];

            extraCols.forEach((ec) => {
                const v = row[ec.idx] != null ? String(row[ec.idx]).trim() : "";
                if (!v) return;
                if (ec.displayName.toLowerCase().includes("status")) {
                    statusVal = v;
                } else {
                    extras.push({ label: ec.displayName, value: v });
                }
            });

            let selectionId: ISelectionId | null = null;
            try {
                selectionId = this.host
                    .createSelectionIdBuilder()
                    .withTable(table, rowIndex)
                    .createSelectionId();
            } catch {
                selectionId = null;
            }

            const node: StaffNode = {
                id,
                managerId: id === "4037" ? null : rawMgr,
                rawManagerId: rawMgr,
                name: fullName,
                extras,
                status: id === "4037" ? "Root" : statusVal,
                selectionId,
                children: [],
                parent: null,
                depth: 1,
                directReports: 0,
                totalReports: 0,
                expanded: prevExpanded.has(id) ? (prevExpanded.get(id) as boolean) : false,
                x: 0,
                y: 0,
                subtreeWidth: CARD_WIDTH,
                isMatch: false,
                isActiveMatch: false,
            };

            this.allNodesMap.set(id, node);
        });

        // Client-side Safeguard 1: Break self-loops & missing manager references
        this.allNodesMap.forEach((node) => {
            if (node.managerId === node.id) {
                node.managerId = null;
            }
            if (node.managerId && !this.allNodesMap.has(node.managerId)) {
                node.managerId = null;
                if (node.status === "Direct") {
                    node.status = "Fallback: Client Safeguard";
                }
            }
        });

        // Client-side Safeguard 2: Break any multi-node cycles
        const visitState = new Map<string, number>(); // 0=unvisited, 1=visiting, 2=visited
        this.allNodesMap.forEach((node) => {
            if ((visitState.get(node.id) || 0) !== 0) return;
            const chain: string[] = [];
            let curr: string | null = node.id;
            while (curr && (visitState.get(curr) || 0) === 0) {
                visitState.set(curr, 1);
                chain.push(curr);
                const cNode = this.allNodesMap.get(curr);
                curr = cNode ? cNode.managerId : null;
            }
            if (curr && visitState.get(curr) === 1) {
                const cycleNode = this.allNodesMap.get(curr);
                if (cycleNode) {
                    cycleNode.managerId = null;
                    cycleNode.status = "Cycle Repaired";
                }
            }
            chain.forEach((id) => visitState.set(id, 2));
        });

        // Wire parent -> children
        const roots: StaffNode[] = [];
        this.allNodesMap.forEach((node) => {
            if (node.managerId && this.allNodesMap.has(node.managerId)) {
                const par = this.allNodesMap.get(node.managerId)!;
                node.parent = par;
                par.children.push(node);
            } else {
                roots.push(node);
            }
        });

        // Client-side Safeguard 3: Ensure a single connected tree (prefer 4037 or largest subtree root)
        if (roots.length === 1) {
            this.rootNode = roots[0];
        } else if (roots.length > 1) {
            let primaryRoot = this.allNodesMap.get("4037") || null;
            if (!primaryRoot || primaryRoot.parent !== null) {
                // Pick root with most children
                roots.sort((a, b) => b.children.length - a.children.length);
                primaryRoot = roots[0];
            }
            this.rootNode = primaryRoot;
            roots.forEach((r) => {
                if (r.id !== primaryRoot!.id) {
                    r.parent = primaryRoot;
                    r.managerId = primaryRoot!.id;
                    if (r.status === "Direct") {
                        r.status = "Fallback: Client Safeguard";
                    }
                    primaryRoot!.children.push(r);
                }
            });
        }

        // Compute depth, directReports, totalReports, and sort children alphabetically by name
        if (this.rootNode) {
            this.computeMetricsRecursive(this.rootNode, 1);
        }

        // Update summary bar
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
        this.allNodesMap.forEach((node) => {
            node.expanded = node.depth < targetDepth;
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

        this.allNodesMap.forEach((node) => {
            const hay = [
                node.name,
                node.id,
                node.status,
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

        // Ensure ancestors expanded
        let p = target.parent;
        while (p) {
            p.expanded = true;
            p = p.parent;
        }
        this.renderTree();
        this.centerOnNode(target);
    }

    private computeLayout(node: StaffNode): void {
        if (!node.expanded || node.children.length === 0) {
            node.subtreeWidth = CARD_WIDTH;
            return;
        }
        let totalW = 0;
        node.children.forEach((ch, idx) => {
            this.computeLayout(ch);
            if (idx > 0) totalW += H_GAP;
            totalW += ch.subtreeWidth;
        });
        node.subtreeWidth = Math.max(CARD_WIDTH, totalW);
    }

    private assignCoordinates(node: StaffNode, leftX: number, topY: number): void {
        node.x = leftX + node.subtreeWidth / 2 - CARD_WIDTH / 2;
        node.y = topY;

        if (!node.expanded || node.children.length === 0) return;

        let childrenTotalW = 0;
        node.children.forEach((ch, idx) => {
            if (idx > 0) childrenTotalW += H_GAP;
            childrenTotalW += ch.subtreeWidth;
        });

        let currX = leftX + (node.subtreeWidth - childrenTotalW) / 2;
        const nextY = topY + CARD_HEIGHT + V_GAP;

        node.children.forEach((ch) => {
            this.assignCoordinates(ch, currX, nextY);
            currX += ch.subtreeWidth + H_GAP;
        });
    }

    private renderTree(): void {
        while (this.linksGroup.firstChild) {
            this.linksGroup.removeChild(this.linksGroup.firstChild);
        }
        while (this.nodesGroup.firstChild) {
            this.nodesGroup.removeChild(this.nodesGroup.firstChild);
        }

        if (!this.rootNode) return;

        this.computeLayout(this.rootNode);
        this.assignCoordinates(this.rootNode, 0, 0);

        const visibleNodes: StaffNode[] = [];
        const collectVisible = (n: StaffNode) => {
            visibleNodes.push(n);
            if (n.expanded) {
                n.children.forEach(collectVisible);
            }
        };
        collectVisible(this.rootNode);

        // Draw smooth cubic Bezier connector lines
        visibleNodes.forEach((n) => {
            if (!n.expanded) return;
            const startX = n.x + CARD_WIDTH / 2;
            const startY = n.y + CARD_HEIGHT;
            n.children.forEach((ch) => {
                const endX = ch.x + CARD_WIDTH / 2;
                const endY = ch.y;
                const midY = (startY + endY) / 2;

                const path = document.createElementNS(SVG_NS, "path");
                const d = `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`;
                path.setAttribute("d", d);
                path.setAttribute(
                    "class",
                    ch.isMatch || ch.isActiveMatch ? "scw-link scw-link-highlighted" : "scw-link"
                );
                this.linksGroup.appendChild(path);
            });
        });

        // Draw Node Cards
        const hasAnySearch = this.matchedNodes.length > 0;
        visibleNodes.forEach((node) => {
            const g = this.renderNodeCard(node, hasAnySearch);
            this.nodesGroup.appendChild(g);
        });

        this.applyTransform();
    }

    private renderNodeCard(node: StaffNode, hasAnySearch: boolean): SVGGElement {
        const g = document.createElementNS(SVG_NS, "g") as SVGGElement;
        g.setAttribute("class", "scw-node-group");
        g.setAttribute("transform", `translate(${node.x}, ${node.y})`);

        const isSelected = this.selectedNodeId === node.id;
        const isDimmed = hasAnySearch && !node.isMatch;
        if (isDimmed) {
            g.setAttribute("opacity", "0.42");
        }

        // Native SVG Tooltip (<title>)
        const titleEl = document.createElementNS(SVG_NS, "title");
        const extraTooltip = node.extras.map((e) => `${e.label}: ${e.value}`).join("\n");
        titleEl.textContent = [
            `${node.name} (#${node.id})`,
            extraTooltip,
            `Direct Reports: ${node.directReports} | Total Subtree: ${node.totalReports}`,
            `Hierarchy Status: ${node.status}`,
        ]
            .filter(Boolean)
            .join("\n");
        g.appendChild(titleEl);

        // Card background
        const rect = document.createElementNS(SVG_NS, "rect");
        rect.setAttribute("width", String(CARD_WIDTH));
        rect.setAttribute("height", String(CARD_HEIGHT));
        rect.setAttribute("rx", "8");
        rect.setAttribute("ry", "8");
        rect.setAttribute("fill", node.isActiveMatch ? "#fff5f5" : isSelected ? "#eff6ff" : "#ffffff");

        let strokeColor = "#cbd5e1";
        let strokeWidth = "1.5";
        if (node.isActiveMatch) {
            strokeColor = "#da291c";
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
            node.depth === 1
                ? "#003087"
                : node.isActiveMatch
                ? "#da291c"
                : this.showHealthBadges && isNonStandard
                ? "#ed8b00"
                : "#005eb8";

        const topBar = document.createElementNS(SVG_NS, "rect");
        topBar.setAttribute("x", "0");
        topBar.setAttribute("y", "0");
        topBar.setAttribute("width", String(CARD_WIDTH));
        topBar.setAttribute("height", "7");
        topBar.setAttribute("rx", "8");
        topBar.setAttribute("fill", headerColor);
        g.appendChild(topBar);

        // Name text
        const nameText = document.createElementNS(SVG_NS, "text");
        nameText.setAttribute("x", "12");
        nameText.setAttribute("y", "26");
        nameText.setAttribute("fill", "#0f172a");
        nameText.setAttribute("font-size", "13px");
        nameText.setAttribute("font-weight", "700");
        nameText.textContent = this.truncate(node.name, 26);
        g.appendChild(nameText);

        // Extra Line 1 (e.g. Level 3 Directorate)
        const line1Val = node.extras.length > 0 ? node.extras[0].value : `ID: ${node.id}`;
        const sub1 = document.createElementNS(SVG_NS, "text");
        sub1.setAttribute("x", "12");
        sub1.setAttribute("y", "45");
        sub1.setAttribute("fill", "#334155");
        sub1.setAttribute("font-size", "11px");
        sub1.setAttribute("font-weight", "600");
        sub1.textContent = this.truncate(line1Val, 31);
        g.appendChild(sub1);

        // Extra Line 2 (e.g. Level 6 Service Line)
        const line2Val = node.extras.length > 1 ? node.extras[1].value : "";
        if (line2Val) {
            const sub2 = document.createElementNS(SVG_NS, "text");
            sub2.setAttribute("x", "12");
            sub2.setAttribute("y", "61");
            sub2.setAttribute("fill", "#64748b");
            sub2.setAttribute("font-size", "10.5px");
            sub2.textContent = this.truncate(line2Val, 33);
            g.appendChild(sub2);
        }

        // Optional Health Status Badge (for Bridged via Leaver / Fallback / Manual Override)
        if (this.showHealthBadges && isNonStandard) {
            const badgeText = document.createElementNS(SVG_NS, "text");
            badgeText.setAttribute("x", "12");
            badgeText.setAttribute("y", "76");
            badgeText.setAttribute("fill", "#b45309");
            badgeText.setAttribute("font-size", "9.5px");
            badgeText.setAttribute("font-weight", "700");
            badgeText.textContent = `⚡ ${this.truncate(node.status, 30)}`;
            g.appendChild(badgeText);
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

        // Expand/Collapse Pill at bottom of card if node has direct reports
        if (node.directReports > 0) {
            const pillG = document.createElementNS(SVG_NS, "g") as SVGGElement;
            const pillW = 128;
            const pillH = 20;
            const pillX = (CARD_WIDTH - pillW) / 2;
            const pillY = CARD_HEIGHT - pillH / 2 - 2;

            const pillRect = document.createElementNS(SVG_NS, "rect");
            pillRect.setAttribute("x", String(pillX));
            pillRect.setAttribute("y", String(pillY));
            pillRect.setAttribute("width", String(pillW));
            pillRect.setAttribute("height", String(pillH));
            pillRect.setAttribute("rx", "10");
            pillRect.setAttribute("fill", node.expanded ? "#e2e8f0" : "#005eb8");
            pillRect.setAttribute("stroke", node.expanded ? "#94a3b8" : "#003087");
            pillRect.setAttribute("stroke-width", "1");

            const pillLabel = document.createElementNS(SVG_NS, "text");
            pillLabel.setAttribute("x", String(CARD_WIDTH / 2));
            pillLabel.setAttribute("y", String(pillY + 13.5));
            pillLabel.setAttribute("text-anchor", "middle");
            pillLabel.setAttribute("fill", node.expanded ? "#1e293b" : "#ffffff");
            pillLabel.setAttribute("font-size", "10px");
            pillLabel.setAttribute("font-weight", "700");
            pillLabel.textContent = node.expanded
                ? `▼ ${node.directReports} direct · ${node.totalReports} all`
                : `▶ +${node.directReports} (${node.totalReports} total)`;

            pillG.appendChild(pillRect);
            pillG.appendChild(pillLabel);

            pillG.addEventListener("click", (e: MouseEvent) => {
                e.stopPropagation();
                node.expanded = !node.expanded;
                this.renderTree();
            });

            g.appendChild(pillG);
        }

        return g;
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
    }

    private zoomBy(factor: number): void {
        const rect = this.svgElement.getBoundingClientRect();
        const cx = rect.width / 2;
        const cy = rect.height / 2;
        const nextScale = Math.min(2.2, Math.max(0.12, this.scale * factor));
        this.panX = cx - ((cx - this.panX) / this.scale) * nextScale;
        this.panY = cy - ((cy - this.panY) / this.scale) * nextScale;
        this.scale = nextScale;
        this.applyTransform();
    }

    private centerOnNode(node: StaffNode): void {
        const rect = this.svgElement.getBoundingClientRect();
        const w = rect.width || 1100;
        const h = rect.height || 640;
        this.scale = Math.max(this.scale, 0.85);
        this.panX = w / 2 - (node.x + CARD_WIDTH / 2) * this.scale;
        this.panY = h / 2 - (node.y + CARD_HEIGHT / 2) * this.scale;
        this.applyTransform();
    }

    private fitToScreen(): void {
        if (!this.rootNode) return;
        const rect = this.svgElement.getBoundingClientRect();
        const w = rect.width || 1100;
        const h = rect.height || 640;

        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;

        const walk = (n: StaffNode) => {
            minX = Math.min(minX, n.x);
            maxX = Math.max(maxX, n.x + CARD_WIDTH);
            minY = Math.min(minY, n.y);
            maxY = Math.max(maxY, n.y + CARD_HEIGHT);
            if (n.expanded) {
                n.children.forEach(walk);
            }
        };
        walk(this.rootNode);

        const treeW = Math.max(CARD_WIDTH, maxX - minX);
        const treeH = Math.max(CARD_HEIGHT, maxY - minY);
        const padX = 60;
        const padTop = 76;
        const padBottom = 48;

        const availW = Math.max(200, w - padX * 2);
        const availH = Math.max(150, h - padTop - padBottom);

        this.scale = Math.min(1.0, Math.max(0.18, Math.min(availW / treeW, availH / treeH)));
        this.panX = (w - treeW * this.scale) / 2 - minX * this.scale;
        this.panY = padTop + (availH - treeH * this.scale) / 2 - minY * this.scale;
        this.applyTransform();
    }
}
