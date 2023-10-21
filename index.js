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
    this._typeMaps = new WeakMap();
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
  /**
   * This builds a type map for the given AST document so we don't have to keep iterating through 
   * it while building a dependency tree.
   * @param {*} document 
   * @returns 
   */
  getTypeMapFor(document) {
    if (this._typeMaps.has(document)) {
      return this._typeMaps.get(document);
    }

    const types = {};
    const typeInterface = {};
    const typeExtensions = {};

    const addInterfaces = function (typeName, node) {
      for (const iface of node.interfaces) {
        const ifaceName = iface.name.value;

        if (!typeInterface[ifaceName]) {
          typeInterface[ifaceName] = [];
        }
        typeInterface[ifaceName].push(typeName);
      } 
    };

    for (const node of document.definitions) {
      if (!node.name) {
        continue;
      }

      const typeName = node.name.value;

      //If this is an extension, capture it and then add it later
      if (DocumentDefinitionFilter.extensionType(node)) {
          if (!typeExtensions[typeName]) {
            typeExtensions[typeName] = [];
          }
          typeExtensions[typeName].push(node);

          if (node.kind === graphql.Kind.OBJECT_TYPE_EXTENSION) {
            addInterfaces(typeName, node);
          }

          continue;
      }

      //Build a map of interfaces to types
      if (node.kind === graphql.Kind.OBJECT_TYPE_DEFINITION) {
        addInterfaces(typeName, node);
      }

      types[typeName] = node;
    }

    this._typeMaps.set(document, { types, typeInterface, typeExtensions});

    return this._typeMaps.get(document);
  }
  static unwrapTypeNameFrom(node) {
    let type = node.type;

    //Drill into NonNull and Lists
    while (type.kind) {
      if (type.kind === graphql.Kind.NON_NULL_TYPE || type.kind === graphql.Kind.LIST_TYPE) {
        type = type.type;
      } 
      else if (type.kind === graphql.Kind.NAMED_TYPE) {
        type = type.name.value;
      } 
    }

    return type;
  }
  static extensionType(definition) {
    return definition.kind === graphql.Kind.OBJECT_TYPE_EXTENSION ||
    definition.kind === graphql.Kind.UNION_TYPE_EXTENSION ||
    definition.kind === graphql.Kind.INTERFACE_TYPE_EXTENSION ||
    definition.kind === graphql.Kind.SCALAR_TYPE_EXTENSION ||
    definition.kind === graphql.Kind.INPUT_OBJECT_TYPE_EXTENSION ||
    definition.kind === graphql.Kind.ENUM_TYPE_EXTENSION;
  }
  static addArgumentTypes(field) {
    const dependencies = [];

    if (!field.arguments) {
      return dependencies;
    }
    for (const arg of field.arguments) {
      let argType = DocumentDefinitionFilter.unwrapTypeNameFrom(arg);
      
      if (!DocumentDefinitionFilter.isBuiltInType(argType)) {
        dependencies.push(argType);
      }
    }
    return dependencies;
  }
  static addFieldTypes(node) {
    const dependencies = [];

    for (const field of node.fields) {
      dependencies.push(...DocumentDefinitionFilter.addArgumentTypes(field));

      let fieldType = DocumentDefinitionFilter.unwrapTypeNameFrom(field);
      
      if (!DocumentDefinitionFilter.isBuiltInType(fieldType)) {
        dependencies.push(fieldType);
      }

      dependencies.push(...field.directives.map(directive => directive.name.value));
    }
    return dependencies;
  }
  static addTransitiveTypes(definition) {
    const dependencies = [];

    if (definition.kind === graphql.Kind.INTERFACE_TYPE_DEFINITION || definition.kind === graphql.Kind.INTERFACE_TYPE_EXTENSION) {
      dependencies.push(...DocumentDefinitionFilter.addFieldTypes(definition));
    }
    else if (definition.kind === graphql.Kind.OBJECT_TYPE_DEFINITION || definition.kind === graphql.Kind.OBJECT_TYPE_EXTENSION || definition.kind === graphql.Kind.INPUT_OBJECT_TYPE_DEFINITION) {
      //Visit the directives
      dependencies.push(...definition.directives.map(directive => directive.name.value));
      //Visit the interfaces
      if (definition.kind !== graphql.Kind.INPUT_OBJECT_TYPE_DEFINITION) {
        dependencies.push(...definition.interfaces.map(iface => iface.name.value)); 
      }
      //Visit field types
      dependencies.push(...DocumentDefinitionFilter.addFieldTypes(definition));
    }
    else if (definition.kind === graphql.Kind.UNION_TYPE_DEFINITION || definition.kind === graphql.Kind.UNION_TYPE_EXTENSION) {
      //Visit the types a union is made up of
      dependencies.push(...definition.types.map(type => type.name.value));
    }

    return dependencies;
  }
  filter(document, types) {
    const dependencies = new Set(types);
    const visiting = [...types];

    const typeMap = this.getTypeMapFor(document); //Should be cached per document

    //First pass finds transitive dependencies
    while (visiting.length > 0) {
      const typeName = visiting.pop();

      dependencies.add(typeName);

      const definition = typeMap.types[typeName];
      const extensions = typeMap.typeExtensions[typeName] || [];
      const implementations = typeMap.typeInterface[typeName] || []

      //Add dependencies for definition
      if (definition) {
        //If we've already seen this definition we can skip it
        if (!this._visited.has(typeName)) {
          visiting.push(...DocumentDefinitionFilter.addTransitiveTypes(definition));

          //Visit the implementations of this type if its a interface
          if (definition.kind === graphql.Kind.INTERFACE_TYPE_DEFINITION || graphql.Kind.INTERFACE_TYPE_EXTENSION) {
            for (const impl of implementations) {
              visiting.push(impl);
            }
          }
          
          this._visited.add(typeName);
        }
      }
      //There might still be an extension definition even if locally, in this document, there is no type
      else {
        for (const extension of extensions) {
          visiting.push(...DocumentDefinitionFilter.addTransitiveTypes(extension));
        }
      }
    }

    //Second pass prunes out anything not in the expanded type list
    return graphql.visit(document, {
      enter(node) {
        if (node.kind === graphql.Kind.OBJECT_TYPE_DEFINITION ||
          node.kind === graphql.Kind.UNION_TYPE_DEFINITION ||
          node.kind === graphql.Kind.ENUM_TYPE_DEFINITION ||
          node.kind === graphql.Kind.SCALAR_TYPE_DEFINITION ||
          node.kind === graphql.Kind.DIRECTIVE_DEFINITION ||
          node.kind === graphql.Kind.INPUT_OBJECT_TYPE_DEFINITION ||
          node.kind === graphql.Kind.INTERFACE_TYPE_DEFINITION || 
          DocumentDefinitionFilter.extensionType(node)) {
            if (!dependencies.has(node.name.value)) {
              return null;
            }
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
  parseImportStatements(filePath, fileContents) {
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
  async buildImportDependencyTreeFrom(fileName) {
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
  
      const fileContents = await this._fileLoader.loadFile(file);
      
      const importStatements = this.parseImportStatements(file, fileContents);
  
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

    //Build a dependency tree starting with the provided filePath
    const imports = await this.buildImportDependencyTreeFrom(absolutePath);

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