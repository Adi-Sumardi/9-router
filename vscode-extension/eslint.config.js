// @ts-check
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  {
    ignores: ['dist/**', '.test-dist/**', 'node_modules/**', 'media/**', '*.vsix']
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // Ekstensi ini banyak dipakai untuk data dinamis dari model AI (tool call args,
      // hasil parsing regex) — `any` yang disengaja di titik-titik itu wajar, jangan
      // dipaksa jadi error. Cukup diingatkan (warn), bukan gagal build.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }]
    }
  }
);
