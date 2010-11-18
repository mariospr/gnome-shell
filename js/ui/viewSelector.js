/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

const Clutter = imports.gi.Clutter;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const Signals = imports.signals;
const Lang = imports.lang;
const Shell = imports.gi.Shell;
const St = imports.gi.St;
const Gettext = imports.gettext.domain('gnome-shell');
const _ = Gettext.gettext;

const Main = imports.ui.main;
const Search = imports.ui.search;
const SearchDisplay = imports.ui.searchDisplay;
const Tweener = imports.ui.tweener;


function SearchEntry() {
    this._init();
}

SearchEntry.prototype = {
    _init : function() {
        this.actor = new St.Entry({ name: 'searchEntry',
                                    hint_text: _("Search your computer") });
        this.entry = this.actor.clutter_text;

        this.actor.clutter_text.connect('text-changed', Lang.bind(this,
            function() {
                if (this.isActive())
                    this.actor.set_secondary_icon_from_file(global.imagedir +
                                                            'close-black.svg');
                else
                    this.actor.set_secondary_icon_from_file(null);
            }));
        this.actor.connect('secondary-icon-clicked', Lang.bind(this,
            function() {
                this.reset();
            }));
        this.actor.connect('destroy', Lang.bind(this, this._onDestroy));

        global.stage.connect('notify::key-focus', Lang.bind(this, this._updateCursorVisibility));

        this.pane = null;

        this._capturedEventId = 0;
    },

    _updateCursorVisibility: function() {
        let focus = global.stage.get_key_focus();
        if (focus == global.stage || focus == this.entry)
            this.entry.set_cursor_visible(true);
        else
            this.entry.set_cursor_visible(false);
    },

    show: function() {
        if (this._capturedEventId == 0)
            this._capturedEventId = global.stage.connect('captured-event',
                                 Lang.bind(this, this._onCapturedEvent));
        this.entry.set_cursor_visible(true);
        this.entry.set_selection(0, 0);
    },

    hide: function() {
        if (this._capturedEventId > 0) {
            global.stage.disconnect(this._capturedEventId);
            this._capturedEventId = 0;
        }
    },

    reset: function () {
        let [x, y, mask] = global.get_pointer();
        let actor = global.stage.get_actor_at_pos (Clutter.PickMode.REACTIVE,
                                                   x, y);
        // this.actor is never hovered directly, only its clutter_text and icon
        let hovered = this.actor == actor.get_parent();

        this.actor.set_hover(hovered);

        this.entry.text = '';

        // Return focus to the stage
        global.stage.set_key_focus(null);

        this.entry.set_cursor_visible(true);
        this.entry.set_selection(0, 0);
    },

    getText: function () {
        return this.entry.get_text().replace(/^\s+/g, '').replace(/\s+$/g, '');
    },

    // some search term has been entered
    isActive: function() {
        return this.actor.get_text() != '';
    },

    // the entry does not show the hint
    _isActivated: function() {
        return this.entry.text == this.actor.get_text();
    },

    _onCapturedEvent: function(actor, event) {
        let source = event.get_source();
        let panelEvent = source && Main.panel.actor.contains(source);

        switch (event.type()) {
            case Clutter.EventType.BUTTON_PRESS:
                // the user clicked outside after activating the entry, but
                // with no search term entered - cancel the search
                if (source != this.entry && this.entry.text == '') {
                    this.reset();
                    // allow only panel events to continue
                    return !panelEvent;
                }
                return false;
            case Clutter.EventType.KEY_PRESS:
                // If neither the stage nor our entry have key focus, some
                // "special" actor grabbed the focus (run dialog, looking
                // glass); we don't want to interfere with that
                let focus = global.stage.get_key_focus();
                if (focus != global.stage && focus != this.entry)
                    return false;

                let sym = event.get_key_symbol();

                // If we have an active search, Escape cancels it - if we
                // haven't, the key is ignored
                if (sym == Clutter.Escape)
                    if (this._isActivated()) {
                        this.reset();
                        return true;
                    } else {
                        return false;
                    }

                 // Ignore non-printable keys
                 if (!Clutter.keysym_to_unicode(sym))
                     return false;

                // Search started - move the key focus to the entry and
                // "repeat" the event
                if (!this._isActivated()) {
                    global.stage.set_key_focus(this.entry);
                    this.entry.event(event, false);
                }

                return false;
            default:
                // Suppress all other events outside the panel while the entry
                // is activated and no search has been entered - any click
                // outside the entry will cancel the search
                return (this.entry.text == '' && !panelEvent);
        }
    },

    _onDestroy: function() {
        if (this._capturedEventId > 0) {
            global.stage.disconnect(this._capturedEventId);
            this._capturedEventId = 0;
        }
    }
};
Signals.addSignalMethods(SearchEntry.prototype);


function BaseTab(titleActor, pageActor) {
    this._init(titleActor, pageActor);
}

BaseTab.prototype = {
    _init: function(titleActor, pageActor) {
        this.title = titleActor;
        this.page = new St.Bin({ child: pageActor,
                                 x_align: St.Align.START,
                                 y_align: St.Align.START,
                                 x_fill: true,
                                 y_fill: true,
                                 style_class: 'view-tab-page' });

        this.visible = false;
    },

    show: function() {
        this.visible = true;
        this.page.opacity = 0;
        this.page.show();

        Tweener.addTween(this.page,
                         { opacity: 255,
                           time: 0.1,
                           transition: 'easeOutQuad' });
    },

    hide: function() {
        this.visible = false;
        Tweener.addTween(this.page,
                         { opacity: 0,
                           time: 0.1,
                           transition: 'easeOutQuad',
                           onComplete: Lang.bind(this,
                               function() {
                                   this.page.hide();
                               })
                         });
    },

    _activate: function() {
        this.emit('activated');
    }
};
Signals.addSignalMethods(BaseTab.prototype);


function ViewTab(label, pageActor) {
    this._init(label, pageActor);
}

ViewTab.prototype = {
    __proto__: BaseTab.prototype,

    _init: function(label, pageActor) {
        let titleActor = new St.Button({ label: label,
                                         style_class: 'view-tab-title' });
        titleActor.connect('clicked', Lang.bind(this, this._activate));

        BaseTab.prototype._init.call(this, titleActor, pageActor);
    }
};


function SearchTab() {
    this._init();
}

SearchTab.prototype = {
    __proto__: BaseTab.prototype,

    _init: function() {
        this._searchActive = false;
        this._searchPending = false;
        this._keyPressId = 0;
        this._searchTimeoutId = 0;

        this._searchSystem = new Search.SearchSystem();

        this._searchEntry = new SearchEntry();
        this._searchResults = new SearchDisplay.SearchResults(this._searchSystem);
        BaseTab.prototype._init.call(this,
                                     this._searchEntry.actor,
                                     this._searchResults.actor);
        this._searchEntry.entry.connect('text-changed',
                                        Lang.bind(this, this._onTextChanged));
        this._searchEntry.entry.connect('activate', Lang.bind(this, function (se) {
            if (this._searchTimeoutId > 0) {
                Mainloop.source_remove(this._searchTimeoutId);
                this._doSearch();
            }
            this._searchResults.activateSelected();
            return true;
        }));
    },

    setFindAsYouType: function(enabled) {
        if (enabled)
            this._searchEntry.show();
        else
            this._searchEntry.hide();
    },

    show: function() {
        BaseTab.prototype.show.call(this);

        if (this._keyPressId == 0)
            this._keyPressId = global.stage.connect('key-press-event',
                                                    Lang.bind(this, this._onKeyPress));
    },

    hide: function() {
        BaseTab.prototype.hide.call(this);

        if (this._keyPressId > 0) {
            global.stage.disconnect(this._keyPressId);
            this._keyPressId = 0;
        }
        this._searchEntry.reset();
    },

    addSearchProvider: function(provider) {
        this._searchSystem.registerProvider(provider);
        this._searchResults.createProviderMeta(provider);
    },

    _onTextChanged: function (se, prop) {
        let searchPreviouslyActive = this._searchActive;
        this._searchActive = this._searchEntry.isActive();
        this._searchPending = this._searchActive && !searchPreviouslyActive;
        if (this._searchPending) {
            this._searchResults.startingSearch();
        }
        if (this._searchActive) {
            this._activate();
        } else {
            this.emit('search-cancelled');
        }
        if (!this._searchActive) {
            if (this._searchTimeoutId > 0) {
                Mainloop.source_remove(this._searchTimeoutId);
                this._searchTimeoutId = 0;
            }
            return;
        }
        if (this._searchTimeoutId > 0)
            return;
        this._searchTimeoutId = Mainloop.timeout_add(150, Lang.bind(this, this._doSearch));
    },

    _onKeyPress: function(stage, event) {
        // If neither the stage nor the search entry have key focus, some
        // "special" actor grabbed the focus (run dialog, looking glass);
        // we don't want to interfere with that
        let focus = stage.get_key_focus();
        if (focus != stage && focus != this._searchEntry.entry)
            return false;

        let symbol = event.get_key_symbol();
        if (symbol == Clutter.Up) {
            if (!this._searchActive)
                return true;
            this._searchResults.selectUp(false);

            return true;
        } else if (symbol == Clutter.Down) {
            if (!this._searchActive)
                return true;

            this._searchResults.selectDown(false);
            return true;
        }
        return false;
    },

    _doSearch: function () {
        this._searchTimeoutId = 0;
        let text = this._searchEntry.getText();
        this._searchResults.updateSearch(text);

        return false;
    }
};


function ViewSelector() {
    this._init();
}

ViewSelector.prototype = {
    _init : function() {
        this.actor = new St.BoxLayout({ name: 'viewSelector',
                                        vertical: true });

        // The tab bar is located at the top of the view selector and
        // holds both "normal" tab labels and the search entry. The former
        // is left aligned, the latter right aligned - unless the text
        // direction is RTL, in which case the order is reversed.
        this._tabBar = new Shell.GenericContainer();
        this._tabBar.connect('get-preferred-width',
                             Lang.bind(this, this._getPreferredTabBarWidth));
        this._tabBar.connect('get-preferred-height',
                             Lang.bind(this, this._getPreferredTabBarHeight));
        this._tabBar.connect('allocate',
                             Lang.bind(this, this._allocateTabBar));
        this.actor.add(this._tabBar);

        // Box to hold "normal" tab labels
        this._tabBox = new St.BoxLayout({ name: 'viewSelectorTabBar' });
        this._tabBar.add_actor(this._tabBox);

        // The searchArea just holds the entry
        this._searchArea = new St.Bin({ name: 'searchArea' });
        this._tabBar.add_actor(this._searchArea);

        // The page area holds the tab pages. Every page is given the
        // area's full allocation, so that the pages would appear on top
        // of each other if the inactive ones weren't hidden.
        this._pageArea = new Shell.Stack();
        this.actor.add(this._pageArea, { x_fill: true,
                                         y_fill: true,
                                         expand: true });

        this._tabs = [];
        this._activeTab = null;

        this._searchTab = new SearchTab();
        this._searchArea.set_child(this._searchTab.title);
        this._addTab(this._searchTab);

        this._searchTab.connect('search-cancelled', Lang.bind(this,
            function() {
                this._switchTab(this._activeTab);
            }));

        this._keyPressId = 0;
        this._itemDragBeginId = 0;
        this._overviewHidingId = 0;

        // Public constraints which may be used to tie actors' height or
        // vertical position to the current tab's content; as the content's
        // height and position depend on the view selector's style properties
        // (e.g. font size, padding, spacing, ...) it would be extremely hard
        // and ugly to get these from the outside. While it would be possible
        // to use position and height properties directly, outside code would
        // need to ensure that the content is properly allocated before
        // accessing the properties.
        this.constrainY = new Clutter.BindConstraint({ source: this._pageArea,
                                                       coordinate: Clutter.BindCoordinate.Y });
        this.constrainHeight = new Clutter.BindConstraint({ source: this._pageArea,
                                                            coordinate: Clutter.BindCoordinate.HEIGHT });
    },

    _addTab: function(tab) {
        tab.page.hide();
        this._pageArea.add_actor(tab.page);
        tab.connect('activated', Lang.bind(this, function(tab) {
            this._switchTab(tab);
        }));
    },

    addViewTab: function(title, pageActor) {
        let viewTab = new ViewTab(title, pageActor);
        this._tabs.push(viewTab);
        this._tabBox.add(viewTab.title);
        this._addTab(viewTab);
    },

    _switchTab: function(tab) {
        if (this._activeTab && this._activeTab.visible) {
            if (this._activeTab == tab)
                return;
            this._activeTab.title.remove_style_pseudo_class('selected');
            this._activeTab.hide();
        }

        if (tab != this._searchTab) {
            tab.title.add_style_pseudo_class('selected');
            this._activeTab = tab;
            if (this._searchTab.visible) {
                this._searchTab.hide();
            }
        }

        if (!tab.visible)
            tab.show();
    },

    _switchDefaultTab: function() {
        if (this._tabs.length > 0)
            this._switchTab(this._tabs[0]);
    },

    _getPreferredTabBarWidth: function(box, forHeight, alloc) {
        let children = box.get_children();
        for (let i = 0; i < children.length; i++) {
            let [childMin, childNat] = children[i].get_preferred_width(forHeight);
            alloc.min_size += childMin;
            alloc.natural_size += childNat;
        }
    },

    _getPreferredTabBarHeight: function(box, forWidth, alloc) {
        let children = box.get_children();
        for (let i = 0; i < children.length; i++) {
            let [childMin, childNatural] = children[i].get_preferred_height(forWidth);
            if (childMin > alloc.min_size)
                alloc.min_size = childMin;
            if (childNatural > alloc.natural_size)
                alloc.natural_size = childNatural;
        }
    },

    _allocateTabBar: function(container, box, flags) {
        let allocWidth = box.x2 - box.x1;
        let allocHeight = box.y2 - box.y1;

        let [searchMinWidth, searchNatWidth] = this._searchArea.get_preferred_width(-1);
        let [barMinWidth, barNatWidth] = this._tabBox.get_preferred_width(-1);
        let childBox = new Clutter.ActorBox();
        childBox.y1 = 0;
        childBox.y2 = allocHeight;
        if (this.actor.get_direction() == St.TextDirection.RTL) {
            childBox.x1 = allocWidth - barNatWidth;
            childBox.x2 = allocWidth;
        } else {
            childBox.x1 = 0;
            childBox.x2 = barNatWidth;
        }
        this._tabBox.allocate(childBox, flags);

        if (this.actor.get_direction() == St.TextDirection.RTL) {
            childBox.x1 = 0;
            childBox.x2 = searchNatWidth;
        } else {
            childBox.x1 = allocWidth - searchNatWidth;
            childBox.x2 = allocWidth;
        }
        this._searchArea.allocate(childBox, flags);

        Meta.later_add(Meta.LaterType.BEFORE_REDRAW, Lang.bind(this,
            function() {
                this.constrainY.offset = this.actor.y;
            }));
    },

    _onKeyPress: function(stage, event) {
        // Only process events if the stage has key focus - search is handled
        // by the search tab, and we do not want to interfere with "special"
        // actors grabbing focus (run dialog, looking glass, notifications).
        let focus = stage.get_key_focus();
        if (focus != stage)
            return false;

        let symbol = event.get_key_symbol();
        if (symbol == Clutter.Escape) {
            Main.overview.hide();
            return true;
        }
        return false;
    },

    addSearchProvider: function(provider) {
        this._searchTab.addSearchProvider(provider);
    },

    show: function() {
        this._searchTab.setFindAsYouType(true);

        if (this._itemDragBeginId == 0)
            this._itemDragBeginId = Main.overview.connect('item-drag-begin',
                                                          Lang.bind(this, this._switchDefaultTab));
        if (this._overviewHidingId == 0)
            this._overviewHidingId = Main.overview.connect('hiding',
                                                           Lang.bind(this, this._switchDefaultTab));
        if (this._keyPressId == 0)
            this._keyPressId = global.stage.connect('key-press-event',
                                                    Lang.bind(this, this._onKeyPress));

        this._switchDefaultTab();
    },

    hide: function() {
        this._searchTab.setFindAsYouType(false);

        if (this._keyPressId > 0) {
            global.stage.disconnect(this._keyPressId);
            this._keyPressId = 0;
        }

        if (this._itemDragBeginId > 0) {
            Main.overview.disconnect(this._itemDragBeginId);
            this._itemDragBeginId = 0;
        }

        if (this._overviewHidingId > 0) {
            Main.overview.disconnect(this._overviewHidingId);
            this._overviewHidingId = 0;
        }
    }
};
Signals.addSignalMethods(ViewSelector.prototype);
