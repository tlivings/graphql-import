'use strict';

const graphql = require('graphql');

class TypeMap {
  constructor(definitions) {
    this._types = {};
    this._typeExtensions = {};
    this._operations = {};
    this._interfaceImplementations = {};
    this._schema = undefined;
    this._schemaExtensions = [];

    for (const definition of definitions) {
      this.addType(definition);
    }
  }
  isTypeDefinition(type) {
    return [
      graphql.Kind.OBJECT_TYPE_DEFINITION,
      graphql.Kind.UNION_TYPE_DEFINITION,
      graphql.Kind.ENUM_TYPE_DEFINITION,
      graphql.Kind.SCALAR_TYPE_DEFINITION,
      graphql.Kind.DIRECTIVE_DEFINITION,
      graphql.Kind.INPUT_OBJECT_TYPE_DEFINITION,
      graphql.Kind.INTERFACE_TYPE_DEFINITION,
    ].includes(type.kind);
  }
  addType(type) {
    if (type.kind === graphql.Kind.SCHEMA_DEFINITION) {
      this._schema = type;
      return;
    }
    if (type.kind === graphql.Kind.SCHEMA_EXTENSION) {
      this._schemaExtensions.push(type);
      return;
    }

    if (
      type.kind === graphql.Kind.OBJECT_TYPE_DEFINITION ||
      type.kind === graphql.Kind.OBJECT_TYPE_EXTENSION
    ) {
      this.addInterfacesFor(type);
    }

    if (DocumentDefinitionFilter.extensionType(type)) {
      if (!this._typeExtensions[type.name.value]) {
        this._typeExtensions[type.name.value] = [];
      }
      this._typeExtensions[type.name.value].push(type);
    } else if (this.isTypeDefinition(type)) {
      this._types[type.name.value] = type;
    }
  }
  addInterfacesFor(type) {
    for (const iface of type.interfaces) {
      const ifaceName = iface.name.value;

      if (!this._interfaceImplementations[ifaceName]) {
        this._interfaceImplementations[ifaceName] = [];
      }
      this._interfaceImplementations[ifaceName].push(type.name.value);
    }
  }
  getType(typeName) {
    return this._types[typeName];
  }
  getTypeExtensions(typeName) {
    return this._typeExtensions[typeName] || [];
  }
  getImplementationsOf(interfaceName) {
    return this._interfaceImplementations[interfaceName] || [];
  }
  getSchema() {
    return {
      schema: this._schema,
      extensions: this._schemaExtensions,
    };
  }
}

/**
 * Designed to filter a document object by the provided type names and their transitive dependencies
 */
class DocumentDefinitionFilter {
  constructor() {
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

    this._typeMaps.set(document, new TypeMap(document.definitions));

    return this._typeMaps.get(document);
  }
  static unwrapTypeNameFrom(node) {
    let type = node.type;

    //Drill into NonNull and Lists
    while (type.kind) {
      if (type.kind === graphql.Kind.NON_NULL_TYPE || type.kind === graphql.Kind.LIST_TYPE) {
        type = type.type;
      } else if (type.kind === graphql.Kind.NAMED_TYPE) {
        type = type.name.value;
      }
    }

    return type;
  }
  static extensionType(definition) {
    return (
      definition.kind === graphql.Kind.OBJECT_TYPE_EXTENSION ||
      definition.kind === graphql.Kind.UNION_TYPE_EXTENSION ||
      definition.kind === graphql.Kind.INTERFACE_TYPE_EXTENSION ||
      definition.kind === graphql.Kind.SCALAR_TYPE_EXTENSION ||
      definition.kind === graphql.Kind.INPUT_OBJECT_TYPE_EXTENSION ||
      definition.kind === graphql.Kind.ENUM_TYPE_EXTENSION
    );
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

      dependencies.push(...field.directives.map((directive) => directive.name.value));
    }
    return dependencies;
  }
  static addTransitiveTypes(definition) {
    const dependencies = [];

    if (definition.directives) {
      //Visit the directives
      dependencies.push(...definition.directives.map((directive) => directive.name.value));
    }

    if (
      definition.kind === graphql.Kind.INTERFACE_TYPE_DEFINITION ||
      definition.kind === graphql.Kind.INTERFACE_TYPE_EXTENSION
    ) {
      //Visit field types
      dependencies.push(...DocumentDefinitionFilter.addFieldTypes(definition));
    } else if (
      definition.kind === graphql.Kind.OBJECT_TYPE_DEFINITION ||
      definition.kind === graphql.Kind.OBJECT_TYPE_EXTENSION ||
      definition.kind === graphql.Kind.INPUT_OBJECT_TYPE_DEFINITION
    ) {
      //Visit the interfaces
      if (definition.kind !== graphql.Kind.INPUT_OBJECT_TYPE_DEFINITION) {
        dependencies.push(...definition.interfaces.map((iface) => iface.name.value));
      }
      //Visit field types
      dependencies.push(...DocumentDefinitionFilter.addFieldTypes(definition));
    } else if (
      definition.kind === graphql.Kind.UNION_TYPE_DEFINITION ||
      definition.kind === graphql.Kind.UNION_TYPE_EXTENSION
    ) {
      //Visit the types a union is made up of
      dependencies.push(...definition.types.map((type) => type.name.value));
    } else if (
      definition.kind === graphql.Kind.ENUM_TYPE_DEFINITION ||
      definition.kind === graphql.Kind.ENUM_TYPE_EXTENSION
    ) {
      //Visit the values which may have directives
      for (const value of definition.values) {
        dependencies.push(...value.directives.map((directive) => directive.name.value));
      }
    }

    return dependencies;
  }
  filter(document, otherDependencies, types) {
    const visited = new Set();
    const visiting = [...types];

    const mergedDocument = {
      kind: graphql.Kind.DOCUMENT,
      definitions: [...otherDependencies, ...document.definitions],
    };

    const typeMap = this.getTypeMapFor(mergedDocument); //Should be cached per document

    //First pass finds transitive dependencies
    while (visiting.length > 0) {
      const typeName = visiting.pop();

      const definition = typeMap.getType(typeName);
      const typeExtensions = typeMap.getTypeExtensions(typeName);
      const implementations = typeMap.getImplementationsOf(typeName);

      //Add dependencies for definition
      if (definition) {
        //If we've already seen this definition we can skip it
        if (!visited.has(typeName)) {
          visiting.push(...DocumentDefinitionFilter.addTransitiveTypes(definition));

          //Visit the implementations of this type if its a interface
          if (
            definition.kind === graphql.Kind.INTERFACE_TYPE_DEFINITION ||
            definition.kind === graphql.Kind.INTERFACE_TYPE_EXTENSION
          ) {
            for (const impl of implementations) {
              visiting.push(impl);
            }
          }

          visited.add(typeName);
        }
      }

      //There might still be an extension definition even if locally, in this document, there is no type
      for (const extension of typeExtensions) {
        visiting.push(...DocumentDefinitionFilter.addTransitiveTypes(extension));
      }
    }

    const added = new Set();
    const newDocument = {
      kind: graphql.Kind.DOCUMENT,
      definitions: [],
    };

    //Second pass selects only our known dependencies from the typemap
    for (const typeName of visited) {
      const definition = typeMap.getType(typeName);
      const typeExtensions = typeMap.getTypeExtensions(typeName);
      let toAdd = [];

      /**
       * This adds extensions to a type, either before or after the type depending.
       * (thats just for formatting purposes)
       * @param {*} typeExtensions
       * @param {*} push
       */
      const addExtensions = function (typeExtensions = [], push) {
        for (const extension of typeExtensions) {
          const extensionName = extension.kind + extension.name.value;
          if (!DocumentDefinitionFilter.extensionType(extension)) {
            if (added.has(extensionName)) {
              continue;
            }
            added.add(extensionName);
          }
          if (push) {
            toAdd.push(extension);
            continue;
          }
          toAdd.unshift(extension);
        }
      };

      if (definition) {
        //Skip if added this kind and name
        if (added.has(definition.kind + typeName)) {
          continue;
        }
        added.add(definition.kind + typeName);
        toAdd.push(definition);
      }
      //Add any extensions
      addExtensions(typeExtensions || [], !!definition);

      newDocument.definitions.unshift(...toAdd);
      toAdd = [];
    }

    return newDocument;
  }
}

module.exports = { DocumentDefinitionFilter };
