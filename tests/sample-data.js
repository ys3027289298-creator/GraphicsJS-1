/**
 * @fileoverview Single shared input used by every comparison, golden and
 * failure-path test. Total weight 1200, 11 leaves including one zero-weight
 * leaf (printers).
 */

'use strict';

var CANVAS = {width: 800, height: 600, padding: 6, gap: 2};

var SAMPLE_TREE = {
  id: 'company',
  name: 'ACME Corp',
  children: [
    {
      id: 'hardware',
      name: 'Hardware Division',
      children: [
        {id: 'laptops', name: 'Business Laptops', value: 260, color: '#d7b5a6'},
        {id: 'servers', name: 'Rack Servers', value: 180, color: '#59a14f'},
        {id: 'networking', name: 'Networking Gear', value: 90, color: '#9c755f'}
      ]
    },
    {
      id: 'software',
      name: 'Software Division',
      children: [
        {id: 'saas', name: 'Cloud SaaS Subscriptions', value: 240, color: '#59a14f'},
        {id: 'licenses', name: 'Perpetual Licenses', value: 110, color: '#e15759'},
        {id: 'support', name: 'Enterprise Support Contracts', value: 70, color: '#edc948'}
      ]
    },
    {
      id: 'services',
      name: 'Professional Services',
      children: [
        {id: 'consulting', name: 'Consulting Engagements', value: 130, color: '#86bcb6'},
        {id: 'training', name: 'Onsite Training Programs', value: 60, color: '#b07aa1'},
        {
          id: 'outsourcing',
          name: 'Managed Outsourcing',
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

module.exports = {
  SAMPLE_TREE: SAMPLE_TREE,
  CANVAS: CANVAS
};
