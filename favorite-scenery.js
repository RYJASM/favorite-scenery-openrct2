// ==============================================================
// Favorite Scenery Plugin for OpenRCT2
// Two-tab window: browse all scenery, save favorites, place them.
// ==============================================================

(function () {

    // ---- Layout constants ----
    var GRID_COLS  = 6;
    var GRID_ROWS  = 7;
    var GRID_SIZE  = GRID_COLS * GRID_ROWS; // 48 buttons
    var BTN_SIZE   = 40;
    var THUMB_PAD  = 4;  // padding around sprite inside each button cell
    var BTN_GAP    = 4;
    var MARGIN     = 6;
    var WIN_WIDTH  = (GRID_COLS * BTN_SIZE) + ((GRID_COLS-1) * BTN_GAP) + 4 * MARGIN;

    // Grid X offset: left margin
    var GRID_LEFT  = 2*MARGIN;

    // Tab 0 (All Scenery): groupbox at y=44 (h=45), grid groupbox at y=93 (h=321)
    //   search row at y=60, type+page row at y=73, grid at y=106
    var ALL_SEARCH_Y = 64;
    var ALL_CTRL_Y   = 80;
    var ALL_GRID_Y   = 119;

    // Tab 1 (Favorites): three groupboxes — Collection (y=44,h=27), Filter (y=75,h=45), Scenery (y=124,dynamic)
    //   collection row y=57, search y=88, type y=104, status y=137, grid y=152
    var FAV_COLL_Y    = 62;
    var FAV_SEARCH_Y  = 100;
    var FAV_TYPE_Y    = 116;
    var FAV_STATUS_Y  = 137;
    var FAV_GRID_Y    = 156;
    var FAV_GB3_Y     = 140;  // "Choose Scenery" groupbox top — used for dynamic height calc
    // Pick button spans both control rows on the left; all other controls are offset right by this amount
    var FAV_CTRL_OFF  = 26 + THUMB_PAD;

    // Hover label: 6px below groupbox bottom (groupbox bottom = grid bottom + 4px padding)
    var ALL_HOVER_Y = ALL_GRID_Y + GRID_ROWS * (BTN_SIZE + BTN_GAP) - BTN_GAP + 10;
    var FAV_HOVER_Y = FAV_GRID_Y + GRID_ROWS * (BTN_SIZE + BTN_GAP) - BTN_GAP + 10;

    // Tab 2 (Import/Export): no grid, fixed shorter height
    var IO_WIN_HEIGHT = 160;

    // ---- Scenery type config ----
    var SCENERY_TYPES = [
        "small_scenery",
        "large_scenery",
        "wall",
        "footpath_addition",
        "banner"
    ];

    var TYPE_LABELS = [
        "All Types",
        "Small Scenery",
        "Large Scenery",
        "Trees & Plants",
        "Walls",
        "Path Items",
        "Banners"
    ];

    var TYPE_VALUES = [
        "all",
        "small_scenery",
        "large_scenery",
        "vegetation",        // special: filtered by scenery group membership
        "wall",
        "footpath_addition",
        "banner"
    ];

    // Tab 1 type filter also includes "Recently Placed" (Tab 0 keeps TYPE_LABELS/TYPE_VALUES)
    var FAV_TYPE_LABELS = [
        "All Types",
        "Recently Placed",
        "Small Scenery",
        "Large Scenery",
        "Trees & Plants",
        "Walls",
        "Path Items",
        "Banners"
    ];
    var FAV_TYPE_VALUES = [
        "all",
        "recent",
        "small_scenery",
        "large_scenery",
        "vegetation",
        "wall",
        "footpath_addition",
        "banner"
    ];


    var ACTION_NAME = {
        "small_scenery":    "smallsceneryplace",
        "large_scenery":    "largesceneryplace",
        "wall":             "wallplace",
        "footpath_addition":"footpathadditionplace",
        "banner":           "bannerplace"
    };

    var STORAGE_KEY     = "FavoriteScenery.favorites";   // legacy key (migration only)
    var COLLECTIONS_KEY = "FavoriteScenery.collections";
    var ACTIVE_COLL_KEY = "FavoriteScenery.activeCollection";
    var RECENT_KEY      = "FavoriteScenery.recent";
    var COLORS_KEY      = "FavoriteScenery.globalColors";
    var RECENT_MAX      = 16;

    // ---- Mutable state ----
    var collections   = [{name: "Default", items: []}];  // [{name, items:[{type,identifier}]}]
    var activeCollIdx = 0;
    var recentItems   = [];   // recently placed items, newest first
    var filteredCatalog = [];   // [{type, obj}] for Tab 0
    var allPageItems    = [];   // current page slice for Tab 0
    var favPageItems    = [];   // current page slice for Tab 1
    var allCurrentPage  = 0;
    var favCurrentPage  = 0;
    var currentTypeIdx  = 0;
    var favTypeIdx      = 0;   // Tab 1 type filter index (independent of Tab 0)
    var activeWindow      = null;
    var thumbRange        = null;   // ImageIndexRange for pre-rendered thumbnails
    var needHoverRestart  = false;  // set by tool onFinish; picked up by onUpdate to avoid re-entrancy
    var hoveredFavItem    = null;   // fav item currently under the cursor (Tab 1 only)
    var globalPrimaryColour   = 0;  // global placement palette — applied to every item placed
    var globalSecondaryColour = 0;
    var globalTertiaryColour  = 0;
    var searchText       = "";    // current search query for Tab 0
    var favSearchText    = "";    // current search query for Tab 1
    var activePlacingItem    = null;  // {type, identifier} of item currently being placed, or null
    var suppressPlacerFinish = false; // true while switching placement to suppress old tool's onFinish cleanup
    var ioExportCollIdx      = 0;    // Tab 2: 0 = all collections, 1+ = collections[i-1]
    var ioStatusText         = "";   // Tab 2: result of last import operation

    // ---- Storage helpers ----
    function loadData() {
        // Load collections, migrating from legacy flat-array format if needed
        var stored = context.sharedStorage.get(COLLECTIONS_KEY);
        if (Array.isArray(stored) && stored.length > 0) {
            collections = stored;
        } else {
            var legacy = context.sharedStorage.get(STORAGE_KEY);
            if (Array.isArray(legacy) && legacy.length > 0) {
                collections = [{name: "Default", items: legacy}];
                context.sharedStorage.set(COLLECTIONS_KEY, collections);
                context.sharedStorage.set(STORAGE_KEY, []);
            } else {
                collections = [{name: "Default", items: []}];
            }
        }
        var savedIdx = context.sharedStorage.get(ACTIVE_COLL_KEY);
        activeCollIdx = (typeof savedIdx === "number" && savedIdx >= 0 && savedIdx < collections.length) ? savedIdx : 0;
        var savedRecent = context.sharedStorage.get(RECENT_KEY);
        recentItems = Array.isArray(savedRecent) ? savedRecent : [];
        var savedColors = context.sharedStorage.get(COLORS_KEY);
        if (savedColors) {
            globalPrimaryColour   = savedColors.primary   || 0;
            globalSecondaryColour = savedColors.secondary || 0;
            globalTertiaryColour  = savedColors.tertiary  || 0;
        }
    }

    function saveGlobalColors() {
        context.sharedStorage.set(COLORS_KEY, {
            primary:   globalPrimaryColour,
            secondary: globalSecondaryColour,
            tertiary:  globalTertiaryColour
        });
    }

    function saveCollections() {
        context.sharedStorage.set(COLLECTIONS_KEY, collections);
        context.sharedStorage.set(ACTIVE_COLL_KEY, activeCollIdx);
    }

    function saveRecent() {
        context.sharedStorage.set(RECENT_KEY, recentItems);
    }

    function isFav(type, identifier) {
        var items = collections[activeCollIdx].items;
        for (var i = 0; i < items.length; i++) {
            if (items[i].type === type && items[i].identifier === identifier) return true;
        }
        return false;
    }

    function toggleFav(type, identifier) {
        if (isFav(type, identifier)) {
            collections[activeCollIdx].items = collections[activeCollIdx].items.filter(function (f) {
                return !(f.type === type && f.identifier === identifier);
            });
        } else {
            collections[activeCollIdx].items.push({ type: type, identifier: identifier });
        }
        saveCollections();
    }

    // ---- Catalog builders ----

    // Returns a lookup object {identifier: true} for all objects that belong to
    // scenery groups whose name contains vegetation-related keywords.
    function getVegetationIdentifiers() {
        var ids = {};
        var KEYWORDS = ["tree", "plant", "garden", "shrub", "bush", "flower", "palm", "fern"];
        try {
            var groups = objectManager.getAllObjects("scenery_group");
            for (var g = 0; g < groups.length; g++) {
                var name = (groups[g].name || "").toLowerCase();
                var isVeg = false;
                for (var k = 0; k < KEYWORDS.length; k++) {
                    if (name.indexOf(KEYWORDS[k]) !== -1) { isVeg = true; break; }
                }
                if (isVeg) {
                    var items = groups[g].items;
                    for (var m = 0; m < items.length; m++) {
                        ids[items[m]] = true;
                    }
                }
            }
        } catch (e) { /* ignore */ }
        return ids;
    }

    function buildCatalog(typeFilter) {
        var list = [];
        if (typeFilter === "vegetation") {
            var vegIds = getVegetationIdentifiers();
            var vegTypes = ["small_scenery", "large_scenery"];
            for (var vi = 0; vi < vegTypes.length; vi++) {
                try {
                    var vobjs = objectManager.getAllObjects(vegTypes[vi]);
                    for (var vo = 0; vo < vobjs.length; vo++) {
                        if (vegIds[vobjs[vo].identifier]) {
                            list.push({ type: vegTypes[vi], obj: vobjs[vo] });
                        }
                    }
                } catch (e) { /* ignore */ }
            }
        } else {
            var types = (typeFilter === "all") ? SCENERY_TYPES : [typeFilter];
            for (var ti = 0; ti < types.length; ti++) {
                var t = types[ti];
                try {
                    var objs = objectManager.getAllObjects(t);
                    for (var oi = 0; oi < objs.length; oi++) {
                        list.push({ type: t, obj: objs[oi] });
                    }
                } catch (e) { /* unsupported type in this build */ }
            }
        }
        list.sort(function (a, b) {
            var na = (a.obj.name || "").toLowerCase();
            var nb = (b.obj.name || "").toLowerCase();
            return na < nb ? -1 : na > nb ? 1 : 0;
        });
        return list;
    }

    function buildFavItems() {
        var result = [];
        var items = collections[activeCollIdx].items;
        for (var i = 0; i < items.length; i++) {
            var fav = items[i];
            var obj = null;
            try {
                var objs = objectManager.getAllObjects(fav.type);
                for (var j = 0; j < objs.length; j++) {
                    if (objs[j].identifier === fav.identifier) {
                        obj = objs[j];
                        break;
                    }
                }
            } catch (e) { /* skip */ }
            result.push({ type: fav.type, identifier: fav.identifier, obj: obj, available: (obj !== null) });
        }
        return result;
    }

    function buildRecentItems() {
        var result = [];
        for (var i = 0; i < recentItems.length; i++) {
            var rec = recentItems[i];
            var obj = null;
            try {
                var objs = objectManager.getAllObjects(rec.type);
                for (var j = 0; j < objs.length; j++) {
                    if (objs[j].identifier === rec.identifier) { obj = objs[j]; break; }
                }
            } catch (e) { /* skip */ }
            result.push({ type: rec.type, identifier: rec.identifier, obj: obj, available: (obj !== null) });
        }
        return result;
    }

    function addToRecent(type, identifier) {
        recentItems = recentItems.filter(function (r) {
            return !(r.type === type && r.identifier === identifier);
        });
        recentItems.unshift({ type: type, identifier: identifier });
        if (recentItems.length > RECENT_MAX) recentItems.length = RECENT_MAX;
        saveRecent();
    }

    function createCollection(name) {
        collections.push({ name: name, items: [] });
        activeCollIdx = collections.length - 1;
        saveCollections();
        if (activeWindow) { refreshCollectionDropdown(activeWindow); updateFavGrid(activeWindow); }
    }

    function deleteActiveCollection() {
        if (collections.length <= 1) return;
        collections.splice(activeCollIdx, 1);
        if (activeCollIdx >= collections.length) activeCollIdx = collections.length - 1;
        saveCollections();
        if (activeWindow) { refreshCollectionDropdown(activeWindow); updateFavGrid(activeWindow); }
    }

    function renameActiveCollection(name) {
        if (!name) return;
        collections[activeCollIdx].name = name;
        saveCollections();
        if (activeWindow) { refreshCollectionDropdown(activeWindow); updateFavGrid(activeWindow); }
    }

    function updateWindowTitle(win) {
        if (!win) return;
        if (win.tabIndex === 0) {
            win.title = "Add Scenery to "+ collections[activeCollIdx].name + " Collection";
        } else if (win.tabIndex === 1) {
            win.title = collections[activeCollIdx].name + " Collection";
        } else {
            win.title = "Import / Export Collections";
        }
    }

    function refreshCollectionDropdown(win) {
        var dd = win.findWidget("fav_coll_select");
        if (dd) {
            dd.items = collections.map(function (c) { return c.name; });
            dd.selectedIndex = activeCollIdx;
        }
        var delBtn = win.findWidget("fav_coll_delete");
        if (delBtn) delBtn.isDisabled = (collections.length <= 1);
    }

    // ---- Import / Export helpers ----

    function buildExportDropdownItems() {
        var items = ["All Collections"];
        for (var i = 0; i < collections.length; i++) {
            items.push(collections[i].name);
        }
        return items;
    }

    function refreshIoCollDropdown(win) {
        var dd = win.findWidget("io_coll_select");
        if (!dd) return;
        dd.items = buildExportDropdownItems();
        if (ioExportCollIdx >= dd.items.length) ioExportCollIdx = 0;
        dd.selectedIndex = ioExportCollIdx;
    }

    function exportCollections(exportIdx) {
        var toExport = (exportIdx === 0) ? collections : [collections[exportIdx - 1]];
        var data = {
            version: 1,
            collections: toExport.map(function (c) {
                return { name: c.name, items: c.items.slice() };
            })
        };
        return JSON.stringify(data);
    }

    function importCollections(jsonStr) {
        var data;
        try { data = JSON.parse(jsonStr); } catch (e) { return "Error: invalid JSON"; }
        if (!data || !Array.isArray(data.collections)) { return "Error: missing collections array"; }
        var addedColls = 0, addedItems = 0;
        for (var ci = 0; ci < data.collections.length; ci++) {
            var incoming = data.collections[ci];
            if (!incoming || !incoming.name || !Array.isArray(incoming.items)) continue;
            var existing = null;
            for (var ei = 0; ei < collections.length; ei++) {
                if (collections[ei].name === incoming.name) { existing = collections[ei]; break; }
            }
            if (existing) {
                // Merge: add only items not already present
                for (var ii = 0; ii < incoming.items.length; ii++) {
                    var item = incoming.items[ii];
                    if (!item || !item.type || !item.identifier) continue;
                    var found = false;
                    for (var ji = 0; ji < existing.items.length; ji++) {
                        if (existing.items[ji].type === item.type && existing.items[ji].identifier === item.identifier) {
                            found = true; break;
                        }
                    }
                    if (!found) { existing.items.push({ type: item.type, identifier: item.identifier }); addedItems++; }
                }
            } else {
                // New collection — add all items
                var newColl = { name: incoming.name, items: [] };
                for (var ii2 = 0; ii2 < incoming.items.length; ii2++) {
                    var item2 = incoming.items[ii2];
                    if (item2 && item2.type && item2.identifier) {
                        newColl.items.push({ type: item2.type, identifier: item2.identifier });
                        addedItems++;
                    }
                }
                collections.push(newColl);
                addedColls++;
            }
        }
        saveCollections();
        var msg = addedColls > 0
            ? addedColls + " new collection" + (addedColls !== 1 ? "s" : "") + ", " + addedItems + " item" + (addedItems !== 1 ? "s" : "") + " added"
            : addedItems + " new item" + (addedItems !== 1 ? "s" : "") + " merged";
        return msg;
    }

    // ---- Tab 2 widgets ----
    function buildTab2Widgets() {
        var w = [];
        var INNER  = MARGIN + 6;
        var GBWIDE = WIN_WIDTH - MARGIN * 2;

        // Export groupbox
        w.push({ type: "groupbox", name: "io_export_box", x: MARGIN, y: 48, width: GBWIDE, height: 32, text: "Export" });
        w.push({ type: "label", name: "io_coll_lbl", x: INNER, y: 62, width: 68, height: 12, text: "Collection:" });
        var dropW = WIN_WIDTH - MARGIN - 56 - 4 - (INNER + 70);
        w.push({
            type:          "dropdown",
            name:          "io_coll_select",
            x:             INNER + 70,
            y:             61,
            width:         dropW,
            height:        13,
            items:         buildExportDropdownItems(),
            selectedIndex: ioExportCollIdx,
            onChange:      function (idx) { ioExportCollIdx = idx; }
        });
        w.push({
            type:    "button",
            name:    "io_export_btn",
            x:       WIN_WIDTH - MARGIN - 56,
            y:       60,
            width:   50,
            height:  14,
            text:    "Export",
            onClick: function () {
                var json = exportCollections(ioExportCollIdx);
                ui.showTextInput({
                    title:        "Export Collections",
                    description:  "Select all and copy (Ctrl+A, Ctrl+C):",
                    initialValue: json,
                    maxLength:    500000,
                    callback:     function () {}
                });
            }
        });

        // Import groupbox
        w.push({ type: "groupbox", name: "io_import_box", x: MARGIN, y: 84, width: GBWIDE, height: 48, text: "Import (merge-only)" });
        w.push({
            type:   "label",
            name:   "io_import_hint",
            x:      INNER,
            y:      97,
            width:  GBWIDE - 12,
            height: 12,
            text:   "Paste exported JSON, then click OK to merge."
        });
        w.push({
            type:    "button",
            name:    "io_import_btn",
            x:       INNER,
            y:       111,
            width:   GBWIDE - 12,
            height:  14,
            text:    "Import JSON...",
            onClick: function () {
                ui.showTextInput({
                    title:        "Import Collections",
                    description:  "Paste exported JSON and click OK:",
                    initialValue: "",
                    maxLength:    500000,
                    callback:     function (value) {
                        if (!value || !value.trim()) return;
                        var result = importCollections(value.trim());
                        ioStatusText = result;
                        if (activeWindow) {
                            var lbl = activeWindow.findWidget("io_status");
                            if (lbl) lbl.text = result;
                            refreshIoCollDropdown(activeWindow);
                            refreshCollectionDropdown(activeWindow);
                        }
                    }
                });
            }
        });

        // Status label — shows result of last import
        w.push({ type: "label", name: "io_status", x: MARGIN, y: 137, width: GBWIDE, height: 12, text: ioStatusText });

        return w;
    }

    // ---- Search filter ----
    function applySearch(catalog, query) {
        if (!query) return catalog;
        var q = query.toLowerCase();
        return catalog.filter(function (item) {
            // item.obj may be null for unavailable favorites — fall back to identifier
            var name = (item.obj ? (item.obj.name || "") : "").toLowerCase();
            var id   = (item.obj ? (item.obj.identifier || "") : (item.identifier || "")).toLowerCase();
            return name.indexOf(q) !== -1 || id.indexOf(q) !== -1;
        });
    }

    // ---- Thumbnail rendering ----
    // Pre-renders each sprite into a fixed BTN_SIZE x BTN_SIZE image slot,
    // applying the sprite's built-in offset so the image is centered and clipped.
    function initThumbs() {
        try {
            thumbRange = ui.imageManager.allocate(GRID_SIZE);
        } catch (e) {
            thumbRange = null;
        }
    }

    function renderThumb(gridIndex, baseImageId, pc, sc, tc) {
        if (!thumbRange) return baseImageId; // fallback: raw sprite (may overflow)
        var slotId = thumbRange.start + gridIndex;
        var failed = false;
        try {
            ui.imageManager.draw(slotId, { width: BTN_SIZE, height: BTN_SIZE }, function (g) {
                var info = g.getImage(baseImageId);
                if (!info) { failed = true; return; }
                g.clear();
                var inner = BTN_SIZE - THUMB_PAD * 2;
                var drawX = THUMB_PAD + Math.floor((inner - info.width)  / 2) - info.offset.x;
                var drawY = THUMB_PAD + Math.floor((inner - info.height) / 2) - info.offset.y;
                g.clip(THUMB_PAD, THUMB_PAD, inner, inner);
                if (pc !== undefined) g.colour          = pc;
                if (sc !== undefined) g.secondaryColour = sc;
                if (tc !== undefined) g.tertiaryColour  = tc;
                g.image(baseImageId, drawX, drawY);
            });
        } catch (e) {
            return baseImageId; // fallback if draw fails
        }
        if (failed) return baseImageId;
        // Glass and water sprites produce all-transparent pixels in the canvas context
        // because the engine's glass blending requires a real screen buffer. Detect this
        // by checking if every pixel is zero (transparent palette index) and fall back to
        // the raw sprite so the engine renders it natively against the button background.
        try {
            var pix = ui.imageManager.getPixelData(slotId);
            if (pix && pix.type === "raw" && pix.data && pix.data.length > 0) {
                var empty = true;
                for (var pi = 0; pi < pix.data.length; pi++) {
                    if (pix.data[pi] !== 0) { empty = false; break; }
                }
                if (empty) return baseImageId;
            }
        } catch (e) { /* can't check — use slotId */ }
        return slotId;
    }

    // ---- Ground height lookup ----
    function getGroundZ(mapX, mapY) {
        try {
            var tileX = Math.floor(mapX / 32);
            var tileY = Math.floor(mapY / 32);
            var tile = map.getTile(tileX, tileY);
            for (var i = 0; i < tile.elements.length; i++) {
                if (tile.elements[i].type === "surface") {
                    return tile.elements[i].baseZ;
                }
            }
        } catch (e) { /* ignore */ }
        return 0;
    }

    // ---- Placement tool ----
    function activatePlacement(item) {
        ui.activateTool({
            id:     "fav-scenery-placer",
            cursor: "cross_hair",
            filter: ["terrain"],
            onMove: function (e) {
                // Keep hover label updated while placing (hover detector is not running).
                if (activeWindow && e.screenCoords) {
                    var tabIdx    = activeWindow.tabIndex;
                    var gridTop   = (tabIdx === 0) ? ALL_GRID_Y : FAV_GRID_Y;
                    var pageItems = (tabIdx === 0) ? allPageItems : favPageItems;
                    var lblName   = (tabIdx === 0) ? "all_hover_lbl" : "fav_hover_lbl";
                    var idx = hitTestGrid(e.screenCoords.x, e.screenCoords.y, gridTop);
                    var lbl = activeWindow.findWidget(lblName);
                    if (lbl) {
                        var hi = (idx >= 0 && idx < pageItems.length) ? pageItems[idx] : null;
                        lbl.text = hi
                            ? (hi.obj ? (hi.obj.name || hi.obj.identifier || "") : (hi.identifier || ""))
                            : "";
                    }
                }
                if (!e.mapCoords) {
                    ui.tileSelection.range = null;
                    ui.tileSelection.tiles = [];
                    return;
                }
                var wx = Math.floor(e.mapCoords.x / 32) * 32;
                var wy = Math.floor(e.mapCoords.y / 32) * 32;
                // Large scenery can span multiple tiles — highlight them all.
                if (item.type === "large_scenery" && item.obj.tiles && item.obj.tiles.length > 0) {
                    ui.tileSelection.range = null;
                    ui.tileSelection.tiles = item.obj.tiles.map(function (t) {
                        return { x: wx + t.offset.x, y: wy + t.offset.y };
                    });
                } else {
                    ui.tileSelection.tiles = [];
                    ui.tileSelection.range = {
                        leftTop:     { x: wx, y: wy },
                        rightBottom: { x: wx, y: wy }
                    };
                }
            },
            onDown: function (e) {
                if (!e.mapCoords) return;
                var z = getGroundZ(e.mapCoords.x, e.mapCoords.y);
                var args = {
                    x:              e.mapCoords.x,
                    y:              e.mapCoords.y,
                    z:              z,
                    direction:      0,
                    object:         item.obj.index,
                    primaryColour:  globalPrimaryColour,
                    secondaryColour:globalSecondaryColour,
                    tertiaryColour: globalTertiaryColour
                };
                if (item.type === "small_scenery") args.quadrant = 0;
                if (item.type === "wall")          args.edge     = 0;

                context.executeAction(ACTION_NAME[item.type], args, function (result) {
                    if (!result.error) {
                        addToRecent(item.type, item.identifier);
                    } else if (activeWindow) {
                        var lbl = activeWindow.findWidget("fav_status");
                        if (lbl) lbl.text = "Error: " + (result.errorMessage || "placement failed");
                    }
                });
            },
            onFinish: function () {
                ui.tileSelection.range = null;
                ui.tileSelection.tiles = [];
                if (!suppressPlacerFinish) {
                    activePlacingItem = null;
                    if (activeWindow) {
                        updateFavButtonPressedStates(activeWindow);
                        var lbl = activeWindow.findWidget("fav_status");
                        if (lbl) lbl.text = "Click a favorite to start placing";
                    }
                    needHoverRestart = true; // restart on next onUpdate tick (avoids tool re-entrancy)
                }
            }
        });
    }

    // ---- Pagination ----
    function pageCount(total) {
        return Math.max(1, Math.ceil(total / GRID_SIZE));
    }

    // ---- Grid update: Tab 0 ----
    function updateAllGrid(win) {
        updateWindowTitle(win);
        var start = allCurrentPage * GRID_SIZE;
        allPageItems.length = 0;
        for (var i = start; i < Math.min(start + GRID_SIZE, filteredCatalog.length); i++) {
            allPageItems.push(filteredCatalog[i]);
        }

        for (var j = 0; j < GRID_SIZE; j++) {
            var btn = win.findWidget("allbtn_" + j);
            if (!btn) continue;
            if (j < allPageItems.length) {
                var item = allPageItems[j];
                btn.image     = renderThumb(j, item.obj.baseImageId);
                btn.isPressed = isFav(item.type, item.obj.identifier);
                btn.isDisabled= false;
                btn.isVisible = true;
            } else {
                btn.isVisible  = false;
                btn.isDisabled = true;
            }
        }

        var n = pageCount(filteredCatalog.length);
        var lbl = win.findWidget("all_page_lbl");
        if (lbl) lbl.text = "Pg " + (allCurrentPage + 1) + "/" + n;
        var prev = win.findWidget("all_prev");
        var next = win.findWidget("all_next");
        if (prev) prev.isDisabled = (allCurrentPage === 0);
        if (next) next.isDisabled = (allCurrentPage >= n - 1);
    }

    // ---- Grid update: Tab 1 ----
    function updateFavGrid(win) {
        updateWindowTitle(win);
        var typeFilter = FAV_TYPE_VALUES[favTypeIdx];
        var favItems;

        if (typeFilter === "recent") {
            // Recent list is pre-ordered and not filtered by type or search
            favItems = buildRecentItems();
        } else {
            var allFavItems = buildFavItems();
            if (typeFilter === "vegetation") {
                var vegIds = getVegetationIdentifiers();
                allFavItems = allFavItems.filter(function (item) {
                    return (item.type === "small_scenery" || item.type === "large_scenery")
                        && vegIds[item.identifier];
                });
            } else if (typeFilter !== "all") {
                allFavItems = allFavItems.filter(function (item) {
                    return item.type === typeFilter;
                });
            }
            favItems = applySearch(allFavItems, favSearchText);
        }

        var start = favCurrentPage * GRID_SIZE;
        favPageItems.length = 0;
        for (var i = start; i < Math.min(start + GRID_SIZE, favItems.length); i++) {
            favPageItems.push(favItems[i]);
        }

        for (var j = 0; j < GRID_SIZE; j++) {
            var btn = win.findWidget("favbtn_" + j);
            if (!btn) continue;
            if (j < favPageItems.length) {
                var item = favPageItems[j];
                btn.isVisible = true;
                btn.isPressed = activePlacingItem !== null
                    && item.type === activePlacingItem.type
                    && item.identifier === activePlacingItem.identifier;
                if (item.available) {
                    btn.image     = renderThumb(j, item.obj.baseImageId,
                        globalPrimaryColour, globalSecondaryColour, globalTertiaryColour);
                    btn.isDisabled= false;
                } else {
                    btn.image     = 0;
                    btn.isDisabled= true;
                }
            } else {
                btn.isVisible  = false;
                btn.isDisabled = true;
            }
        }

        var favTotalPages = pageCount(favItems.length);
        var lbl = win.findWidget("fav_page_lbl");
        if (lbl) lbl.text = "Pg " + (favCurrentPage + 1) + "/" + favTotalPages;
        var prev = win.findWidget("fav_prev");
        var next = win.findWidget("fav_next");
        if (prev) prev.isDisabled = (favCurrentPage === 0);
        if (next) next.isDisabled = (favCurrentPage >= favTotalPages - 1);

        // Update status label when not actively placing
        if (!(ui.tool && ui.tool.id === "fav-scenery-placer")) {
            var statusLbl = win.findWidget("fav_status");
            if (statusLbl) {
                if (typeFilter === "recent") {
                    statusLbl.text = favItems.length === 0
                        ? "No recently placed items yet"
                        : "Recently placed — click to place";
                } else {
                    statusLbl.text = favItems.length === 0
                        ? "No favorites yet — add from All Scenery tab"
                        : "Click a favorite to start placing";
                }
            }
        }

        // Dynamic window height: shrink/grow the "Choose Scenery" groupbox and window
        // based on how many rows are actually filled on the current page.
        var filledRows = favPageItems.length > 0 ? Math.ceil(favPageItems.length / GRID_COLS) : 0;
        var gridH      = filledRows > 0 ? filledRows * (BTN_SIZE + BTN_GAP) - BTN_GAP : 0;
        // GB3 height: title(13) + status label(12) + gap(3) + gridH + bottom padding(4)
        var gb3H = 13 + 10 + gridH;
        var gb3Box = win.findWidget("fav_scenery_box");
        if (gb3Box) gb3Box.height = gb3H;

        var newHoverY = FAV_GB3_Y + gb3H + 6;
        var hovLbl = win.findWidget("fav_hover_lbl");  if (hovLbl) hovLbl.y = newHoverY;
        var cp1    = win.findWidget("fav_color_1");    if (cp1)    cp1.y    = newHoverY;
        var cp2    = win.findWidget("fav_color_2");    if (cp2)    cp2.y    = newHoverY;
        var cp3    = win.findWidget("fav_color_3");    if (cp3)    cp3.y    = newHoverY;
        var rb     = win.findWidget("fav_remove_btn"); if (rb)     rb.y     = newHoverY;
        win.height = newHoverY + 20;
    }

    // Updates only the isPressed state of all fav buttons based on activePlacingItem.
    // Called when placement starts, switches, or ends to avoid a full grid rebuild.
    function updateFavButtonPressedStates(win) {
        for (var j = 0; j < GRID_SIZE; j++) {
            var btn = win.findWidget("favbtn_" + j);
            if (!btn || !btn.isVisible) continue;
            var item = (j < favPageItems.length) ? favPageItems[j] : null;
            btn.isPressed = item !== null
                && activePlacingItem !== null
                && item.type === activePlacingItem.type
                && item.identifier === activePlacingItem.identifier;
        }
    }

    // ---- Widget factory: image button grid ----
    function makeGridButtons(prefix, gridTop, onClickFn) {
        var buttons = [];
        for (var row = 0; row < GRID_ROWS; row++) {
            for (var col = 0; col < GRID_COLS; col++) {
                (function (idx, c, r) {
                    buttons.push({
                        type:      "button",
                        name:      prefix + idx,
                        x:         GRID_LEFT + c * (BTN_SIZE + BTN_GAP),
                        y:         gridTop   + r * (BTN_SIZE + BTN_GAP),
                        width:     BTN_SIZE,
                        height:    BTN_SIZE,
                        image:     0,
                        border:    true,
                        isDisabled:true,
                        isVisible: false,
                        onClick:   function () { onClickFn(idx); }
                    });
                })(row * GRID_COLS + col, col, row);
            }
        }
        return buttons;
    }

    // ---- Tab 0 widgets ----
    function buildTab0Widgets() {
        var w = [];
        var GBWIDE = WIN_WIDTH - MARGIN * 2;  // 260

        // Groupboxes (visual containers — must be pushed before the widgets they frame)
        w.push({ type: "groupbox", name: "all_filter_box", x: MARGIN, y: 48, width: GBWIDE, height: 52, text: "Select & Filter" });
        w.push({ type: "groupbox", name: "all_grid_box",   x: MARGIN, y: 104, width: GBWIDE, height: 320 + MARGIN, text: "Add to Collection" });

        // Pick button — spans both control rows on the left (mirrors Tab 1 layout)
        w.push({
            type:    "button",
            name:    "all_pick",
            x:       MARGIN + MARGIN,
            y:       ALL_SEARCH_Y,
            width:   FAV_CTRL_OFF - THUMB_PAD,
            height:  ALL_CTRL_Y + 13 - ALL_SEARCH_Y,
            image:   "eyedropper",
            border:    true,
            tooltip: "Pick Scenery",
            onClick: activatePicker
        });

        // Search field (shifted right by FAV_CTRL_OFF)
        w.push({
            type:   "label",
            name:   "search_lbl",
            x:      2*MARGIN + FAV_CTRL_OFF,
            y:      ALL_SEARCH_Y + 2,
            width:  44,
            height: 11,
            text:   "Search:"
        });
        w.push({
            type:      "textbox",
            name:      "search_input",
            x:         2*MARGIN + FAV_CTRL_OFF + 46,
            y:         ALL_SEARCH_Y,
            width:     WIN_WIDTH - 2*MARGIN - (2*MARGIN + FAV_CTRL_OFF + 46),
            height:    13,
            text:      "",
            maxLength: 100,
            onChange:  function (text) {
                searchText      = text;
                filteredCatalog = applySearch(buildCatalog(TYPE_VALUES[currentTypeIdx]), searchText);
                allCurrentPage  = 0;
                if (activeWindow) updateAllGrid(activeWindow);
            }
        });

        // Type filter dropdown (shifted right by FAV_CTRL_OFF)
        w.push({
            type:          "dropdown",
            name:          "type_filter",
            x:             2*MARGIN + FAV_CTRL_OFF,
            y:             ALL_CTRL_Y,
            width:         110,
            height:        13,
            items:         TYPE_LABELS,
            selectedIndex: 0,
            onChange:      function (idx) {
                currentTypeIdx  = idx;
                filteredCatalog = applySearch(buildCatalog(TYPE_VALUES[idx]), searchText);
                allCurrentPage  = 0;
                if (activeWindow) updateAllGrid(activeWindow);
            }
        });

        // Prev / page label / next (same relative positions as Tab 1)
        w.push({
            type:      "button",
            name:      "all_prev",
            x:         2*MARGIN + FAV_CTRL_OFF + 115,
            y:         ALL_CTRL_Y,
            width:     16,
            height:    13,
            text:      "<",
            isDisabled:true,
            onClick:   function () {
                if (allCurrentPage > 0) {
                    allCurrentPage--;
                    if (activeWindow) updateAllGrid(activeWindow);
                }
            }
        });
        w.push({
            type:      "label",
            name:      "all_page_lbl",
            x:         2*MARGIN + FAV_CTRL_OFF + 131,
            y:         ALL_CTRL_Y + 2,
            width:     83,
            height:    10,
            textAlign: "centred",
            text:      "Pg 1/1"
        });
        w.push({
            type:      "button",
            name:      "all_next",
            x:         2*MARGIN + FAV_CTRL_OFF + 214,
            y:         ALL_CTRL_Y,
            width:     16,
            height:    13,
            text:      ">",
            isDisabled:true,
            onClick:   function () {
                var n = pageCount(filteredCatalog.length);
                if (allCurrentPage < n - 1) {
                    allCurrentPage++;
                    if (activeWindow) updateAllGrid(activeWindow);
                }
            }
        });

        // Image button grid
        var btns = makeGridButtons("allbtn_", ALL_GRID_Y, function (i) {
            if (i >= allPageItems.length) return;
            var item = allPageItems[i];
            // If picker is active, cancel it before toggling (unpress pick, then toggle item)
            if (ui.tool && ui.tool.id === "fav-scenery-picker") {
                ui.tool.cancel(); // onFinish sets needHoverRestart = true
                needHoverRestart = false;
            }
            toggleFav(item.type, item.obj.identifier);
            if (activeWindow) {
                var btn = activeWindow.findWidget("allbtn_" + i);
                if (btn) {
                    btn.isPressed = isFav(item.type, item.obj.identifier);
                }
            }
        });
        for (var bi = 0; bi < btns.length; bi++) w.push(btns[bi]);

        // Hover label: shows item name when cursor is over a grid button
        w.push({
            type:   "label",
            name:   "all_hover_lbl",
            x:      MARGIN,
            y:      ALL_HOVER_Y,
            width:  WIN_WIDTH - MARGIN * 2,
            height: 13,
            text:   ""
        });

        return w;
    }

    // ---- Tab 1 widgets ----
    function buildTab1Widgets() {
        var w = [];
        var GBWIDE = WIN_WIDTH - MARGIN * 2;  // 260

        // Groupboxes (visual containers — must be pushed before the widgets they frame)
        // "Choose Scenery" (GB3) height is dynamic; initial value covers all 7 rows.
        w.push({ type: "groupbox", name: "fav_coll_box",    x: MARGIN, y: 48,          width: GBWIDE, height: 34,  text: "Favorites Collection" });
        w.push({ type: "groupbox", name: "fav_filter_box",  x: MARGIN, y: 85,          width: GBWIDE, height: 50,  text: "Select & Filter" });
        w.push({ type: "groupbox", name: "fav_scenery_box", x: MARGIN, y: FAV_GB3_Y,   width: GBWIDE, height: 336, text: "Choose Scenery to Place" });

        // Collections row: dropdown + New/Rename/Delete buttons
        w.push({
            type:          "dropdown",
            name:          "fav_coll_select",
            x:             2*MARGIN,
            y:             FAV_COLL_Y,
            width:         154,
            height:        13,
            items:         collections.map(function (c) { return c.name; }),
            selectedIndex: activeCollIdx,
            onChange:      function (idx) {
                activeCollIdx  = idx;
                saveCollections();
                favCurrentPage = 0;
                if (activeWindow) updateFavGrid(activeWindow);
            }
        });
        w.push({
            type:      "button",
            name:      "fav_coll_new",
            x:         2*MARGIN + 156,
            y:         FAV_COLL_Y,
            width:     22,
            height:    13,
            text:      "+",
            onClick:   function () { showNewCollectionDialog(); }
        });
        w.push({
            type:      "button",
            name:      "fav_coll_rename",
            x:         2*MARGIN + 180,
            y:         FAV_COLL_Y,
            width:     50,
            height:    13,
            text:      "Rename",
            onClick:   function () { showRenameCollectionDialog(); }
        });
        w.push({
            type:       "button",
            name:       "fav_coll_delete",
            x:          2*MARGIN + 232,
            y:          FAV_COLL_Y,
            width:      28,
            height:     13,
            text:       "Del",
            isDisabled: (collections.length <= 1),
            onClick:    function () { showDeleteCollectionConfirm(); }
        });

        // Pick button — spans both control rows on the left
        w.push({
            type:    "button",
            name:    "fav_pick",
            x:       2*MARGIN,
            y:       FAV_SEARCH_Y,
            width:   FAV_CTRL_OFF - THUMB_PAD,   // 32px; 2px gap before other controls
            height:  FAV_TYPE_Y + 13 - FAV_SEARCH_Y,  // 29px, spans search+type rows
            image:   "eyedropper",
            border:    true,
            tooltip: "Pick Scenery",
            onClick: activatePicker
        });

        // Search field (shifted right by FAV_CTRL_OFF)
        w.push({
            type:   "label",
            name:   "fav_search_lbl",
            x:      2*MARGIN + FAV_CTRL_OFF,
            y:      FAV_SEARCH_Y + 2,
            width:  44,
            height: 11,
            text:   "Search:"
        });
        w.push({
            type:      "textbox",
            name:      "fav_search_input",
            x:         2*MARGIN + FAV_CTRL_OFF + 46,
            y:         FAV_SEARCH_Y,
            width:     WIN_WIDTH - 2*MARGIN - FAV_CTRL_OFF - 46 - 2*MARGIN,
            height:    13,
            text:      "",
            maxLength: 100,
            onChange:  function (text) {
                favSearchText  = text;
                favCurrentPage = 0;
                if (activeWindow) updateFavGrid(activeWindow);
            }
        });

        // Type filter dropdown (shifted right by FAV_CTRL_OFF)
        w.push({
            type:          "dropdown",
            name:          "fav_type_filter",
            x:             2*MARGIN + FAV_CTRL_OFF,
            y:             FAV_TYPE_Y,
            width:         110,
            height:        13,
            items:         FAV_TYPE_LABELS,
            selectedIndex: 0,
            onChange:      function (idx) {
                favTypeIdx     = idx;
                favCurrentPage = 0;
                if (activeWindow) updateFavGrid(activeWindow);
            }
        });
/*
        // Status label
        w.push({
            type:  "label",
            name:  "fav_status",
            x:     MARGIN,
            y:     FAV_STATUS_Y,
            width: WIN_WIDTH - MARGIN * 2,
            height: 12,
            text:  "Click a favorite to start placing"
        });
        */

        // Prev / page label / next (same row as dropdown, shifted right by FAV_CTRL_OFF)
        w.push({
            type:      "button",
            name:      "fav_prev",
            x:         2*MARGIN + FAV_CTRL_OFF + 115,
            y:         FAV_TYPE_Y,
            width:     16,
            height:    13,
            text:      "<",
            isDisabled:true,
            onClick:   function () {
                if (favCurrentPage > 0) {
                    favCurrentPage--;
                    if (activeWindow) updateFavGrid(activeWindow);
                }
            }
        });
        w.push({
            type:      "label",
            name:      "fav_page_lbl",
            x:         2*MARGIN + FAV_CTRL_OFF + 131,
            y:         FAV_TYPE_Y + 2,
            width:     83,
            height:    10,
            text:      "Pg 1/1",
            textAlign: "centred"
        });
        w.push({
            type:      "button",
            name:      "fav_next",
            x:         2*MARGIN + FAV_CTRL_OFF + 214,
            y:         FAV_TYPE_Y,
            width:     16,
            height:    13,
            text:      ">",
            isDisabled:true,
            onClick:   function () {
                var typeFilter = FAV_TYPE_VALUES[favTypeIdx];
                var items;
                if (typeFilter === "recent") {
                    items = buildRecentItems();
                } else {
                    var allFavItems = buildFavItems();
                    if (typeFilter === "vegetation") {
                        var vegIds = getVegetationIdentifiers();
                        allFavItems = allFavItems.filter(function (item) {
                            return (item.type === "small_scenery" || item.type === "large_scenery")
                                && vegIds[item.identifier];
                        });
                    } else if (typeFilter !== "all") {
                        allFavItems = allFavItems.filter(function (item) { return item.type === typeFilter; });
                    }
                    items = applySearch(allFavItems, favSearchText);
                }
                var n = pageCount(items.length);
                if (favCurrentPage < n - 1) {
                    favCurrentPage++;
                    if (activeWindow) updateFavGrid(activeWindow);
                }
            }
        });

        // Image button grid
        var btns = makeGridButtons("favbtn_", FAV_GRID_Y, function (i) {
            if (i >= favPageItems.length) return;
            var item = favPageItems[i];
            if (!item.available) return;
            var rb = activeWindow.findWidget("fav_remove_btn");
            if (rb) rb.isDisabled = false;
            // Toggle off if clicking the item that's already being placed
            if (ui.tool && ui.tool.id === "fav-scenery-placer"
                    && activePlacingItem
                    && activePlacingItem.type === item.type
                    && activePlacingItem.identifier === item.identifier) {
                        if (rb) rb.isDisabled = true;
                ui.tool.cancel(); // onFinish will clear activePlacingItem and unpress the button
                return;
            }

            // Switch to (or start) placement — suppress the old tool's onFinish cleanup
            // so it doesn't wipe activePlacingItem we're about to set.
            // Also clear needHoverRestart so the onUpdate tick doesn't cancel the new tool.
            suppressPlacerFinish = true;
            activePlacingItem = { type: item.type, identifier: item.identifier };
            activatePlacement(item);
            suppressPlacerFinish = false;
            needHoverRestart = false;

            if (activeWindow) {
                updateFavButtonPressedStates(activeWindow);
                var lbl = activeWindow.findWidget("fav_status");
                if (lbl) lbl.text = "Placing: " + (item.obj ? item.obj.name : item.identifier);
                var hovLbl = activeWindow.findWidget("fav_hover_lbl");
                if (hovLbl) hovLbl.text = "";
            }
        });
        for (var bi = 0; bi < btns.length; bi++) w.push(btns[bi]);

        // Hover row: item name label | 3 colour pickers | Remove button
        w.push({
            type:   "label",
            name:   "fav_hover_lbl",
            x:      MARGIN,
            y:      FAV_HOVER_Y,
            width:  156,
            height: 13,
            text:   ""
        });
        // Global colour pickers — always visible; applied to every item placed
        w.push({
            type:       "colourpicker",
            name:       "fav_color_1",
            x:          MARGIN + 158,
            y:          FAV_HOVER_Y,
            width:      12,
            height:     12,
            colour:     globalPrimaryColour,
            isVisible:  true,
            isDisabled: false,
            onChange:   function (col) {
                globalPrimaryColour = col;
                saveGlobalColors();
                if (activeWindow) updateFavGrid(activeWindow);
            }
        });
        w.push({
            type:       "colourpicker",
            name:       "fav_color_2",
            x:          MARGIN + 172,
            y:          FAV_HOVER_Y,
            width:      12,
            height:     12,
            colour:     globalSecondaryColour,
            isVisible:  true,
            isDisabled: false,
            onChange:   function (col) {
                globalSecondaryColour = col;
                saveGlobalColors();
                if (activeWindow) updateFavGrid(activeWindow);
            }
        });
        w.push({
            type:       "colourpicker",
            name:       "fav_color_3",
            x:          MARGIN + 186,
            y:          FAV_HOVER_Y,
            width:      12,
            height:     12,
            colour:     globalTertiaryColour,
            isVisible:  true,
            isDisabled: false,
            onChange:   function (col) {
                globalTertiaryColour = col;
                saveGlobalColors();
                if (activeWindow) updateFavGrid(activeWindow);
            }
        });
        w.push({
            type:      "button",
            name:      "fav_remove_btn",
            x:         MARGIN + 201,
            y:         FAV_HOVER_Y,
            width:     WIN_WIDTH - MARGIN - (MARGIN + 201),
            height:    13,
            text:      "Remove",
            isDisabled:true,
            onClick:   function () { showRemoveConfirm(hoveredFavItem); }
        });

        return w;
    }

    // ---- Item picker tool ----
    function activatePicker() {
        // Toggle off if already picking
        if (ui.tool && ui.tool.id === "fav-scenery-picker") {
            ui.tool.cancel();
            return;
        }
        ui.activateTool({
            id:     "fav-scenery-picker",
            cursor: "cross_hair",
            filter: ["terrain", "scenery", "large_scenery", "wall", "footpath_item"],
            onMove: function (e) {
                if (!activeWindow) return;
                var tabIdx  = activeWindow.tabIndex;
                var lblName = (tabIdx === 0) ? "all_hover_lbl" : "fav_hover_lbl";
                var lbl = activeWindow.findWidget(lblName);
                if (!lbl) return;

                // When over a map element, show that element's name.
                if (e.mapCoords && e.tileElementIndex !== null && e.tileElementIndex !== undefined) {
                    try {
                        var tileX = Math.floor(e.mapCoords.x / 32);
                        var tileY = Math.floor(e.mapCoords.y / 32);
                        var tile  = map.getTile(tileX, tileY);
                        var mel   = tile.elements[e.tileElementIndex];
                        var mtype = null, mIdx = null;
                        if      (mel.type === "small_scenery")  { mtype = "small_scenery";    mIdx = mel.object; }
                        else if (mel.type === "large_scenery")  { mtype = "large_scenery";    mIdx = mel.object; }
                        else if (mel.type === "wall")            { mtype = "wall";             mIdx = mel.object; }
                        else if (mel.type === "footpath" && mel.addition !== null && mel.addition !== undefined) {
                            mtype = "footpath_addition"; mIdx = mel.addition;
                        }
                        if (mtype !== null && mIdx !== null) {
                            var mobjs = objectManager.getAllObjects(mtype);
                            for (var mi = 0; mi < mobjs.length; mi++) {
                                if (mobjs[mi].index === mIdx) {
                                    lbl.text = mobjs[mi].name || mobjs[mi].identifier;
                                    return;
                                }
                            }
                        }
                    } catch (ex) { /* ignore */ }
                    lbl.text = "";
                    return;
                }

                // When over the window, fall back to grid button hit-test.
                if (e.screenCoords) {
                    var gridTop   = (tabIdx === 0) ? ALL_GRID_Y : FAV_GRID_Y;
                    var pageItems = (tabIdx === 0) ? allPageItems : favPageItems;
                    var idx = hitTestGrid(e.screenCoords.x, e.screenCoords.y, gridTop);
                    var hi  = (idx >= 0 && idx < pageItems.length) ? pageItems[idx] : null;
                    lbl.text = hi
                        ? (hi.obj ? (hi.obj.name || hi.obj.identifier || "") : (hi.identifier || ""))
                        : "";
                } else {
                    lbl.text = "";
                }
            },
            onDown: function (e) {
                if (!e.mapCoords) return;
                var tileX = Math.floor(e.mapCoords.x / 32);
                var tileY = Math.floor(e.mapCoords.y / 32);
                try {
                    var tile = map.getTile(tileX, tileY);
                    // tileElementIndex identifies the specific element the user clicked on
                    var el = (e.tileElementIndex !== null && e.tileElementIndex !== undefined)
                        ? tile.elements[e.tileElementIndex]
                        : null;
                    var added = [];
                    if (el) {
                        var type = null, objIdx = null;
                        if      (el.type === "small_scenery")  { type = "small_scenery";    objIdx = el.object; }
                        else if (el.type === "large_scenery")  { type = "large_scenery";    objIdx = el.object; }
                        else if (el.type === "wall")            { type = "wall";             objIdx = el.object; }
                        else if (el.type === "footpath" && el.addition !== null && el.addition !== undefined) {
                            type = "footpath_addition"; objIdx = el.addition;
                        }
                        if (type !== null && objIdx !== null) {
                            var objs = objectManager.getAllObjects(type);
                            for (var j = 0; j < objs.length; j++) {
                                if (objs[j].index === objIdx) {
                                    var itemName = objs[j].name || objs[j].identifier;
                                    if (isFav(type, objs[j].identifier)) {
                                        added.push(itemName + " (already in favorites)");
                                    } else {
                                        toggleFav(type, objs[j].identifier);
                                        added.push(itemName);
                                    }
                                    break;
                                }
                            }
                        }
                    }
                    if (activeWindow) {
                        updateFavGrid(activeWindow);
                        var statusLbl = activeWindow.findWidget("fav_status");
                        if (statusLbl) {
                            statusLbl.text = added.length > 0
                                ? "Added: " + added[0] + " — click more or Esc to stop"
                                : "No scenery here — click elsewhere or Esc to stop";
                        }
                    }
                } catch (ex) { /* ignore tile read errors */ }
            },
            onFinish: function () {
                if (activeWindow) {
                    var b0 = activeWindow.findWidget("all_pick");
                    var b1 = activeWindow.findWidget("fav_pick");
                    if (b0) b0.isPressed = false;
                    if (b1) b1.isPressed = false;
                    if (activeWindow.tabIndex === 0) {
                        updateAllGrid(activeWindow);
                    } else {
                        updateFavGrid(activeWindow);
                    }
                }
                needHoverRestart = true; // restart on next onUpdate tick (avoids tool re-entrancy)
            }
        });
        if (activeWindow) {
            var pickName = (activeWindow.tabIndex === 0) ? "all_pick" : "fav_pick";
            var btn = activeWindow.findWidget(pickName);
            if (btn) btn.isPressed = true;
            var statusLbl = activeWindow.findWidget("fav_status");
            if (statusLbl) statusLbl.text = "Click scenery on the map to add — Esc to cancel";
        }
        // Clear the flag so onUpdate doesn't restart the hover tool and cancel the picker.
        needHoverRestart = false;
    }

    // ---- Hover label helpers ----

    // Given a screen-space cursor position and the grid's top Y (in window-local coords),
    // returns the grid index (0-47) under the cursor, or -1 if not over any button.
    function hitTestGrid(screenX, screenY, gridTop) {
        if (!activeWindow) return -1;
        var localX = screenX - activeWindow.x;
        var localY = screenY - activeWindow.y;
        var relX = localX - GRID_LEFT;
        var relY = localY - gridTop;
        if (relX < 0 || relY < 0) return -1;
        var col = Math.floor(relX / (BTN_SIZE + BTN_GAP));
        var row = Math.floor(relY / (BTN_SIZE + BTN_GAP));
        if (col >= GRID_COLS || row >= GRID_ROWS) return -1;
        // Ensure cursor is inside the button itself, not in the gap between buttons
        var inBtnX = relX - col * (BTN_SIZE + BTN_GAP);
        var inBtnY = relY - row * (BTN_SIZE + BTN_GAP);
        if (inBtnX >= BTN_SIZE || inBtnY >= BTN_SIZE) return -1;
        return row * GRID_COLS + col;
    }

    // Activates a passive background tool that updates the hover label as the cursor moves.
    // Uses cursor:"arrow" so it is visually unobtrusive. Re-activated after placement/picker finish.
    function activateHoverTool() {
        if (!activeWindow) return;
        if (ui.tool && ui.tool.id === "fav-hover-detector") return; // already running
        ui.activateTool({
            id:     "fav-hover-detector",
            cursor: "arrow",
            filter: ["terrain"],
            onMove: function (e) {
                if (!activeWindow) return;
                var sc = e.screenCoords;
                if (!sc) return;
                var tabIdx    = activeWindow.tabIndex;
                var gridTop   = (tabIdx === 0) ? ALL_GRID_Y   : FAV_GRID_Y;
                var pageItems = (tabIdx === 0) ? allPageItems : favPageItems;
                var lblName   = (tabIdx === 0) ? "all_hover_lbl" : "fav_hover_lbl";
                var idx = hitTestGrid(sc.x, sc.y, gridTop);
                var lbl = activeWindow.findWidget(lblName);
                if (!lbl) return;
                var hoveredItem = (idx >= 0 && idx < pageItems.length) ? pageItems[idx] : null;
                lbl.text = hoveredItem
                    ? (hoveredItem.obj
                        ? (hoveredItem.obj.name || hoveredItem.obj.identifier || "")
                        : (hoveredItem.identifier || ""))
                    : "";
                if (tabIdx === 1) {
                    hoveredFavItem = hoveredItem;
                    var isRecent  = FAV_TYPE_VALUES[favTypeIdx] === "recent";
                    var removeBtn = activeWindow.findWidget("fav_remove_btn");
                    //if (removeBtn) removeBtn.isDisabled = (!hoveredItem || isRecent);
                }
            },
            onFinish: function () { /* other code restarts as needed */ }
        });
    }

    // ---- Remove-favorite confirmation window ----
    function showRemoveConfirm(item) {
        if (!item) return;
        var name = item.obj ? (item.obj.name || item.identifier) : item.identifier;
        // Close any existing confirm window first
        try {
            var existing = ui.getWindow("fav-remove-confirm");
            if (existing) existing.close();
        } catch (e) { /* not open */ }
        ui.openWindow({
            classification: "fav-remove-confirm",
            title:          "Remove Favorite",
            width:          220,
            height:         75,
            widgets: [
                {
                    type:   "label",
                    name:   "confirm_msg",
                    x:      10,
                    y:      20,
                    width:  200,
                    height: 24,
                    text:   "Remove from favorites?\n" + name
                },
                {
                    type:    "button",
                    name:    "confirm_yes",
                    x:       10,
                    y:       52,
                    width:   90,
                    height:  14,
                    text:    "Remove",
                    onClick: function () {
                        toggleFav(item.type, item.identifier);
                        if (hoveredFavItem === item) {
                            hoveredFavItem = null;
                            if (activeWindow) {
                                var rb = activeWindow.findWidget("fav_remove_btn");
                                if (rb) rb.isDisabled = true;
                                var hl = activeWindow.findWidget("fav_hover_lbl");
                                if (hl) hl.text = "";
                            }
                        }
                        if (activeWindow) updateFavGrid(activeWindow);
                        try {
                            var w = ui.getWindow("fav-remove-confirm");
                            if (w) w.close();
                        } catch (e) { /* ignore */ }
                    }
                },
                {
                    type:    "button",
                    name:    "confirm_no",
                    x:       118,
                    y:       52,
                    width:   90,
                    height:  14,
                    text:    "Cancel",
                    onClick: function () {
                        try {
                            var w = ui.getWindow("fav-remove-confirm");
                            if (w) w.close();
                        } catch (e) { /* ignore */ }
                    }
                }
            ]
        });
    }

    // ---- Collection management dialogs ----
    function showNewCollectionDialog() {
        try {
            var existing = ui.getWindow("fav-new-coll");
            if (existing) existing.close();
        } catch (e) { /* not open */ }
        ui.openWindow({
            classification: "fav-new-coll",
            title:          "New Collection",
            width:          240,
            height:         80,
            widgets: [
                {
                    type:   "label",
                    name:   "new_coll_lbl",
                    x:      10, y: 20,
                    width:  220, height: 11,
                    text:   "Collection name:"
                },
                {
                    type:      "textbox",
                    name:      "new_coll_name",
                    x:         10, y: 34,
                    width:     220, height: 13,
                    text:      "",
                    maxLength: 64
                },
                {
                    type:    "button",
                    name:    "new_coll_create",
                    x:       10, y: 55,
                    width:   105, height: 14,
                    text:    "Create",
                    onClick: function () {
                        try {
                            var dlg = ui.getWindow("fav-new-coll");
                            var tb  = dlg ? dlg.findWidget("new_coll_name") : null;
                            var name = (tb && tb.text) ? tb.text.trim() : "";
                            if (name) {
                                createCollection(name);
                                if (dlg) dlg.close();
                            }
                        } catch (e) { /* ignore */ }
                    }
                },
                {
                    type:    "button",
                    name:    "new_coll_cancel",
                    x:       125, y: 55,
                    width:   105, height: 14,
                    text:    "Cancel",
                    onClick: function () {
                        try {
                            var w = ui.getWindow("fav-new-coll");
                            if (w) w.close();
                        } catch (e) { /* ignore */ }
                    }
                }
            ]
        });
    }

    function showRenameCollectionDialog() {
        try {
            var existing = ui.getWindow("fav-rename-coll");
            if (existing) existing.close();
        } catch (e) { /* not open */ }
        var currentName = collections[activeCollIdx].name;
        ui.openWindow({
            classification: "fav-rename-coll",
            title:          "Rename Collection",
            width:          240,
            height:         80,
            widgets: [
                {
                    type:   "label",
                    name:   "rename_coll_lbl",
                    x:      10, y: 20,
                    width:  220, height: 11,
                    text:   "New name:"
                },
                {
                    type:      "textbox",
                    name:      "rename_coll_name",
                    x:         10, y: 34,
                    width:     220, height: 13,
                    text:      currentName,
                    maxLength: 64
                },
                {
                    type:    "button",
                    name:    "rename_coll_ok",
                    x:       10, y: 55,
                    width:   105, height: 14,
                    text:    "Rename",
                    onClick: function () {
                        try {
                            var dlg = ui.getWindow("fav-rename-coll");
                            var tb  = dlg ? dlg.findWidget("rename_coll_name") : null;
                            var name = (tb && tb.text) ? tb.text.trim() : "";
                            if (name) {
                                renameActiveCollection(name);
                                if (dlg) dlg.close();
                            }
                        } catch (e) { /* ignore */ }
                    }
                },
                {
                    type:    "button",
                    name:    "rename_coll_cancel",
                    x:       125, y: 55,
                    width:   105, height: 14,
                    text:    "Cancel",
                    onClick: function () {
                        try {
                            var w = ui.getWindow("fav-rename-coll");
                            if (w) w.close();
                        } catch (e) { /* ignore */ }
                    }
                }
            ]
        });
    }

    function showDeleteCollectionConfirm() {
        if (collections.length <= 1) return;
        try {
            var existing = ui.getWindow("fav-delete-coll");
            if (existing) existing.close();
        } catch (e) { /* not open */ }
        var name = collections[activeCollIdx].name;
        ui.openWindow({
            classification: "fav-delete-coll",
            title:          "Delete Collection",
            width:          220,
            height:         75,
            widgets: [
                {
                    type:   "label",
                    name:   "del_coll_msg",
                    x:      10, y: 20,
                    width:  200, height: 24,
                    text:   "Delete collection?\n" + name
                },
                {
                    type:    "button",
                    name:    "del_coll_yes",
                    x:       10, y: 52,
                    width:   90, height: 14,
                    text:    "Delete",
                    onClick: function () {
                        deleteActiveCollection();
                        try {
                            var w = ui.getWindow("fav-delete-coll");
                            if (w) w.close();
                        } catch (e) { /* ignore */ }
                    }
                },
                {
                    type:    "button",
                    name:    "del_coll_no",
                    x:       120, y: 52,
                    width:   90, height: 14,
                    text:    "Cancel",
                    onClick: function () {
                        try {
                            var w = ui.getWindow("fav-delete-coll");
                            if (w) w.close();
                        } catch (e) { /* ignore */ }
                    }
                }
            ]
        });
    }

    // ---- Window descriptor ----
    function buildWindowDesc() {
        return {
            classification: "favorite-scenery",
            title:          "Add to Favorites Collection",
            width:          WIN_WIDTH,
            height:         ALL_HOVER_Y + 20, // initial height for Tab 0; resized by onTabChange
            tabs: [
                {
                    image:   5465,
                    widgets: buildTab0Widgets()
                },
                {
                    image:   "awards",
                    widgets: buildTab1Widgets()
                },
                {
                    image:   "floppy_disk",
                    widgets: buildTab2Widgets()
                }
            ],
            onUpdate: function () {
                if (needHoverRestart && activeWindow && activeWindow.tabIndex !== 2) {
                    needHoverRestart = false;
                    activateHoverTool();
                } else if (needHoverRestart) {
                    needHoverRestart = false;
                }
            },
            onTabChange: function () {
                if (!activeWindow) return;
                // Cancel picker and placer on any tab switch.
                if (ui.tool && (ui.tool.id === "fav-scenery-placer" || ui.tool.id === "fav-scenery-picker")) {
                    ui.tool.cancel();
                }
                if (activeWindow.tabIndex === 0) {
                    activeWindow.height = ALL_HOVER_Y + 20;
                    hoveredFavItem = null;
                    updateAllGrid(activeWindow);
                } else if (activeWindow.tabIndex === 1) {
                    // Height is set dynamically by updateFavGrid based on filled rows
                    refreshCollectionDropdown(activeWindow);
                    updateFavGrid(activeWindow);
                } else {
                    // Tab 2: Import / Export
                    activeWindow.height = IO_WIN_HEIGHT;
                    activeWindow.title  = "Import / Export Collections";
                    if (ui.tool && ui.tool.id === "fav-hover-detector") ui.tool.cancel();
                    refreshIoCollDropdown(activeWindow);
                    var statusLbl = activeWindow.findWidget("io_status");
                    if (statusLbl) statusLbl.text = ioStatusText;
                }
            },
            onClose: function () {
                activeWindow = null; // clear first so onFinish callbacks see no window
                if (ui.tool && (ui.tool.id === "fav-scenery-placer" ||
                                ui.tool.id === "fav-scenery-picker" ||
                                ui.tool.id === "fav-hover-detector")) {
                    ui.tool.cancel();
                }
                // Close any open sub-dialogs
                var subDialogs = ["fav-remove-confirm", "fav-new-coll", "fav-rename-coll", "fav-delete-coll"];
                for (var di = 0; di < subDialogs.length; di++) {
                    try {
                        var dlg = ui.getWindow(subDialogs[di]);
                        if (dlg) dlg.close();
                    } catch (e) { /* ignore */ }
                }
            }
        };
    }

    // ---- Main ----
    function main() {
        if (typeof ui === "undefined") return; // headless / dedicated server

        loadData();
        initThumbs();
        filteredCatalog = buildCatalog("all");

        ui.registerMenuItem("Favorite Scenery", function () {
            // Bring existing window to front if open
            try {
                var existing = ui.getWindow("favorite-scenery");
                if (existing) { existing.bringToFront(); return; }
            } catch (e) { /* window not found */ }

            // Reset pagination and search
            allCurrentPage  = 0;
            favCurrentPage  = 0;
            searchText      = "";
            favSearchText   = "";
            currentTypeIdx  = 0;
            favTypeIdx      = 0;
            filteredCatalog = buildCatalog("all");

            var win = ui.openWindow(buildWindowDesc());
            activeWindow = win;
            updateAllGrid(win);
            activateHoverTool();
        });
    }

    registerPlugin({
        name:            "Favorite Scenery",
        version:         "1.0.0",
        authors:         ["OpenRCT2 User"],
        type:            "local",
        licence:         "MIT",
        targetApiVersion:110,
        main:            main
    });

})();
