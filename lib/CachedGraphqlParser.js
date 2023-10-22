'use strict';

const graphql = require('graphql');

/**
 * Parses and caches graphql documents
 */
class CachedGraphqlParser {
  constructor() {
    this._cache = new Map();
  }
  parse(filePath, contents) {
    if (this._cache.has(filePath)) {
      return this._cache.get(filePath);
    }

    const document = graphql.parse(contents);

    this._cache.set(filePath, document);

    return this._cache.get(filePath);
  }
}

module.exports = { CachedGraphqlParser };