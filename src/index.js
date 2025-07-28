const TokenClient = require('./TokenClient');
const TronGridClient = require('./TronGridClient');

const TrongridAPIKeys = [
  '2b6879e8-06ab-4de7-9b7a-4a09971a4bdb',
  'eca61e33-3c2a-4b74-ac4d-423e1abfb50b',
  '31b700d0-4223-45b2-b9b0-d2bf4e9a9407',

  'e29b3b0f-4273-41ab-a802-7d15b4d2b79d',
  '4084750e-da7f-4b91-9f41-c87665c7fadb',
  'e56d6194-1423-4c17-8490-0f1752420b75',

  'feaed436-caec-474b-8f7c-9edbd9d7e026',
  'cd6d6822-2809-4117-b4dc-f661663eba8d',
  'a58e713e-2144-423c-a665-c37cd5ebd3f6',

  '9b235a6c-b12c-4a84-8618-0ea8446c5af8',
  '294a7046-7721-4001-af27-4b619503016e',
  'cc53f239-cc82-45e1-8917-b9d323226bc2',

  '93501f81-390b-4ddd-8b7e-1573bd015ca0',
  '83b89821-e9bf-4d33-a517-0a99d151d04e',
  '2f0d1e3b-c257-49c8-ab4d-2a1de6f9f6c6',

  '7f5471dc-8a0d-490c-a331-8d070d1d68e9',
  'c41cf2a2-6c1b-4090-8301-a11ceb9ea3b8',
  '5874a74c-1854-402f-989b-29e53a793ebf',

  'edf21722-e868-4f42-86e3-6bf1732b831e',
  '608cd193-16eb-4195-ba3a-7c42b446adc2',
  '0e766d55-bb20-4095-9cc9-2d0ca0b4e358',

  '379a649a-873f-4a31-8bfe-f1412d7ca904',
  '6e54c3ea-fb56-4a7a-aed9-65800e24d46d',
  'c58118a7-7195-4a1c-97e3-aca2a2991898',
];

const GridClient = new TronGridClient({
  keyRps: 12,
  timing: false,
  keepAlive: false,
  keys: TrongridAPIKeys,
});

module.exports = {
  TokenClient,
  GridClient,
};
