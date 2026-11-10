/*
 * Lotergeist prototype runtime (standalone).
 * Renders the .dc.html screens in any modern browser without the design canvas.
 * Supports: {{path}} holes in text and attributes, <template data-sc-for>, <template data-sc-if>,
 * onClick / onChange handler holes, boolean attribute holes, and a tiny DCLogic base class
 * with state / setState / props (defaults from data-props).
 * Prototype only: every setState re-renders the screen.
 */
(function () {
  'use strict';

  // Hide the raw template before first paint.
  var hide = document.createElement('style');
  hide.textContent = 'x-dc{display:none!important}';
  document.head.appendChild(hide);

  function DCLogic(props) {
    this.props = props || {};
    this.state = {};
  }
  DCLogic.prototype.setState = function (patch) {
    var next = typeof patch === 'function' ? patch(this.state, this.props) : patch;
    this.state = Object.assign({}, this.state, next || {});
    if (this.__render) this.__render();
  };
  DCLogic.prototype.forceUpdate = function () { if (this.__render) this.__render(); };
  window.DCLogic = DCLogic;

  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  var WHOLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;
  var BOOL = { checked: 1, disabled: 1, readonly: 1, selected: 1, hidden: 1 };

  function lookup(path, scope) {
    path = path.trim();
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    if (/^'.*'$|^".*"$/.test(path)) return path.slice(1, -1);
    var parts = path.split('.');
    var cur = scope;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function interp(str, scope) {
    return str.replace(HOLE, function (_, p) {
      var v = lookup(p, scope);
      return v == null ? '' : String(v);
    });
  }

  function child(scope, extra) {
    var s = Object.create(scope);
    for (var k in extra) s[k] = extra[k];
    return s;
  }

  function renderNodes(nodes, scope, out) {
    for (var i = 0; i < nodes.length; i++) renderNode(nodes[i], scope, out);
  }

  function renderNode(node, scope, out) {
    if (node.nodeType === 3) {
      out.appendChild(document.createTextNode(node.nodeValue.indexOf('{{') >= 0 ? interp(node.nodeValue, scope) : node.nodeValue));
      return;
    }
    if (node.nodeType !== 1) return;
    var tag = node.tagName.toLowerCase();

    if (tag === 'template' && node.hasAttribute('data-sc-for')) {
      var m = WHOLE.exec(node.getAttribute('list') || '');
      var list = m ? lookup(m[1], scope) : [];
      var as = node.getAttribute('as') || 'item';
      (list || []).forEach(function (item, idx) {
        var extra = { $index: idx };
        extra[as] = item;
        renderNodes(node.content.childNodes, child(scope, extra), out);
      });
      return;
    }
    if (tag === 'template' && node.hasAttribute('data-sc-if')) {
      var mv = WHOLE.exec(node.getAttribute('value') || '');
      if (mv && lookup(mv[1], scope)) renderNodes(node.content.childNodes, scope, out);
      return;
    }

    var el = node.namespaceURI === 'http://www.w3.org/2000/svg'
      ? document.createElementNS(node.namespaceURI, node.tagName)
      : document.createElement(node.tagName);

    for (var a = 0; a < node.attributes.length; a++) {
      var at = node.attributes[a];
      var name = at.name, val = at.value;
      if (name.indexOf('hint-') === 0) continue;
      var whole = WHOLE.exec(val);
      if (name.indexOf('on') === 0 && whole) {
        var fn = lookup(whole[1], scope);
        if (typeof fn === 'function') {
          el.addEventListener(name.slice(2).toLowerCase(), (function (f) {
            return function (e) { if (el.tagName === 'A' && el.getAttribute('href') === '#') e.preventDefault(); f(e); };
          })(fn));
        }
        continue;
      }
      if (BOOL[name] && whole) {
        var bv = lookup(whole[1], scope);
        if (bv) el.setAttribute(name, '');
        if (name === 'checked') el.checked = !!bv;
        continue;
      }
      try { el.setAttribute(name, val.indexOf('{{') >= 0 ? interp(val, scope) : val); } catch (err) { /* ignore invalid names */ }
    }

    var kids = tag === 'template' ? node.content.childNodes : node.childNodes;
    if (tag === 'textarea') {
      el.value = interp(node.textContent, scope);
    } else {
      renderNodes(kids, scope, el);
    }
    if (BOOL.checked && el.hasAttribute('checked') && el.tagName === 'INPUT') el.checked = true;
    out.appendChild(el);
  }

  function boot() {
    var src = document.querySelector('x-dc');
    if (!src) return;

    // Move <helmet> fonts and styles into <head>.
    var helmet = src.querySelector('helmet');
    if (helmet) {
      Array.prototype.slice.call(helmet.children).forEach(function (n) { document.head.appendChild(n); });
      helmet.parentNode.removeChild(helmet);
    }

    // Component logic and default props.
    var scriptEl = document.querySelector('script[data-dc-script]');
    var props = {};
    var Component = DCLogic;
    if (scriptEl) {
      try {
        var decl = JSON.parse(scriptEl.getAttribute('data-props') || '{}');
        Object.keys(decl).forEach(function (k) {
          if (k.charAt(0) !== '$' && decl[k] && 'default' in decl[k]) props[k] = decl[k]['default'];
        });
      } catch (e) { console.warn('data-props parse failed', e); }
      // Load the component with a normal script tag (works where eval is blocked by CSP).
      try {
        var s = document.createElement('script');
        s.textContent = '(function(){' + scriptEl.textContent + '\nwindow.__DCComponent = Component;})();';
        document.head.appendChild(s);
        if (window.__DCComponent) Component = window.__DCComponent;
      } catch (e) { console.error('Component failed to load', e); }
      if (Component === DCLogic) {
        try { Component = new Function('DCLogic', scriptEl.textContent + '\nreturn Component;')(DCLogic); } catch (e2) { console.error('Component failed to load', e2); }
      }
    }

    var root = document.createElement('div');
    root.className = 'dc-root';
    src.parentNode.insertBefore(root, src.nextSibling);

    var comp = new Component(props);
    var pending = false;
    comp.__render = function () {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () {
        pending = false;
        draw();
      });
    };
    function draw() {
      var vals = {};
      try { vals = comp.renderVals ? comp.renderVals() : {}; } catch (e) { console.error('renderVals failed', e); }
      var focusedId = document.activeElement && document.activeElement.id;
      var scrollY = window.scrollY;
      var frag = document.createDocumentFragment();
      renderNodes(src.childNodes, vals, frag);
      root.innerHTML = '';
      root.appendChild(frag);
      if (focusedId) { var f = document.getElementById(focusedId); if (f) f.focus(); }
      window.scrollTo(0, scrollY);
    }
    draw();
    if (typeof comp.componentDidMount === 'function') comp.componentDidMount();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
