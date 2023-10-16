# graphql-import

Due to issues in graphql-tools import functionality (https://github.com/ardatan/graphql-tools/issues/5436), I am writing a utility for loading a graphql file with support for `#import` syntax that is easier to debug and more performant.

There are 4 classes exported:

- `CachedFileLoader` - load a file and cache its contents by absolute file name
- `CachedGraphqlParser` - parse a graphql string and cache its contents by absolute file name
- `DocumentDefinitionFilter` - filter a graphql document object's definitions by a list of types and their transitive dependencies
- `GraphQLFileLoader` - load a graphql file by filename and resolve all import statements