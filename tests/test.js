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

  t.equal(expected, contents);

  t.doesNotThrow(() => {
    graphql.validateSchema(graphql.buildSchema(contents));
  });
  
  t.end();
});

test('test load unions', async (t) => {
  const expected = await loadFile('fixtures/unions/expected.graphql');
  
  const loader = new loaders.GraphQLFileLoader();

  const contents = await loader.loadFile(__dirname, 'fixtures/unions/a.graphql');

  t.equal(expected, contents);

  t.doesNotThrow(() => {
    graphql.validateSchema(graphql.buildSchema(contents));
  });
  
  t.end();
});