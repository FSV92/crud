/**
 * @file
 * Sticky table headers.
 */

(function ($, Drupal, displace) {
  /**
   * Constructor for the tableHeader object. Provides sticky table headers.
   *
   * TableHeader will make the current table header stick to the top of the page
   * if the table is very long.
   *
   * @constructor Drupal.TableHeader
   *
   * @param {HTMLElement} table
   *   DOM object for the table to add a sticky header to.
   *
   * @listens event:columnschange
   */
  function TableHeader(table) {
    const $table = $(table);

    /**
     * @name Drupal.TableHeader#$originalTable
     *
     * @type {HTMLElement}
     */
    this.$originalTable = $table;

    /**
     * @type {jQuery}
     */
    this.$originalHeader = $table.children('thead');

    /**
     * @type {jQuery}
     */
    this.$originalHeaderCells = this.$originalHeader.find('> tr > th');

    /**
     * @type {null|boolean}
     */
    this.displayWeight = null;
    this.$originalTable.addClass('sticky-table');
    this.tableHeight = $table[0].clientHeight;
    this.tableOffset = this.$originalTable.offset();

    // React to columns change to avoid making checks in the scroll callback.
    this.$originalTable.on(
      'columnschange',
      { tableHeader: this },
      (e, display) => {
        const tableHeader = e.data.tableHeader;
        if (
          tableHeader.displayWeight === null ||
          tableHeader.displayWeight !== display
        ) {
          tableHeader.recalculateSticky();
        }
        tableHeader.displayWeight = display;
      },
    );

    // Create and display sticky header.
    this.createSticky();
  }

  // Helper method to loop through tables and execute a method.
  function forTables(method, arg) {
    const tables = TableHeader.tables;
    const il = tables.length;
    for (let i = 0; i < il; i++) {
      tables[i][method](arg);
    }
  }

  // Select and initialize sticky table headers.
  function tableHeaderInitHandler(e) {
    once('tableheader', $(e.data.context).find('table.sticky-enabled')).forEach(
      (table) => {
        TableHeader.tables.push(new TableHeader(table));
      },
    );
    forTables('onScroll');
  }

  /**
   * Attaches sticky table headers.
   *
   * @type {Drupal~behavior}
   *
   * @prop {Drupal~behaviorAttach} attach
   *   Attaches the sticky table header behavior.
   */
  Drupal.behaviors.tableHeader = {
    attach(context) {
      $(window).one(
        'scroll.TableHeaderInit',
        { context },
        tableHeaderInitHandler,
      );
    },
  };

  function scrollValue(position) {
    return document.documentElement[position] || document.body[position];
  }

  function tableHeaderResizeHandler(e) {
    forTables('recalculateSticky');
  }

  function tableHeaderOnScrollHandler(e) {
    forTables('onScroll');
  }

  function tableHeaderOffsetChangeHandler(e, offsets) {
    forTables('stickyPosition', offsets.top);
  }

  // Bind event that need to change all tables.
  $(window).on({
    /**
     * When resizing table width can change, recalculate everything.
     *
     * @ignore
     */
    'resize.TableHeader': tableHeaderResizeHandler,

    /**
     * Bind only one event to take care of calling all scroll callbacks.
     *
     * @ignore
     */
    'scroll.TableHeader': tableHeaderOnScrollHandler,
  });
  // Bind to custom Drupal events.
  $(document).on({
    /**
     * Recalculate columns width when window is resized, when show/hide weight
     * is triggered, or when toolbar tray is toggled.
     *
     * @ignore
     */
    'columnschange.TableHeader drupalToolbarTrayChange':
      tableHeaderResizeHandler,

    /**
     * Recalculate TableHeader.topOffset when viewport is resized.
     *
     * @ignore
     */
    'drupalViewportOffsetChange.TableHeader': tableHeaderOffsetChangeHandler,
  });

  /**
   * Store the state of TableHeader.
   */
  $.extend(
    TableHeader,
    /** @lends Drupal.TableHeader */ {
      /**
       * This will store the state of all processed tables.
       *
       * @type {Array.<Drupal.TableHeader>}
       */
      tables: [],
    },
  );

  /**
   * Extend TableHeader prototype.
   */
  $.extend(
    TableHeader.prototype,
    /** @lends Drupal.TableHeader# */ {
      /**
       * Minimum height in pixels for the table to have a sticky header.
       *
       * @type {number}
       */
      minHeight: 100,

      /**
       * Absolute position of the table on the page.
       *
       * @type {?Drupal~displaceOffset}
       */
      tableOffset: null,

      /**
       * Absolute position of the table on the page.
       *
       * @type {?number}
       */
      tableHeight: null,

      /**
       * Boolean storing the sticky header visibility state.
       *
       * @type {boolean}
       */
      stickyVisible: false,

      /**
       * Create the duplicate header.
       */
      createSticky() {
        // For caching purposes.
        this.$html = $('html');
        // Clone the table header so it inherits original jQuery properties.
        const $stickyHeader = this.$originalHeader.clone(true);
        // Hide the table to avoid a flash of the header clone upon page load.
        this.$stickyTable = $('<table class="sticky-header"></table>')
          .css({
            visibility: 'hidden',
            position: 'fixed',
            top: '0px',
          })
          .append($stickyHeader)
          .insertBefore(this.$originalTable);

        this.$stickyHeaderCells = $stickyHeader.find('> tr > th');

        // Initialize all computations.
        this.recalculateSticky();
      },

      /**
       * Set absolute position of sticky.
       *
       * @param {number} offsetTop
       *   The top offset for the sticky header.
       * @param {number} offsetLeft
       *   The left offset for the sticky header.
       *
       * @return {jQuery}
       *   The sticky table as a jQuery collection.
       */
      stickyPosition(offsetTop, offsetLeft) {
        const css = {};
        if (typeof offsetTop === 'number') {
          css.top = `${offsetTop}px`;
        }
        if (typeof offsetLeft === 'number') {
          css.left = `${this.tableOffset.left - offsetLeft}px`;
        }
        this.$html.css(
          'scroll-padding-top',
          displace.offsets.top +
            (this.stickyVisible ? this.$stickyTable.height() : 0),
        );
        return this.$stickyTable.css(css);
      },

      /**
       * Returns true if sticky is currently visible.
       *
       * @return {boolean}
       *   The visibility status.
       */
      checkStickyVisible() {
        const scrollTop = scrollValue('scrollTop');
        const tableTop = this.tableOffset.top - displace.offsets.top;
        const tableBottom = tableTop + this.tableHeight;
        let visible = false;

        if (tableTop < scrollTop && scrollTop < tableBottom - this.minHeight) {
          visible = true;
        }

        this.stickyVisible = visible;
        return visible;
      },

      /**
       * Check if sticky header should be displayed.
       *
       * This function is throttled to once every 250ms to avoid unnecessary
       * calls.
       *
       * @param {jQuery.Event} e
       *   The scroll event.
       */
      onScroll(e) {
        this.checkStickyVisible();
        // Track horizontal positioning relative to the viewport.
        this.stickyPosition(null, scrollValue('scrollLeft'));
        this.$stickyTable.css(
          'visibility',
          this.stickyVisible ? 'visible' : 'hidden',
        );
      },

      /**
       * Event handler: recalculates position of the sticky table header.
       *
       * @param {jQuery.Event} event
       *   Event being triggered.
       */
      recalculateSticky(event) {
        // Update table size.
        this.tableHeight = this.$originalTable[0].clientHeight;

        // Update offset top.
        displace.offsets.top = displace.calculateOffset('top');
        this.tableOffset = this.$originalTable.offset();
        this.stickyPosition(displace.offsets.top, scrollValue('scrollLeft'));

        // Update columns width.
        let $that = null;
        let $stickyCell = null;
        let display = null;
        // Resize header and its cell widths.
        // Only apply width to visible table cells. This prevents the header from
        // displaying incorrectly when the sticky header is no longer visible.
        const il = this.$originalHeaderCells.length;
        for (let i = 0; i < il; i++) {
          $that = $(this.$originalHeaderCells[i]);
          $stickyCell = this.$stickyHeaderCells.eq($that.index());
          display = $that.css('display');
          if (display !== 'none') {
            $stickyCell.css({ width: $that.css('width'), display });
          } else {
            $stickyCell.css('display', 'none');
          }
        }
        this.$stickyTable.css('width', this.$originalTable.outerWidth());
      },
    },
  );

  // Expose constructor in the public space.
  Drupal.TableHeader = TableHeader;
})(jQuery, Drupal, window.Drupal.displace);
;
/**
 * @file
 * Responsive table functionality.
 */

(function ($, Drupal, window) {
  /**
   * The TableResponsive object optimizes table presentation for screen size.
   *
   * A responsive table hides columns at small screen sizes, leaving the most
   * important columns visible to the end user. Users should not be prevented
   * from accessing all columns, however. This class adds a toggle to a table
   * with hidden columns that exposes the columns. Exposing the columns will
   * likely break layouts, but it provides the user with a means to access
   * data, which is a guiding principle of responsive design.
   *
   * @constructor Drupal.TableResponsive
   *
   * @param {HTMLElement} table
   *   The table element to initialize the responsive table on.
   */
  function TableResponsive(table) {
    this.table = table;
    this.$table = $(table);
    this.showText = Drupal.t('Show all columns');
    this.hideText = Drupal.t('Hide lower priority columns');
    // Store a reference to the header elements of the table so that the DOM is
    // traversed only once to find them.
    this.$headers = this.$table.find('th');
    // Add a link before the table for users to show or hide weight columns.
    this.$link = $(
      '<button type="button" class="link tableresponsive-toggle"></button>',
    )
      .attr(
        'title',
        Drupal.t(
          'Show table cells that were hidden to make the table fit within a small screen.',
        ),
      )
      .on('click', $.proxy(this, 'eventhandlerToggleColumns'));

    this.$table.before(
      $('<div class="tableresponsive-toggle-columns"></div>').append(
        this.$link,
      ),
    );

    // Attach a resize handler to the window.
    $(window)
      .on(
        'resize.tableresponsive',
        $.proxy(this, 'eventhandlerEvaluateColumnVisibility'),
      )
      .trigger('resize.tableresponsive');
  }

  /**
   * Attach the tableResponsive function to {@link Drupal.behaviors}.
   *
   * @type {Drupal~behavior}
   *
   * @prop {Drupal~behaviorAttach} attach
   *   Attaches tableResponsive functionality.
   */
  Drupal.behaviors.tableResponsive = {
    attach(context, settings) {
      once('tableresponsive', 'table.responsive-enabled', context).forEach(
        (table) => {
          TableResponsive.tables.push(new TableResponsive(table));
        },
      );
    },
  };

  /**
   * Extend the TableResponsive function with a list of managed tables.
   */
  $.extend(
    TableResponsive,
    /** @lends Drupal.TableResponsive */ {
      /**
       * Store all created instances.
       *
       * @type {Array.<Drupal.TableResponsive>}
       */
      tables: [],
    },
  );

  /**
   * Associates an action link with the table that will show hidden columns.
   *
   * Columns are assumed to be hidden if their header has the class priority-low
   * or priority-medium.
   */
  $.extend(
    TableResponsive.prototype,
    /** @lends Drupal.TableResponsive# */ {
      /**
       * @param {jQuery.Event} e
       *   The event triggered.
       */
      eventhandlerEvaluateColumnVisibility(e) {
        const pegged = parseInt(this.$link.data('pegged'), 10);
        const hiddenLength = this.$headers.filter(
          '.priority-medium:hidden, .priority-low:hidden',
        ).length;
        // If the table has hidden columns, associate an action link with the
        // table to show the columns.
        if (hiddenLength > 0) {
          this.$link.show();
          this.$link[0].textContent = this.showText;
        }
        // When the toggle is pegged, its presence is maintained because the user
        // has interacted with it. This is necessary to keep the link visible if
        // the user adjusts screen size and changes the visibility of columns.
        if (!pegged && hiddenLength === 0) {
          this.$link.hide();
          this.$link[0].textContent = this.hideText;
        }
      },

      /**
       * Toggle the visibility of columns based on their priority.
       *
       * Columns are classed with either 'priority-low' or 'priority-medium'.
       *
       * @param {jQuery.Event} e
       *   The event triggered.
       */
      eventhandlerToggleColumns(e) {
        e.preventDefault();
        const self = this;
        const $hiddenHeaders = this.$headers.filter(
          '.priority-medium:hidden, .priority-low:hidden',
        );
        this.$revealedCells = this.$revealedCells || $();
        // Reveal hidden columns.
        if ($hiddenHeaders.length > 0) {
          $hiddenHeaders.each(function (index, element) {
            const $header = $(this);
            const position = $header.prevAll('th').length;
            self.$table.find('tbody tr').each(function () {
              const $cells = $(this).find('td').eq(position);
              $cells.show();
              // Keep track of the revealed cells, so they can be hidden later.
              self.$revealedCells = $().add(self.$revealedCells).add($cells);
            });
            $header.show();
            // Keep track of the revealed headers, so they can be hidden later.
            self.$revealedCells = $().add(self.$revealedCells).add($header);
          });
          this.$link[0].textContent = this.hideText;
          this.$link.data('pegged', 1);
        }
        // Hide revealed columns.
        else {
          this.$revealedCells.hide();
          // Strip the 'display:none' declaration from the style attributes of
          // the table cells that .hide() added.
          this.$revealedCells.each(function (index, element) {
            const $cell = $(this);
            const properties = $cell.attr('style').split(';');
            const newProps = [];
            // The hide method adds display none to the element. The element
            // should be returned to the same state it was in before the columns
            // were revealed, so it is necessary to remove the display none value
            // from the style attribute.
            const match = /^display\s*:\s*none$/;
            for (let i = 0; i < properties.length; i++) {
              const prop = properties[i];
              prop.trim();
              // Find the display:none property and remove it.
              const isDisplayNone = match.exec(prop);
              if (isDisplayNone) {
                continue;
              }
              newProps.push(prop);
            }
            // Return the rest of the style attribute values to the element.
            $cell.attr('style', newProps.join(';'));
          });
          this.$link[0].textContent = this.showText;
          this.$link.data('pegged', 0);
          // Refresh the toggle link.
          $(window).trigger('resize.tableresponsive');
        }
      },
    },
  );

  // Make the TableResponsive object available in the Drupal namespace.
  Drupal.TableResponsive = TableResponsive;
})(jQuery, Drupal, window);
;
/**
 * @file
 * Defines checkbox theme functions.
 */

((Drupal) => {
  /**
   * Theme function for a checkbox.
   *
   * @return {string}
   *   The HTML markup for the checkbox.
   */
  Drupal.theme.checkbox = () =>
    `<input type="checkbox" class="form-checkbox"/>`;
})(Drupal);
;
/**
 * @file
 * Theme override for checkbox.
 */

((Drupal) => {
  /**
   * Constructs a checkbox input element.
   *
   * @return {string}
   *   A string representing a DOM fragment.
   */
  Drupal.theme.checkbox = () =>
    '<input type="checkbox" class="form-checkbox form-boolean form-boolean--type-checkbox"/>';
})(Drupal);
;
/**
 * @file
 * Table select functionality.
 */

(function ($, Drupal) {
  /**
   * Initialize tableSelects.
   *
   * @type {Drupal~behavior}
   *
   * @prop {Drupal~behaviorAttach} attach
   *   Attaches tableSelect functionality.
   */
  Drupal.behaviors.tableSelect = {
    attach(context, settings) {
      // Select the inner-most table in case of nested tables.
      once(
        'table-select',
        $(context).find('th.select-all').closest('table'),
      ).forEach((table) => Drupal.tableSelect.call(table));
    },
  };

  /**
   * Callback used in {@link Drupal.behaviors.tableSelect}.
   */
  Drupal.tableSelect = function () {
    // Do not add a "Select all" checkbox if there are no rows with checkboxes
    // in the table.
    if ($(this).find('td input[type="checkbox"]').length === 0) {
      return;
    }

    // Keep track of the table, which checkbox is checked and alias the
    // settings.
    const table = this;
    let checkboxes;
    let lastChecked;
    const $table = $(table);
    const strings = {
      selectAll: Drupal.t('Select all rows in this table'),
      selectNone: Drupal.t('Deselect all rows in this table'),
    };
    const updateSelectAll = function (state) {
      // Update table's select-all checkbox (and sticky header's if available).
      $table
        .prev('table.sticky-header')
        .addBack()
        .find('th.select-all input[type="checkbox"]')
        .each(function () {
          const $checkbox = $(this);
          const stateChanged = $checkbox.prop('checked') !== state;

          $checkbox.attr(
            'title',
            state ? strings.selectNone : strings.selectAll,
          );

          /**
           * @checkbox {HTMLElement}
           */
          if (stateChanged) {
            $checkbox.prop('checked', state).trigger('change');
          }
        });
    };

    // Find all <th> with class select-all, and insert the check all checkbox.
    $table
      .find('th.select-all')
      .prepend($(Drupal.theme('checkbox')).attr('title', strings.selectAll))
      .on('click', (event) => {
        if ($(event.target).is('input[type="checkbox"]')) {
          // Loop through all checkboxes and set their state to the select all
          // checkbox' state.
          checkboxes.each(function () {
            const $checkbox = $(this);
            const stateChanged =
              $checkbox.prop('checked') !== event.target.checked;

            /**
             * @checkbox {HTMLElement}
             */
            if (stateChanged) {
              $checkbox.prop('checked', event.target.checked).trigger('change');
            }
            // Either add or remove the selected class based on the state of the
            // check all checkbox.

            /**
             * @checkbox {HTMLElement}
             */
            $checkbox.closest('tr').toggleClass('selected', this.checked);
          });
          // Update the title and the state of the check all box.
          updateSelectAll(event.target.checked);
        }
      });

    // For each of the checkboxes within the table that are not disabled.
    checkboxes = $table
      .find('td input[type="checkbox"]:enabled')
      .on('click', function (e) {
        // Either add or remove the selected class based on the state of the
        // check all checkbox.

        /**
         * @this {HTMLElement}
         */
        $(this).closest('tr').toggleClass('selected', this.checked);

        // If this is a shift click, we need to highlight everything in the
        // range. Also make sure that we are actually checking checkboxes
        // over a range and that a checkbox has been checked or unchecked before.
        if (e.shiftKey && lastChecked && lastChecked !== e.target) {
          // We use the checkbox's parent <tr> to do our range searching.
          Drupal.tableSelectRange(
            $(e.target).closest('tr')[0],
            $(lastChecked).closest('tr')[0],
            e.target.checked,
          );
        }

        // If all checkboxes are checked, make sure the select-all one is checked
        // too, otherwise keep unchecked.
        updateSelectAll(
          checkboxes.length === checkboxes.filter(':checked').length,
        );

        // Keep track of the last checked checkbox.
        lastChecked = e.target;
      });

    // If all checkboxes are checked on page load, make sure the select-all one
    // is checked too, otherwise keep unchecked.
    updateSelectAll(checkboxes.length === checkboxes.filter(':checked').length);
  };

  /**
   * @param {HTMLElement} from
   *   The HTML element representing the "from" part of the range.
   * @param {HTMLElement} to
   *   The HTML element representing the "to" part of the range.
   * @param {boolean} state
   *   The state to set on the range.
   */
  Drupal.tableSelectRange = function (from, to, state) {
    // We determine the looping mode based on the order of from and to.
    const mode =
      from.rowIndex > to.rowIndex ? 'previousSibling' : 'nextSibling';

    // Traverse through the sibling nodes.
    for (let i = from[mode]; i; i = i[mode]) {
      const $i = $(i);
      // Make sure that we're only dealing with elements.
      if (i.nodeType !== 1) {
        continue;
      }
      // Either add or remove the selected class based on the state of the
      // target checkbox.
      $i.toggleClass('selected', state);
      $i.find('input[type="checkbox"]').prop('checked', state);

      if (to.nodeType) {
        // If we are at the end of the range, stop.
        if (i === to) {
          break;
        }
      }
      // A faster alternative to doing $(i).filter(to).length.
      else if ($.filter(to, [i]).r.length) {
        break;
      }
    }
  };
})(jQuery, Drupal);
;
