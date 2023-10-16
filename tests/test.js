'use strict';

const fs = require('fs/promises');
const path = require('path');
const test = require('tape');
const loaders = require('..');
const graphql = require('graphql');

const loadFile = async function (fileName) {
  return (await fs.readFile(path.resolve(__dirname, fileName))).toString().trim();
}

test('test load simple', async (t) => {
  const expected = await loadFile('fixtures/simple/expected.graphql');
  
  const loader = new loaders.GraphQLFileLoader();

  const contents = await loader.loadFile(__dirname, 'fixtures/simple/a.graphql');

  t.equal(contents, expected);

  t.doesNotThrow(() => {
    graphql.validateSchema(graphql.buildSchema(contents));
  });
  
  t.end();
});

test('test load unions', async (t) => {
  const expected = await loadFile('fixtures/unions/expected.graphql');
  
  const loader = new loaders.GraphQLFileLoader();

  const contents = await loader.loadFile(__dirname, 'fixtures/unions/a.graphql');

  t.equal(contents, expected);

  t.doesNotThrow(() => {
    graphql.validateSchema(graphql.buildSchema(contents));
  });
  
  t.end();
});

test('test load only imported types', async (t) => {
  const expected = await loadFile('fixtures/unused/expected.graphql');
  
  const loader = new loaders.GraphQLFileLoader();

  const contents = await loader.loadFile(__dirname, 'fixtures/unused/a.graphql');

  t.equal(contents, expected);

  t.doesNotThrow(() => {
    graphql.validateSchema(graphql.buildSchema(contents));
  });
  
  t.end();
});

test('test circular', async (t) => {
  const expected = await loadFile('fixtures/circular/expected.graphql');
  
  const loader = new loaders.GraphQLFileLoader();

  const contents = await loader.loadFile(__dirname, 'fixtures/circular/a.graphql');

  t.equal(contents, expected);

  t.doesNotThrow(() => {
    graphql.validateSchema(graphql.buildSchema(contents));
  });
  
  t.end();
});

test('test collision', async (t) => {
  const loader = new loaders.GraphQLFileLoader();

  const contents = await loader.loadFile(__dirname, 'fixtures/collision/a.graphql');

  t.throws(() => {
    graphql.validateSchema(graphql.buildSchema(contents));
  });
  
  t.end();
});

test('test deep', async (t) => {
  const expected = await loadFile('fixtures/deep/expected.graphql');
  
  const loader = new loaders.GraphQLFileLoader();

  const contents = await loader.loadFile(__dirname, 'fixtures/deep/a.graphql');

  t.equal(contents, expected);

  t.doesNotThrow(() => {
    graphql.validateSchema(graphql.buildSchema(contents));
  });
  
  t.end();
});

test('test interface implementations', async (t) => {
  const expected = await loadFile('fixtures/implements/expected.graphql');
  
  const loader = new loaders.GraphQLFileLoader();

  const contents = await loader.loadFile(__dirname, 'fixtures/implements/a.graphql');

  t.equal(contents, expected);

  t.doesNotThrow(() => {
    graphql.validateSchema(graphql.buildSchema(contents));
  });
  
  t.end();
});