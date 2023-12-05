'use strict';

const fs = require('fs/promises');
const path = require('path');

/**
 * Reads and caches files
 */
class CachedFileLoader {
  constructor() {
    this._cache = new Map();
  }
  async loadFile(cwd = __dirname, filePath = '') {
    const absolutePath = path.resolve(cwd, filePath);

    if (this._cache.has(absolutePath)) {
      return this._cache.get(absolutePath);
    }

    const contents = await fs.readFile(absolutePath);

    this._cache.set(absolutePath, contents.toString().trim());

    return this._cache.get(absolutePath);
  }
}

module.exports = { CachedFileLoader };
