'use strict';

const graphql = require('graphql');
const fs = require('fs/promises');
const path = require('path');
const { type } = require('os');

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
 * TODO: Might make sense to make this specific to unique files or documents
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
    const dependencies = new Set(types);
    const visiting = [...types];

    const getFieldType = function (field) {
      let fieldType = field.type;

      //Drill into NonNull and Lists
      while (fieldType.kind) {
        if (fieldType.kind === 'NonNullType' || fieldType.kind === 'ListType') {
          fieldType = fieldType.type;
        } 
        else if (fieldType.kind === 'NamedType') {
          fieldType = fieldType.name.value;
        } 
      }

      return fieldType;
    };

    const addFieldTypes = function (node) {
      for (const field of node.fields) {
        addArgumentTypes(field);

        let fieldType = getFieldType(field);
        
        if (!DocumentDefinitionFilter.isBuiltInType(fieldType)) {
          visiting.push(fieldType);
        }

        visiting.push(...field.directives.map(directive => directive.name.value));
      }
    }

    const addArgumentTypes = function (field) {
      if (!field.arguments) {
        return;
      }
      for (const arg of field.arguments) {
        let argType = getFieldType(arg);
        
        if (!DocumentDefinitionFilter.isBuiltInType(argType)) {
          visiting.push(argType);
        }
      }
    }

    //First pass finds transitive dependencies
    while (visiting.length > 0) {
      const typeName = visiting.pop();

      //Add this type to dependencies
      dependencies.add(typeName);

      //Figure out transitive dependencies
      for (const node of document.definitions) {
        //If the name doesn't match the type we're traversing, skip it
        if (node.name && node.name.value !== typeName) {
          continue;
        }
        //If this is not an extension and has already been visited, skip it
        //Otherwise, if it is an extension or a type that has not been visited, visit it
        if (this._visited.has(typeName)) {
          if (node.kind === graphql.Kind.OBJECT_TYPE_DEFINITION ||
            node.kind === graphql.Kind.UNION_TYPE_DEFINITION ||
            node.kind === graphql.Kind.ENUM_TYPE_DEFINITION ||
            node.kind === graphql.Kind.SCALAR_TYPE_DEFINITION ||
            node.kind === graphql.Kind.DIRECTIVE_DEFINITION ||
            node.kind === graphql.Kind.INPUT_OBJECT_TYPE_DEFINITION ||
            node.kind === graphql.Kind.INTERFACE_TYPE_DEFINITION) {
              continue;
          }
        }
        if (node.kind === graphql.Kind.INTERFACE_TYPE_DEFINITION) {
          //Visit the implementations
          visiting.push(...DocumentDefinitionFilter.findImplementationsFor(typeName, document));
          //Visit field types
          addFieldTypes(node);
        }
        if (node.kind === graphql.Kind.OBJECT_TYPE_DEFINITION || node.kind === graphql.Kind.OBJECT_TYPE_EXTENSION || node.kind === graphql.Kind.INPUT_OBJECT_TYPE_DEFINITION) {
          //Visit the directives
          visiting.push(...node.directives.map(directive => directive.name.value));
          //Visit the interfaces
          if (node.kind !== graphql.Kind.INPUT_OBJECT_TYPE_DEFINITION) {
            visiting.push(...node.interfaces.map(iface => iface.name.value).filter(name => !this._visited.has(name))); 
          }
          //Visit field types
          addFieldTypes(node);
        }
        if (node.kind === graphql.Kind.UNION_TYPE_DEFINITION || node.kind === graphql.Kind.UNION_TYPE_EXTENSION) {
          //Visit the types a union is made up of
          visiting.push(...node.types.map(type => type.name.value));
        }
      }

      this._visited.add(typeName);
    }

    //Second pass prunes out anything not in the expanded type list
    const definitions = [];

    for (const definition of document.definitions) {
      if (!definition.name) {
        definitions.push(definition);
      }
      if (definition.kind === graphql.Kind.OBJECT_TYPE_DEFINITION ||
        definition.kind === graphql.Kind.UNION_TYPE_DEFINITION ||
        definition.kind === graphql.Kind.ENUM_TYPE_DEFINITION ||
        definition.kind === graphql.Kind.SCALAR_TYPE_DEFINITION ||
        definition.kind === graphql.Kind.DIRECTIVE_DEFINITION ||
        definition.kind === graphql.Kind.INPUT_OBJECT_TYPE_DEFINITION ||
        definition.kind === graphql.Kind.INTERFACE_TYPE_DEFINITION || 
        definition.kind === graphql.Kind.OBJECT_TYPE_EXTENSION ||
        definition.kind === graphql.Kind.UNION_TYPE_EXTENSION) {
          if (dependencies.has(definition.name.value)) {
            definitions.push(definition);
          }
      }
    }

    return {
      kind: 'Document',
      definitions
    };
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
}

module.exports = { CachedFileLoader, CachedGraphqlParser, GraphQLFileLoader, DocumentDefinitionFilter };