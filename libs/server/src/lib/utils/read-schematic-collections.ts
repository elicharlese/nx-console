import { Schematic, SchematicCollection } from '@nx-console/schema';
import { basename, dirname, join } from 'path';

import {
  directoryExists,
  fileExistsSync,
  listFiles,
  listOfUnnestedNpmPackages,
  normalizeSchema,
  readAndCacheJsonFile,
  readAndParseJson,
  toLegacyWorkspaceFormat
} from './utils';

export async function readAllSchematicCollections(
  workspaceJsonPath: string
): Promise<SchematicCollection[]> {
  const basedir = join(workspaceJsonPath, '..');
  let collections = await readSchematicCollectionsFromNodeModules(
    workspaceJsonPath
  );
  collections = [
    ...collections,
    ...(await checkAndReadWorkspaceCollection(
      basedir,
      join('tools', 'schematics')
    )),
    ...(await checkAndReadWorkspaceCollection(
      basedir,
      join('tools', 'generators')
    ))
  ];
  return collections.filter(
    (collection): collection is SchematicCollection =>
      !!collection && collection!.schematics!.length > 0
  );
}

async function checkAndReadWorkspaceCollection(
  basedir: string,
  workspaceSchematicsPath: string
) {
  if (directoryExists(join(basedir, workspaceSchematicsPath))) {
    return readWorkspaceSchematicsCollection(
      basedir,
      workspaceSchematicsPath
    ).then(val => [val]);
  }
  return Promise.resolve([]);
}

function readWorkspaceJsonDefaults(workspaceJsonPath: string): any {
  const defaults =
    toLegacyWorkspaceFormat(readAndParseJson(workspaceJsonPath)).schematics ||
    {};
  const collectionDefaults = Object.keys(defaults).reduce(
    (collectionDefaultsMap: any, key) => {
      if (key.includes(':')) {
        const [collectionName, schematicName] = key.split(':');
        if (!collectionDefaultsMap[collectionName]) {
          collectionDefaultsMap[collectionName] = {};
        }
        collectionDefaultsMap[collectionName][schematicName] = defaults[key];
      } else {
        const collectionName = key;
        if (!collectionDefaultsMap[collectionName]) {
          collectionDefaultsMap[collectionName] = {};
        }
        Object.keys(defaults[collectionName]).forEach(schematicName => {
          collectionDefaultsMap[collectionName][schematicName] =
            defaults[collectionName][schematicName];
        });
      }
      return collectionDefaultsMap;
    },
    {}
  );
  return collectionDefaults;
}

async function readSchematicCollectionsFromNodeModules(
  workspaceJsonPath: string
): Promise<SchematicCollection[]> {
  const basedir = join(workspaceJsonPath, '..');
  const nodeModulesDir = join(basedir, 'node_modules');
  const packages = listOfUnnestedNpmPackages(nodeModulesDir);
  const schematicCollections = packages.filter(p => {
    try {
      const packageJson = readAndCacheJsonFile(
        join(p, 'package.json'),
        nodeModulesDir
      ).json;
      return !!(packageJson.schematics || packageJson.generators);
    } catch (e) {
      if (
        e.message &&
        (e.message.indexOf('no such file') > -1 ||
          e.message.indexOf('not a directory') > -1)
      ) {
        return false;
      } else {
        throw e;
      }
    }
  });
  const defaults = readWorkspaceJsonDefaults(workspaceJsonPath);

  return (await Promise.all(
    schematicCollections.map(c => readCollection(nodeModulesDir, c, defaults))
  )).filter((c): c is SchematicCollection => Boolean(c));
}

async function readWorkspaceSchematicsCollection(
  basedir: string,
  workspaceSchematicsPath: string
): Promise<{
  name: string;
  schematics: Schematic[];
}> {
  const collectionDir = join(basedir, workspaceSchematicsPath);
  const collectionName = 'workspace-schematic';
  if (fileExistsSync(join(collectionDir, 'collection.json'))) {
    const collection = readAndCacheJsonFile('collection.json', collectionDir);

    return await readCollectionSchematics(
      collectionName,
      collection.path,
      collection.json
    );
  } else {
    const schematics: Schematic[] = await Promise.all(
      listFiles(collectionDir)
        .filter(f => basename(f) === 'schema.json')
        .map(async f => {
          const schemaJson = readAndCacheJsonFile(f, '');
          return {
            name: schemaJson.json.id,
            collection: collectionName,
            options: await normalizeSchema(schemaJson.json),
            description: ''
          };
        })
    );
    return { name: collectionName, schematics };
  }
}

async function readCollection(
  basedir: string,
  collectionName: string,
  defaults?: any
): Promise<SchematicCollection | null> {
  try {
    const packageJson = readAndCacheJsonFile(
      join(collectionName, 'package.json'),
      basedir
    );
    const collection = readAndCacheJsonFile(
      packageJson.json.schematics || packageJson.json.generators,
      dirname(packageJson.path)
    );
    return readCollectionSchematics(
      collectionName,
      collection.path,
      collection.json,
      defaults
    );
  } catch (e) {
    // this happens when package is misconfigured. We decided to ignore such a case.
    return null;
  }
}

async function readCollectionSchematics(
  collectionName: string,
  collectionPath: string,
  collectionJson: any,
  defaults?: any
) {
  const schematicCollection = {
    name: collectionName,
    schematics: [] as Schematic[]
  };
  try {
    Object.entries(
      collectionJson.schematics || collectionJson.generators
    ).forEach(async ([k, v]: [any, any]) => {
      try {
        if (canAdd(k, v)) {
          const schematicSchema = readAndCacheJsonFile(
            v.schema,
            dirname(collectionPath)
          );
          const projectDefaults =
            defaults && defaults[collectionName] && defaults[collectionName][k];

          schematicCollection.schematics.push({
            name: k,
            collection: collectionName,
            options: await normalizeSchema(
              schematicSchema.json,
              projectDefaults
            ),
            description: v.description || ''
          });
        }
      } catch (e) {
        console.error(e);
        console.error(
          `Invalid package.json for schematic ${collectionName}:${k}`
        );
      }
    });
  } catch (e) {
    console.error(e);
    console.error(`Invalid package.json for schematic ${collectionName}`);
  }
  return schematicCollection;
}

export function canAdd(
  name: string,
  s: { hidden: boolean; private: boolean; schema: string; extends: boolean }
): boolean {
  return !s.hidden && !s.private && !s.extends && name !== 'ng-add';
}