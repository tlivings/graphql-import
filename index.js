'use strict';

const graphql = require('graphql');
const path = require('path');
const glob = require('glob-promise');
const { CachedFileLoader } = require('./lib/CachedFileLoader');
const { CachedGraphqlParser } = require('./lib/CachedGraphqlParser');
const { DocumentDefinitionFilter } = require('./lib/DocumentDefinitionFilter');

/**
 * Load a graphql file and process imports
 */
class GraphQLFileLoader {
  constructor() {
    this._fileLoader = new CachedFileLoader();
    this._graphqlParser = new CachedGraphqlParser();
    this._definitionFilter = new DocumentDefinitionFilter();
  }
  /**
   * Parse #import statements in the given file contents
   * @param {*} filePath the path of the file from which to build relative paths from
   * @param {*} fileContents the contents of the file
   * @returns 
   */
  static parseImportStatements(filePath, fileContents) {
    const basePath = path.dirname(filePath);

    const imports = [];

    for (const line of fileContents.split(/\r?\n/).map((l) => l.trim())) {
      if (!line.startsWith('# import') && !line.startsWith('#import')) {
        continue;
      }

      const importLine = line.slice(line.indexOf('import') + 7);

      const regex = /(.+) from ["'](.+)["']/;
      const match = regex.exec(importLine);

      if (!match) {
        throw new Error('Incorrect import syntax');
      }

      const types = match[1].trim().split(',').map((t) => t.trim());
      const specifiedPath = match[2].trim();
      const fileName = path.isAbsolute(specifiedPath) ? specifiedPath : path.resolve(basePath, specifiedPath);

      imports.push({
        types,
        fileName
      });
    }

    return imports;
  }
  /**
   * Builds a dependency map starting with the given file.
   * @param {*} fileName the name of the file to start with.
   * @returns 
   */
  async buildImportDependencyTreeFrom(fileName) {
    const files = [fileName];
    const visited = new Set();
    const imports = new Map();

    imports.set(fileName, ['*']);

    //While we find import statements, load that file and parse its import statements too.
    while (files.length > 0) {
      const file = files.pop();

      if (visited.has(file)) {
        continue;
      }

      visited.add(file);

      const fileContents = await this._fileLoader.loadFile(file);

      const importStatements = GraphQLFileLoader.parseImportStatements(file, fileContents);

      if (importStatements.length) {
        for (const { types, fileName } of importStatements) {
          if (!imports.has(fileName)) {
            imports.set(fileName, []);
          }
          //Tack-on more imported types to the given file
          imports.get(fileName).push(...types);
          files.push(fileName);
        }
      }
    }

    return imports;
  }
  /**
   * Loads a graphql sdl file and parses the imports and returns a merged SDL with all imports resolved.
   * @param {*} cwd 
   * @param {*} filePath 
   * @returns 
   */
  async loadFile(cwd = __dirname, filePath, { skipGraphQLImport = false } = {}) {
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
    const definitions = [];

    if (skipGraphQLImport) {
      return await this._fileLoader.loadFile(absolutePath);
    }

    //Build a dependency tree starting with the provided filePath
    const imports = await this.buildImportDependencyTreeFrom(absolutePath);

    //Make a copy so we can reverse-process from bottom to top
    const entries = [...imports.entries()];

    //This iterates through imports, parses graphql, and prunes out the requests types
    while (entries.length > 0) {
      const [fileName, types] = entries.pop();

      const file = await this._fileLoader.loadFile(fileName); //This file is already cached from earlier
      const document = this._graphqlParser.parse(fileName, file);

      if (types.includes('*')) {
        definitions.push(...document.definitions);
        continue;
      }

      //Filter by types and their transitive dependencies
      const filteredDocument = this._definitionFilter.filter(document, types);

      definitions.push(...filteredDocument.definitions);
    }

    //This is the merged SDL which we can parse into a schema etc
    return graphql.print({
      kind: 'Document',
      definitions
    });
  }
  async loadAllContent(pointer, { cwd =  process.cwd(), skipGraphQLImport = false, ignore = [] } = {}) {
    const files = await glob(pointer, {
      cwd,
      ignore
    });

    return Promise.all(files.map(file => {
      return this.loadFile(cwd, file, { skipGraphQLImport });
    }));
  }
  /**
   * Conforms to the loader interface in graphql-tools
   * @param {*} pointer 
   * @param {*} options 
   */
  async load(pointer, { cwd =  process.cwd(), skipGraphQLImport = false, ignore = [] } = {}) {
    const sources = await this.loadAllContent(pointer, { cwd, skipGraphQLImport, ignore });

    return sources.map(rawSDL => ({ rawSDL }));
  }
}

module.exports = { CachedFileLoader, CachedGraphqlParser, GraphQLFileLoader, DocumentDefinitionFilter };