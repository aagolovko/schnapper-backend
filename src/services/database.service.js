import * as mongoDB from "mongodb";
import * as dotenv from "dotenv-flow";
export const collections = {
    articles: undefined,
    searchProfiles: undefined,
};
export function getArticlesCollection() {
    if (!collections.articles) {
        throw new Error('Articles collection has not been initialized');
    }
    return collections.articles;
}
export function getSearchProfilesCollection() {
    if (!collections.searchProfiles) {
        throw new Error('Search profiles collection has not been initialized');
    }
    return collections.searchProfiles;
}
export async function connectToDatabase() {
    // Pulls in the .env.dev file so it can be accessed from process.env. No path as .env.dev is in root, the default location
    dotenv.config();
    // Create a new MongoDB client with the connection string from .env.dev
    const mongoUrl = process.env.MONGODB_URL;
    const dbName = process.env.DB_NAME;
    const articlesCollectionName = process.env.ARTICLES_COLLECTION_NAME;
    if (!mongoUrl || !dbName || !articlesCollectionName) {
        throw new Error('Missing MongoDB configuration');
    }
    const client = new mongoDB.MongoClient(mongoUrl);
    // Connect to the cluster
    await client.connect();
    // Connect to the database with the name specified in .env.dev
    const db = client.db(dbName);
    // // Apply schema validation to the collection
    await applySchemaValidation(db, articlesCollectionName);
    // Connect to the collection with the specific name from .env.dev, found in the database previously specified
    const articlesCollection = db.collection(articlesCollectionName);
    const searchProfilesCollection = db.collection('searchProfiles');
    // Persist the connection to the Games collection
    collections.articles = articlesCollection;
    collections.searchProfiles = searchProfilesCollection;
    console.log(`Successfully connected to database: ${db.databaseName} and collections`);
    return client;
}
// Update our existing collection with JSON schema validation so we know our documents will always match the shape of our Game model, even if added elsewhere.
// For more information about schema validation, see this blog series: https://www.mongodb.com/blog/post/json-schema-validation--locking-down-your-model-the-smart-way
async function applySchemaValidation(db, articlesCollectionName) {
    const jsonSchema = {
        $jsonSchema: {
            bsonType: "object",
            required: ["href"],
            additionalProperties: true,
            properties: {
                title: {
                    bsonType: "string",
                    description: "'title' is required and is a string",
                },
                href: {
                    bsonType: "string",
                    description: "link to the article on the source platform",
                },
            },
        },
    };
    // Try applying the modification to the collection, if the collection doesn't exist, create it
    await db.command({
        collMod: articlesCollectionName,
        validator: jsonSchema
    }).catch(async (error) => {
        if (error.codeName === 'NamespaceNotFound') {
            await db.createCollection(articlesCollectionName, { validator: jsonSchema });
        }
    });
}
