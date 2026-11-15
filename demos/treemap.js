/**
 * @fileoverview Treemap demo: algorithm switch (squarify / slice-dice),
 * click-to-drill-down with breadcrumb, and deterministic SVG rendering.
 * Loads the UMD bundle built from src/treemap (no build step required when
 * served through a CommonJS-aware dev server; the page uses a tiny shim).
 */

(function() {
  'use strict';

  var treemap = window.acgraph && window.acgraph.treemap;
  if (!treemap) {
    document.getElementById('stage').textContent =
      'acgraph.treemap failed to load. Open this page via the demo server.';
    return;
  }

  var tree = {
    id: 'company',
    name: 'ACME Corp',
    children: [
      {
        id: 'hardware', name: 'Hardware Division',
        children: [
          {id: 'laptops', name: 'Business Laptops', value: 260, color: '#d7b5a6'},
          {id: 'servers', name: 'Rack Servers', value: 180, color: '#59a14f'},
          {id: 'networking', name: 'Networking Gear', value: 90, color: '#9c755f'}
        ]
      },
      {
        id: 'software', name: 'Software Division',
        children: [
          {id: 'saas', name: 'Cloud SaaS Subscriptions', value: 240, color: '#59a14f'},
          {id: 'licenses', name: 'Perpetual Licenses', value: 110, color: '#e15759'},
          {id: 'support', name: 'Enterprise Support Contracts', value: 70, color: '#edc948'}
        ]
      },
      {
        id: 'services', name: 'Professional Services',
        children: [
          {id: 'consulting', name: 'Consulting Engagements', value: 130, color: '#86bcb6'},
          {id: 'training', name: 'Onsite Training Programs', value: 60, color: '#b07aa1'},
          {
            id: 'outsourcing', name: 'Managed Outsourcing',
            children: [
              {id: 'helpdesk', name: 'Helpdesk Operations', value: 45, color: '#e15759'},
              {id: 'hosting', name: 'Managed Hosting', value: 15, color: '#86bcb6'},
              {id: 'printers', name: 'Printers', value: 0}
            ]
          }
        ]
      }
    ]
  };

  var state = {
    algorithm: 'squarify',
    path: [],
    currentInput: tree
  };

  function render() {
    var tm = treemap.createTreemap(state.currentInput, {
      width: 800,
      height: 600,
      padding: 6,
      gap: 2,
      algorithm: state.algorithm
    });
    var svg = treemap.renderToSvg(tm);
    var stage = document.getElementById('stage');
    stage.innerHTML = svg;

    var metrics = tm.metrics;
    document.getElementById('metrics').textContent =
      'mean aspect ' + metrics.aspectRatio.mean.toFixed(3) +
      ' | worst ' + metrics.aspectRatio.max.toFixed(3) +
      ' | void ' + metrics.voidPercent.toFixed(2) + '%' +
      ' | labels ' + Math.round(metrics.labelCoverage * 100) + '%' +
      ' | zero-weight leaves ' + JSON.stringify(tm.zeroWeightLeaves);

    var breadcrumb = document.getElementById('breadcrumb');
    breadcrumb.innerHTML = '';
    var rootCrumb = document.createElement('a');
    rootCrumb.href = '#';
    rootCrumb.textContent = tree.name;
    rootCrumb.onclick = function(event) {
      event.preventDefault();
      state.path = [];
      state.currentInput = tree;
      render();
    };
    breadcrumb.appendChild(rootCrumb);
    state.path.forEach(function(nodeId) {
      var separator = document.createElement('span');
      separator.textContent = ' / ';
      breadcrumb.appendChild(separator);
      var crumb = document.createElement('span');
      crumb.textContent = nodeId;
      breadcrumb.appendChild(crumb);
    });

    Array.prototype.forEach.call(stage.querySelectorAll('[data-id]'), function(element) {
      element.style.cursor = 'pointer';
      element.onclick = function() {
        var node = tm.nodeById[element.getAttribute('data-id')];
        if (node && !node.isLeaf && node.weight > 0) {
          state.path.push(node.id);
          state.currentInput = denormalize(node);
          render();
        }
      };
    });
  }

  function denormalize(node) {
    var raw = {id: node.id, name: node.name};
    if (node.isLeaf) {
      raw.value = node.value;
      if (node.color) raw.color = node.color;
    } else {
      raw.children = node.children.map(denormalize);
    }
    return raw;
  }

  document.getElementById('algorithm').onchange = function(event) {
    state.algorithm = event.target.value;
    render();
  };
  render();
})();
