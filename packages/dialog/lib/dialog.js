(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
    typeof define === 'function' && define.amd ? define(['exports'], factory) :
    (factory((global.Dialog = {})));
}(this, (function (exports) { 'use strict';

    /*! *****************************************************************************
    Copyright (c) Microsoft Corporation. All rights reserved.
    Licensed under the Apache License, Version 2.0 (the "License"); you may not use
    this file except in compliance with the License. You may obtain a copy of the
    License at http://www.apache.org/licenses/LICENSE-2.0

    THIS CODE IS PROVIDED ON AN *AS IS* BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
    KIND, EITHER EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION ANY IMPLIED
    WARRANTIES OR CONDITIONS OF TITLE, FITNESS FOR A PARTICULAR PURPOSE,
    MERCHANTABLITY OR NON-INFRINGEMENT.

    See the Apache Version 2.0 License for specific language governing permissions
    and limitations under the License.
    ***************************************************************************** */

    var __assign = function() {
        __assign = Object.assign || function __assign(t) {
            for (var s, i = 1, n = arguments.length; i < n; i++) {
                s = arguments[i];
                for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p)) t[p] = s[p];
            }
            return t;
        };
        return __assign.apply(this, arguments);
    };

    function createCommonjsModule(fn, module) {
    	return module = { exports: {} }, fn(module, module.exports), module.exports;
    }

    var dialogPolyfill = createCommonjsModule(function (module) {
    (function() {

      // nb. This is for IE10 and lower _only_.
      var supportCustomEvent = window.CustomEvent;
      if (!supportCustomEvent || typeof supportCustomEvent === 'object') {
        supportCustomEvent = function CustomEvent(event, x) {
          x = x || {};
          var ev = document.createEvent('CustomEvent');
          ev.initCustomEvent(event, !!x.bubbles, !!x.cancelable, x.detail || null);
          return ev;
        };
        supportCustomEvent.prototype = window.Event.prototype;
      }

      /**
       * @param {Element} el to check for stacking context
       * @return {boolean} whether this el or its parents creates a stacking context
       */
      function createsStackingContext(el) {
        while (el && el !== document.body) {
          var s = window.getComputedStyle(el);
          var invalid = function(k, ok) {
            return !(s[k] === undefined || s[k] === ok);
          };
          if (s.opacity < 1 ||
              invalid('zIndex', 'auto') ||
              invalid('transform', 'none') ||
              invalid('mixBlendMode', 'normal') ||
              invalid('filter', 'none') ||
              invalid('perspective', 'none') ||
              s['isolation'] === 'isolate' ||
              s.position === 'fixed' ||
              s.webkitOverflowScrolling === 'touch') {
            return true;
          }
          el = el.parentElement;
        }
        return false;
      }

      /**
       * Finds the nearest <dialog> from the passed element.
       *
       * @param {Element} el to search from
       * @return {HTMLDialogElement} dialog found
       */
      function findNearestDialog(el) {
        while (el) {
          if (el.localName === 'dialog') {
            return /** @type {HTMLDialogElement} */ (el);
          }
          el = el.parentElement;
        }
        return null;
      }

      /**
       * Blur the specified element, as long as it's not the HTML body element.
       * This works around an IE9/10 bug - blurring the body causes Windows to
       * blur the whole application.
       *
       * @param {Element} el to blur
       */
      function safeBlur(el) {
        if (el && el.blur && el !== document.body) {
          el.blur();
        }
      }

      /**
       * @param {!NodeList} nodeList to search
       * @param {Node} node to find
       * @return {boolean} whether node is inside nodeList
       */
      function inNodeList(nodeList, node) {
        for (var i = 0; i < nodeList.length; ++i) {
          if (nodeList[i] === node) {
            return true;
          }
        }
        return false;
      }

      /**
       * @param {HTMLFormElement} el to check
       * @return {boolean} whether this form has method="dialog"
       */
      function isFormMethodDialog(el) {
        if (!el || !el.hasAttribute('method')) {
          return false;
        }
        return el.getAttribute('method').toLowerCase() === 'dialog';
      }

      /**
       * @param {!HTMLDialogElement} dialog to upgrade
       * @constructor
       */
      function dialogPolyfillInfo(dialog) {
        this.dialog_ = dialog;
        this.replacedStyleTop_ = false;
        this.openAsModal_ = false;

        // Set a11y role. Browsers that support dialog implicitly know this already.
        if (!dialog.hasAttribute('role')) {
          dialog.setAttribute('role', 'dialog');
        }

        dialog.show = this.show.bind(this);
        dialog.showModal = this.showModal.bind(this);
        dialog.close = this.close.bind(this);

        if (!('returnValue' in dialog)) {
          dialog.returnValue = '';
        }

        if ('MutationObserver' in window) {
          var mo = new MutationObserver(this.maybeHideModal.bind(this));
          mo.observe(dialog, {attributes: true, attributeFilter: ['open']});
        } else {
          // IE10 and below support. Note that DOMNodeRemoved etc fire _before_ removal. They also
          // seem to fire even if the element was removed as part of a parent removal. Use the removed
          // events to force downgrade (useful if removed/immediately added).
          var removed = false;
          var cb = function() {
            removed ? this.downgradeModal() : this.maybeHideModal();
            removed = false;
          }.bind(this);
          var timeout;
          var delayModel = function(ev) {
            if (ev.target !== dialog) { return; }  // not for a child element
            var cand = 'DOMNodeRemoved';
            removed |= (ev.type.substr(0, cand.length) === cand);
            window.clearTimeout(timeout);
            timeout = window.setTimeout(cb, 0);
          };
          ['DOMAttrModified', 'DOMNodeRemoved', 'DOMNodeRemovedFromDocument'].forEach(function(name) {
            dialog.addEventListener(name, delayModel);
          });
        }
        // Note that the DOM is observed inside DialogManager while any dialog
        // is being displayed as a modal, to catch modal removal from the DOM.

        Object.defineProperty(dialog, 'open', {
          set: this.setOpen.bind(this),
          get: dialog.hasAttribute.bind(dialog, 'open')
        });

        this.backdrop_ = document.createElement('div');
        this.backdrop_.className = 'backdrop';
        this.backdrop_.addEventListener('click', this.backdropClick_.bind(this));
      }

      dialogPolyfillInfo.prototype = {

        get dialog() {
          return this.dialog_;
        },

        /**
         * Maybe remove this dialog from the modal top layer. This is called when
         * a modal dialog may no longer be tenable, e.g., when the dialog is no
         * longer open or is no longer part of the DOM.
         */
        maybeHideModal: function() {
          if (this.dialog_.hasAttribute('open') && document.body.contains(this.dialog_)) { return; }
          this.downgradeModal();
        },

        /**
         * Remove this dialog from the modal top layer, leaving it as a non-modal.
         */
        downgradeModal: function() {
          if (!this.openAsModal_) { return; }
          this.openAsModal_ = false;
          this.dialog_.style.zIndex = '';

          // This won't match the native <dialog> exactly because if the user set top on a centered
          // polyfill dialog, that top gets thrown away when the dialog is closed. Not sure it's
          // possible to polyfill this perfectly.
          if (this.replacedStyleTop_) {
            this.dialog_.style.top = '';
            this.replacedStyleTop_ = false;
          }

          // Clear the backdrop and remove from the manager.
          this.backdrop_.parentNode && this.backdrop_.parentNode.removeChild(this.backdrop_);
          dialogPolyfill.dm.removeDialog(this);
        },

        /**
         * @param {boolean} value whether to open or close this dialog
         */
        setOpen: function(value) {
          if (value) {
            this.dialog_.hasAttribute('open') || this.dialog_.setAttribute('open', '');
          } else {
            this.dialog_.removeAttribute('open');
            this.maybeHideModal();  // nb. redundant with MutationObserver
          }
        },

        /**
         * Handles clicks on the fake .backdrop element, redirecting them as if
         * they were on the dialog itself.
         *
         * @param {!Event} e to redirect
         */
        backdropClick_: function(e) {
          if (!this.dialog_.hasAttribute('tabindex')) {
            // Clicking on the backdrop should move the implicit cursor, even if dialog cannot be
            // focused. Create a fake thing to focus on. If the backdrop was _before_ the dialog, this
            // would not be needed - clicks would move the implicit cursor there.
            var fake = document.createElement('div');
            this.dialog_.insertBefore(fake, this.dialog_.firstChild);
            fake.tabIndex = -1;
            fake.focus();
            this.dialog_.removeChild(fake);
          } else {
            this.dialog_.focus();
          }

          var redirectedEvent = document.createEvent('MouseEvents');
          redirectedEvent.initMouseEvent(e.type, e.bubbles, e.cancelable, window,
              e.detail, e.screenX, e.screenY, e.clientX, e.clientY, e.ctrlKey,
              e.altKey, e.shiftKey, e.metaKey, e.button, e.relatedTarget);
          this.dialog_.dispatchEvent(redirectedEvent);
          e.stopPropagation();
        },

        /**
         * Focuses on the first focusable element within the dialog. This will always blur the current
         * focus, even if nothing within the dialog is found.
         */
        focus_: function() {
          // Find element with `autofocus` attribute, or fall back to the first form/tabindex control.
          var target = this.dialog_.querySelector('[autofocus]:not([disabled])');
          if (!target && this.dialog_.tabIndex >= 0) {
            target = this.dialog_;
          }
          if (!target) {
            // Note that this is 'any focusable area'. This list is probably not exhaustive, but the
            // alternative involves stepping through and trying to focus everything.
            var opts = ['button', 'input', 'keygen', 'select', 'textarea'];
            var query = opts.map(function(el) {
              return el + ':not([disabled])';
            });
            // TODO(samthor): tabindex values that are not numeric are not focusable.
            query.push('[tabindex]:not([disabled]):not([tabindex=""])');  // tabindex != "", not disabled
            target = this.dialog_.querySelector(query.join(', '));
          }
          safeBlur(document.activeElement);
          target && target.focus();
        },

        /**
         * Sets the zIndex for the backdrop and dialog.
         *
         * @param {number} dialogZ
         * @param {number} backdropZ
         */
        updateZIndex: function(dialogZ, backdropZ) {
          if (dialogZ < backdropZ) {
            throw new Error('dialogZ should never be < backdropZ');
          }
          this.dialog_.style.zIndex = dialogZ;
          this.backdrop_.style.zIndex = backdropZ;
        },

        /**
         * Shows the dialog. If the dialog is already open, this does nothing.
         */
        show: function() {
          if (!this.dialog_.open) {
            this.setOpen(true);
            this.focus_();
          }
        },

        /**
         * Show this dialog modally.
         */
        showModal: function() {
          if (this.dialog_.hasAttribute('open')) {
            throw new Error('Failed to execute \'showModal\' on dialog: The element is already open, and therefore cannot be opened modally.');
          }
          if (!document.body.contains(this.dialog_)) {
            throw new Error('Failed to execute \'showModal\' on dialog: The element is not in a Document.');
          }
          if (!dialogPolyfill.dm.pushDialog(this)) {
            throw new Error('Failed to execute \'showModal\' on dialog: There are too many open modal dialogs.');
          }

          if (createsStackingContext(this.dialog_.parentElement)) {
            console.warn('A dialog is being shown inside a stacking context. ' +
                'This may cause it to be unusable. For more information, see this link: ' +
                'https://github.com/GoogleChrome/dialog-polyfill/#stacking-context');
          }

          this.setOpen(true);
          this.openAsModal_ = true;

          // Optionally center vertically, relative to the current viewport.
          if (dialogPolyfill.needsCentering(this.dialog_)) {
            dialogPolyfill.reposition(this.dialog_);
            this.replacedStyleTop_ = true;
          } else {
            this.replacedStyleTop_ = false;
          }

          // Insert backdrop.
          this.dialog_.parentNode.insertBefore(this.backdrop_, this.dialog_.nextSibling);

          // Focus on whatever inside the dialog.
          this.focus_();
        },

        /**
         * Closes this HTMLDialogElement. This is optional vs clearing the open
         * attribute, however this fires a 'close' event.
         *
         * @param {string=} opt_returnValue to use as the returnValue
         */
        close: function(opt_returnValue) {
          if (!this.dialog_.hasAttribute('open')) {
            throw new Error('Failed to execute \'close\' on dialog: The element does not have an \'open\' attribute, and therefore cannot be closed.');
          }
          this.setOpen(false);

          // Leave returnValue untouched in case it was set directly on the element
          if (opt_returnValue !== undefined) {
            this.dialog_.returnValue = opt_returnValue;
          }

          // Triggering "close" event for any attached listeners on the <dialog>.
          var closeEvent = new supportCustomEvent('close', {
            bubbles: false,
            cancelable: false
          });
          this.dialog_.dispatchEvent(closeEvent);
        }

      };

      var dialogPolyfill = {};

      dialogPolyfill.reposition = function(element) {
        var scrollTop = document.body.scrollTop || document.documentElement.scrollTop;
        var topValue = scrollTop + (window.innerHeight - element.offsetHeight) / 2;
        element.style.top = Math.max(scrollTop, topValue) + 'px';
      };

      dialogPolyfill.isInlinePositionSetByStylesheet = function(element) {
        for (var i = 0; i < document.styleSheets.length; ++i) {
          var styleSheet = document.styleSheets[i];
          var cssRules = null;
          // Some browsers throw on cssRules.
          try {
            cssRules = styleSheet.cssRules;
          } catch (e) {}
          if (!cssRules) { continue; }
          for (var j = 0; j < cssRules.length; ++j) {
            var rule = cssRules[j];
            var selectedNodes = null;
            // Ignore errors on invalid selector texts.
            try {
              selectedNodes = document.querySelectorAll(rule.selectorText);
            } catch(e) {}
            if (!selectedNodes || !inNodeList(selectedNodes, element)) {
              continue;
            }
            var cssTop = rule.style.getPropertyValue('top');
            var cssBottom = rule.style.getPropertyValue('bottom');
            if ((cssTop && cssTop !== 'auto') || (cssBottom && cssBottom !== 'auto')) {
              return true;
            }
          }
        }
        return false;
      };

      dialogPolyfill.needsCentering = function(dialog) {
        var computedStyle = window.getComputedStyle(dialog);
        if (computedStyle.position !== 'absolute') {
          return false;
        }

        // We must determine whether the top/bottom specified value is non-auto.  In
        // WebKit/Blink, checking computedStyle.top == 'auto' is sufficient, but
        // Firefox returns the used value. So we do this crazy thing instead: check
        // the inline style and then go through CSS rules.
        if ((dialog.style.top !== 'auto' && dialog.style.top !== '') ||
            (dialog.style.bottom !== 'auto' && dialog.style.bottom !== '')) {
          return false;
        }
        return !dialogPolyfill.isInlinePositionSetByStylesheet(dialog);
      };

      /**
       * @param {!Element} element to force upgrade
       */
      dialogPolyfill.forceRegisterDialog = function(element) {
        if (window.HTMLDialogElement || element.showModal) {
          console.warn('This browser already supports <dialog>, the polyfill ' +
              'may not work correctly', element);
        }
        if (element.localName !== 'dialog') {
          throw new Error('Failed to register dialog: The element is not a dialog.');
        }
        new dialogPolyfillInfo(/** @type {!HTMLDialogElement} */ (element));
      };

      /**
       * @param {!Element} element to upgrade, if necessary
       */
      dialogPolyfill.registerDialog = function(element) {
        if (!element.showModal) {
          dialogPolyfill.forceRegisterDialog(element);
        }
      };

      /**
       * @constructor
       */
      dialogPolyfill.DialogManager = function() {
        /** @type {!Array<!dialogPolyfillInfo>} */
        this.pendingDialogStack = [];

        var checkDOM = this.checkDOM_.bind(this);

        // The overlay is used to simulate how a modal dialog blocks the document.
        // The blocking dialog is positioned on top of the overlay, and the rest of
        // the dialogs on the pending dialog stack are positioned below it. In the
        // actual implementation, the modal dialog stacking is controlled by the
        // top layer, where z-index has no effect.
        this.overlay = document.createElement('div');
        this.overlay.className = '_dialog_overlay';
        this.overlay.addEventListener('click', function(e) {
          this.forwardTab_ = undefined;
          e.stopPropagation();
          checkDOM([]);  // sanity-check DOM
        }.bind(this));

        this.handleKey_ = this.handleKey_.bind(this);
        this.handleFocus_ = this.handleFocus_.bind(this);

        this.zIndexLow_ = 100000;
        this.zIndexHigh_ = 100000 + 150;

        this.forwardTab_ = undefined;

        if ('MutationObserver' in window) {
          this.mo_ = new MutationObserver(function(records) {
            var removed = [];
            records.forEach(function(rec) {
              for (var i = 0, c; c = rec.removedNodes[i]; ++i) {
                if (!(c instanceof Element)) {
                  continue;
                } else if (c.localName === 'dialog') {
                  removed.push(c);
                }
                removed = removed.concat(c.querySelectorAll('dialog'));
              }
            });
            removed.length && checkDOM(removed);
          });
        }
      };

      /**
       * Called on the first modal dialog being shown. Adds the overlay and related
       * handlers.
       */
      dialogPolyfill.DialogManager.prototype.blockDocument = function() {
        document.documentElement.addEventListener('focus', this.handleFocus_, true);
        document.addEventListener('keydown', this.handleKey_);
        this.mo_ && this.mo_.observe(document, {childList: true, subtree: true});
      };

      /**
       * Called on the first modal dialog being removed, i.e., when no more modal
       * dialogs are visible.
       */
      dialogPolyfill.DialogManager.prototype.unblockDocument = function() {
        document.documentElement.removeEventListener('focus', this.handleFocus_, true);
        document.removeEventListener('keydown', this.handleKey_);
        this.mo_ && this.mo_.disconnect();
      };

      /**
       * Updates the stacking of all known dialogs.
       */
      dialogPolyfill.DialogManager.prototype.updateStacking = function() {
        var zIndex = this.zIndexHigh_;

        for (var i = 0, dpi; dpi = this.pendingDialogStack[i]; ++i) {
          dpi.updateZIndex(--zIndex, --zIndex);
          if (i === 0) {
            this.overlay.style.zIndex = --zIndex;
          }
        }

        // Make the overlay a sibling of the dialog itself.
        var last = this.pendingDialogStack[0];
        if (last) {
          var p = last.dialog.parentNode || document.body;
          p.appendChild(this.overlay);
        } else if (this.overlay.parentNode) {
          this.overlay.parentNode.removeChild(this.overlay);
        }
      };

      /**
       * @param {Element} candidate to check if contained or is the top-most modal dialog
       * @return {boolean} whether candidate is contained in top dialog
       */
      dialogPolyfill.DialogManager.prototype.containedByTopDialog_ = function(candidate) {
        while (candidate = findNearestDialog(candidate)) {
          for (var i = 0, dpi; dpi = this.pendingDialogStack[i]; ++i) {
            if (dpi.dialog === candidate) {
              return i === 0;  // only valid if top-most
            }
          }
          candidate = candidate.parentElement;
        }
        return false;
      };

      dialogPolyfill.DialogManager.prototype.handleFocus_ = function(event) {
        if (this.containedByTopDialog_(event.target)) { return; }

        event.preventDefault();
        event.stopPropagation();
        safeBlur(/** @type {Element} */ (event.target));

        if (this.forwardTab_ === undefined) { return; }  // move focus only from a tab key

        var dpi = this.pendingDialogStack[0];
        var dialog = dpi.dialog;
        var position = dialog.compareDocumentPosition(event.target);
        if (position & Node.DOCUMENT_POSITION_PRECEDING) {
          if (this.forwardTab_) {  // forward
            dpi.focus_();
          } else {  // backwards
            document.documentElement.focus();
          }
        }

        return false;
      };

      dialogPolyfill.DialogManager.prototype.handleKey_ = function(event) {
        this.forwardTab_ = undefined;
        if (event.keyCode === 27) {
          event.preventDefault();
          event.stopPropagation();
          var cancelEvent = new supportCustomEvent('cancel', {
            bubbles: false,
            cancelable: true
          });
          var dpi = this.pendingDialogStack[0];
          if (dpi && dpi.dialog.dispatchEvent(cancelEvent)) {
            dpi.dialog.close();
          }
        } else if (event.keyCode === 9) {
          this.forwardTab_ = !event.shiftKey;
        }
      };

      /**
       * Finds and downgrades any known modal dialogs that are no longer displayed. Dialogs that are
       * removed and immediately readded don't stay modal, they become normal.
       *
       * @param {!Array<!HTMLDialogElement>} removed that have definitely been removed
       */
      dialogPolyfill.DialogManager.prototype.checkDOM_ = function(removed) {
        // This operates on a clone because it may cause it to change. Each change also calls
        // updateStacking, which only actually needs to happen once. But who removes many modal dialogs
        // at a time?!
        var clone = this.pendingDialogStack.slice();
        clone.forEach(function(dpi) {
          if (removed.indexOf(dpi.dialog) !== -1) {
            dpi.downgradeModal();
          } else {
            dpi.maybeHideModal();
          }
        });
      };

      /**
       * @param {!dialogPolyfillInfo} dpi
       * @return {boolean} whether the dialog was allowed
       */
      dialogPolyfill.DialogManager.prototype.pushDialog = function(dpi) {
        var allowed = (this.zIndexHigh_ - this.zIndexLow_) / 2 - 1;
        if (this.pendingDialogStack.length >= allowed) {
          return false;
        }
        if (this.pendingDialogStack.unshift(dpi) === 1) {
          this.blockDocument();
        }
        this.updateStacking();
        return true;
      };

      /**
       * @param {!dialogPolyfillInfo} dpi
       */
      dialogPolyfill.DialogManager.prototype.removeDialog = function(dpi) {
        var index = this.pendingDialogStack.indexOf(dpi);
        if (index === -1) { return; }

        this.pendingDialogStack.splice(index, 1);
        if (this.pendingDialogStack.length === 0) {
          this.unblockDocument();
        }
        this.updateStacking();
      };

      dialogPolyfill.dm = new dialogPolyfill.DialogManager();
      dialogPolyfill.formSubmitter = null;
      dialogPolyfill.useValue = null;

      /**
       * Installs global handlers, such as click listers and native method overrides. These are needed
       * even if a no dialog is registered, as they deal with <form method="dialog">.
       */
      if (window.HTMLDialogElement === undefined) {

        /**
         * If HTMLFormElement translates method="DIALOG" into 'get', then replace the descriptor with
         * one that returns the correct value.
         */
        var testForm = document.createElement('form');
        testForm.setAttribute('method', 'dialog');
        if (testForm.method !== 'dialog') {
          var methodDescriptor = Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, 'method');
          if (methodDescriptor) {
            // nb. Some older iOS and older PhantomJS fail to return the descriptor. Don't do anything
            // and don't bother to update the element.
            var realGet = methodDescriptor.get;
            methodDescriptor.get = function() {
              if (isFormMethodDialog(this)) {
                return 'dialog';
              }
              return realGet.call(this);
            };
            var realSet = methodDescriptor.set;
            methodDescriptor.set = function(v) {
              if (typeof v === 'string' && v.toLowerCase() === 'dialog') {
                return this.setAttribute('method', v);
              }
              return realSet.call(this, v);
            };
            Object.defineProperty(HTMLFormElement.prototype, 'method', methodDescriptor);
          }
        }

        /**
         * Global 'click' handler, to capture the <input type="submit"> or <button> element which has
         * submitted a <form method="dialog">. Needed as Safari and others don't report this inside
         * document.activeElement.
         */
        document.addEventListener('click', function(ev) {
          dialogPolyfill.formSubmitter = null;
          dialogPolyfill.useValue = null;
          if (ev.defaultPrevented) { return; }  // e.g. a submit which prevents default submission

          var target = /** @type {Element} */ (ev.target);
          if (!target || !isFormMethodDialog(target.form)) { return; }

          var valid = (target.type === 'submit' && ['button', 'input'].indexOf(target.localName) > -1);
          if (!valid) {
            if (!(target.localName === 'input' && target.type === 'image')) { return; }
            // this is a <input type="image">, which can submit forms
            dialogPolyfill.useValue = ev.offsetX + ',' + ev.offsetY;
          }

          var dialog = findNearestDialog(target);
          if (!dialog) { return; }

          dialogPolyfill.formSubmitter = target;
        }, false);

        /**
         * Replace the native HTMLFormElement.submit() method, as it won't fire the
         * submit event and give us a chance to respond.
         */
        var nativeFormSubmit = HTMLFormElement.prototype.submit;
        var replacementFormSubmit = function () {
          if (!isFormMethodDialog(this)) {
            return nativeFormSubmit.call(this);
          }
          var dialog = findNearestDialog(this);
          dialog && dialog.close();
        };
        HTMLFormElement.prototype.submit = replacementFormSubmit;

        /**
         * Global form 'dialog' method handler. Closes a dialog correctly on submit
         * and possibly sets its return value.
         */
        document.addEventListener('submit', function(ev) {
          var form = /** @type {HTMLFormElement} */ (ev.target);
          if (!isFormMethodDialog(form)) { return; }
          ev.preventDefault();

          var dialog = findNearestDialog(form);
          if (!dialog) { return; }

          // Forms can only be submitted via .submit() or a click (?), but anyway: sanity-check that
          // the submitter is correct before using its value as .returnValue.
          var s = dialogPolyfill.formSubmitter;
          if (s && s.form === form) {
            dialog.close(dialogPolyfill.useValue || s.value);
          } else {
            dialog.close();
          }
          dialogPolyfill.formSubmitter = null;
        }, true);
      }

      dialogPolyfill['forceRegisterDialog'] = dialogPolyfill.forceRegisterDialog;
      dialogPolyfill['registerDialog'] = dialogPolyfill.registerDialog;

      if (typeof module['exports'] === 'object') {
        // CommonJS support
        module['exports'] = dialogPolyfill;
      } else {
        // all others
        window['dialogPolyfill'] = dialogPolyfill;
      }
    })();
    });

    function styleInject(css, ref) {
      if ( ref === void 0 ) ref = {};
      var insertAt = ref.insertAt;

      if (!css || typeof document === 'undefined') { return; }

      var head = document.head || document.getElementsByTagName('head')[0];
      var style = document.createElement('style');
      style.type = 'text/css';

      if (insertAt === 'top') {
        if (head.firstChild) {
          head.insertBefore(style, head.firstChild);
        } else {
          head.appendChild(style);
        }
      } else {
        head.appendChild(style);
      }

      if (style.styleSheet) {
        style.styleSheet.cssText = css;
      } else {
        style.appendChild(document.createTextNode(css));
      }
    }

    var css = "dialog {\n  position: absolute;\n  left: 0; right: 0;\n  width: -moz-fit-content;\n  width: -webkit-fit-content;\n  width: fit-content;\n  height: -moz-fit-content;\n  height: -webkit-fit-content;\n  height: fit-content;\n  margin: auto;\n  border: solid;\n  padding: 1em;\n  background: white;\n  color: black;\n  display: block;\n}\n\ndialog:not([open]) {\n  display: none;\n}\n\ndialog + .backdrop {\n  position: fixed;\n  top: 0; right: 0; bottom: 0; left: 0;\n  background: rgba(0,0,0,0.1);\n}\n\n._dialog_overlay {\n  position: fixed;\n  top: 0; right: 0; bottom: 0; left: 0;\n}\n\ndialog.fixed {\n  position: fixed;\n  top: 50%;\n  transform: translate(0, -50%);\n}";
    styleInject(css);

    var css$1 = ".dialog-component {\r\n  border: 1px solid rgba(0, 0, 0, 0.3);\r\n  box-shadow: 0 3px 7px rgba(0, 0, 0, 0.3);\r\n  text-align: center;\r\n}\r\n\r\n.dialog-component::backdrop {\r\n  position: fixed;\r\n  top: 0;\r\n  left: 0;\r\n  right: 0;\r\n  bottom: 0;\r\n  background-color: rgba(0, 0, 0, 0.5);\r\n}\r\n\r\n.dialog-component__close {\r\n  margin-top: -2px;\r\n  float: right;\r\n  line-height: 1;\r\n  color: #000;\r\n  text-shadow: 0 1px 0 #fff;\r\n  filter: alpha(opacity=20);\r\n  opacity: .2;\r\n}\r\n\r\n";
    styleInject(css$1);

    var closeBtn = "\n  <a href=\"#\">\n    <svg height=\"24\" viewBox=\"0 0 24 24\" width=\"24\" xmlns=\"http://www.w3.org/2000/svg\">\n      <path d=\"M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z\">\n      </path>\n      <path d=\"M0 0h24v24H0z\" fill=\"none\"></path>\n    </svg>\n  </a>\n";
    var Dialog = (function () {
        function Dialog(options) {
            this.options = {
                template: "\n      <p>This is dialog!</p>\n    ",
                closeBtn: true,
                closeBtnTemplate: closeBtn,
            };
            this._dialog = document.createElement('dialog');
            this._dialog.className = 'dialog-component';
            this.options = __assign({}, this.options, options);
            this._parent = this.options.parent || document.body;
            this._isNativeDialog = !!this._dialog.showModal;
            if (!this._isNativeDialog) {
                dialogPolyfill.registerDialog(this._dialog);
                this._dialog.classList.add('polifilled');
            }
            if (this.options.closeBtn) {
                this._addCloseBtn();
            }
            this._content = document.createElement('div');
            this._dialog.appendChild(this._content);
            this.updateContent();
            if (this._parent) {
                this._parent.appendChild(this._dialog);
            }
            this._addEventsListeners();
        }
        Dialog.prototype.show = function () {
            this._dialog.showModal();
        };
        Dialog.prototype.close = function () {
            this._dialog.close();
        };
        Dialog.prototype.updateContent = function (content) {
            if (content === void 0) { content = this.options.template; }
            this._addContent(content, this._content);
        };
        Dialog.prototype._addCloseBtn = function () {
            var _this = this;
            var template = this.options.closeBtnTemplate;
            this._closeBtn = document.createElement('div');
            this._closeBtn.className = 'dialog-component__close';
            this._dialog.appendChild(this._closeBtn);
            this._addContent(template, this._closeBtn);
            this._closeBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                _this.close();
            });
        };
        Dialog.prototype._addContent = function (content, parent) {
            if (typeof content === 'string') {
                parent.innerHTML = content;
            }
            else if (content instanceof HTMLElement) {
                parent.innerHTML = '';
                parent.appendChild(content);
            }
            return parent.firstChild;
        };
        Dialog.prototype._addEventsListeners = function () {
            var _this = this;
            if (this._closeBtn) {
                this._closeBtn.addEventListener('click', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    _this.close();
                });
            }
            if (this.options.openers) {
                [].forEach.call(this.options.openers, function (opener) {
                    opener.onclick = function (e) {
                        e.preventDefault();
                        _this.show();
                    };
                });
            }
            this._dialog.addEventListener('close', function () {
            });
            this._dialog.addEventListener('cancel', function () {
            });
        };
        Dialog.dialogs = [];
        return Dialog;
    }());

    exports.Dialog = Dialog;

    Object.defineProperty(exports, '__esModule', { value: true });

})));
//# sourceMappingURL=dialog.js.map
