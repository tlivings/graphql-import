'use strict';

const graphql = require('graphql');
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

/**
 * Parses and caches graphql documents
 */
class CachedGraphqlParser {
  constructor() {
    this._cache = new Map();
  }
  parse(filePath, contents) {
    if (this._cache.has(filePath)) {
      return this._cache(filePath);
    }

    const document = graphql.parse(contents);

    this._cache.set(filePath, document);

    return this._cache.get(filePath);
  }
}

/**
 * Designed to filter a document object by the given types and their transitive dependencies
 */
class DocumentDefinitionFilter {
  constructor() {
    this._visited = new Set();
  }
  static isBuiltInType(typeName) {
    return (
      typeName === 'String' ||
      typeName === 'Int' ||
      typeName === 'Float' ||
      typeName === 'Boolean' ||
      typeName === 'ID'
    );
  }
  static findImplementationsFor(typeName, document) {
    const implementations = [];

    for (const node of document.definitions) {
      if (node.kind === graphql.Kind.OBJECT_TYPE_DEFINITION) {
        const interfaces = (node.interfaces || []).map(iface => iface.name.value);

        if (interfaces.includes(typeName)) {
          implementations.push(node.name.value);
        }
      }
    }

    return implementations;
  }
  filter(document, types) {
    const visiting = [...types];

    //First pass finds transitive dependencies
    while (visiting.length > 0) {
      const typeName = visiting.pop();

      if (this._visited.has(typeName)) {
        continue;
      }

      this._visited.add(typeName);

      for (const node of document.definitions) {
        switch (node.kind) {
          case graphql.Kind.INTERFACE_TYPE_DEFINITION:
            if (node.name.value === typeName) {
              const implementations = DocumentDefinitionFilter.findImplementationsFor(typeName, document);
              types.push(...implementations);
              visiting.push(...implementations);
            }
          case graphql.Kind.INPUT_OBJECT_TYPE_DEFINITION:
          case graphql.Kind.OBJECT_TYPE_DEFINITION:
            if (node.name.value === typeName) {
              const typeDirectives = node.directives.map(directive => directive.name.value);
              const fieldTypes = [];
              const fieldDirectives = [];
  
              for (const field of node.fields) {
                const fieldType = field.type.type ? field.type.type.name.value : field.type.name.value;
                
                if (!DocumentDefinitionFilter.isBuiltInType(fieldType)) {
                  fieldTypes.push(fieldType);
                }
  
                fieldDirectives.push(...field.directives.map(directive => directive.name.value));
              }
  
              types.push(...fieldTypes);
              types.push(...fieldDirectives);
              types.push(...typeDirectives);
              visiting.push(...fieldTypes);
            }
            break;
          case graphql.Kind.UNION_TYPE_DEFINITION:
            if (node.name.value === typeName) {
              const unionTypes = node.types.map(type => type.name.value);
              types.push(...unionTypes);
              visiting.push(...unionTypes);
            }
            break;
          default: break;
        } 
      }
    }

    //Second pass prunes out anything not in the expanded type list
    return graphql.visit(document, {
      enter(node) {
        switch (node.kind) {  
          case graphql.Kind.OBJECT_TYPE_DEFINITION:
          case graphql.Kind.UNION_TYPE_DEFINITION:
          case graphql.Kind.ENUM_TYPE_DEFINITION:
          case graphql.Kind.SCALAR_TYPE_DEFINITION:
          case graphql.Kind.DIRECTIVE_DEFINITION:
          case graphql.Kind.INPUT_OBJECT_TYPE_DEFINITION:
            if (!types.includes(node.name.value)) {
              return null;
            }
            break;
          default: break;
        }
      }
    });
  }
}

/**
 * Load a graphql file and process imports
 */
class GraphQLFileLoader {
  constructor() {
    this._fileLoader = new CachedFileLoader();
    this._graphqlParser = new CachedGraphqlParser();
    this._definitionFilter = new DocumentDefinitionFilter();
  }
  static parseImportStatements(basePath, fileContents) {
    const imports = [];

    for (const line of fileContents.split(/\r?\n/).map((l) => l.trim())) {
      if (!line.startsWith('# import') && !line.startsWith('#import')) {
        continue;
      }

      const importLine = line.slice(line.indexOf('import') + 7);

      const regex = /(.+) from (.+)/;
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
  async buildImportsListFrom(fileName) {
    const files = [fileName];
    const visited = new Set();
    const imports = new Map();

    imports.set(fileName, ['*']);
  
    while (files.length > 0) {
      const file = files.pop();
  
      if (visited.has(file)) {
        continue;
      }
  
      visited.add(file);
  
      const basePath = path.dirname(file);
  
      const fileContents = await this._fileLoader.loadFile(file);
      
      const importStatements = GraphQLFileLoader.parseImportStatements(basePath, fileContents);
  
      if (importStatements.length) {
        for (const { types, fileName } of importStatements) {
          if (!imports.has(fileName)) {
            imports.set(fileName, []);
          }
          imports.get(fileName).push(...types);
          files.push(fileName);
        }
      }
    }
  
    return imports;
  }
  async loadFile(cwd = __dirname, filePath) {
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
    const definitions = [];

    //Build a dependency tree
    const imports = await this.buildImportsListFrom(absolutePath);

    //Make a copy so we can reverse-process from bottom to top
    const entries = [...imports.entries()];

    //This iterates through imports, parses graphql, and prunes out the requests types
    while (entries.length > 0) {
      const [ fileName, types ] = entries.pop();

      const file = await this._fileLoader.loadFile(fileName); //This file is already cached from earlier
      const document = this._graphqlParser.parse(fileName, file);

      if (types.includes('*')) {
        definitions.push(document.definitions);
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
}

module.exports = { CachedFileLoader, GraphQLFileLoader, DocumentDefinitionFilter };