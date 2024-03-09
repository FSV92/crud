/**
 * @file
 * JavaScript API for the History module, with client-side caching.
 *
 * May only be loaded for authenticated users, with the History module enabled.
 */

(function ($, Drupal, drupalSettings, storage) {
  const currentUserID = parseInt(drupalSettings.user.uid, 10);

  // Any comment that is older than 30 days is automatically considered read,
  // so for these we don't need to perform a request at all!
  const secondsIn30Days = 2592000;
  const thirtyDaysAgo =
    Math.round(new Date().getTime() / 1000) - secondsIn30Days;

  // Use the data embedded in the page, if available.
  let embeddedLastReadTimestamps = false;
  if (drupalSettings.history && drupalSettings.history.lastReadTimestamps) {
    embeddedLastReadTimestamps = drupalSettings.history.lastReadTimestamps;
  }

  /**
   * @namespace
   */
  Drupal.history = {
    /**
     * Fetch "last read" timestamps for the given nodes.
     *
     * @param {Array} nodeIDs
     *   An array of node IDs.
     * @param {function} callback
     *   A callback that is called after the requested timestamps were fetched.
     */
    fetchTimestamps(nodeIDs, callback) {
      // Use the data embedded in the page, if available.
      if (embeddedLastReadTimestamps) {
        callback();
        return;
      }

      $.ajax({
        url: Drupal.url('history/get_node_read_timestamps'),
        type: 'POST',
        data: { 'node_ids[]': nodeIDs },
        dataType: 'json',
        success(results) {
          Object.keys(results || {}).forEach((nodeID) => {
            storage.setItem(
              `Drupal.history.${currentUserID}.${nodeID}`,
              results[nodeID],
            );
          });
          callback();
        },
      });
    },

    /**
     * Get the last read timestamp for the given node.
     *
     * @param {number|string} nodeID
     *   A node ID.
     *
     * @return {number}
     *   A UNIX timestamp.
     */
    getLastRead(nodeID) {
      // Use the data embedded in the page, if available.
      if (embeddedLastReadTimestamps && embeddedLastReadTimestamps[nodeID]) {
        return parseInt(embeddedLastReadTimestamps[nodeID], 10);
      }
      return parseInt(
        storage.getItem(`Drupal.history.${currentUserID}.${nodeID}`) || 0,
        10,
      );
    },

    /**
     * Marks a node as read, store the last read timestamp client-side.
     *
     * @param {number|string} nodeID
     *   A node ID.
     */
    markAsRead(nodeID) {
      $.ajax({
        url: Drupal.url(`history/${nodeID}/read`),
        type: 'POST',
        dataType: 'json',
        success(timestamp) {
          // If the data is embedded in the page, don't store on the client
          // side.
          if (
            embeddedLastReadTimestamps &&
            embeddedLastReadTimestamps[nodeID]
          ) {
            return;
          }

          storage.setItem(
            `Drupal.history.${currentUserID}.${nodeID}`,
            timestamp,
          );
        },
      });
    },

    /**
     * Determines whether a server check is necessary.
     *
     * Any content that is >30 days old never gets a "new" or "updated"
     * indicator. Any content that was published before the oldest known reading
     * also never gets a "new" or "updated" indicator, because it must've been
     * read already.
     *
     * @param {number|string} nodeID
     *   A node ID.
     * @param {number} contentTimestamp
     *   The time at which some content (e.g. a comment) was published.
     *
     * @return {boolean}
     *   Whether a server check is necessary for the given node and its
     *   timestamp.
     */
    needsServerCheck(nodeID, contentTimestamp) {
      // First check if the content is older than 30 days, then we can bail
      // early.
      if (contentTimestamp < thirtyDaysAgo) {
        return false;
      }

      // Use the data embedded in the page, if available.
      if (embeddedLastReadTimestamps && embeddedLastReadTimestamps[nodeID]) {
        return (
          contentTimestamp > parseInt(embeddedLastReadTimestamps[nodeID], 10)
        );
      }

      const minLastReadTimestamp = parseInt(
        storage.getItem(`Drupal.history.${currentUserID}.${nodeID}`) || 0,
        10,
      );
      return contentTimestamp > minLastReadTimestamp;
    },
  };
})(jQuery, Drupal, drupalSettings, window.localStorage);
;
/**
 * @file
 * Attaches behaviors for the Comment module's "X new comments" link.
 *
 * May only be loaded for authenticated users, with the History module
 * installed.
 */

(function ($, Drupal, drupalSettings) {
  /**
   * Hides a "new comment" element.
   *
   * @param {jQuery} $placeholder
   *   The placeholder element of the new comment link.
   *
   * @return {jQuery}
   *   The placeholder element passed in as a parameter.
   */
  function hide($placeholder) {
    return (
      $placeholder
        // Find the parent <li>.
        .closest('.comment-new-comments')
        // Find the preceding <li>, if any, and give it the 'last' class.
        .prev()
        .addClass('last')
        // Go back to the parent <li> and hide it.
        .end()
        .hide()
    );
  }

  /**
   * Removes a "new comment" element.
   *
   * @param {jQuery} $placeholder
   *   The placeholder element of the new comment link.
   */
  function remove($placeholder) {
    hide($placeholder).remove();
  }

  /**
   * Shows a "new comment" element.
   *
   * @param {jQuery} $placeholder
   *   The placeholder element of the new comment link.
   *
   * @return {jQuery}
   *   The placeholder element passed in as a parameter.
   */
  function show($placeholder) {
    return (
      $placeholder
        // Find the parent <li>.
        .closest('.comment-new-comments')
        // Find the preceding <li>, if any, and remove its 'last' class, if any.
        .prev()
        .removeClass('last')
        // Go back to the parent <li> and show it.
        .end()
        .show()
    );
  }

  /**
   * Processes new comment links and adds appropriate text in relevant cases.
   *
   * @param {Array.<Element>} placeholders
   *   The placeholder elements of the current page.
   */
  function processNodeNewCommentLinks(placeholders) {
    // Figure out which placeholders need the "x new comments" links.
    const $placeholdersToUpdate = {};
    let fieldName = 'comment';
    let $placeholder;
    placeholders.forEach((placeholder) => {
      $placeholder = $(placeholder);
      const timestamp = parseInt(
        $placeholder.attr('data-history-node-last-comment-timestamp'),
        10,
      );
      fieldName = $placeholder.attr('data-history-node-field-name');
      const nodeID = $placeholder
        .closest('[data-history-node-id]')
        .attr('data-history-node-id');
      const lastViewTimestamp = Drupal.history.getLastRead(nodeID);

      // Queue this placeholder's "X new comments" link to be downloaded from
      // the server.
      if (timestamp > lastViewTimestamp) {
        $placeholdersToUpdate[nodeID] = $placeholder;
      }
      // No "X new comments" link necessary; remove it from the DOM.
      else {
        remove($placeholder);
      }
    });

    // Perform an AJAX request to retrieve node view timestamps.
    const nodeIDs = Object.keys($placeholdersToUpdate);
    if (nodeIDs.length === 0) {
      return;
    }

    /**
     * Renders the "X new comments" links.
     *
     * Either use the data embedded in the page or perform an AJAX request to
     * retrieve the same data.
     *
     * @param {object} results
     *   Data about new comment links indexed by nodeID.
     */
    function render(results) {
      Object.keys(results || {}).forEach((nodeID) => {
        if ($placeholdersToUpdate.hasOwnProperty(nodeID)) {
          const $placeholderItem = $placeholdersToUpdate[nodeID];
          const result = results[nodeID];
          $placeholderItem[0].textContent = Drupal.formatPlural(
            result.new_comment_count,
            '1 new comment',
            '@count new comments',
          );
          $placeholderItem
            .attr('href', result.first_new_comment_link)
            .removeClass('hidden');
          show($placeholderItem);
        }
      });
    }

    if (drupalSettings.comment && drupalSettings.comment.newCommentsLinks) {
      render(drupalSettings.comment.newCommentsLinks.node[fieldName]);
    } else {
      $.ajax({
        url: Drupal.url('comments/render_new_comments_node_links'),
        type: 'POST',
        data: { 'node_ids[]': nodeIDs, field_name: fieldName },
        dataType: 'json',
        success: render,
      });
    }
  }

  /**
   * Render "X new comments" links wherever necessary.
   *
   * @type {Drupal~behavior}
   *
   * @prop {Drupal~behaviorAttach} attach
   *   Attaches new comment links behavior.
   */
  Drupal.behaviors.nodeNewCommentsLink = {
    attach(context) {
      // Collect all "X new comments" node link placeholders (and their
      // corresponding node IDs) newer than 30 days ago that have not already
      // been read after their last comment timestamp.
      const nodeIDs = [];
      const placeholders = once(
        'history',
        '[data-history-node-last-comment-timestamp]',
        context,
      ).filter((placeholder) => {
        const $placeholder = $(placeholder);
        const lastCommentTimestamp = parseInt(
          $placeholder.attr('data-history-node-last-comment-timestamp'),
          10,
        );
        const nodeID = $placeholder
          .closest('[data-history-node-id]')
          .attr('data-history-node-id');
        if (Drupal.history.needsServerCheck(nodeID, lastCommentTimestamp)) {
          nodeIDs.push(nodeID);
          // Hide this placeholder link until it is certain we'll need it.
          hide($placeholder);
          return true;
        }

        // Remove this placeholder link from the DOM because we won't need it.
        remove($placeholder);
        return false;
      });

      if (placeholders.length === 0) {
        return;
      }

      // Perform an AJAX request to retrieve node read timestamps.
      Drupal.history.fetchTimestamps(nodeIDs, () => {
        processNodeNewCommentLinks(placeholders);
      });
    },
  };
})(jQuery, Drupal, drupalSettings);
;
