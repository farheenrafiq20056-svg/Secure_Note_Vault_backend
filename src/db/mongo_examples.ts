/**
 * ==============================================================================
 * ASSIGNMENT TASK 2: MongoDB CRUD Operations (Mongoose / Native Driver)
 * Demonstrates:
 * 1. db.collection.insertOne() for creating a document with embedded subfields
 * 2. db.collection.find() with compound query filtering, projection, and sorting
 * ==============================================================================
 */

export interface MongoObjectId {
  toHexString(): string;
  toString(): string;
}

export interface MongoNoteDocument {
  _id?: string | MongoObjectId;
  userId: string | MongoObjectId;
  title: string;
  contentEncrypted: string;
  nonce: string;
  isFavorite: boolean;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface MongoDbCollection<T> {
  insertOne(doc: T): Promise<{ insertedId: string | MongoObjectId; acknowledged: boolean }>;
  find(filter: any, options?: { projection?: any }): {
    sort(sortSpec: any): {
      limit(limitNum: number): {
        toArray(): Promise<T[]>;
      };
    };
  };
}

export interface MongoDatabase {
  collection<T>(name: string): MongoDbCollection<T>;
}

export interface MongoDbClient {
  db(dbName: string): MongoDatabase;
}

/**
 * Task 2.1: insertOne() operation
 * Inserts an encrypted note document into the `notes` collection.
 */
export async function demonstrateMongoInsert(
  client: MongoDbClient,
  noteData: Omit<MongoNoteDocument, '_id' | 'createdAt' | 'updatedAt'>
) {
  const db = client.db('notesvault');
  const collection = db.collection<MongoNoteDocument>('notes');

  const docToInsert: MongoNoteDocument = {
    ...noteData,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const result = await collection.insertOne(docToInsert);
  console.log(`Document inserted with _id: ${result.insertedId}`);
  return result;
}

/**
 * Task 2.2: find() with filter, projection, and sorting
 * Retrieves non-sensitive note headers matching specific tags and ownership.
 */
export async function demonstrateMongoFind(
  client: MongoDbClient,
  userId: string | MongoObjectId,
  targetTag: string
) {
  const db = client.db('notesvault');
  const collection = db.collection<MongoNoteDocument>('notes');

  // Query filter: match userId AND tags array contains targetTag AND isFavorite is true
  const queryFilter = {
    userId: userId,
    tags: { $in: [targetTag] },
    isFavorite: true
  };

  // Projection: Exclude encrypted content payload for overview lists
  const projection = {
    _id: 1,
    title: 1,
    isFavorite: 1,
    tags: 1,
    createdAt: 1,
    updatedAt: 1
  };

  const cursor = collection
    .find(queryFilter, { projection })
    .sort({ createdAt: -1 })
    .limit(20);

  const notesList = await cursor.toArray();
  return notesList;
}
