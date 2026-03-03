// ==============================================================
// Favorite Scenery Plugin for OpenRCT2
// Two-tab window: browse all scenery, save favorites, place them.
// ==============================================================

(function () {

    // ---- Layout constants ----
    var GRID_COLS  = 6;
    var GRID_ROWS  = 5;
    var GRID_SIZE  = GRID_COLS * GRID_ROWS; // 48 buttons
    var BTN_SIZE   = 64;      // button width (and square cell size for image slots)
    var BTN_H      = BTN_SIZE * 1.25; // button height — taller cells give sprites more room
    var THUMB_PAD  = 1;  // padding around sprite inside each button cell
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
    var ALL_HOVER_Y = ALL_GRID_Y + GRID_ROWS * (BTN_H + BTN_GAP) - BTN_GAP + 10;
    var FAV_HOVER_Y = FAV_GRID_Y + GRID_ROWS * (BTN_H + BTN_GAP) - BTN_GAP + 10;

    // Tab 2 (Import/Export): no grid, fixed shorter height
    var IO_WIN_HEIGHT = 210;

    // Bit 9 of SmallSceneryObject.flags — object has a glass overlay sprite at baseImageId+4
    var SMALL_SCENERY_FLAG_HAS_GLASS = 0x200; // bit 9 — has glass overlay sprites

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
        "Recently Placed",
        "Small Scenery",
        "Large Scenery",
        "Trees & Plants",
        "Walls",
        "Path Items",
        "Banners"
    ];

    var TYPE_VALUES = [
        "all",
        "recent",
        "small_scenery",
        "large_scenery",
        "vegetation",        // special: filtered by scenery group membership
        "wall",
        "footpath_addition",
        "banner"
    ];

    var FAV_TYPE_LABELS = [
        "All Types",
        "Small Scenery",
        "Large Scenery",
        "Trees & Plants",
        "Walls",
        "Path Items",
        "Banners"
    ];
    var FAV_TYPE_VALUES = [
        "all",
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

    var REMOVE_ACTION_NAME = {
        "small_scenery":    "smallsceneryremove",
        "large_scenery":    "largesceneryremove",
        "wall":             "wallremove",
        "footpath_addition":"footpathadditionremove",
        "banner":           "bannerremove"
    };

    // flags: GAME_COMMAND_FLAG_GHOST (0x40) | GAME_COMMAND_FLAG_ALLOW_DURING_PAUSED (0x08)
    var GHOST_FLAGS = 72;

    var STORAGE_KEY     = "FavoriteScenery.favorites";   // legacy key (migration only)
    var COLLECTIONS_KEY = "FavoriteScenery.collections";
    var ACTIVE_COLL_KEY = "FavoriteScenery.activeCollection";
    var RECENT_KEY      = "FavoriteScenery.recent";
    var COLORS_KEY      = "FavoriteScenery.globalColors";
    var WINDOW_POS_KEY  = "FavoriteScenery.windowPos";
    var RECENT_MAX      = 150;  // 5 pages × 30 items

    // ---- Mutable state ----
    var collections   = [{name: "Default", items: []}];  // [{name, items:[{type,identifier}]}]
    var activeCollIdx = 0;
    var favViewMode   = "collection"; // "collection" | "recent" — what the Favorites grid shows
    var recentItems   = [];   // recently placed items, newest first
    var filteredCatalog = [];   // [{type, obj}] for Tab 0
    var allPageItems    = [];   // current page slice for Tab 0
    var favPageItems    = [];   // current page slice for Tab 1
    var allCurrentPage  = 0;
    var favCurrentPage  = 0;
    var currentTypeIdx  = 0;
    var favTypeIdx      = 0;   // Tab 1 type filter index (independent of Tab 0)
    var currentGroupIdx = 0;   // All Scenery tab group filter (0 = all groups)
    var favGroupIdx     = 0;   // Favorites tab group filter (0 = all groups)
    var groupList       = [];  // [{name, itemSet:{identifier:true}}] — sorted, loaded per window open
    var activeWindow      = null;
    var thumbRange        = null;   // ImageIndexRange for pre-rendered thumbnails
    var needHoverRestart  = false;  // set by tool onFinish; picked up by onUpdate to avoid re-entrancy
    var hoveredFavItem    = null;   // fav item currently under the cursor (Tab 1 only)
    var globalPrimaryColour   = 0;  // global placement palette — applied to every item placed
    var globalSecondaryColour = 0;
    var globalTertiaryColour  = 0;
    var globalDirection       = 0;  // placement rotation: 0=N 1=E 2=S 3=W
    var searchText       = "";    // current search query for Tab 0
    var favSearchText    = "";    // current search query for Tab 1
    var activePlacingItem    = null;  // {type, identifier} of item currently being placed, or null
    var suppressPlacerFinish = false; // true while switching placement to suppress old tool's onFinish cleanup
    var ghostRemoveQueue     = [];    // [{action, args}] — pre-built remove calls to undo the current ghost
    var lastGhostPos         = null;  // {tileX, tileY, direction, quadrant} — skip re-placing if unchanged
    var ioExportCollIdx      = 0;    // Tab 2: 0 = all collections, 1+ = collections[i-1]
    var ioStatusText         = "";   // Tab 2: result of last import operation
    var ioEnableCollIdx      = 0;    // Tab 2: 0 = all collections, 1+ = collections[i-1]
    var ioEnableStatusText   = "";   // Tab 2: result of last enable operation

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
        if (savedIdx === -1) {
            favViewMode   = "recent";
            activeCollIdx = 0;
        } else if (typeof savedIdx === "number" && savedIdx >= 0 && savedIdx < collections.length) {
            favViewMode   = "collection";
            activeCollIdx = savedIdx;
        } else {
            favViewMode   = "collection";
            activeCollIdx = 0;
        }
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
        context.sharedStorage.set(ACTIVE_COLL_KEY, favViewMode === "recent" ? -1 : activeCollIdx);
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
            collections[activeCollIdx].items.unshift({ type: type, identifier: identifier });
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
        if (typeFilter === "recent") {
            // Preserve recency order (no alpha sort); exclude items not in the current park
            var recItems = buildRecentItems();
            var result = [];
            for (var ri = 0; ri < recItems.length; ri++) {
                if (recItems[ri].available) {
                    result.push({ type: recItems[ri].type, obj: recItems[ri].obj });
                }
            }
            return result;
        }
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
        favViewMode   = "collection";
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
        if (win.tabIndex === 1) {
            win.title = "Add Scenery to " + collections[activeCollIdx].name + " Collection";
        } else if (win.tabIndex === 0) {
            win.title = (favViewMode === "recent")
                ? "Recent Items"
                : collections[activeCollIdx].name + " Collection";
        } else {
            win.title = "Import / Export Collections";
        }
    }

    function refreshCollectionDropdown(win) {
        var isRecent = (favViewMode === "recent");
        var dd = win.findWidget("fav_coll_select");
        if (dd) {
            dd.items = ["Recent Items"].concat(collections.map(function (c) { return c.name; }));
            dd.selectedIndex = isRecent ? 0 : activeCollIdx + 1;
        }
        var renameBtn = win.findWidget("fav_coll_rename");
        if (renameBtn) renameBtn.isDisabled = isRecent;
        var delBtn = win.findWidget("fav_coll_delete");
        if (delBtn) delBtn.isDisabled = isRecent || (collections.length <= 1);
    }

    // ---- Import / Export helpers ----

    function buildExportDropdownItems() {
        var items = ["All Collections"];
        for (var i = 0; i < collections.length; i++) {
            items.push(collections[i].name);
        }
        return items;
    }

    function buildEnableDropdownItems() {
        var items = ["All Collections", "Recent Items"];
        for (var i = 0; i < collections.length; i++) {
            items.push(collections[i].name);
        }
        return items;
    }

    function refreshIoCollDropdown(win) {
        var items = buildExportDropdownItems();
        var dd = win.findWidget("io_coll_select");
        if (dd) {
            dd.items = items;
            if (ioExportCollIdx >= items.length) ioExportCollIdx = 0;
            dd.selectedIndex = ioExportCollIdx;
        }
        var dd2 = win.findWidget("io_enable_coll_select");
        if (dd2) {
            var enableItems = buildEnableDropdownItems();
            dd2.items = enableItems;
            if (ioEnableCollIdx >= enableItems.length) ioEnableCollIdx = 0;
            dd2.selectedIndex = ioEnableCollIdx;
        }
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

    function enableObjectsFromCollections(collIdx) {
        var seen = {};
        var unique = [];
        if (collIdx === 1) {
            // Recent Items
            for (var ri = 0; ri < recentItems.length; ri++) {
                var id = recentItems[ri].identifier;
                if (!seen[id]) { seen[id] = true; unique.push(id); }
            }
        } else {
            var toEnable = (collIdx === 0) ? collections : [collections[collIdx - 2]];
            for (var ci = 0; ci < toEnable.length; ci++) {
                var items = toEnable[ci].items;
                for (var ii = 0; ii < items.length; ii++) {
                    var id = items[ii].identifier;
                    if (!seen[id]) { seen[id] = true; unique.push(id); }
                }
            }
        }
        if (unique.length === 0) return "No items in selected collection(s)";
        var results = objectManager.load(unique);
        var loaded = 0, failed = 0;
        for (var r = 0; r < results.length; r++) {
            if (results[r] !== null) loaded++;
            else failed++;
        }
        var msg = loaded + " object" + (loaded !== 1 ? "s" : "") + " enabled";
        if (failed > 0) msg += ", " + failed + " not installed locally";
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

        // Enable Objects groupbox
        var isMultiplayer = (network.mode !== "none");
        w.push({ type: "groupbox", name: "io_enable_box", x: MARGIN, y: 142, width: GBWIDE, height: 42, text: "Enable Objects from Collection" });
        w.push({ type: "label", name: "io_enable_lbl", x: INNER, y: 166, width: 68, height: 12, text: "Collection:" });
        w.push({
            type:          "dropdown",
            name:          "io_enable_coll_select",
            x:             INNER + 70,
            y:             165,
            width:         dropW,
            height:        13,
            items:         buildEnableDropdownItems(),
            selectedIndex: ioEnableCollIdx,
            onChange:      function (idx) { ioEnableCollIdx = idx; }
        });
        w.push({
            type:       "button",
            name:       "io_enable_btn",
            x:          WIN_WIDTH - MARGIN - 56,
            y:          164,
            width:      50,
            height:     14,
            text:       "Enable",
            isDisabled: isMultiplayer,
            onClick:    function () {
                var result = enableObjectsFromCollections(ioEnableCollIdx);
                ioEnableStatusText = result;
                if (activeWindow) {
                    var lbl = activeWindow.findWidget("io_enable_status");
                    if (lbl) lbl.text = result;
                }
            }
        });

        // Enable status label
        w.push({ type: "label", name: "io_enable_status", x: MARGIN, y: 188, width: GBWIDE, height: 12,
                 text: isMultiplayer ? "Not available in multiplayer" : ioEnableStatusText });

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

    // ---- Scenery group filter ----
    function loadGroupList() {
        groupList = [];
        try {
            var groups = objectManager.getAllObjects("scenery_group");
            groups.sort(function (a, b) {
                var na = (a.name || "").toLowerCase(), nb = (b.name || "").toLowerCase();
                return na < nb ? -1 : na > nb ? 1 : 0;
            });
            for (var i = 0; i < groups.length; i++) {
                var set = {};
                var grpItems = groups[i].items || [];
                for (var j = 0; j < grpItems.length; j++) set[grpItems[j]] = true;
                groupList.push({ name: groups[i].name || groups[i].identifier, itemSet: set });
            }
        } catch (e) { /* ignore */ }
    }

    function buildGroupDropdownItems() {
        var MAX_LEN = 30;
        var items = ["All Groups"];
        for (var i = 0; i < groupList.length; i++) {
            var name = groupList[i].name;
            if (name.length > MAX_LEN) name = name.substring(0, MAX_LEN - 1) + "\u2026";
            items.push(name);
        }
        return items;
    }

    function applyGroupFilter(items, groupIdx) {
        if (groupIdx === 0 || groupIdx > groupList.length) return items;
        var set = groupList[groupIdx - 1].itemSet;
        return items.filter(function (item) {
            var id = item.obj ? item.obj.identifier : item.identifier;
            return set[id] === true;
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

    function renderThumb(gridIndex, item, pc, sc, tc, dir) {
        var baseImageId = item.obj.baseImageId;
        if (!thumbRange) return baseImageId; // fallback: raw sprite (may overflow)
        var slotId = thumbRange.start + gridIndex;
        // The in-game scenery window renders glass items in two passes:
        //   1) base sprite (opaque parts)
        //   2) glass overlay at baseImageId+4 drawn with WithTransparency(primaryColour)
        // The plugin API's g.image() has no way to invoke the glass-blend path, so we
        // draw the overlay with a colour remap instead — the glass area shows as a tinted
        // shape rather than true blended glass, but at least it is visible.
        // Small scenery: glass overlay at baseImageId+4, detected via obj.flags bit 9.
        // Wall: glass overlay at rotatedBase+6; non-glass walls have <=6 sprites, so
        //       numImages>6 safely guards within-object probing without needing flags.
        var hasGlass = item.type === "small_scenery"
                    && item.obj.flags !== undefined
                    && (item.obj.flags & SMALL_SCENERY_FLAG_HAS_GLASS) !== 0;
        var wallHasGlass = item.type === "wall" && item.obj.numImages > 6;
        // Small/large scenery: directional sprites at baseImageId+0/1/2/3 (N/E/S/W).
        // Walls: sprite 0 = N/S edge, sprite 1 = E/W edge (directions 0,2 → offset 1; 1,3 → offset 0).
        var rotDir = (dir !== undefined && dir > 0) ? (dir % 4) : 0;
        var rotatedBase;
        if (item.type === "wall") {
            rotatedBase = baseImageId + (rotDir % 2 === 0 ? 1 : 0);
        } else if (rotDir > 0
                && (item.type === "small_scenery" || item.type === "large_scenery")
                && item.obj.numImages >= 4) {
            rotatedBase = baseImageId + rotDir;
        } else {
            rotatedBase = baseImageId;
        }

        // xAdj/yAdj: pixel-content centering corrections computed after first pass.
        var xAdj = 0, yAdj = 0;
        var failed = false;

        // Determine which colour channels this object actually supports.
        // Only small_scenery exposes obj.flags in the plugin API; large_scenery and
        // wall do not, so we leave hasPC/hasSC/hasTC = true for those types.
        // When a channel is unsupported we pass 0 instead of the user colour so that
        // any stray remap-range pixels render at colour-0 shades rather than going
        // transparent (the result of leaving g.colour unset) or showing the wrong hue.
        var hasPC = true, hasSC = true, hasTC = true;
        if (item.type === "small_scenery" && item.obj.flags !== undefined) {
            var f = item.obj.flags;
            hasPC = (f & 0x400)        !== 0;
            hasSC = (f & 0x80000)      !== 0;
            hasTC = (f & 0x20000000)   !== 0;
        }

        function execDraw() {
            failed = false;
            try {
                ui.imageManager.draw(slotId, { width: BTN_SIZE, height: BTN_H }, function (g) {
                    var info = g.getImage(rotatedBase);
                    if (!info) { failed = true; return; }
                    g.clear();
                    var innerW = BTN_SIZE - THUMB_PAD * 2;
                    var innerH = BTN_H    - THUMB_PAD * 2;
                    var drawX = THUMB_PAD + Math.floor((innerW - info.width)  / 2) - info.offset.x + xAdj;
                    var drawY = THUMB_PAD + Math.floor((innerH - info.height) / 2) - info.offset.y + yAdj;
                    g.clip(THUMB_PAD, THUMB_PAD, innerW, innerH);
                    g.colour          = (pc !== undefined && hasPC) ? pc : 0;
                    g.secondaryColour = (sc !== undefined && hasSC) ? sc : 0;
                    g.tertiaryColour  = (tc !== undefined && hasTC) ? tc : 0;
                    g.image(rotatedBase, drawX, drawY);
                    var glassOffset = 0;
                    if (hasGlass) {
                        glassOffset = 4;
                    } else if (wallHasGlass) {
                        glassOffset = 6;
                    }
                    if (glassOffset > 0) {
                        var glassColour = pc !== undefined ? pc : 8;
                        g.colour          = glassColour;
                        g.secondaryColour = glassColour;
                        g.tertiaryColour  = glassColour;
                        g.image(rotatedBase + glassOffset, drawX, drawY);
                    }
                });
            } catch (e) {
                failed = true;
            }
        }

        // First pass — initial centered position.
        execDraw();
        if (failed) return baseImageId;

        // Analyze pixel data to find the actual non-transparent content bounding box,
        // then re-center on that box and redraw if the correction is significant.
        try {
            var pix = ui.imageManager.getPixelData(slotId);
            if (pix && pix.type === "raw" && pix.data && pix.data.length > 0) {
                var data = pix.data;
                var minX = BTN_SIZE, maxX = -1, minY = BTN_H, maxY = -1;
                for (var row = 0; row < BTN_H; row++) {
                    for (var col = 0; col < BTN_SIZE; col++) {
                        if (data[row * BTN_SIZE + col] !== 0) {
                            if (col < minX) minX = col;
                            if (col > maxX) maxX = col;
                            if (row < minY) minY = row;
                            if (row > maxY) maxY = row;
                        }
                    }
                }
                // Completely transparent — fall back to raw sprite.
                if (maxX < 0) return baseImageId;
                // Compute how far the content centre deviates from the canvas centre.
                xAdj = Math.round(BTN_SIZE / 2 - (minX + maxX) / 2);
                yAdj = Math.round(BTN_H    / 2 - (minY + maxY) / 2);
                if (Math.abs(xAdj) > 1 || Math.abs(yAdj) > 1) {
                    execDraw(); // second pass with corrected position
                    if (failed) return baseImageId;
                }
            }
        } catch (e) { /* keep first-pass result */ }

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

    // ---- Ghost preview helpers ----

    // Returns which quarter of a tile (0-3) the map coordinate falls in.
    // Quadrant layout (looking top-down, x=east, y=south):
    //   0=NW  3=NE
    //   1=SW  2=SE
    function computeQuadrant(mapX, mapY) {
        // Replicates MapGetTileQuadrant(mapPos) ^ 2 from OpenRCT2 Scenery.cpp
        var subX = mapX & 31;
        var subY = mapY & 31;
        if (subX <= 16 && subY < 16)  return 0;  // top-left
        if (subX <= 16 && subY >= 16) return 1;  // bottom-left
        if (subX > 16  && subY >= 16) return 2;  // bottom-right
        return 3;                                 // top-right
    }


    // Replicates CoordsXY::Rotate(direction) from OpenRCT2 Location.hpp.
    // Rotates a tile offset (in world units) by dir * 90° clockwise.
    function rotateTileOffset(dx, dy, dir) {
        switch (dir & 3) {
            case 1: return { x:  dy, y: -dx };
            case 2: return { x: -dx, y: -dy };
            case 3: return { x: -dy, y:  dx };
            default: return { x: dx, y: dy };
        }
    }

    // Execute the pre-built remove queue to erase the current ghost.
    function removeGhost() {
        var queue = ghostRemoveQueue;
        ghostRemoveQueue = [];
        lastGhostPos = null;
        for (var i = 0; i < queue.length; i++) {
            context.executeAction(queue[i].action, queue[i].args, function () {});
        }
    }

    // Place a ghost preview and pre-build the matching remove queue.
    function placeGhost(item, mapX, mapY, quadrant) {
        var wx = Math.floor(mapX / 32) * 32;
        var wy = Math.floor(mapY / 32) * 32;
        var z  = getGroundZ(wx, wy);
        var q  = quadrant || 0;

        var placeArgs = {
            x:               wx,
            y:               wy,
            z:               z,
            direction:       globalDirection,
            object:          item.obj.index,
            primaryColour:   globalPrimaryColour,
            secondaryColour: globalSecondaryColour,
            tertiaryColour:  globalTertiaryColour,
            flags:           GHOST_FLAGS
        };
        if (item.type === "small_scenery") placeArgs.quadrant = q;
        if (item.type === "wall")          placeArgs.edge     = globalDirection;

        // Pre-build the remove queue now, while we know all the args.
        ghostRemoveQueue = [];
        if (item.type === "small_scenery") {
            ghostRemoveQueue.push({
                action: "smallsceneryremove",
                args: { x: wx, y: wy, z: z, object: item.obj.index, quadrant: q, flags: GHOST_FLAGS }
            });
        } else if (item.type === "large_scenery") {
            // largesceneryremove removes all tiles of the structure from a single call.
            // direction is required — FindLargeSceneryElement matches GetDirection().
            // Use tile 0 (the anchor tile) at its rotated world position.
            var lgTiles = (item.obj.tiles && item.obj.tiles.length > 0)
                ? item.obj.tiles : [{ offset: { x: 0, y: 0 } }];
            var off0 = rotateTileOffset(lgTiles[0].offset.x, lgTiles[0].offset.y, globalDirection);
            ghostRemoveQueue.push({
                action: "largesceneryremove",
                args: { x: wx + off0.x, y: wy + off0.y,
                        z: z, direction: globalDirection, tileIndex: 0, flags: GHOST_FLAGS }
            });
        } else if (item.type === "wall") {
            ghostRemoveQueue.push({
                action: "wallremove",
                args: { x: wx, y: wy, z: z, direction: globalDirection, flags: GHOST_FLAGS }
            });
        } else if (item.type === "footpath_addition") {
            ghostRemoveQueue.push({
                action: "footpathadditionremove",
                args: { x: wx, y: wy, z: z, flags: GHOST_FLAGS }
            });
        } else if (item.type === "banner") {
            ghostRemoveQueue.push({
                action: "bannerremove",
                args: { x: wx, y: wy, z: z, flags: GHOST_FLAGS }
            });
        }

        context.executeAction(ACTION_NAME[item.type], placeArgs, function () {});
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
                    var gridTop   = (tabIdx === 0) ? FAV_GRID_Y : ALL_GRID_Y;
                    var pageItems = (tabIdx === 0) ? favPageItems : allPageItems;
                    var lblName   = (tabIdx === 0) ? "fav_hover_lbl" : "all_hover_lbl";
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
                    removeGhost();
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
                        var off = rotateTileOffset(t.offset.x, t.offset.y, globalDirection);
                        return { x: wx + off.x, y: wy + off.y };
                    });
                } else {
                    ui.tileSelection.tiles = [];
                    ui.tileSelection.range = {
                        leftTop:     { x: wx, y: wy },
                        rightBottom: { x: wx, y: wy }
                    };
                }
                // Ghost preview: only re-place if the tile, direction, or quadrant changed.
                var tileX = wx / 32;
                var tileY = wy / 32;
                var q = (item.type === "small_scenery") ? computeQuadrant(e.mapCoords.x, e.mapCoords.y) : 0;
                if (!lastGhostPos
                        || lastGhostPos.tileX     !== tileX
                        || lastGhostPos.tileY     !== tileY
                        || lastGhostPos.direction !== globalDirection
                        || lastGhostPos.quadrant  !== q) {
                    removeGhost();
                    placeGhost(item, wx, wy, q);
                    lastGhostPos = { tileX: tileX, tileY: tileY, direction: globalDirection, quadrant: q };
                }
            },
            onDown: function (e) {
                // Remove ghost before placing permanently so there's no overlap.
                removeGhost();
                if (!e.mapCoords) return;
                var z = getGroundZ(e.mapCoords.x, e.mapCoords.y);
                var args = {
                    x:              e.mapCoords.x,
                    y:              e.mapCoords.y,
                    z:              z,
                    direction:      globalDirection,
                    object:         item.obj.index,
                    primaryColour:  globalPrimaryColour,
                    secondaryColour:globalSecondaryColour,
                    tertiaryColour: globalTertiaryColour
                };
                if (item.type === "small_scenery") args.quadrant = computeQuadrant(e.mapCoords.x, e.mapCoords.y);
                if (item.type === "wall")          args.edge     = globalDirection;

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
                removeGhost();
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
                btn.image     = renderThumb(j, item, globalPrimaryColour, globalSecondaryColour, globalTertiaryColour, globalDirection);
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
        if (lbl) lbl.text = (allCurrentPage + 1) + "/" + n;
        var prev = win.findWidget("all_prev");
        var next = win.findWidget("all_next");
        if (prev) prev.isDisabled = (allCurrentPage === 0);
        if (next) next.isDisabled = (allCurrentPage >= n - 1);

        var noResultsLbl = win.findWidget("all_no_results_lbl");
        if (noResultsLbl) noResultsLbl.isVisible = (filteredCatalog.length === 0);

        // Dynamic height: shrink/grow grid box and window based on filled rows
        var filledRows = allPageItems.length > 0 ? Math.ceil(allPageItems.length / GRID_COLS) : 0;
        var gridH      = filledRows > 0 ? filledRows * (BTN_H + BTN_GAP) - BTN_GAP : 0;
        if (filteredCatalog.length === 0) gridH += BTN_H; // room for no-results label
        var gridBox = win.findWidget("all_grid_box");
        if (gridBox) gridBox.height = (ALL_GRID_Y - 104) + gridH + MARGIN;
        var newHoverY = ALL_GRID_Y + gridH + 10;
        var hovLbl = win.findWidget("all_hover_lbl");
        if (hovLbl) hovLbl.y = newHoverY + 8;
        var rotBtn = win.findWidget("all_rotate");
        if (rotBtn) rotBtn.y = newHoverY;
        win.height = newHoverY + 33;
    }

    // ---- Grid update: Tab 1 ----
    function updateFavGrid(win) {
        updateWindowTitle(win);
        var typeFilter = FAV_TYPE_VALUES[favTypeIdx];

        var allFavItems = (favViewMode === "recent") ? buildRecentItems() : buildFavItems();
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
        allFavItems = applyGroupFilter(allFavItems, favGroupIdx);
        var favItems = applySearch(allFavItems, favSearchText);

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
                    btn.image     = renderThumb(j, item,
                        globalPrimaryColour, globalSecondaryColour, globalTertiaryColour, globalDirection);
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
        if (lbl) lbl.text = (favCurrentPage + 1) + "/" + favTotalPages;
        var prev = win.findWidget("fav_prev");
        var next = win.findWidget("fav_next");
        if (prev) prev.isDisabled = (favCurrentPage === 0);
        if (next) next.isDisabled = (favCurrentPage >= favTotalPages - 1);

        // Update status label when not actively placing
        if (!(ui.tool && ui.tool.id === "fav-scenery-placer")) {
            var statusLbl = win.findWidget("fav_status");
            if (statusLbl) {
                statusLbl.text = favItems.length === 0
                    ? "No favorites yet — add from All Scenery tab"
                    : "Click a favorite to start placing";
            }
        }

        // Dynamic window height: shrink/grow the "Choose Scenery" groupbox and window
        // based on how many rows are actually filled on the current page.
        var filledRows = favPageItems.length > 0 ? Math.ceil(favPageItems.length / GRID_COLS) : 0;
        var gridH      = filledRows > 0 ? filledRows * (BTN_H + BTN_GAP) - BTN_GAP : 0;
        // GB3 height: title(13) + status label(12) + gap(3) + gridH + bottom padding(4)
        var gb3H = 13 + 10 + gridH;

        // Empty-collection hint: show label and add one row of height so it fits
        var isEmptyView = (favViewMode === "recent")
            ? (recentItems.length === 0)
            : (collections[activeCollIdx].items.length === 0);
        var isNoResults = !isEmptyView && favItems.length === 0;
        var emptyLbl = win.findWidget("fav_empty_lbl");
        if (emptyLbl) {
            emptyLbl.isVisible = isEmptyView;
            emptyLbl.text = (favViewMode === "recent")
                ? "No recently placed items yet"
                : "Add to this collection using the scenery tab";
        }
        var noResultsLbl = win.findWidget("fav_no_results_lbl");
        if (noResultsLbl) noResultsLbl.isVisible = isNoResults;
        if (isEmptyView || isNoResults) gb3H += BTN_H;

        // Remove button is meaningless in recent view — keep it disabled
        var removeBtn = win.findWidget("fav_remove_btn");
        if (removeBtn && favViewMode === "recent") removeBtn.isDisabled = true;

        var gb3Box = win.findWidget("fav_scenery_box");
        if (gb3Box) gb3Box.height = gb3H;

        var newHoverY = FAV_GB3_Y + gb3H + 6;
        var hovLbl = win.findWidget("fav_hover_lbl");  if (hovLbl) hovLbl.y = newHoverY + 8;
        var cp1    = win.findWidget("fav_color_1");    if (cp1)    cp1.y    = newHoverY + 7;
        var cp2    = win.findWidget("fav_color_2");    if (cp2)    cp2.y    = newHoverY + 7;
        var cp3    = win.findWidget("fav_color_3");    if (cp3)    cp3.y    = newHoverY + 7;
        var rb     = win.findWidget("fav_remove_btn"); if (rb)     rb.y     = newHoverY + 7;
        var rotBtn = win.findWidget("fav_rotate");    if (rotBtn) rotBtn.y = newHoverY;
        win.height = newHoverY + 33;
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

    // ---- Rotation direction ----
    function rotateDirection() {
        globalDirection = (globalDirection + 1) % 4;
        if (activeWindow) {
            if (activeWindow.tabIndex === 0) {
                updateFavGrid(activeWindow);
            } else {
                updateAllGrid(activeWindow);
            }
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
                        y:         gridTop   + r * (BTN_H    + BTN_GAP),
                        width:     BTN_SIZE,
                        height:    BTN_H,
                        image:     0,
                        border:    false,
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
        w.push({ type: "groupbox", name: "all_grid_box",   x: MARGIN, y: 104, width: GBWIDE, height: (ALL_GRID_Y - 104) + GRID_ROWS * (BTN_H + BTN_GAP) - BTN_GAP + MARGIN, text: "Add to Collection" });

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
            x:      2*MARGIN + FAV_CTRL_OFF + 2,
            y:      ALL_SEARCH_Y + 2,
            width:  44,
            height: 11,
            text:   "Search:"
        });
        w.push({
            type:      "textbox",
            name:      "search_input",
            x:         2*MARGIN + FAV_CTRL_OFF + 46 + 2,
            y:         ALL_SEARCH_Y,
            width:     WIN_WIDTH - 2*MARGIN - (2*MARGIN + FAV_CTRL_OFF + 46 + 2) - 34 - 138,
            height:    13,
            text:      "",
            maxLength: 100,
            onChange:  function (text) {
                searchText      = text;
                filteredCatalog = applyGroupFilter(applySearch(buildCatalog(TYPE_VALUES[currentTypeIdx]), searchText), currentGroupIdx);
                allCurrentPage  = 0;
                if (activeWindow) updateAllGrid(activeWindow);
            }
        });

        // Type filter dropdown — on search row, right side
        w.push({
            type:          "dropdown",
            name:          "type_filter",
            x:             2*MARGIN - 2*FAV_CTRL_OFF + WIN_WIDTH - 4 - 134,
            y:             ALL_SEARCH_Y,
            width:         168,
            height:        13,
            items:         TYPE_LABELS,
            selectedIndex: 0,
            onChange:      function (idx) {
                currentTypeIdx  = idx;
                filteredCatalog = applyGroupFilter(applySearch(buildCatalog(TYPE_VALUES[idx]), searchText), currentGroupIdx);
                allCurrentPage  = 0;
                if (activeWindow) updateAllGrid(activeWindow);
            }
        });

        // Group filter dropdown — now spans full ctrl row width
        w.push({
            type:          "dropdown",
            name:          "group_filter",
            x:             2*MARGIN + FAV_CTRL_OFF + 3,
            y:             ALL_CTRL_Y,
            width:         202,
            height:        13,
            items:         buildGroupDropdownItems(),
            selectedIndex: 0,
            onChange:      function (idx) {
                currentGroupIdx = idx;
                filteredCatalog = applyGroupFilter(applySearch(buildCatalog(TYPE_VALUES[currentTypeIdx]), searchText), currentGroupIdx);
                allCurrentPage  = 0;
                if (activeWindow) updateAllGrid(activeWindow);
            }
        });

        // Prev / page label / next — compacted to right side of control row
        w.push({
            type:      "button",
            name:      "all_prev",
            x:         248,
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
            x:         264,
            y:         ALL_CTRL_Y + 2,
            width:     134,
            height:    10,
            textAlign: "centred",
            text:      "1/1"
        });
        w.push({
            type:      "button",
            name:      "all_next",
            x:         400,
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
            y:      ALL_HOVER_Y + 8,
            width:  WIN_WIDTH - MARGIN * 2 - 2 - 30,
            height: 13,
            text:   ""
        });
        w.push({
            type:    "button",
            name:    "all_rotate",
            x:       WIN_WIDTH - MARGIN - 28,
            y:       ALL_HOVER_Y,
            width:   28,
            height:  26,
            image:   "rotate_arrow",
            border:  false,
            tooltip: "Rotate direction clockwise",
            onClick: rotateDirection
        });

        // No-results label — shown centred in the grid area when filters yield zero results
        w.push({
            type:      "label",
            name:      "all_no_results_lbl",
            x:         MARGIN + 2,
            y:         ALL_GRID_Y + Math.floor((BTN_H - 13) / 2),
            width:     WIN_WIDTH - MARGIN * 2 - 4,
            height:    13,
            text:      "No results based on your filters",
            textAlign: "centred",
            isVisible: false
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
        w.push({ type: "groupbox", name: "fav_filter_box",  x: MARGIN, y: 85,          width: GBWIDE, height: 50,  text: "Filter" });
        w.push({ type: "groupbox", name: "fav_scenery_box", x: MARGIN, y: FAV_GB3_Y,   width: GBWIDE, height: 336, text: "Choose Scenery to Place" });

        // Collections row: dropdown + New/Rename/Delete buttons
        w.push({
            type:          "dropdown",
            name:          "fav_coll_select",
            x:             2*MARGIN,
            y:             FAV_COLL_Y,
            width:         WIN_WIDTH - 2*MARGIN - 28 - 4 - 50 - 4 - 22 - 4 - 2*MARGIN,
            height:        13,
            items:         ["Recent Items"].concat(collections.map(function (c) { return c.name; })),
            selectedIndex: (favViewMode === "recent") ? 0 : activeCollIdx + 1,
            onChange:      function (idx) {
                if (idx === 0) {
                    favViewMode = "recent";
                } else {
                    favViewMode   = "collection";
                    activeCollIdx = idx - 1;
                }
                saveCollections();
                favCurrentPage = 0;
                if (activeWindow) {
                    refreshCollectionDropdown(activeWindow);
                    updateFavGrid(activeWindow);
                }
            }
        });
        w.push({
            type:      "button",
            name:      "fav_coll_new",
            x:         WIN_WIDTH - 2*MARGIN - 28 - 4 - 50 - 4 - 22,
            y:         FAV_COLL_Y,
            width:     22,
            height:    13,
            text:      "+",
            onClick:   function () { showNewCollectionDialog(); }
        });
        w.push({
            type:      "button",
            name:      "fav_coll_rename",
            x:         WIN_WIDTH - 2*MARGIN - 28 - 4 - 50,
            y:         FAV_COLL_Y,
            width:     50,
            height:    13,
            text:      "Rename",
            isDisabled:(favViewMode === "recent"),
            onClick:   function () { showRenameCollectionDialog(); }
        });
        w.push({
            type:       "button",
            name:       "fav_coll_delete",
            x:          WIN_WIDTH - 2*MARGIN - 28,
            y:          FAV_COLL_Y,
            width:      28,
            height:     13,
            text:       "Del",
            isDisabled: (favViewMode === "recent") || (collections.length <= 1),
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

        // Search field (shifted right by FAV_CTRL_OFF to clear pick button)
        w.push({
            type:   "label",
            name:   "fav_search_lbl",
            x:      2*MARGIN + FAV_CTRL_OFF + 2,
            y:      FAV_SEARCH_Y + 2,
            width:  44,
            height: 11,
            text:   "Search:"
        });
        w.push({
            type:      "textbox",
            name:      "fav_search_input",
            x:         2*MARGIN + FAV_CTRL_OFF + 46 + 2,
            y:         FAV_SEARCH_Y,
            width:     WIN_WIDTH - 2*MARGIN - (2*MARGIN + FAV_CTRL_OFF + 46 + 2) - 34 - 138,
            height:    13,
            text:      "",
            maxLength: 100,
            onChange:  function (text) {
                favSearchText  = text;
                favCurrentPage = 0;
                if (activeWindow) updateFavGrid(activeWindow);
            }
        });

        // Type filter dropdown — on search row, right side
        w.push({
            type:          "dropdown",
            name:          "fav_type_filter",
            x:             2*MARGIN - 2*FAV_CTRL_OFF + WIN_WIDTH - 4 - 134,
            y:             FAV_SEARCH_Y,
            width:         168,
            height:        13,
            items:         FAV_TYPE_LABELS,
            selectedIndex: 0,
            onChange:      function (idx) {
                favTypeIdx     = idx;
                favCurrentPage = 0;
                if (activeWindow) updateFavGrid(activeWindow);
            }
        });

        // Group filter dropdown — shifted right to clear pick button
        w.push({
            type:          "dropdown",
            name:          "fav_group_filter",
            x:             2*MARGIN + FAV_CTRL_OFF + 3,
            y:             FAV_TYPE_Y,
            width:         202,
            height:        13,
            items:         buildGroupDropdownItems(),
            selectedIndex: 0,
            onChange:      function (idx) {
                favGroupIdx    = idx;
                favCurrentPage = 0;
                if (activeWindow) updateFavGrid(activeWindow);
            }
        });

        // Prev / page label / next — compacted to right side of control row
        w.push({
            type:      "button",
            name:      "fav_prev",
            x:         248,
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
            x:         264,
            y:         FAV_TYPE_Y + 2,
            width:     134,
            height:    10,
            text:      "1/1",
            textAlign: "centred"
        });
        w.push({
            type:      "button",
            name:      "fav_next",
            x:         400,
            y:         FAV_TYPE_Y,
            width:     16,
            height:    13,
            text:      ">",
            isDisabled:true,
            onClick:   function () {
                var typeFilter = FAV_TYPE_VALUES[favTypeIdx];
                var allFavItems = (favViewMode === "recent") ? buildRecentItems() : buildFavItems();
                if (typeFilter === "vegetation") {
                    var vegIds = getVegetationIdentifiers();
                    allFavItems = allFavItems.filter(function (item) {
                        return (item.type === "small_scenery" || item.type === "large_scenery")
                            && vegIds[item.identifier];
                    });
                } else if (typeFilter !== "all") {
                    allFavItems = allFavItems.filter(function (item) { return item.type === typeFilter; });
                }
                allFavItems = applyGroupFilter(allFavItems, favGroupIdx);
                var items = applySearch(allFavItems, favSearchText);
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
            if (rb && favViewMode !== "recent") rb.isDisabled = false;
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
            hoveredFavItem = item; // keep in sync so Remove button works without needing a hover pass
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

        // Empty-collection hint label — shown centred in the grid area when collection has no items
        w.push({
            type:      "label",
            name:      "fav_empty_lbl",
            x:         MARGIN + 2,
            y:         FAV_GRID_Y + Math.floor((BTN_H - 13) / 2),
            width:     WIN_WIDTH - MARGIN * 2 - 4,
            height:    13,
            text:      "Add to this collection using the scenery tab",
            textAlign: "centred",
            isVisible: false
        });

        // No-results label — shown centred in the grid area when filters yield zero results
        w.push({
            type:      "label",
            name:      "fav_no_results_lbl",
            x:         MARGIN + 2,
            y:         FAV_GRID_Y + Math.floor((BTN_H - 13) / 2),
            width:     WIN_WIDTH - MARGIN * 2 - 4,
            height:    13,
            text:      "No results based on your filters",
            textAlign: "centred",
            isVisible: false
        });

        // Hover row: item name label | Remove button | 3 colour pickers | Rotate button
        w.push({
            type:   "label",
            name:   "fav_hover_lbl",
            x:      MARGIN,
            y:      FAV_HOVER_Y + 6,
            width:  156,
            height: 13,
            text:   ""
        });
        w.push({
            type:      "button",
            name:      "fav_remove_btn",
            x:         WIN_WIDTH - MARGIN - 28 - 4 - 12 - 2 - 12 - 2 - 12 - 4 - 70,
            y:         FAV_HOVER_Y + 7,
            width:     70,
            height:    13,
            text:      "Remove",
            isDisabled:true,
            onClick:   function () { showRemoveConfirm(hoveredFavItem); }
        });
        // Global colour pickers — always visible; applied to every item placed
        w.push({
            type:       "colourpicker",
            name:       "fav_color_1",
            x:          WIN_WIDTH - MARGIN - 30 - 2 - 12 - 2 - 12 - 2 - 12,
            y:          FAV_HOVER_Y + 7,
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
            x:          WIN_WIDTH - MARGIN - 30 - 2 - 12 - 2 - 12,
            y:          FAV_HOVER_Y + 7,
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
            x:          WIN_WIDTH - MARGIN - 30 - 2 - 12,
            y:          FAV_HOVER_Y + 7,
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
            type:    "button",
            name:    "fav_rotate",
            x:       WIN_WIDTH - MARGIN - 28,
            y:       FAV_HOVER_Y,
            width:   28,
            height:  26,
            image:   "rotate_arrow",
            border:  false,
            tooltip: "Rotate direction clockwise",
            onClick: rotateDirection
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
                var lblName = (tabIdx === 0) ? "fav_hover_lbl" : "all_hover_lbl";
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
                    var gridTop   = (tabIdx === 0) ? FAV_GRID_Y : ALL_GRID_Y;
                    var pageItems = (tabIdx === 0) ? favPageItems : allPageItems;
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
                        if (activeWindow.tabIndex === 0) {
                            updateFavGrid(activeWindow);
                            var statusLbl = activeWindow.findWidget("fav_status");
                            if (statusLbl) {
                                statusLbl.text = added.length > 0
                                    ? "Added: " + added[0] + " — click more or Esc to stop"
                                    : "No scenery here — click elsewhere or Esc to stop";
                            }
                        } else {
                            updateAllGrid(activeWindow);
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
                        updateFavGrid(activeWindow);
                    } else {
                        updateAllGrid(activeWindow);
                    }
                }
                needHoverRestart = true;
            }
        });
        if (activeWindow) {
            var pickName = (activeWindow.tabIndex === 0) ? "fav_pick" : "all_pick";
            var btn = activeWindow.findWidget(pickName);
            if (btn) btn.isPressed = true;
            var statusLbl = activeWindow.findWidget("fav_status");
            if (statusLbl) statusLbl.text = "Click scenery on the map to add — Esc to cancel";
        }
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
        var row = Math.floor(relY / (BTN_H    + BTN_GAP));
        if (col >= GRID_COLS || row >= GRID_ROWS) return -1;
        // Ensure cursor is inside the button itself, not in the gap between buttons
        var inBtnX = relX - col * (BTN_SIZE + BTN_GAP);
        var inBtnY = relY - row * (BTN_H    + BTN_GAP);
        if (inBtnX >= BTN_SIZE || inBtnY >= BTN_H) return -1;
        return row * GRID_COLS + col;
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
                        hoveredFavItem = null;
                        if (activeWindow) {
                            var rb = activeWindow.findWidget("fav_remove_btn");
                            if (rb) rb.isDisabled = true;
                            var hl = activeWindow.findWidget("fav_hover_lbl");
                            if (hl) hl.text = "";
                        }
                        if (activeWindow) {
                            updateFavGrid(activeWindow);
                            updateFavButtonPressedStates(activeWindow);
                        }
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
    // ---- Hover detector tool ----
    // Runs continuously while the window is open (except on tab 2).
    // Updates the hover label and hoveredFavItem as the cursor moves over the grid.
    function activateHoverTool() {
        ui.activateTool({
            id:     "fav-hover-detector",
            cursor: "default",
            filter: [],
            onMove: function (e) {
                if (!activeWindow) return;
                var tabIdx = activeWindow.tabIndex;
                if (tabIdx === 2) return;
                var isTab0    = (tabIdx === 0);
                var gridTop   = isTab0 ? FAV_GRID_Y : ALL_GRID_Y;
                var pageItems = isTab0 ? favPageItems : allPageItems;
                var lblName   = isTab0 ? "fav_hover_lbl" : "all_hover_lbl";
                var lbl = activeWindow.findWidget(lblName);
                if (!lbl) return;
                if (!e.screenCoords) { lbl.text = ""; return; }
                var idx = hitTestGrid(e.screenCoords.x, e.screenCoords.y, gridTop);
                var hi = (idx >= 0 && idx < pageItems.length) ? pageItems[idx] : null;
                lbl.text = hi
                    ? (hi.obj ? (hi.obj.name || hi.obj.identifier || "") : (hi.identifier || ""))
                    : "";
            },
            onFinish: function () {}
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
                    image:   "awards",
                    widgets: buildTab1Widgets()
                },
                {
                    image:   "scenery",
                    widgets: buildTab0Widgets()
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
                }
            },
            onTabChange: function () {
                if (!activeWindow) return;
                // Cancel picker, placer, and hover detector on any tab switch.
                if (ui.tool && (ui.tool.id === "fav-scenery-placer" || ui.tool.id === "fav-scenery-picker" ||
                                ui.tool.id === "fav-hover-detector")) {
                    ui.tool.cancel();
                }
                if (activeWindow.tabIndex === 0) {
                    // Height is set dynamically by updateFavGrid based on filled rows
                    refreshCollectionDropdown(activeWindow);
                    updateFavGrid(activeWindow);
                    needHoverRestart = true;
                } else if (activeWindow.tabIndex === 1) {
                    hoveredFavItem = null;
                    updateAllGrid(activeWindow);
                    needHoverRestart = true;
                } else {
                    // Tab 2: Import / Export — hover tool stays cancelled
                    activeWindow.height = IO_WIN_HEIGHT;
                    activeWindow.title  = "Import / Export Collections";
                    refreshIoCollDropdown(activeWindow);
                    var statusLbl = activeWindow.findWidget("io_status");
                    if (statusLbl) statusLbl.text = ioStatusText;
                }
            },

            onClose: function () {
                if (activeWindow) {
                    context.sharedStorage.set(WINDOW_POS_KEY, { x: activeWindow.x, y: activeWindow.y });
                }
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

        // Track ALL scenery placements (native UI or other plugins) for the Recent list.
        var NATIVE_PLACE_TYPES = {
            "smallsceneryplace":     "small_scenery",
            "largesceneryplace":     "large_scenery",
            "wallplace":             "wall",
            "footpathadditionplace": "footpath_addition",
            "bannerplace":           "banner"
        };
        context.subscribe("action.execute", function (e) {
            var type = NATIVE_PLACE_TYPES[e.action];
            if (!type) return;
            if (!e.result || e.result.error) return;
            var args = e.args;
            if (!args || args.object === undefined || args.object === null) return;
            if (args.flags && (args.flags & 0x40)) return; // skip ghost placements
            try {
                var objs = objectManager.getAllObjects(type);
                for (var oi = 0; oi < objs.length; oi++) {
                    if (objs[oi].index === args.object) {
                        addToRecent(type, objs[oi].identifier);
                        // If the All Scenery tab is currently showing "recent", refresh it live
                        if (activeWindow && activeWindow.tabIndex === 1
                                && TYPE_VALUES[currentTypeIdx] === "recent") {
                            filteredCatalog = applyGroupFilter(applySearch(buildCatalog("recent"), searchText), currentGroupIdx);
                            updateAllGrid(activeWindow);
                        }
                        // If the Favorites tab is showing the Recent Items collection, refresh it live
                        if (activeWindow && activeWindow.tabIndex === 0
                                && favViewMode === "recent") {
                            updateFavGrid(activeWindow);
                        }
                        return;
                    }
                }
            } catch (ex) { /* ignore */ }
        });

        ui.registerShortcut({
            id:       "favorite-scenery.rotate",
            text:     "Favorite Scenery: Rotate placement direction",
            bindings: ["Z"],
            callback: rotateDirection
        });



        function openFavoritesWindow() {
            // Toggle: close if already open, otherwise open
            try {
                var existing = ui.getWindow("favorite-scenery");
                if (existing) { existing.close(); return; }
            } catch (e) { /* window not found */ }

            // Reset pagination, search, and filters; load groups for current park
            loadGroupList();
            allCurrentPage  = 0;
            favCurrentPage  = 0;
            searchText      = "";
            favSearchText   = "";
            currentTypeIdx  = 0;
            favTypeIdx      = 0;
            currentGroupIdx = 0;
            favGroupIdx     = 0;
            filteredCatalog = buildCatalog("all");

            var desc = buildWindowDesc();
            var savedPos = context.sharedStorage.get(WINDOW_POS_KEY);
            if (savedPos && typeof savedPos.x === "number" && typeof savedPos.y === "number") {
                desc.x = savedPos.x;
                desc.y = savedPos.y;
            }
            var win = ui.openWindow(desc);
            activeWindow = win;
            refreshCollectionDropdown(win);
            updateFavGrid(win);
            activateHoverTool();
        }

        ui.registerShortcut({
            id:       "favorite-scenery.open",
            text:     "Favorite Scenery: Open window",
            bindings: ["CTRL+F"],
            callback: openFavoritesWindow
        });

        ui.registerMenuItem("Favorite Scenery", openFavoritesWindow);
    }

    registerPlugin({
        name:            "Favorite Scenery",
        version:         "1.2.2",
        authors:         ["DookieNukem"],
        type:            "local",
        licence:         "MIT",
        targetApiVersion: 110,
        main:             main
    });

})();

